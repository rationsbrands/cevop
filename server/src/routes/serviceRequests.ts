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
import { notifyStaffWebPush, notifyServiceRequest } from '../services/notifications';
import { io } from '../index';
import { logger } from '../services/logger';
import { findLeastLoadedWaiter } from '../services/waiterAssignment';
import { getOrCreateSession } from '../services/tableSession';

export const serviceRequestsRouter = Router();

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

serviceRequestsRouter.post('/public', async (req: Request, res: Response) => {
  try {
    const data = z
      .object({
        organizationId: z.string(),
        tableId: z.string(),
        branchId: z.string().optional(),
        serviceType: z.string().min(1).max(100),
        notes: z.string().max(500).optional(),
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
      res.status(400).json({ success: false, error: 'branchId does not match table branch' });
      return;
    }

    // Ensure table session is open
    const sessionId = await getOrCreateSession(table.id, table.organizationId, actualBranchId);

    const request = await prisma.serviceRequest.create({
      data: {
        organizationId: table.organizationId,
        branchId: actualBranchId,
        tableId: table.id,
        sessionId,
        serviceType: data.serviceType,
        notes: data.notes,
      },
      include: { table: true, assignedUser: { select: { id: true, name: true } } },
    });

    // Auto-assign to least-loaded online waiter
    const assignedWaiterId = await findLeastLoadedWaiter(
      table.organizationId,
      actualBranchId,
      table.id,
    ).catch(() => null);

    let finalRequest = request;
    if (assignedWaiterId) {
      finalRequest = await prisma.serviceRequest.update({
        where: { id: request.id },
        data: { assignedTo: assignedWaiterId, assignedAt: new Date() },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      // Notify the assigned waiter directly
      io.to(`waiter:${assignedWaiterId}`).emit('TASK_ASSIGNED', {
        type: 'SERVICE_REQUEST',
        task: finalRequest,
      });
    } else {
      // No waiter online — emit as unassigned so all waiters can claim
      io.to(`${table.organizationId}:${actualBranchId}`).emit('TASK_UNASSIGNED', {
        type: 'SERVICE_REQUEST',
        task: finalRequest,
      });
    }

    io.to(`${table.organizationId}:${actualBranchId}`).emit('SERVICE_REQUESTED', finalRequest);

    const org = await prisma.organization.findUnique({ where: { id: table.organizationId } });
    if (org && (org as any).notifyServiceRequests)
      notifyServiceRequest(
        request,
        org.whatsappNumber || undefined,
        org.slackWebhook || undefined,
        org.plan,
      ).catch(() => {});

    notifyStaffWebPush({
      organizationId: table.organizationId,
      branchId: actualBranchId,
      roles: ['WAITER', 'SERVICE'],
      title: 'Service Request',
      body: `${finalRequest.table?.label || 'Table'} — ${finalRequest.serviceType}${finalRequest.notes ? ` — ${finalRequest.notes}` : ''}`,
      url: '/',
      tag: `service-request:${request.id}`,
    }).catch(() => {});

    res.status(201).json({ success: true, data: request });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    logger.error('POST /service-requests/public error:', err);
    res.status(500).json({ success: false, error: 'Failed to submit service request' });
  }
});

// ─── PROTECTED ────────────────────────────────────────────────────────────────

serviceRequestsRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

serviceRequestsRouter.get('/', async (req: AuthRequest, res: Response) => {
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
    const where: Prisma.ServiceRequestWhereInput = { organizationId: req.user!.organizationId };
    where.branchId = req.branchScope!;
    if (status) where.status = Array.isArray(status) ? { in: status } : status;

    const requests = await prisma.serviceRequest.findMany({
      where,
      include: { table: true, assignedUser: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: requests });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch service requests' });
  }
});

// Admin/staff updates a service request — including adding admin notes
serviceRequestsRouter.patch(
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
        adminNotes: z.string().max(1000).optional(),
      });
      const { status, adminNotes } = schema.parse(req.body);

      // Enforce org + branch isolation
      const existingReq = await prisma.serviceRequest.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
        },
        select: { id: true },
      });
      if (!existingReq) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const updateData: Prisma.ServiceRequestUpdateInput = {
        status,
        ...(adminNotes !== undefined ? { adminNotes } : {}),
        ...(status === 'RESOLVED' ? { resolvedBy: req.user!.userId, resolvedAt: new Date() } : {}),
      };

      const request = await prisma.serviceRequest.update({
        where: { id: req.params.id },
        data: updateData,
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit(
        'SERVICE_REQUEST_UPDATED',
        request,
      );

      res.json({ success: true, data: request });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update service request' });
    }
  },
);

serviceRequestsRouter.patch(
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

      const where: Prisma.ServiceRequestWhereInput = {
        id: req.params.id,
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
        assignedTo: null,
        status: 'PENDING',
      };

      const result = await prisma.serviceRequest.updateMany({
        where,
        data: { assignedTo: req.user!.userId, assignedAt: new Date() },
      });
      if (result.count === 0) {
        res.status(404).json({ success: false, error: 'Task not found or already assigned' });
        return;
      }

      const updated = await prisma.serviceRequest.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
        },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });
      if (!updated) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      // Notify everyone this is now claimed
      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit('TASK_CLAIMED', {
        type: 'SERVICE_REQUEST',
        task: updated,
      });

      res.json({ success: true, data: updated });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to claim task' });
    }
  },
);

serviceRequestsRouter.patch(
  '/:id/assign',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN', 'SERVICE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { waiterId } = z.object({ waiterId: z.string().nullable() }).parse(req.body);

      const existing = await prisma.serviceRequest.findFirst({
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
        if (waiter.branchId !== existing.branchId) {
          res.status(400).json({ success: false, error: 'Waiter must belong to the same branch' });
          return;
        }
        if (waiter.branchId !== req.branchScope!) {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
      }

      const updated = await prisma.serviceRequest.update({
        where: { id: req.params.id },
        data: {
          assignedTo: waiterId,
          assignedAt: waiterId ? new Date() : null,
        },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit(
        'SERVICE_REQUEST_UPDATED',
        updated,
      );

      // If assigning to a specific waiter, send them a direct notification
      if (waiterId) {
        io.to(`waiter:${waiterId}`).emit('TASK_ASSIGNED', {
          type: 'SERVICE_REQUEST',
          task: updated,
        });
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
