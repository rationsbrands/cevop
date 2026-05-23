import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { getOnlineWaiters } from '../services/waiterAssignment';
import { logger } from '../services/logger';

export const waiterTasksRouter = Router();

waiterTasksRouter.use(authenticate, requireBranchAccess);

// ─── GET /api/waiter-tasks ────────────────────────────────────────────────────
// Returns: mine (assigned to this waiter) + unassigned tasks
// Used by WaiterBoard to populate My Tasks and Unassigned tabs
waiterTasksRouter.get(
  '/',
  requireRole('WAITER', 'ADMIN', 'ORG_OWNER', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      const base = {
        organizationId: orgId,
        ...(branchScope ? { branchId: branchScope } : {}),
      };

      const tableSelect = {
        select: {
          id: true,
          label: true,
          number: true,
          section: {
            select: { name: true, colour: true },
          },
        },
      };

      const [
        myWaiterCalls,
        unassignedWaiterCalls,
        myServiceRequests,
        unassignedServiceRequests,
        myReadyOrders,
        unassignedReadyOrders,
      ] = await Promise.all([
        prisma.waiterCall.findMany({
          where: { ...base, assignedTo: userId, status: { in: ['PENDING', 'ACKNOWLEDGED'] } },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.waiterCall.findMany({
          where: { ...base, assignedTo: null, status: 'PENDING' },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.serviceRequest.findMany({
          where: { ...base, assignedTo: userId, status: { in: ['PENDING', 'ACKNOWLEDGED'] } },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.serviceRequest.findMany({
          where: { ...base, assignedTo: null, status: 'PENDING' },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.order.findMany({
          where: { ...base, assignedWaiter: userId, status: 'READY' },
          include: {
            table: tableSelect,
            items: { select: { quantity: true, menuItem: { select: { name: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.order.findMany({
          where: { ...base, assignedWaiter: null, status: 'READY' },
          include: {
            table: tableSelect,
            items: { select: { quantity: true, menuItem: { select: { name: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      res.json({
        success: true,
        data: {
          mine: {
            waiterCalls: myWaiterCalls,
            serviceRequests: myServiceRequests,
            readyOrders: myReadyOrders,
          },
          unassigned: {
            waiterCalls: unassignedWaiterCalls,
            serviceRequests: unassignedServiceRequests,
            readyOrders: unassignedReadyOrders,
          },
        },
      });
    } catch (err) {
      logger.error('GET /waiter-tasks error', { err });
      res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
    }
  },
);

// ─── GET /api/waiter-tasks/online ─────────────────────────────────────────────
// Returns all waiters for this org/branch with their online status
// Used by admin dashboard waiter availability strip
waiterTasksRouter.get(
  '/online',
  requireRole('ADMIN', 'ORG_OWNER', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      const onlineIds = getOnlineWaiters(orgId, branchScope ?? null);

      const waiters = await prisma.user.findMany({
        where: {
          organizationId: orgId,
          role: 'WAITER',
          isActive: true,
          ...(branchScope ? { branchId: branchScope } : {}),
        },
        select: {
          id: true,
          name: true,
          branchId: true,
          branch: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      });

      const result = waiters.map((w) => ({
        ...w,
        online: onlineIds.includes(w.id),
      }));

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('GET /waiter-tasks/online error', { err });
      res.status(500).json({ success: false, error: 'Failed to fetch waiter status' });
    }
  },
);
