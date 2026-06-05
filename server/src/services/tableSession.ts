import { prisma } from './prisma';
import { io } from '../index';
import { logger } from './logger';

/**
 * Get or create the active session for a table.
 * Called when an order is placed — session opens automatically on first order.
 */
export async function getOrCreateSession(
  tableId: string,
  organizationId: string,
  branchId: string | null,
): Promise<string | null> {
  // If no branchId, we try to find it from the table record
  let actualBranchId = branchId;
  if (!actualBranchId) {
    const tableData = await prisma.table.findUnique({
      where: { id: tableId },
      select: { branchId: true },
    });
    actualBranchId = tableData?.branchId ?? null;
  }

  // If we still don't have a branchId, we can't safely manage sessions in this multi-tenant setup
  if (!actualBranchId) {
    logger.warn('Cannot getOrCreateSession: Missing branchId', { tableId, organizationId });
    return null;
  }

  // Check for an existing open session
  const table = (await prisma.table.findUnique({
    where: { id: tableId },
    select: { activeSessionId: true, status: true } as any,
  })) as any;

  if (table?.activeSessionId) {
    // Verify session is still open
    const existing = await (prisma as any).tableSession.findUnique({
      where: { id: table.activeSessionId },
      select: { id: true, closedAt: true },
    });
    if (existing && !existing.closedAt) {
      return existing.id;
    }
  }

  // Create a new session
  const session = await (prisma as any).tableSession.create({
    data: {
      organizationId,
      branchId: actualBranchId,
      tableId,
    },
  });

  // Update table status to OCCUPIED and set activeSessionId
  await prisma.table.update({
    where: { id: tableId },
    data: { status: 'OCCUPIED', activeSessionId: session.id } as any,
  });

  // Emit socket events
  io.to(`${organizationId}:${actualBranchId}`).emit('SESSION_OPENED', {
    sessionId: session.id,
    tableId,
    branchId: actualBranchId,
    openedAt: session.openedAt,
  });
  io.to(`${organizationId}:${actualBranchId}`).emit('TABLE_STATUS_CHANGED', {
    tableId,
    status: 'OCCUPIED',
    branchId: actualBranchId,
  });

  logger.info('Table session opened', { sessionId: session.id, tableId });
  return session.id;
}

/**
 * Close a session and update table status.
 * Called by staff when they clear the table.
 */
export async function closeSession(
  sessionId: string,
  closedByUserId: string,
  nextStatus: 'CLEANING' | 'EMPTY' = 'CLEANING',
): Promise<void> {
  const session = await (prisma as any).tableSession.findUnique({
    where: { id: sessionId },
    select: { id: true, tableId: true, organizationId: true, branchId: true, closedAt: true },
  });

  if (!session) throw new Error('Session not found');
  if (session.closedAt) throw new Error('Session already closed');

  // Find all pending tasks for this TABLE before resolving them
  const [waiterCalls, serviceRequests] = await Promise.all([
    prisma.waiterCall.findMany({
      where: { tableId: session.tableId, status: { not: 'RESOLVED' } },
      select: { id: true },
    }),
    prisma.serviceRequest.findMany({
      where: { tableId: session.tableId, status: { not: 'RESOLVED' } },
      select: { id: true },
    }),
  ]);

  await prisma.$transaction([
    (prisma as any).tableSession.update({
      where: { id: sessionId },
      data: { closedAt: new Date(), closedBy: closedByUserId },
    }),
    prisma.table.update({
      where: { id: session.tableId },
      data: { status: nextStatus, activeSessionId: null } as any,
    }),
    // Resolve all pending waiter calls for this TABLE (not just session) to be safe
    prisma.waiterCall.updateMany({
      where: { tableId: session.tableId, status: { not: 'RESOLVED' } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: closedByUserId },
    }),
    // Resolve all pending service requests for this TABLE (not just session) to be safe
    prisma.serviceRequest.updateMany({
      where: { tableId: session.tableId, status: { not: 'RESOLVED' } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: closedByUserId },
    }),
  ]);

  const orgBranch = `${session.organizationId}:${session.branchId}`;

  // Emit resolution events for each task so they disappear from waiter dashboards
  waiterCalls.forEach((call) => {
    io.to(orgBranch).emit('WAITER_CALL_UPDATED', { id: call.id, status: 'RESOLVED' });
  });
  serviceRequests.forEach((req) => {
    io.to(orgBranch).emit('SERVICE_REQUEST_UPDATED', { id: req.id, status: 'RESOLVED' });
  });

  const sessionClosedPayload = {
    sessionId,
    tableId: session.tableId,
    branchId: session.branchId,
    closedAt: new Date(),
  };

  io.to(orgBranch).emit('SESSION_CLOSED', sessionClosedPayload);
  io.to(`pub:${orgBranch}`).emit('SESSION_CLOSED', sessionClosedPayload);

  // Also emit SESSION_CLOSED to individual order rooms so customers who joined via
  // JOIN_ORDER receive the event and clear their running tab immediately
  try {
    const sessionOrders = await prisma.order.findMany({
      where: { sessionId },
      select: { id: true },
    });
    for (const order of sessionOrders) {
      io.to(`order:${order.id}`).emit('SESSION_CLOSED', sessionClosedPayload);
    }
  } catch (err) {
    logger.warn('Failed to emit SESSION_CLOSED to order rooms', { err, sessionId });
  }
  io.to(orgBranch).emit('TABLE_STATUS_CHANGED', {
    tableId: session.tableId,
    status: nextStatus,
    branchId: session.branchId,
  });

  // Global sync signal for the branch

  logger.info('Table session closed', { sessionId, tableId: session.tableId });
}
