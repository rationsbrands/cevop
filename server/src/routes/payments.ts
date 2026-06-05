import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';
import { logger } from '../services/logger';
import { io } from '../index';

export const paymentsRouter = Router();

paymentsRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

const CASHIER_ROLES = [
  'ORG_OWNER',
  'ADMIN',
  'ORG_MANAGER',
  'BRANCH_ADMIN',
  'CASHIER',
  'WAITER',
  'SUPERADMIN',
] as const;

// GET /api/payments/open-sessions — all sessions with unpaid bills
paymentsRouter.get(
  '/open-sessions',
  requireRole(...CASHIER_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const sessions = await prisma.tableSession.findMany({
        where: {
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
          closedAt: null,
          orders: { some: { status: { not: 'CANCELLED' } } },
        },
        orderBy: { openedAt: 'asc' },
        select: {
          id: true,
          openedAt: true,
          guestCount: true,
          table: { select: { label: true, number: true } },
          orders: {
            where: { status: { not: 'CANCELLED' } },
            select: { total: true },
          },
          payments: {
            select: { id: true, amount: true, method: true, processedAt: true },
          },
          serviceRequests: {
            where: { serviceType: 'BILL_REQUEST', status: { not: 'RESOLVED' } },
            select: { id: true },
          },
          assignedWaiter: { select: { id: true, name: true } },
        },
      });

      const result = sessions.map((s) => {
        const grandTotal = s.orders.reduce((sum, o) => sum + Number(o.total), 0);
        const amountPaid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        return {
          sessionId: s.id,
          assignedWaiter: s.assignedWaiter,
          openedAt: s.openedAt,
          guestCount: s.guestCount,
          table: s.table,
          grandTotal,
          amountPaid,
          balance: Math.max(0, grandTotal - amountPaid),
          isPaid: amountPaid >= grandTotal && grandTotal > 0,
          hasBillRequest: s.serviceRequests.length > 0,
          payments: s.payments,
        };
      });

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('GET /payments/open-sessions error', { err });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch open sessions' });
    }
  },
);

// POST /api/payments — record a payment for a session
paymentsRouter.post('/', requireRole(...CASHIER_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const body = z
      .object({
        sessionId: z.string(),
        amount: z.number().optional(), // Optional if itemIds are provided
        itemIds: z.array(z.string()).optional(), // Specific items to pay for
        method: z.enum(['CASH', 'CARD', 'TRANSFER']),
        reference: z.string().optional(),
        note: z.string().optional(),
        idempotencyKey: z.string().optional(),
      })
      .parse(req.body);

    const orgId = req.user!.organizationId;
    const branchId = req.branchScope!;

    // 1. Fetch the session and items
    const session = (await prisma.tableSession.findFirst({
      where: { id: body.sessionId, organizationId: orgId, branchId: branchId, closedAt: null },
      include: {
        orders: {
          where: { status: { not: 'CANCELLED' } },
          include: { items: { where: { cancelledAt: null } } },
        },
        payments: { include: { orderItems: true } as any },
      },
    } as any)) as any;

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found or already closed' });
      return;
    }

    // 2. Identify items being paid for
    let targetItems: any[] = [];
    let calculatedAmount = 0;

    if (body.itemIds && body.itemIds.length > 0) {
      targetItems = session.orders
        .flatMap((o: any) => o.items)
        .filter((i: any) => body.itemIds!.includes(i.id) && i.status !== 'PAID');

      if (targetItems.length === 0) {
        res.status(400).json({ success: false, error: 'No unpaid items found with provided IDs' });
        return;
      }
      calculatedAmount = targetItems.reduce(
        (sum: number, i: any) => sum + Number(i.unitPrice) * i.quantity,
        0,
      );
    }

    const payAmount = body.amount ?? calculatedAmount;

    if (payAmount <= 0) {
      res.status(400).json({ success: false, error: 'Payment amount must be greater than zero' });
      return;
    }

    // 3. Create payment and update items in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      const grandTotal = session.orders.reduce((sum: number, o: any) => sum + Number(o.total), 0);

      const payment = await tx.payment.create({
        data: {
          sessionId: body.sessionId,
          organizationId: orgId,
          branchId: branchId,
          amount: payAmount,
          currency: req.user!.currency ?? 'NGN',
          method: body.method,
          reference: body.reference,
          note: body.note,
          ordersTotal: grandTotal,
          processedBy: req.user!.userId,
          ...(targetItems.length > 0
            ? {
                orderItems: {
                  connect: targetItems.map((i: any) => ({ id: i.id })),
                },
              }
            : {}),
        },
      });

      // Update item statuses if specific items were paid
      if (targetItems.length > 0) {
        await tx.orderItem.updateMany({
          where: { id: { in: targetItems.map((i: any) => i.id) } },
          data: { status: 'PAID' },
        });
      }

      // Re-calculate total paid to see if we should close the session
      const allPayments = await tx.payment.findMany({
        where: { sessionId: body.sessionId },
        select: { amount: true },
      });
      const totalPaid = allPayments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);

      let sessionClosed = false;
      if (totalPaid >= grandTotal && grandTotal > 0) {
        // Auto-close session logic (imported from tableSession service)
        await tx.tableSession.update({
          where: { id: body.sessionId },
          data: { closedAt: new Date(), closedBy: req.user!.userId },
        });

        if (session.tableId) {
          await tx.table.update({
            where: { id: session.tableId },
            data: { status: 'EMPTY', activeSessionId: null } as any,
          });
        }
        sessionClosed = true;
      }

      return { payment, totalPaid, grandTotal, sessionClosed };
    });

    // 4. Resolve any pending BILL_REQUEST service requests for this session
    //    so they disappear from the service desk immediately after payment
    const resolvedBillRequests = await prisma.serviceRequest.findMany({
      where: {
        sessionId: body.sessionId,
        serviceType: 'BILL_REQUEST',
        status: { not: 'RESOLVED' },
      },
      select: { id: true, branchId: true },
    });

    if (resolvedBillRequests.length > 0) {
      await prisma.serviceRequest.updateMany({
        where: { id: { in: resolvedBillRequests.map((r) => r.id) } },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: req.user!.userId } as any,
      });
      const orgBranchTemp = `${orgId}:${branchId}`;
      for (const req of resolvedBillRequests) {
        io.to(orgBranchTemp).emit('SERVICE_REQUEST_UPDATED', {
          id: req.id,
          status: 'RESOLVED',
          sessionId: body.sessionId,
        });
      }
    }

    // 5. Notifications
    const orgBranch = `${orgId}:${branchId}`;
    io.to(orgBranch).emit('PAYMENT_RECORDED', {
      sessionId: body.sessionId,
      payment: result.payment,
      totalPaid: result.totalPaid,
      grandTotal: result.grandTotal,
      sessionClosed: result.sessionClosed,
    });
    io.to(`pub:${orgBranch}`).emit('PAYMENT_RECORDED', {
      sessionId: body.sessionId,
      payment: result.payment,
      totalPaid: result.totalPaid,
      grandTotal: result.grandTotal,
      sessionClosed: result.sessionClosed,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('POST /payments error', { err });
    res.status(500).json({ success: false, error: 'Failed to record payment' });
  }
});

// GET /api/payments/history — recently closed sessions with payments
paymentsRouter.get(
  '/history',
  requireRole(...CASHIER_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const dateFilter: any = { not: null };
      if (req.query.startDate && req.query.endDate) {
        const start = new Date(req.query.startDate as string);
        const end = new Date(req.query.endDate as string);
        end.setHours(23, 59, 59, 999);
        dateFilter.gte = start;
        dateFilter.lte = end;
      } else {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        dateFilter.gte = twentyFourHoursAgo;
      }

      const sessions = await prisma.tableSession.findMany({
        where: {
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
          closedAt: dateFilter,
        },
        orderBy: { closedAt: 'desc' },
        take: 1000,
        select: {
          id: true,
          openedAt: true,
          closedAt: true,
          guestCount: true,
          table: { select: { label: true, number: true } },
          orders: {
            where: { status: { not: 'CANCELLED' } },
            select: { total: true },
          },
          payments: {
            select: { id: true, amount: true, method: true, processedAt: true },
          },
          assignedWaiter: { select: { id: true, name: true, staffCode: true } },
        },
      });

      const result = sessions.map((s) => {
        const grandTotal = s.orders.reduce((sum, o) => sum + Number(o.total), 0);
        const amountPaid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        return {
          sessionId: s.id,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
          guestCount: s.guestCount,
          table: s.table,
          assignedWaiter: s.assignedWaiter,
          grandTotal,
          amountPaid,
          balance: Math.max(0, grandTotal - amountPaid),
          isPaid: amountPaid >= grandTotal && grandTotal > 0,
          payments: s.payments,
        };
      });

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('GET /payments/history error', { err });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch payment history' });
    }
  },
);

// PATCH /api/payments/:id/void — Void a recorded payment
paymentsRouter.patch(
  '/:id/void',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'CASHIER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const paymentId = req.params.id;
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { session: true },
      });

      if (
        !payment ||
        payment.organizationId !== orgId ||
        (branchScope && payment.branchId !== branchScope)
      ) {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Payment not found' });
        return;
      }

      await prisma.$transaction(async (tx) => {
        // 1. Delete the payment
        await tx.payment.delete({
          where: { id: paymentId },
        });

        // 2. If the session was closed, re-open it
        if (payment.session.closedAt) {
          await tx.tableSession.update({
            where: { id: payment.sessionId },
            data: { closedAt: null, closedBy: null },
          });

          // 3. Re-occupy the table
          await tx.table.updateMany({
            where: {
              activeSessionId: null,
              ...(payment.session.tableId ? { id: payment.session.tableId } : {}),
            },
            data: { status: 'OCCUPIED', activeSessionId: payment.sessionId },
          });

          // 4. Emit events
          const orgBranch = `${orgId}:${payment.branchId}`;
          io.to(orgBranch).emit('SESSION_OPENED', {
            sessionId: payment.sessionId,
            tableId: payment.session.tableId,
          });
          io.to(orgBranch).emit('TABLE_STATUS_CHANGED', {
            tableId: payment.session.tableId,
            status: 'OCCUPIED',
          });
        }
      });

      res.json({ success: true, data: { voided: true } });
    } catch (err) {
      logger.error('PATCH /payments/:id/void error', { err });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to void payment' });
    }
  },
);
