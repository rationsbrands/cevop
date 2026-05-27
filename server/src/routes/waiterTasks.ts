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
  requireRole(
    'WAITER',
    'ADMIN',
    'ORG_OWNER',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'SUPERADMIN',
    'SERVICE',
    'HOST',
    'CASHIER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      const base = {
        organizationId: orgId,
        ...(branchScope ? { branchId: branchScope } : {}),
      };

      // Find active sessions owned by this waiter OR tables in their assigned sections
      const [myActiveSessions, mySections] = await Promise.all([
        prisma.tableSession.findMany({
          where: {
            organizationId: orgId,
            branchId: branchScope!,
            assignedWaiterId: userId,
            closedAt: null,
            table: { activeSessionId: { not: null } },
          },
          select: { tableId: true },
        }),
        prisma.sectionStaff.findMany({
          where: { userId },
          select: { sectionId: true },
        }),
      ]);

      const sectionIds = mySections.map((s) => s.sectionId);

      // Tables are "mine" if I'm assigned to the session OR if they are in my section
      const myTablesFromSections = await prisma.table.findMany({
        where: {
          organizationId: orgId,
          branchId: branchScope!,
          sectionId: { in: sectionIds },
          isActive: true,
        },
        select: { id: true },
      });

      const myTableIds = Array.from(
        new Set([
          // Filter out null tableIds — table may have been deleted but session preserved
          ...myActiveSessions.map((s) => s.tableId).filter((id): id is string => id !== null),
          ...myTablesFromSections.map((t) => t.id),
        ]),
      );

      const isLockedToTables = myTableIds.length > 0;

      const unassignedFilter: any = {
        assignedTo: null,
        status: 'PENDING',
        session: { closedAt: null }, // Only show tasks for active sessions
        ...(isLockedToTables
          ? { tableId: { in: myTableIds } }
          : { session: { assignedWaiterId: null } }),
      };

      const unassignedOrderFilter: any = {
        assignedWaiter: null,
        status: 'READY',
        session: { closedAt: null }, // Only show tasks for active sessions
        ...(isLockedToTables
          ? { tableId: { in: myTableIds } }
          : { session: { assignedWaiterId: null } }),
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
          where: {
            ...base,
            assignedTo: userId,
            status: { in: ['PENDING', 'ACKNOWLEDGED'] },
            session: { closedAt: null }, // Only show tasks for active sessions
          },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.waiterCall.findMany({
          where: { ...base, ...unassignedFilter },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.serviceRequest.findMany({
          where: {
            ...base,
            assignedTo: userId,
            status: { in: ['PENDING', 'ACKNOWLEDGED'] },
            session: { closedAt: null }, // Only show tasks for active sessions
          },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.serviceRequest.findMany({
          where: { ...base, ...unassignedFilter },
          include: { table: tableSelect },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.order.findMany({
          where: {
            ...base,
            assignedWaiter: userId,
            status: 'READY',
            session: { closedAt: null }, // Only show tasks for active sessions
          },
          include: {
            table: tableSelect,
            items: { select: { quantity: true, menuItem: { select: { name: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.order.findMany({
          where: { ...base, ...unassignedOrderFilter },
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
  requireRole(
    'ADMIN',
    'ORG_OWNER',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'SUPERADMIN',
    'SERVICE',
    'HOST',
    'CASHIER',
  ),
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
