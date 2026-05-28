import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import { io } from '../index';

export const shiftsRouter = Router();

shiftsRouter.use(authenticate);

// Toggle shift status
shiftsRouter.patch('/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const orgId = req.user!.organizationId;

    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: { isOnShift: true, shiftStartedAt: true, branchId: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const nextState = !user.isOnShift;
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const userUpdate = await tx.user.update({
        where: { id: userId },
        data: {
          isOnShift: nextState,
          shiftStartedAt: nextState ? now : user.shiftStartedAt,
          shiftEndedAt: nextState ? null : now,
        },
        select: {
          id: true,
          isOnShift: true,
          shiftStartedAt: true,
          shiftEndedAt: true,
        },
      });

      if (nextState) {
        // Clocking in: create a new open StaffShift
        await tx.staffShift.create({
          data: {
            organizationId: orgId,
            branchId: user.branchId,
            userId: userId,
            clockedInAt: now,
          },
        });
      } else {
        // Clocking out: find the most recent open StaffShift and close it
        const openShift = await tx.staffShift.findFirst({
          where: { userId: userId, clockedOutAt: null },
          orderBy: { clockedInAt: 'desc' },
        });

        if (openShift) {
          const durationMinutes = Math.round(
            (now.getTime() - openShift.clockedInAt.getTime()) / 60000,
          );
          await tx.staffShift.update({
            where: { id: openShift.id },
            data: {
              clockedOutAt: now,
              durationMinutes,
            },
          });
        }
      }

      return userUpdate;
    });

    // Notify others that staff status changed (useful for active user grids)
    if (user.branchId) {
      const room = `${orgId}:${user.branchId}`;
      io.to(room).emit('STAFF_SHIFT_CHANGED', {
        userId: updated.id,
        isOnShift: updated.isOnShift,
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('PATCH /shifts/toggle error:', err);
    res.status(500).json({ success: false, error: 'Failed to toggle shift' });
  }
});
