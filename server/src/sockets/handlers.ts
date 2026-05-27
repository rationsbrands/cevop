import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '../services/logger';
import { prisma } from '../services/prisma';
import type { AuthPayload } from '../../../shared/types';
import {
  registerWaiter,
  unregisterWaiter,
  unregisterWaiterByUserId,
  getOnlineWaiters,
} from '../services/waiterAssignment';

// Per-socket event rate limiter
// Prevents malicious clients from spamming events and overwhelming the server
const socketEventCounts = new Map<string, { count: number; resetAt: number }>();

function socketRateLimit(socketId: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = socketEventCounts.get(socketId);
  if (!entry || now > entry.resetAt) {
    socketEventCounts.set(socketId, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }
  entry.count++;
  if (entry.count > limit) return false; // blocked
  return true;
}

// Clean up stale entries every 5 minutes so the Map doesn't grow forever
setInterval(
  () => {
    const now = Date.now();
    for (const [id, entry] of socketEventCounts.entries()) {
      if (now > entry.resetAt) socketEventCounts.delete(id);
    }
  },
  5 * 60 * 1000,
).unref();

export function initSocketHandlers(io: Server): void {
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      // Allow unauthenticated connections (service read-only, customer PWA)
      return next();
    }

    try {
      const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET!;
      const payload = jwt.verify(token, secret) as AuthPayload;
      socket.data.user = payload;
      return next();
    } catch {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user as AuthPayload | undefined;
    logger.info('Socket connected', { socketId: socket.id, userId: user?.userId });

    if (user?.organizationId) {
      if (user.branchId) {
        // Branch-scoped staff: join their branch room only
        const branchRoom = `${user.organizationId}:${user.branchId}`;
        socket.join(branchRoom);
        logger.info('Socket joined branch room', { room: branchRoom });
      } else {
        // Org-wide admin/superadmin: join org-wide room + all active branch rooms
        socket.join(user.organizationId);
        logger.info('Socket joined org room', { orgId: user.organizationId });

        try {
          const branches = await prisma.branch.findMany({
            where: { organizationId: user.organizationId, isActive: true },
            select: { id: true },
          });
          for (const branch of branches) {
            const branchRoom = `${user.organizationId}:${branch.id}`;
            socket.join(branchRoom);
            logger.info('Socket joined branch room (org-wide admin)', { room: branchRoom });
          }
        } catch (err: unknown) {
          logger.error('Failed to fetch branches for socket room join', { err });
        }
      }

      if (user.role === 'WAITER') {
        socket.join(`waiter:${user.userId}`);
        const waiter = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { isOnShift: true, branchId: true } as any,
        });
        const branchId = (user.branchId ?? (waiter as any)?.branchId ?? null) as string | null;
        if (waiter?.isOnShift) {
          registerWaiter(user.organizationId, branchId, user.userId, socket.id);

          const waiterOnlinePayload = {
            userId: user.userId,
            organizationId: user.organizationId,
            branchId,
            onlineWaiters: getOnlineWaiters(user.organizationId, branchId),
          };
          if (branchId) {
            io.to(`${user.organizationId}:${branchId}`).emit('WAITER_ONLINE', waiterOnlinePayload);
          }
          io.to(user.organizationId).emit('WAITER_ONLINE', waiterOnlinePayload);
        }
      }

      // Every authenticated user joins their personal room for direct messages
      if (user.userId) {
        socket.join(`user:${user.userId}`);
      }
    }

    socket.on('JOIN_ORG', async (orgId: string) => {
      if (!socketRateLimit(socket.id)) {
        socket.emit('ERROR', { message: 'Too many requests' });
        return;
      }
      if (!user) {
        socket.emit('ERROR', { message: 'Unauthorized room join' });
        return;
      }
      if (user.organizationId !== orgId && user.role !== 'SUPERADMIN') {
        socket.emit('ERROR', { message: 'Unauthorized room join' });
        return;
      }
      if (user.branchId) {
        socket.emit('ERROR', { message: 'Branch-scoped users cannot join org-wide rooms' });
        return;
      }

      socket.join(orgId);
      logger.info('Socket joined org room via event', { orgId, socketId: socket.id });
      socket.emit('JOINED', { orgId });
    });

    // Unauthenticated join — customer PWA only, for menu availability updates
    // No sensitive data in these events — only menu item availability changes
    socket.on('JOIN_ORG_PUBLIC', (orgId: string) => {
      if (!socketRateLimit(socket.id)) return;
      if (typeof orgId !== 'string' || orgId.length > 100) return; // basic validation
      socket.join(orgId);
      logger.info('Customer PWA joined org room for menu updates', { orgId, socketId: socket.id });
    });

    socket.on('JOIN_BRANCH_PUBLIC', ({ orgId, branchId }: { orgId: string; branchId: string }) => {
      if (!socketRateLimit(socket.id)) return;
      if (typeof orgId !== 'string' || typeof branchId !== 'string') return;
      const room = `${orgId}:${branchId}`;
      socket.join(room);
      logger.info('Customer PWA joined branch room for order updates', {
        room,
        socketId: socket.id,
      });
    });

    // Join a specific branch room (for branch-scoped service displays)
    socket.on('JOIN_BRANCH', async ({ orgId, branchId }: { orgId: string; branchId: string }) => {
      if (!socketRateLimit(socket.id)) {
        socket.emit('ERROR', { message: 'Too many requests' });
        return;
      }
      if (!user) {
        socket.emit('ERROR', { message: 'Unauthorized room join' });
        return;
      }
      if (user.organizationId !== orgId) {
        socket.emit('ERROR', { message: 'Unauthorized room join' });
        return;
      }
      if (user.branchId && user.branchId !== branchId) {
        socket.emit('ERROR', { message: 'Unauthorized room join' });
        return;
      }

      const room = `${orgId}:${branchId}`;
      socket.join(room);
      logger.info('Socket joined branch room via event', { room, socketId: socket.id });
      socket.emit('JOINED', { orgId, branchId, room });
    });

    socket.on('SHIFT_START', async (_: unknown, ack?: (payload: any) => void) => {
      if (!socketRateLimit(socket.id, 10, 60_000)) {
        ack?.({ success: false, error: 'Too many requests' });
        return;
      }
      try {
        if (!user || user.role !== 'WAITER') {
          ack?.({ success: false, error: 'Unauthorized' });
          return;
        }
        const waiter = await prisma.user.update({
          where: { id: user.userId },
          data: { isOnShift: true, shiftStartedAt: new Date(), shiftEndedAt: null } as any,
          select: { id: true, organizationId: true, branchId: true },
        });

        const branchId = waiter.branchId ?? null;
        registerWaiter(waiter.organizationId, branchId, waiter.id, socket.id);

        const payload = {
          userId: waiter.id,
          organizationId: waiter.organizationId,
          branchId,
          onlineWaiters: getOnlineWaiters(waiter.organizationId, branchId),
        };
        if (branchId) io.to(`${waiter.organizationId}:${branchId}`).emit('WAITER_ONLINE', payload);
        io.to(waiter.organizationId).emit('WAITER_ONLINE', payload);

        ack?.({ success: true, data: { isOnShift: true } });
      } catch (err) {
        logger.error('SHIFT_START error', { err, socketId: socket.id, userId: user?.userId });
        ack?.({ success: false, error: 'Failed to start shift' });
      }
    });

    socket.on('SHIFT_END', async (_: unknown, ack?: (payload: any) => void) => {
      if (!socketRateLimit(socket.id, 10, 60_000)) {
        ack?.({ success: false, error: 'Too many requests' });
        return;
      }
      try {
        if (!user || user.role !== 'WAITER') {
          ack?.({ success: false, error: 'Unauthorized' });
          return;
        }
        const waiter = await prisma.user.update({
          where: { id: user.userId },
          data: { isOnShift: false, shiftEndedAt: new Date() } as any,
          select: { id: true, organizationId: true, branchId: true },
        });

        const branchId = waiter.branchId ?? null;
        unregisterWaiterByUserId(waiter.organizationId, branchId, waiter.id);

        const payload = {
          userId: waiter.id,
          organizationId: waiter.organizationId,
          branchId,
          onlineWaiters: getOnlineWaiters(waiter.organizationId, branchId),
        };
        if (branchId) io.to(`${waiter.organizationId}:${branchId}`).emit('WAITER_OFFLINE', payload);
        io.to(waiter.organizationId).emit('WAITER_OFFLINE', payload);

        ack?.({ success: true, data: { isOnShift: false } });
      } catch (err) {
        logger.error('SHIFT_END error', { err, socketId: socket.id, userId: user?.userId });
        ack?.({ success: false, error: 'Failed to end shift' });
      }
    });

    socket.on('LEAVE_ORG', (orgId: string) => {
      socket.leave(orgId);
    });

    socket.on('LEAVE_BRANCH', ({ orgId, branchId }: { orgId: string; branchId: string }) => {
      socket.leave(`${orgId}:${branchId}`);
    });

    socket.on('JOIN_ORDER', async ({ orderId }: { orderId: string }) => {
      if (!socketRateLimit(socket.id)) {
        socket.emit('ERROR', { message: 'Too many requests' });
        return;
      }
      try {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: { id: true },
        });
        if (!order) {
          socket.emit('ERROR', { message: 'Order not found' });
          return;
        }
        const room = `order:${orderId}`;
        socket.join(room);
        socket.emit('JOINED', { orderId, room });
      } catch {
        socket.emit('ERROR', { message: 'Failed to join order room' });
      }
    });

    socket.on('LEAVE_ORDER', ({ orderId }: { orderId: string }) => {
      socket.leave(`order:${orderId}`);
    });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { socketId: socket.id });
      socketEventCounts.delete(socket.id); // clean up immediately on disconnect

      // Unregister waiter if they were one
      const unregistered = unregisterWaiter(socket.id);
      if (unregistered && user?.organizationId) {
        const offlinePayload = {
          userId: unregistered.userId,
          organizationId: user.organizationId,
          branchId: user?.branchId ?? null,
          onlineWaiters: getOnlineWaiters(user.organizationId, user?.branchId ?? null),
        };
        if (user.branchId) {
          io.to(`${user.organizationId}:${user.branchId}`).emit('WAITER_OFFLINE', offlinePayload);
        }
        io.to(user.organizationId).emit('WAITER_OFFLINE', offlinePayload);
      }
    });

    socket.on('error', (err) => {
      logger.error('Socket error', { err, socketId: socket.id });
    });
  });
}
