import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';
import { closeSession } from '../services/tableSession';
import { io } from '../index';
import { logger } from '../services/logger';

export const sessionsRouter = Router();

// GET /api/sessions/public/:sessionId/bill — public, for customer PWA running tab
sessionsRouter.get('/public/:sessionId/bill', async (req: Request, res: Response) => {
  try {
    const session = await prisma.tableSession.findUnique({
      where: { id: req.params.sessionId },
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        tableId: true,
        assignedWaiter: { select: { staffCode: true, name: true } },
        organizationId: true,
        organization: { select: { currency: true } },
        orders: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            subtotal: true,
            taxAmount: true,
            serviceChargeAmount: true,
            total: true,
            createdAt: true,
            items: {
              where: { cancelledAt: null },
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                notes: true,
                menuItem: { select: { name: true } },
              },
            },
          },
        },
        payments: {
          select: { id: true, amount: true, method: true, processedAt: true },
        },
      },
    });

    if (!session) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Session not found' });
      return;
    }

    const grandSubtotal = session.orders.reduce((sum, o) => sum + Number(o.subtotal), 0);
    const grandTax = session.orders.reduce((sum, o) => sum + Number(o.taxAmount), 0);
    const grandServiceCharge = session.orders.reduce(
      (sum, o) => sum + Number(o.serviceChargeAmount),
      0,
    );
    const grandTotal = session.orders.reduce((sum, o) => sum + Number(o.total), 0);
    const amountPaid = session.payments.reduce((sum, p) => sum + Number(p.amount), 0);

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        openedAt: session.openedAt,
        currency: session.organization.currency,
        assignedWaiter: session.assignedWaiter,
        orders: session.orders.map((o) => ({
          id: o.id,
          status: o.status,
          subtotal: Number(o.subtotal),
          taxAmount: Number(o.taxAmount),
          serviceChargeAmount: Number(o.serviceChargeAmount),
          total: Number(o.total),
          createdAt: o.createdAt,
          items: o.items.map((i) => ({
            name: i.menuItem?.name ?? 'Item',
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
            notes: i.notes,
            lineTotal: i.quantity * Number(i.unitPrice),
          })),
        })),
        grandSubtotal,
        grandTax,
        grandServiceCharge,
        grandTotal,
        amountPaid,
        balance: Math.max(0, grandTotal - amountPaid),
        isPaid: amountPaid >= grandTotal,
        orderCount: session.orders.length,
        closedAt: session.closedAt,
        payments: session.payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          processedAt: p.processedAt,
        })),
      },
    });
  } catch (err) {
    logger.error('GET /sessions/public/:sessionId/bill error', { err });
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch bill' });
  }
});

sessionsRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

// GET /api/sessions/:id/bill — authenticated, for waiter board and cashier
sessionsRouter.get(
  '/:id/bill',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'SERVICE',
    'WAITER',
    'KITCHEN',
    'CASHIER',
    'SUPERADMIN',
    'HOST',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const session = await prisma.tableSession.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          ...(req.branchScope ? { branchId: req.branchScope } : {}),
        },
        select: {
          id: true,
          openedAt: true,
          closedAt: true,
          tableId: true,
          assignedWaiter: { select: { staffCode: true, name: true } },
          organization: { select: { currency: true } },
          table: { select: { label: true, number: true } },
          orders: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              status: true,
              subtotal: true,
              taxAmount: true,
              serviceChargeAmount: true,
              total: true,
              createdAt: true,
              assignedWaiter: true,
              items: {
                where: { cancelledAt: null },
                select: {
                  id: true,
                  quantity: true,
                  unitPrice: true,
                  notes: true,
                  menuItem: { select: { name: true } },
                },
              },
            },
          },
          payments: {
            select: { id: true, amount: true, method: true, processedAt: true },
          },
        },
      });

      if (!session) {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Session not found' });
        return;
      }

      const grandSubtotal = session.orders.reduce((sum, o) => sum + Number(o.subtotal), 0);
      const grandTax = session.orders.reduce((sum, o) => sum + Number(o.taxAmount), 0);
      const grandServiceCharge = session.orders.reduce(
        (sum, o) => sum + Number(o.serviceChargeAmount),
        0,
      );
      const grandTotal = session.orders.reduce((sum, o) => sum + Number(o.total), 0);
      const amountPaid = session.payments.reduce((sum, p) => sum + Number(p.amount), 0);

      res.json({
        success: true,
        data: {
          sessionId: session.id,
          openedAt: session.openedAt,
          closedAt: session.closedAt,
          table: session.table,
          assignedWaiter: session.assignedWaiter,
          currency: session.organization.currency,
          orders: session.orders.map((o) => ({
            id: o.id,
            status: o.status,
            subtotal: Number(o.subtotal),
            taxAmount: Number(o.taxAmount),
            serviceChargeAmount: Number(o.serviceChargeAmount),
            total: Number(o.total),
            createdAt: o.createdAt,
            items: o.items.map((i) => ({
              name: i.menuItem?.name ?? 'Item',
              quantity: i.quantity,
              unitPrice: Number(i.unitPrice),
              notes: i.notes,
              lineTotal: i.quantity * Number(i.unitPrice),
            })),
          })),
          grandSubtotal,
          grandTax,
          grandServiceCharge,
          grandTotal,
          amountPaid,
          balance: Math.max(0, grandTotal - amountPaid),
          isPaid: amountPaid >= grandTotal,
          orderCount: session.orders.length,
          payments: session.payments.map((p) => ({
            id: p.id,
            amount: Number(p.amount),
            method: p.method,
            processedAt: p.processedAt,
          })),
        },
      });
    } catch (err) {
      logger.error('GET /sessions/:id/bill error', { err });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch bill' });
    }
  },
);

// Close an active session
sessionsRouter.patch(
  '/:id/close',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'SERVICE',
    'WAITER',
    'HOST',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const session = await (prisma as any).tableSession.findUnique({
        where: { id: req.params.id },
      });

      if (!session) {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Session not found' });
        return;
      }

      // Enforce org and branch scoped access
      if (
        session.organizationId !== req.user!.organizationId ||
        session.branchId !== req.branchScope
      ) {
        res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Access denied' });
        return;
      }

      if (session.closedAt) {
        res.json({ success: true, message: 'Session already closed', idempotent: true });
        return;
      }

      const bodySchema = z.object({
        nextStatus: z.enum(['CLEANING', 'EMPTY']).optional(),
        // Managers can force-close an unpaid table for genuine walkouts/comps.
        force: z.boolean().optional(),
      });

      const { nextStatus, force } = bodySchema.parse(req.body);

      // ─── Require payment before clearing ──────────────────────────────────
      // A table with an outstanding balance cannot be cleared. The waiter must
      // record payment first. Only org/branch managers may force-close (walkouts).
      const [orders, payments] = await Promise.all([
        prisma.order.findMany({
          where: { sessionId: req.params.id, status: { not: 'CANCELLED' } },
          select: { total: true },
        }),
        (prisma as any).payment.findMany({
          where: { sessionId: req.params.id },
          select: { amount: true },
        }),
      ]);
      const grandTotal = orders.reduce((s, o) => s + Number(o.total), 0);
      const amountPaid = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
      const balance = Number((grandTotal - amountPaid).toFixed(2));

      const isManager = [
        'ORG_OWNER',
        'ADMIN',
        'ORG_MANAGER',
        'BRANCH_ADMIN',
        'SUPERADMIN',
      ].includes(req.user!.role);

      if (balance > 0 && !(force && isManager)) {
        res.status(400).json({
          success: false,
          code: 'UNPAID_BALANCE',
          error: 'This table has an unpaid balance. Record payment before clearing.',
          balance,
        });
        return;
      }

      await closeSession(req.params.id, req.user!.userId, nextStatus);

      res.json({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Session already closed') {
        res.status(400).json({
          success: false,
          code: 'SESSION_ALREADY_CLOSED',
          error: 'Session already closed',
        });
        return;
      }
      logger.error('PATCH /sessions/:id/close error:', err);
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to close session' });
    }
  },
);

// Assign a waiter to a session (manual assignment)
sessionsRouter.patch(
  '/:id/assign-waiter',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { waiterId } = z.object({ waiterId: z.string().nullable() }).parse(req.body);
      const session = await prisma.tableSession.findUnique({
        where: { id: req.params.id },
      });

      if (!session) {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Session not found' });
        return;
      }

      if (
        session.organizationId !== req.user!.organizationId ||
        session.branchId !== req.branchScope
      ) {
        res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Access denied' });
        return;
      }

      if (waiterId) {
        const waiter = await prisma.user.findFirst({
          where: {
            id: waiterId,
            organizationId: req.user!.organizationId,
            branchId: req.branchScope!,
            isActive: true,
          },
        });

        if (!waiter) {
          res
            .status(400)
            .json({ success: false, code: 'INVALID_REQUEST', error: 'Invalid waiter' });
          return;
        }
      }

      await (prisma.tableSession as any).update({
        where: { id: req.params.id },
        data: {
          assignedWaiterId: waiterId,
          assignedWaiterAt: waiterId ? new Date() : null,
        },
      });

      // Notify all clients that waiter assignment changed
      const orgBranch = `${req.user!.organizationId}:${req.branchScope!}`;
      io.to(orgBranch).emit('TABLE_CLAIMED', {
        sessionId: req.params.id,
        tableId: session.tableId,
        waiterId,
      });
      io.to(orgBranch).emit('SYNC_REQUIRED', {
        type: 'WAITER_ASSIGNED',
        sessionId: req.params.id,
      });

      res.json({ success: true });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Validation error',
          details: err.errors,
        });
        return;
      }
      logger.error('PATCH /sessions/:id/assign-waiter error:', err);
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to assign waiter' });
    }
  },
);

// Claim a table session (for Waiter Dashboard)
sessionsRouter.patch(
  '/:id/claim',
  requireRole('WAITER', 'ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const session = await prisma.tableSession.findUnique({
        where: { id: req.params.id },
      });

      if (!session) {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Session not found' });
        return;
      }

      if (
        session.organizationId !== req.user!.organizationId ||
        session.branchId !== req.branchScope
      ) {
        res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Access denied' });
        return;
      }

      const { claimTableSession } = await import('../services/waiterAssignment');
      if (!session.tableId) {
        res
          .status(400)
          .json({ success: false, code: 'INVALID_REQUEST', error: 'Table no longer exists' });
        return;
      }
      const result = await claimTableSession(
        req.user!.userId,
        session.tableId,
        session.id,
        session.branchId,
      );

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      logger.error('PATCH /sessions/:id/claim error:', err);
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to claim session' });
    }
  },
);
