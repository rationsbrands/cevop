import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';
import { notifyStaffWebPush, notifyWaiterCall } from '../services/notifications';
import { io } from '../index';
import { logger } from '../services/logger';
import { findLeastLoadedWaiter } from '../services/waiterAssignment';
import { getOrCreateSession } from '../services/tableSession';

export const waiterCallsRouter = Router();

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

waiterCallsRouter.post('/public', async (req: Request, res: Response) => {
  try {
    const data = z
      .object({
        organizationId: z.string(),
        tableId: z.string(),
        branchId: z.string().optional(),
        reason: z.string().max(200).optional(),
      })
      .parse(req.body);

    const table = await prisma.table.findFirst({
      where: {
        OR: [
          { id: data.tableId, organizationId: data.organizationId },
          { id: data.tableId, organization: { slug: data.organizationId } },
        ],
        isActive: true,
      },
    });
    if (!table) {
      res.status(404).json({ success: false, error: 'Table not found' });
      return;
    }

    const actualBranchId = table.branchId;
    if (data.branchId && data.branchId !== actualBranchId) {
      res
        .status(400)
        .json({ success: false, error: 'Table does not belong to the specified branch' });
      return;
    }

    // Ensure table session is open
    const sessionId = await getOrCreateSession(table.id, table.organizationId, actualBranchId);

    const call = await prisma.waiterCall.create({
      data: {
        organizationId: table.organizationId,
        branchId: actualBranchId,
        tableId: table.id,
        sessionId,
        reason: data.reason,
      },
      include: { table: true, assignedUser: { select: { id: true, name: true } } },
    });

    // Auto-assign to least-loaded online waiter
    const assignedWaiterId = await findLeastLoadedWaiter(
      table.organizationId,
      actualBranchId,
      table.id,
    ).catch(() => null);

    let finalCall = call;
    if (assignedWaiterId) {
      finalCall = await prisma.waiterCall.update({
        where: { id: call.id },
        data: { assignedTo: assignedWaiterId, assignedAt: new Date() },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      if (sessionId) {
        const { claimTableSession } = await import('../services/waiterAssignment');
        await claimTableSession(assignedWaiterId, table.id, sessionId, actualBranchId);
      }

      // Notify the assigned waiter directly
      io.to(`waiter:${assignedWaiterId}`).emit('TASK_ASSIGNED', {
        type: 'WAITER_CALL',
        task: finalCall,
      });
    } else {
      // No waiter online — emit as unassigned so all waiters can claim
      io.to(`${table.organizationId}:${actualBranchId}`).emit('TASK_UNASSIGNED', {
        type: 'WAITER_CALL',
        task: finalCall,
      });
    }

    io.to(`${table.organizationId}:${actualBranchId}`).emit('WAITER_CALLED', finalCall);

    const org = await prisma.organization.findUnique({ where: { id: table.organizationId } });
    if (org && (org as any).notifyWaiterCalls)
      notifyWaiterCall(
        call,
        org.whatsappNumber || undefined,
        org.slackWebhook || undefined,
        org.plan,
        actualBranchId,
        table.organizationId,
      ).catch(() => {});

    notifyStaffWebPush({
      organizationId: table.organizationId,
      branchId: actualBranchId,
      roles: ['WAITER', 'SERVICE'],
      title: 'Waiter Called',
      body: `${finalCall.table?.label || 'Table'}${finalCall.reason ? ` — ${finalCall.reason}` : ''}`,
      url: '/',
      tag: `waiter-call:${call.id}`,
    }).catch(() => {});

    res.status(201).json({ success: true, data: call });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    logger.error('POST /waiter-calls/public error:', err);
    res.status(500).json({ success: false, error: 'Failed to call waiter' });
  }
});

// ─── PROTECTED ────────────────────────────────────────────────────────────────

waiterCallsRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

waiterCallsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const querySchema = z.object({
      status: z
        .union([
          z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED']),
          z.array(z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED'])),
        ])
        .optional(),
    });
    const { status } = querySchema.parse(req.query);
    const where: Prisma.WaiterCallWhereInput = {
      organizationId: req.user!.organizationId,
      branchId: req.branchScope!,
    };
    if (status) where.status = Array.isArray(status) ? { in: status } : status;

    const calls = await prisma.waiterCall.findMany({
      where,
      include: { table: true, assignedUser: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json({ success: true, data: calls });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch waiter calls' });
  }
});

// Admin/staff updates a waiter call — including adding notes
waiterCallsRouter.patch(
  '/:id/status',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_AUDITOR',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'WAITER',
    'SERVICE',
    'CASHIER',
    'HOST',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role === 'WAITER') {
        const waiter = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { isOnShift: true } as any,
        });
        if (!(waiter as any)?.isOnShift) {
          res.status(403).json({ success: false, error: 'Start shift to work on tasks' });
          return;
        }
      }

      const schema = z.object({
        status: z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED']),
        notes: z.string().max(1000).optional(),
      });
      const { status, notes } = schema.parse(req.body);

      // Enforce org + branch isolation
      const existingCall = await prisma.waiterCall.findUnique({ where: { id: req.params.id } });
      if (!existingCall || existingCall.organizationId !== req.user!.organizationId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      if (existingCall.branchId !== req.branchScope) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const updateData: Prisma.WaiterCallUpdateInput = {
        status,
        ...(notes !== undefined ? { notes } : {}),
        ...(status === 'RESOLVED' ? { resolvedBy: req.user!.userId, resolvedAt: new Date() } : {}),
      };

      const call = await prisma.waiterCall.update({
        where: { id: req.params.id },
        data: updateData,
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      io.to(`${req.user!.organizationId}:${call.branchId}`).emit('WAITER_CALL_UPDATED', call);

      res.json({ success: true, data: call });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update waiter call' });
    }
  },
);

waiterCallsRouter.patch(
  '/:id/claim',
  requireRole('WAITER', 'ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role === 'WAITER') {
        const waiter = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { isOnShift: true } as any,
        });
        if (!(waiter as any)?.isOnShift) {
          res.status(403).json({ success: false, error: 'Start shift to claim tasks' });
          return;
        }
      }

      const where: Prisma.WaiterCallWhereInput = {
        id: req.params.id,
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
        assignedTo: null,
        status: 'PENDING',
      };

      const callToClaim = await prisma.waiterCall.findFirst({ where });
      if (!callToClaim) {
        res.status(404).json({ success: false, error: 'Task not found or already assigned' });
        return;
      }

      if (callToClaim.sessionId) {
        const { claimTableSession } = await import('../services/waiterAssignment');
        const claimResult = await claimTableSession(
          req.user!.userId,
          callToClaim.tableId,
          callToClaim.sessionId,
          callToClaim.branchId,
        );
        if (!claimResult.success && claimResult.error?.startsWith('LIMIT_REACHED')) {
          res.status(400).json({ success: false, error: claimResult.error });
          return;
        }
      }

      await prisma.waiterCall.updateMany({
        where,
        data: { assignedTo: req.user!.userId, assignedAt: new Date() },
      });

      const updated = await prisma.waiterCall.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });
      if (!updated) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      // Notify everyone this is now claimed
      io.to(`${req.user!.organizationId}:${updated.branchId}`).emit('TASK_CLAIMED', {
        type: 'WAITER_CALL',
        task: updated,
      });

      res.json({ success: true, data: updated });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to claim task' });
    }
  },
);

waiterCallsRouter.patch(
  '/:id/assign',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'SUPERADMIN',
    'SERVICE',
    'HOST',
    'CASHIER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const { waiterId } = z.object({ waiterId: z.string().nullable() }).parse(req.body);

      const existing = await prisma.waiterCall.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
        },
        select: { id: true, branchId: true },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }
      if (waiterId) {
        const waiter = await prisma.user.findFirst({
          where: {
            id: waiterId,
            organizationId: req.user!.organizationId,
            role: 'WAITER',
            isActive: true,
          },
          select: { id: true, branchId: true },
        });
        if (!waiter) {
          res.status(404).json({ success: false, error: 'Waiter not found' });
          return;
        }
        if (existing.branchId && waiter.branchId && waiter.branchId !== existing.branchId) {
          res.status(400).json({ success: false, error: 'Waiter must belong to the same branch' });
          return;
        }
        if (req.branchScope && waiter.branchId !== req.branchScope) {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
      }

      const updated = await prisma.waiterCall.update({
        where: { id: req.params.id },
        data: { assignedTo: waiterId, assignedAt: waiterId ? new Date() : null },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      io.to(`${req.user!.organizationId}:${updated.branchId}`).emit('WAITER_CALL_UPDATED', updated);

      // If assigning to a specific waiter, send them a direct notification
      if (waiterId) {
        io.to(`waiter:${waiterId}`).emit('TASK_ASSIGNED', { type: 'WAITER_CALL', task: updated });
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to assign task' });
    }
  },
);

// GET /api/waiter-calls/waiters/online — get online waiters for this branch
waiterCallsRouter.get(
  '/waiters/online',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'SUPERADMIN',
    'SERVICE',
    'HOST',
    'CASHIER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const { getWaiterAvailability } = await import('../services/waiterAssignment');
      const onlineIds = getWaiterAvailability(req.user!.organizationId, req.branchScope!);

      const waiters = await prisma.user.findMany({
        where: {
          organizationId: req.user!.organizationId,
          role: 'WAITER',
          isActive: true,
          branchId: req.branchScope!,
        },
        select: { id: true, name: true, branchId: true },
      });

      const result = waiters.map((w) => ({
        ...w,
        online: onlineIds.includes(w.id),
      }));

      res.json({ success: true, data: result });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to fetch waiter status' });
    }
  },
);
