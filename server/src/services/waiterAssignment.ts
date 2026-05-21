import { prisma } from './prisma';
import { logger } from './logger';

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
): Promise<string | null> {
  const waiterIds = getOnlineWaiters(orgId, branchId);
  if (waiterIds.length === 0) return null;

  // Count active tasks per waiter in parallel
  const counts = await Promise.all(
    waiterIds.map(async (userId) => {
      const [calls, requests, orders] = await Promise.all([
        prisma.waiterCall.count({
          where: { assignedTo: userId, status: { not: 'RESOLVED' } },
        }),
        prisma.serviceRequest.count({
          where: { assignedTo: userId, status: { not: 'RESOLVED' } },
        }),
        prisma.order.count({
          where: { assignedWaiter: userId, status: { in: ['READY'] } },
        }),
      ]);
      return { userId, total: calls + requests + orders };
    }),
  );

  // Sort by total tasks ascending — first is least loaded
  counts.sort((a, b) => a.total - b.total);
  return counts[0].userId;
}

// Get waiter availability summary for admin dashboard
export function getWaiterAvailability(orgId: string, branchId: string | null): string[] {
  return getOnlineWaiters(orgId, branchId);
}
