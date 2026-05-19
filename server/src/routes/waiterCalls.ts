import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { notifyWaiterCall } from '../services/notifications';
import { io } from '../index';
import { logger } from '../services/logger';

export const waiterCallsRouter = Router();

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

waiterCallsRouter.post('/public', async (req: Request, res: Response) => {
  try {
    const data = z.object({
      organizationId: z.string(),
      tableId: z.string(),
      branchId: z.string().optional(),
      reason: z.string().max(200).optional(),
    }).parse(req.body);

    const table = await prisma.table.findFirst({
      where: {
        OR: [
          { id: data.tableId, organizationId: data.organizationId },
          { id: data.tableId, organization: { slug: data.organizationId } },
        ],
        isActive: true,
      },
    });
    if (!table) { res.status(404).json({ success: false, error: 'Table not found' }); return; }

    const actualBranchId = data.branchId ?? table.branchId ?? null;

    const call = await prisma.waiterCall.create({
      data: {
        organizationId: table.organizationId,
        branchId: actualBranchId,
        tableId: table.id,
        reason: data.reason,
      },
      include: { table: true },
    });

    if (actualBranchId) io.to(`${table.organizationId}:${actualBranchId}`).emit('WAITER_CALLED', call);
    io.to(table.organizationId).emit('WAITER_CALLED', call);

    const org = await prisma.organization.findUnique({ where: { id: table.organizationId } });
    if (org) notifyWaiterCall(call, org.whatsappNumber || undefined, org.slackWebhook || undefined).catch(() => {});

    res.status(201).json({ success: true, data: call });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: 'Validation error', details: err.errors }); return; }
    logger.error('POST /waiter-calls/public error:', err);
    res.status(500).json({ success: false, error: 'Failed to call waiter' });
  }
});

// ─── PROTECTED ────────────────────────────────────────────────────────────────

waiterCallsRouter.use(authenticate, requireBranchAccess);

waiterCallsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const querySchema = z.object({
      status: z.union([
        z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED']),
        z.array(z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED']))
      ]).optional()
    });
    const { status } = querySchema.parse(req.query);
    const where: Prisma.WaiterCallWhereInput = { organizationId: req.user!.organizationId };
    if (req.branchScope) where.branchId = req.branchScope;
    if (status) where.status = Array.isArray(status) ? { in: status } : status;

    const calls = await prisma.waiterCall.findMany({
      where,
      include: { table: true },
      orderBy: { createdAt: 'desc' },
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
waiterCallsRouter.patch('/:id/status', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN', 'WAITER', 'SERVICE'), async (req: AuthRequest, res: Response) => {
  try {
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
    if (req.branchScope && existingCall.branchId !== req.branchScope) {
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
      include: { table: true },
    });

    if (call.branchId) io.to(`${req.user!.organizationId}:${call.branchId}`).emit('WAITER_CALL_UPDATED', call);
    io.to(req.user!.organizationId).emit('WAITER_CALL_UPDATED', call);

    res.json({ success: true, data: call });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: 'Validation error', details: err.errors }); return; }
    res.status(500).json({ success: false, error: 'Failed to update waiter call' });
  }
});
