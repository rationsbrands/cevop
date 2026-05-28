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
import { closeSession } from '../services/tableSession';

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
        amount: z.number().positive(),
        method: z.enum(['CASH', 'CARD', 'TRANSFER']),
        reference: z.string().optional(),
        note: z.string().optional(),
        idempotencyKey: z.string().optional(),
      })
      .parse(req.body);

    if (body.idempotencyKey) {
      const existing = await prisma.payment.findFirst({
        where: {
          sessionId: body.sessionId,
          amount: body.amount,
          method: body.method,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 minutes
        },
      });
      if (existing) {
        res.status(200).json({ success: true, data: existing, idempotent: true });
        return;
      }
    }

    // Verify session belongs to this org and branch
    const session = await prisma.tableSession.findFirst({
      where: {
        id: body.sessionId,
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
        closedAt: null,
      },
      select: {
        id: true,
        orders: {
          where: { status: { not: 'CANCELLED' } },
          select: { total: true },
        },
        payments: { select: { amount: true } },
      },
    });

    if (!session) {
      res
        .status(404)
        .json({ success: false, code: 'NOT_FOUND', error: 'Session not found or already closed' });
      return;
    }

    const grandTotal = session.orders.reduce((sum, o) => sum + Number(o.total), 0);
    const alreadyPaid = session.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Math.max(0, grandTotal - alreadyPaid);

    // Don't allow overpayment beyond the balance
    const payAmount = Math.min(body.amount, remaining > 0 ? remaining : body.amount);

    const payment = await prisma.payment.create({
      data: {
        sessionId: body.sessionId,
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
        amount: payAmount,
        currency: req.user!.currency ?? 'NGN',
        method: body.method,
        reference: body.reference,
        note: body.note,
        ordersTotal: grandTotal,
        processedBy: req.user!.userId,
      },
    });

    // Check if fully paid — if so, close the session automatically
    const totalPaid = alreadyPaid + payAmount;
    let sessionClosed = false;

    if (totalPaid >= grandTotal && grandTotal > 0) {
      await closeSession(body.sessionId, req.user!.userId, 'EMPTY').catch((err) => {
        logger.error('Failed to close session during payment processing', {
          err: err.message,
          sessionId: body.sessionId,
        });
      });
      sessionClosed = true;
    }

    // Notify all clients that payment state changed for this session
    const orgBranch = `${req.user!.organizationId}:${req.branchScope!}`;
    io.to(orgBranch).emit('PAYMENT_RECORDED', {
      sessionId: body.sessionId,
      payment: { id: payment.id, amount: Number(payAmount), method: body.method },
      totalPaid,
      grandTotal,
      sessionClosed,
    });
    io.to(orgBranch).emit('SYNC_REQUIRED', {
      type: 'PAYMENT_RECORDED',
      sessionId: body.sessionId,
      sessionClosed,
    });

    res.json({ success: true, data: { payment, sessionClosed, totalPaid, grandTotal } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    logger.error('POST /payments error', { err });
    res
      .status(500)
      .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to record payment' });
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
