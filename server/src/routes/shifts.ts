import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import { io } from '../index';
import { uploadClockInPhoto } from '../services/storage';

export const shiftsRouter = Router();

// ─── Self-service toggle (waiters/kitchen go on/off shift from their board) ───

shiftsRouter.patch('/toggle', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const orgId = req.user!.organizationId;

    const user = await (prisma.user as any).findFirst({
      where: { id: userId, organizationId: orgId },
      select: { isOnShift: true, shiftStartedAt: true, branchId: true },
    });

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

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
        select: { id: true, isOnShift: true, shiftStartedAt: true, shiftEndedAt: true },
      });

      if (nextState) {
        await (tx.staffShift as any).create({
          data: { organizationId: orgId, branchId: user.branchId, userId, clockedInAt: now },
        });
      } else {
        const openShift = await (tx.staffShift as any).findFirst({
          where: { userId, clockedOutAt: null },
          orderBy: { clockedInAt: 'desc' },
        });
        if (openShift) {
          const durationMinutes = Math.round(
            (now.getTime() - openShift.clockedInAt.getTime()) / 60000,
          );
          await (tx.staffShift as any).update({
            where: { id: openShift.id },
            data: { clockedOutAt: now, durationMinutes },
          });
        }
      }

      return userUpdate;
    });

    if (user.branchId) {
      io.to(`${orgId}:${user.branchId}`).emit('STAFF_SHIFT_CHANGED', {
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

// ─── Kiosk clock-in (no auth — staff enter their staff code on a shared tablet) ─

shiftsRouter.post('/kiosk-toggle', async (req: Request, res: Response) => {
  try {
    const { staffCode, orgId, branchId, photo } = z
      .object({
        staffCode: z.string().min(1).max(20).trim().toUpperCase(),
        orgId: z.string().min(1),
        branchId: z.string().min(1),
        photo: z.string().max(150_000).optional(),
      })
      .parse(req.body);

    const user = await (prisma.user as any).findFirst({
      where: { staffCode, organizationId: orgId, branchId, isActive: true },
      select: { id: true, name: true, role: true, isOnShift: true, shiftStartedAt: true },
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: 'Staff code not found. Check your code and try again.' });
    }

    const nextState = !user.isOnShift;
    const now = new Date();

    const createdShiftId = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          isOnShift: nextState,
          shiftStartedAt: nextState ? now : user.shiftStartedAt,
          shiftEndedAt: nextState ? null : now,
        },
      });

      if (nextState) {
        const newShift = await (tx.staffShift as any).create({
          data: { organizationId: orgId, branchId, userId: user.id, clockedInAt: now },
          select: { id: true },
        });
        return newShift.id as string;
      } else {
        const openShift = await (tx.staffShift as any).findFirst({
          where: { userId: user.id, clockedOutAt: null },
          orderBy: { clockedInAt: 'desc' },
        });
        if (openShift) {
          const durationMinutes = Math.round(
            (now.getTime() - openShift.clockedInAt.getTime()) / 60000,
          );
          await (tx.staffShift as any).update({
            where: { id: openShift.id },
            data: { clockedOutAt: now, durationMinutes },
          });
        }
        return null;
      }
    });

    // Upload selfie AFTER transaction — failure must never roll back the clock-in
    if (nextState && createdShiftId && photo) {
      uploadClockInPhoto(photo, orgId, createdShiftId)
        .then((storagePath) => {
          if (storagePath) {
            return (prisma.staffShift as any).update({
              where: { id: createdShiftId },
              data: { clockInPhotoUrl: storagePath },
            });
          }
        })
        .catch((err) => {
          logger.error('Failed to save clock-in photo after successful clock-in', {
            err,
            shiftId: createdShiftId,
          });
        });
    }

    io.to(`${orgId}:${branchId}`).emit('STAFF_SHIFT_CHANGED', {
      userId: user.id,
      isOnShift: nextState,
    });

    let clockedInAt: string | null = null;
    let durationMinutes: number | null = null;
    if (!nextState) {
      const lastShift = await (prisma.staffShift as any).findFirst({
        where: { userId: user.id, clockedOutAt: { not: null } },
        orderBy: { clockedOutAt: 'desc' },
        select: { clockedInAt: true, durationMinutes: true },
      });
      if (lastShift) {
        clockedInAt = lastShift.clockedInAt.toISOString();
        durationMinutes = lastShift.durationMinutes;
      }
    }

    res.json({
      success: true,
      data: {
        name: user.name,
        role: user.role,
        isOnShift: nextState,
        timestamp: now.toISOString(),
        clockedInAt,
        durationMinutes,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid request', details: err.errors });
    }
    logger.error('POST /shifts/kiosk-toggle error:', err);
    res.status(500).json({ success: false, error: 'Failed to toggle shift' });
  }
});
