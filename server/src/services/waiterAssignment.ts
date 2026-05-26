import { prisma } from './prisma';
import { logger } from './logger';
import { io } from '../index';

// In-memory registry of online waiters per branch
// Key: `${orgId}:${branchId}` or `${orgId}` for org-wide
// Value: Set of { userId, socketId }
const onlineWaiters = new Map<string, Set<{ userId: string; socketId: string }>>();

export function registerWaiter(
  orgId: string,
  branchId: string | null,
  userId: string,
  socketId: string,
): void {
  const key = branchId ? `${orgId}:${branchId}` : orgId;
  if (!onlineWaiters.has(key)) onlineWaiters.set(key, new Set());
  // Remove any existing entry for this userId (handles reconnect)
  const existing = onlineWaiters.get(key)!;
  for (const entry of existing) {
    if (entry.userId === userId) existing.delete(entry);
  }
  existing.add({ userId, socketId });
  logger.info('Waiter registered online', { userId, key });
}

export function unregisterWaiter(socketId: string): { userId: string; key: string } | null {
  for (const [key, waiters] of onlineWaiters.entries()) {
    for (const entry of waiters) {
      if (entry.socketId === socketId) {
        waiters.delete(entry);
        if (waiters.size === 0) onlineWaiters.delete(key);
        logger.info('Waiter unregistered offline', { userId: entry.userId, key });
        return { userId: entry.userId, key };
      }
    }
  }
  return null;
}

export function unregisterWaiterByUserId(
  orgId: string,
  branchId: string | null,
  userId: string,
): boolean {
  const key = branchId ? `${orgId}:${branchId}` : orgId;
  const waiters = onlineWaiters.get(key);
  if (!waiters) return false;
  let removed = false;
  for (const entry of Array.from(waiters)) {
    if (entry.userId === userId) {
      waiters.delete(entry);
      removed = true;
    }
  }
  if (waiters.size === 0) onlineWaiters.delete(key);
  if (removed) logger.info('Waiter unregistered offline (by user)', { userId, key });
  return removed;
}

export function getOnlineWaiters(orgId: string, branchId: string | null): string[] {
  const key = branchId ? `${orgId}:${branchId}` : orgId;
  const waiters = onlineWaiters.get(key);
  if (!waiters || waiters.size === 0) return [];
  return Array.from(waiters).map((w) => w.userId);
}

export function getOnlineWaiterCount(orgId: string, branchId: string | null): number {
  return getOnlineWaiters(orgId, branchId).length;
}

// Find the least-loaded online waiter — fewest active (unresolved) assigned tasks
export async function findLeastLoadedWaiter(
  orgId: string,
  branchId: string | null,
  tableId?: string,
): Promise<string | null> {
  let waiterIds = getOnlineWaiters(orgId, branchId);
  if (waiterIds.length === 0) return null;

  // Filter out waiters who have reached their table limit
  const branch = branchId
    ? await prisma.branch.findUnique({
        where: { id: branchId },
        select: { maxTablesPerWaiter: true },
      })
    : null;

  if (branch && branch.maxTablesPerWaiter !== null) {
    const validWaiterIds: string[] = [];
    for (const wid of waiterIds) {
      const activeOwnedCount = await prisma.tableSession.count({
        where: {
          assignedWaiterId: wid,
          closedAt: null,
          table: { activeSessionId: { not: null } },
        },
      });
      if (activeOwnedCount < branch.maxTablesPerWaiter) {
        validWaiterIds.push(wid);
      }
    }
    waiterIds = validWaiterIds;
  }

  if (waiterIds.length === 0) return null;

  // If tableId is provided, check if it belongs to a section
  // and if any online waiters are assigned to that section
  if (tableId) {
    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: {
        sectionId: true,
        activeSessionId: true,
      },
    });

    if (table?.activeSessionId) {
      // First check if the session itself is claimed
      const session = await prisma.tableSession.findUnique({
        where: { id: table.activeSessionId },
        select: { assignedWaiterId: true },
      });

      // Find the first assigned waiter across all tasks in this session (fallback)
      const [order, call, request] = await Promise.all([
        prisma.order.findFirst({
          where: { sessionId: table.activeSessionId, assignedWaiter: { not: null } },
          select: { assignedWaiter: true },
        }),
        prisma.waiterCall.findFirst({
          where: { sessionId: table.activeSessionId, assignedTo: { not: null } },
          select: { assignedTo: true },
        }),
        prisma.serviceRequest.findFirst({
          where: { sessionId: table.activeSessionId, assignedTo: { not: null } },
          select: { assignedTo: true },
        }),
      ]);

      const waiterId =
        session?.assignedWaiterId ||
        order?.assignedWaiter ||
        call?.assignedTo ||
        request?.assignedTo;

      if (waiterId) {
        // Check if the assigned waiter is still online/active
        const waiter = await prisma.user.findFirst({
          where: {
            id: waiterId,
            isOnShift: true,
            isActive: true,
          },
          select: { id: true },
        });
        if (waiter) return waiter.id;
      }
    }
  }

  // If the table is not already claimed, return null so the task broadcasts to all available waiters
  return null;
}

// Get waiter availability summary for admin dashboard
export function getWaiterAvailability(orgId: string, branchId: string | null): string[] {
  return getOnlineWaiters(orgId, branchId);
}

// Attempt to claim a table session for a waiter
export async function claimTableSession(
  waiterId: string,
  tableId: string,
  sessionId: string,
  branchId: string,
  options: { force?: boolean; ignoreLimit?: boolean } = {},
): Promise<{
  success: boolean;
  error?: string;
  currentWaiter?: string;
  alreadyOwned?: boolean;
}> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { maxTablesPerWaiter: true },
  });

  const session = await prisma.tableSession.findUnique({
    where: { id: sessionId },
    include: { assignedWaiter: { select: { id: true, name: true } } },
  });

  if (!session) return { success: false, error: 'Session not found' };

  // If already assigned to this waiter, return success
  if (session.assignedWaiterId === waiterId) {
    return {
      success: true,
      alreadyOwned: true,
      currentWaiter: session.assignedWaiter?.name || 'You',
    };
  }

  // If already assigned to another waiter
  if (session.assignedWaiterId) {
    if (!options.force) {
      return {
        success: false,
        error: 'ALREADY_CLAIMED',
        currentWaiter: session.assignedWaiter?.name || 'Another waiter',
      };
    }

    // Record the transfer in AuditLog
    await prisma.auditLog
      .create({
        data: {
          organizationId: session.organizationId,
          userId: waiterId,
          action: 'TABLE_TRANSFERRED',
          entity: 'TableSession',
          entityId: sessionId,
          metadata: {
            fromWaiterId: session.assignedWaiterId,
            fromWaiterName: session.assignedWaiter?.name,
            toWaiterId: waiterId,
            tableId: session.tableId,
          },
          ipAddress: null,
        },
      })
      .catch(() => {});
  }

  // Check concurrency limit if there is one
  if (branch && branch.maxTablesPerWaiter !== null && !options.ignoreLimit) {
    // Only count sessions that are currently active on a physical table
    const activeOwnedCount = await prisma.tableSession.count({
      where: {
        assignedWaiterId: waiterId,
        closedAt: null,
        table: {
          activeSessionId: { not: null },
        },
      },
    });
    if (activeOwnedCount >= branch.maxTablesPerWaiter) {
      return {
        success: false,
        error: `LIMIT_REACHED: You have reached the maximum of ${branch.maxTablesPerWaiter} active tables.`,
      };
    }
  }

  // Claim the table
  const updated = await prisma.tableSession.update({
    where: { id: sessionId },
    data: { assignedWaiterId: waiterId, assignedWaiterAt: new Date() },
    include: {
      table: { select: { label: true } },
      assignedWaiter: { select: { id: true, name: true, staffCode: true } },
    },
  });

  // Emit socket event to notify other waiters and admin
  io.to(`${session.organizationId}:${branchId}`).emit('TABLE_CLAIMED', {
    tableId: session.tableId,
    tableLabel: (updated.table as any)?.label,
    waiterId,
    waiterName: updated.assignedWaiter?.name,
    staffCode: updated.assignedWaiter?.staffCode,
    sessionId,
  });

  return { success: true };
}
