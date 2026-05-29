import { prisma } from './prisma';
import { logger } from './logger';
import { io } from '../index';
import { getRedisClient } from './redis';

// Waiter online registry — dual-layer:
//   1. In-memory Map for low-latency reads within the current process
//   2. Redis (Upstash) for persistence across server restarts
//      Key: cevop:waiters:{orgId}:{branchId}
//      Value: JSON array of { userId, socketId }
//      TTL: 90 seconds — sockets ping every 25s so this stays alive automatically
//
// On startup, the in-memory map is empty. It self-heals within one keepalive cycle
// as sockets reconnect and re-register. Redis lets us survive brief restarts without
// a full cold-start gap.

const WAITER_TTL_SECONDS = 90;
const onlineWaiters = new Map<string, Set<{ userId: string; socketId: string }>>();

function redisKey(orgId: string, branchId: string | null): string {
  return `cevop:waiters:${orgId}:${branchId ?? 'org'}`;
}

async function persistToRedis(orgId: string, branchId: string | null): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const key = redisKey(orgId, branchId);
  const mapKey = branchId ? `${orgId}:${branchId}` : orgId;
  const waiters = onlineWaiters.get(mapKey);
  try {
    if (!waiters || waiters.size === 0) {
      await redis.del(key);
    } else {
      const data = JSON.stringify(Array.from(waiters));
      await redis.set(key, data, { ex: WAITER_TTL_SECONDS });
    }
  } catch (err) {
    logger.warn('Failed to persist waiter state to Redis', { err });
  }
}

// On startup, restore from Redis into the in-memory map
// Called once from index.ts after socket handlers are initialized
export async function restoreWaiterStateFromRedis(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    // We don't know which keys exist, so we can't restore proactively
    // Sockets reconnect and re-register within seconds anyway
    // This function exists for future use with Redis SCAN if needed
    logger.info('Waiter state will restore as sockets reconnect (Redis-backed)');
  } catch (err) {
    logger.warn('Failed to restore waiter state from Redis', { err });
  }
}

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
  // Async persist — don't await, never block the socket connect path
  void persistToRedis(orgId, branchId);
}

export function unregisterWaiter(socketId: string): { userId: string; key: string } | null {
  for (const [key, waiters] of onlineWaiters.entries()) {
    for (const entry of waiters) {
      if (entry.socketId === socketId) {
        waiters.delete(entry);
        if (waiters.size === 0) onlineWaiters.delete(key);
        logger.info('Waiter unregistered offline', { userId: entry.userId, key });
        // Parse orgId and branchId back from key for Redis persist
        const [unreg_orgId, unreg_branchId] = key.includes(':')
          ? [key.split(':')[0], key.split(':').slice(1).join(':')]
          : [key, null];
        void persistToRedis(unreg_orgId, unreg_branchId === 'org' ? null : unreg_branchId || null);
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
  const ASSIGNMENT_TIMEOUT_MS = 5000; // 5s safety timeout for DB heavy lifting

  try {
    const result = await Promise.race([
      (async () => {
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
          const sessionCounts = await prisma.tableSession.groupBy({
            by: ['assignedWaiterId'],
            where: {
              assignedWaiterId: { in: waiterIds },
              closedAt: null,
              table: { activeSessionId: { not: null } },
            },
            _count: { _all: true },
          });

          const countByWaiter = new Map(
            sessionCounts.map((r) => [r.assignedWaiterId, r._count._all]),
          );

          waiterIds = waiterIds.filter(
            (wid) => (countByWaiter.get(wid) ?? 0) < branch.maxTablesPerWaiter!,
          );
        }
        if (waiterIds.length === 0) return null;

        // If tableId is provided, check if it belongs to a section
        // and if any online waiters are assigned to that section
        if (tableId) {
          const table = await prisma.table.findFirst({
            where: {
              id: tableId,
              organizationId: orgId,
              branchId: branchId ?? undefined,
            },
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
            // CRITICAL: Must filter by organizationId and branchId to avoid cross-tenant data leakage or cross-branch misassignment
            const [order, call, request] = await Promise.all([
              prisma.order.findFirst({
                where: {
                  organizationId: orgId,
                  branchId: branchId ?? undefined,
                  sessionId: table.activeSessionId,
                  assignedWaiter: { not: null },
                },
                select: { assignedWaiter: true },
              }),
              prisma.waiterCall.findFirst({
                where: {
                  organizationId: orgId,
                  branchId: branchId ?? undefined,
                  sessionId: table.activeSessionId,
                  assignedTo: { not: null },
                },
                select: { assignedTo: true },
              }),
              prisma.serviceRequest.findFirst({
                where: {
                  organizationId: orgId,
                  branchId: branchId ?? undefined,
                  sessionId: table.activeSessionId,
                  assignedTo: { not: null },
                },
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
                  organizationId: orgId,
                  branchId: branchId ?? undefined,
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
      })(),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          logger.warn('Waiter assignment timed out, falling back to broadcast', {
            orgId,
            branchId,
            tableId,
          });
          resolve(null);
        }, ASSIGNMENT_TIMEOUT_MS),
      ),
    ]);
    return result;
  } catch (err) {
    logger.error('findLeastLoadedWaiter error:', err);
    return null; // Fallback to broadcast on any error
  }
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
  code?: string;
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

  if (!session || session.branchId !== branchId)
    return { success: false, error: 'Session not found' };

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
        code: 'ALREADY_CLAIMED',
        error: 'This table is already claimed by another waiter',
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
        code: 'LIMIT_REACHED',
        error: `You have reached the maximum of ${branch.maxTablesPerWaiter} active tables`,
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
