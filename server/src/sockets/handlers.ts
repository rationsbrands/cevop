import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '../services/logger';
import { prisma } from '../services/prisma';
import type { AuthPayload } from '../../../shared/types';

export function initSocketHandlers(io: Server): void {
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      // Allow unauthenticated connections (service read-only, customer PWA)
      return next();
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
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
    }

    // Allow explicit room join — validate JWT before allowing
    socket.on('JOIN_ORG', (orgId: string) => {
      if (!user || (user.organizationId !== orgId && user.role !== 'SUPERADMIN')) {
        socket.emit('ERROR', { message: 'Unauthorized room join' });
        return;
      }
      socket.join(orgId);
      logger.info('Socket joined org room via event', { orgId, socketId: socket.id });
      socket.emit('JOINED', { orgId });
    });

    // Join a specific branch room (for branch-scoped service displays)
    socket.on('JOIN_BRANCH', ({ orgId, branchId }: { orgId: string; branchId: string }) => {
      if (!user || user.organizationId !== orgId) {
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

    socket.on('LEAVE_ORG', (orgId: string) => {
      socket.leave(orgId);
    });

    socket.on('LEAVE_BRANCH', ({ orgId, branchId }: { orgId: string; branchId: string }) => {
      socket.leave(`${orgId}:${branchId}`);
    });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { socketId: socket.id });
    });

    socket.on('error', (err) => {
      logger.error('Socket error', { err, socketId: socket.id });
    });
  });
}
