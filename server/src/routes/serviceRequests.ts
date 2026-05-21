import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { notifyServiceRequest } from '../services/notifications';
import { io } from '../index';
import { logger } from '../services/logger';
import { findLeastLoadedWaiter } from '../services/waiterAssignment';

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

    const actualBranchId = data.branchId ?? table.branchId ?? null;

    const request = await prisma.serviceRequest.create({
      data: {
        organizationId: table.organizationId,
        branchId: actualBranchId,
        tableId: table.id,
        serviceType: data.serviceType,
        notes: data.notes,
      },
      include: { table: true, assignedUser: { select: { id: true, name: true } } },
    });

    // Auto-assign to least-loaded online waiter
    const assignedWaiterId = await findLeastLoadedWaiter(
      table.organizationId,
      actualBranchId,
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
      if (actualBranchId) {
        io.to(`${table.organizationId}:${actualBranchId}`).emit('TASK_UNASSIGNED', {
          type: 'SERVICE_REQUEST',
          task: finalRequest,
        });
      }
      io.to(table.organizationId).emit('TASK_UNASSIGNED', {
        type: 'SERVICE_REQUEST',
        task: finalRequest,
      });
    }

    if (actualBranchId)
      io.to(`${table.organizationId}:${actualBranchId}`).emit('SERVICE_REQUESTED', finalRequest);
    io.to(table.organizationId).emit('SERVICE_REQUESTED', finalRequest);

    const org = await prisma.organization.findUnique({ where: { id: table.organizationId } });
    if (org)
      notifyServiceRequest(
        request,
        org.whatsappNumber || undefined,
        org.slackWebhook || undefined,
        org.plan,
      ).catch(() => {});

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

serviceRequestsRouter.use(authenticate, requireBranchAccess);

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
    if (req.branchScope) where.branchId = req.branchScope;
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
  requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN', 'WAITER', 'SERVICE'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        status: z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED']),
        adminNotes: z.string().max(1000).optional(),
      });
      const { status, adminNotes } = schema.parse(req.body);

      // Enforce org + branch isolation
      const existingReq = await prisma.serviceRequest.findUnique({ where: { id: req.params.id } });
      if (!existingReq || existingReq.organizationId !== req.user!.organizationId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      if (req.branchScope && existingReq.branchId !== req.branchScope) {
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

      if (request.branchId)
        io.to(`${req.user!.organizationId}:${request.branchId}`).emit(
          'SERVICE_REQUEST_UPDATED',
          request,
        );
      io.to(req.user!.organizationId).emit('SERVICE_REQUEST_UPDATED', request);

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
  requireRole('WAITER', 'ADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const request = await prisma.serviceRequest.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          assignedTo: null, // Only claim unassigned tasks
          status: 'PENDING',
        },
      });
      if (!request) {
        res.status(404).json({ success: false, error: 'Task not found or already assigned' });
        return;
      }

      const updated = await prisma.serviceRequest.update({
        where: { id: req.params.id },
        data: { assignedTo: req.user!.userId, assignedAt: new Date() },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      // Notify everyone this is now claimed
      if (updated.branchId) {
        io.to(`${req.user!.organizationId}:${updated.branchId}`).emit('TASK_CLAIMED', {
          type: 'SERVICE_REQUEST',
          task: updated,
        });
      }
      io.to(req.user!.organizationId).emit('TASK_CLAIMED', {
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
  requireRole('ADMIN', 'BRANCH_ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { waiterId } = z.object({ waiterId: z.string().nullable() }).parse(req.body);

      const updated = await prisma.serviceRequest.update({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
        data: {
          assignedTo: waiterId,
          assignedAt: waiterId ? new Date() : null,
        },
        include: { table: true, assignedUser: { select: { id: true, name: true } } },
      });

      if (updated.branchId) {
        io.to(`${req.user!.organizationId}:${updated.branchId}`).emit(
          'SERVICE_REQUEST_UPDATED',
          updated,
        );
      }
      io.to(req.user!.organizationId).emit('SERVICE_REQUEST_UPDATED', updated);

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
