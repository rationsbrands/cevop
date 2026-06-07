import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth';
import { logger } from '../services/logger';
import { io } from '../index';
import { uploadClockInPhoto, getSignedPhotoUrl } from '../services/storage';

export const shiftsRouter = Router();

// ─── Pay calculation helper ───────────────────────────────────────────────────

function calculatePayAmount(shift: {
  salaryType: string;
  hourlyRate: any;
  monthlySalary: any;
  workingDaysPerMonth?: number;
  durationMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
}): number {
  const billableMinutes = Math.max(0, shift.durationMinutes - shift.breakMinutes);

  if (shift.salaryType === 'HOURLY') {
    const rate = Number(shift.hourlyRate ?? 0);
    const regularHours = billableMinutes / 60;
    const overtimeHours = shift.overtimeMinutes / 60;
    return Number((regularHours * rate + overtimeHours * rate * 0.5).toFixed(2));
  }

  // MONTHLY: daily rate × days worked (this shift = 1 day fraction)
  const monthly = Number(shift.monthlySalary ?? 0);
  const workDays = shift.workingDaysPerMonth ?? 22;
  const dailyRate = monthly / workDays;
  // A shift counts as one day; overtime adds 1.5× daily rate per extra hour
  const overtimeHours = shift.overtimeMinutes / 60;
  const overtimePay = overtimeHours * (dailyRate / 8) * 1.5;
  return Number((dailyRate + overtimePay).toFixed(2));
}

// ─── Self-service toggle (waiter/kitchen/service roles via their board) ───────

shiftsRouter.patch('/toggle', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const orgId = req.user!.organizationId;

    const user = await (prisma.user as any).findFirst({
      where: { id: userId, organizationId: orgId },
      select: {
        isOnShift: true,
        shiftStartedAt: true,
        branchId: true,
        salaryType: true,
        hourlyRate: true,
        monthlySalary: true,
        workingDaysPerMonth: true,
      },
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
          data: {
            organizationId: orgId,
            branchId: user.branchId,
            userId,
            clockedInAt: now,
            salaryType: user.salaryType,
            hourlyRate: user.hourlyRate,
            monthlySalary: user.monthlySalary,
          },
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
          const payAmount = calculatePayAmount({
            salaryType: openShift.salaryType,
            hourlyRate: openShift.hourlyRate,
            monthlySalary: openShift.monthlySalary,
            workingDaysPerMonth: user.workingDaysPerMonth,
            durationMinutes,
            breakMinutes: openShift.breakMinutes,
            overtimeMinutes: openShift.overtimeMinutes,
          });
          await (tx.staffShift as any).update({
            where: { id: openShift.id },
            data: { clockedOutAt: now, durationMinutes, payAmount },
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

// ─── Kiosk clock-in (no auth required — staff enter their staff code) ────────
// The orgId + branchId come from the kiosk URL (set up by admin once, not user input).

shiftsRouter.post('/kiosk-toggle', async (req: Request, res: Response) => {
  try {
    const { staffCode, orgId, branchId, photo } = z
      .object({
        staffCode: z.string().min(1).max(20).trim().toUpperCase(),
        orgId: z.string().min(1),
        branchId: z.string().min(1),
        // Optional base64 JPEG selfie captured by the kiosk tablet camera.
        // Max ~100KB base64 string (~75KB image). Silently ignored if absent or invalid.
        photo: z.string().max(150_000).optional(),
      })
      .parse(req.body);

    const user = await (prisma.user as any).findFirst({
      where: {
        staffCode,
        organizationId: orgId,
        branchId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        role: true,
        isOnShift: true,
        shiftStartedAt: true,
        branchId: true,
        salaryType: true,
        hourlyRate: true,
        monthlySalary: true,
        workingDaysPerMonth: true,
      },
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
          data: {
            organizationId: orgId,
            branchId,
            userId: user.id,
            clockedInAt: now,
            salaryType: user.salaryType,
            hourlyRate: user.hourlyRate,
            monthlySalary: user.monthlySalary,
          },
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
          const payAmount = calculatePayAmount({
            salaryType: openShift.salaryType,
            hourlyRate: openShift.hourlyRate,
            monthlySalary: openShift.monthlySalary,
            workingDaysPerMonth: user.workingDaysPerMonth,
            durationMinutes,
            breakMinutes: openShift.breakMinutes,
            overtimeMinutes: openShift.overtimeMinutes,
          });
          await (tx.staffShift as any).update({
            where: { id: openShift.id },
            data: { clockedOutAt: now, durationMinutes, payAmount },
          });
        }
        return null;
      }
    });

    // Upload selfie photo AFTER transaction — failure must never roll back the clock-in
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

    // For clock-outs, include the shift start time and duration so the kiosk can display them
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

// ─── Admin: manually create/correct a shift ───────────────────────────────────

shiftsRouter.post(
  '/',
  authenticate,
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        userId: z.string(),
        clockedInAt: z.string().datetime(),
        clockedOutAt: z.string().datetime().optional(),
        breakMinutes: z.number().int().min(0).default(0),
        overtimeMinutes: z.number().int().min(0).default(0),
        notes: z.string().max(500).optional(),
      });
      const body = schema.parse(req.body);

      const user = await (prisma.user as any).findFirst({
        where: { id: body.userId, organizationId: req.user!.organizationId },
        select: {
          branchId: true,
          salaryType: true,
          hourlyRate: true,
          monthlySalary: true,
          workingDaysPerMonth: true,
        },
      });
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });

      const clockedInAt = new Date(body.clockedInAt);
      const clockedOutAt = body.clockedOutAt ? new Date(body.clockedOutAt) : null;

      let durationMinutes: number | null = null;
      let payAmount: number | null = null;

      if (clockedOutAt) {
        durationMinutes = Math.round((clockedOutAt.getTime() - clockedInAt.getTime()) / 60000);
        payAmount = calculatePayAmount({
          salaryType: user.salaryType,
          hourlyRate: user.hourlyRate,
          monthlySalary: user.monthlySalary,
          workingDaysPerMonth: user.workingDaysPerMonth,
          durationMinutes,
          breakMinutes: body.breakMinutes,
          overtimeMinutes: body.overtimeMinutes,
        });
      }

      const shift = await (prisma.staffShift as any).create({
        data: {
          organizationId: req.user!.organizationId,
          branchId: user.branchId,
          userId: body.userId,
          clockedInAt,
          clockedOutAt,
          durationMinutes,
          breakMinutes: body.breakMinutes,
          overtimeMinutes: body.overtimeMinutes,
          payAmount,
          notes: body.notes,
          salaryType: user.salaryType,
          hourlyRate: user.hourlyRate,
          monthlySalary: user.monthlySalary,
          approvedBy: req.user!.userId,
          isApproved: true,
        },
        include: { user: { select: { name: true, role: true } } },
      });

      res.status(201).json({ success: true, data: shift });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res
          .status(400)
          .json({ success: false, error: 'Validation error', details: err.errors });
      logger.error('POST /shifts error:', err);
      res.status(500).json({ success: false, error: 'Failed to create shift' });
    }
  },
);

// ─── Admin: edit / correct an existing shift ──────────────────────────────────

shiftsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        clockedInAt: z.string().datetime().optional(),
        clockedOutAt: z.string().datetime().nullable().optional(),
        breakMinutes: z.number().int().min(0).optional(),
        overtimeMinutes: z.number().int().min(0).optional(),
        lateMinutes: z.number().int().min(0).optional(),
        notes: z.string().max(500).optional(),
        isApproved: z.boolean().optional(),
      });
      const body = schema.parse(req.body);

      const existing = await (prisma.staffShift as any).findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
        include: { user: { select: { workingDaysPerMonth: true } } },
      });
      if (!existing) return res.status(404).json({ success: false, error: 'Shift not found' });

      const clockedInAt = body.clockedInAt ? new Date(body.clockedInAt) : existing.clockedInAt;
      const clockedOutAt =
        body.clockedOutAt !== undefined
          ? body.clockedOutAt
            ? new Date(body.clockedOutAt)
            : null
          : existing.clockedOutAt;

      let durationMinutes = existing.durationMinutes;
      let payAmount = existing.payAmount;

      if (clockedOutAt) {
        durationMinutes = Math.round((clockedOutAt.getTime() - clockedInAt.getTime()) / 60000);
        payAmount = calculatePayAmount({
          salaryType: existing.salaryType,
          hourlyRate: existing.hourlyRate,
          monthlySalary: existing.monthlySalary,
          workingDaysPerMonth: existing.user?.workingDaysPerMonth ?? 22,
          durationMinutes,
          breakMinutes: body.breakMinutes ?? existing.breakMinutes,
          overtimeMinutes: body.overtimeMinutes ?? existing.overtimeMinutes,
        });
      }

      const updated = await (prisma.staffShift as any).update({
        where: { id: req.params.id },
        data: {
          ...body,
          clockedInAt,
          clockedOutAt,
          durationMinutes,
          payAmount,
          approvedBy: body.isApproved ? req.user!.userId : existing.approvedBy,
        },
        include: { user: { select: { name: true, role: true } } },
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res
          .status(400)
          .json({ success: false, error: 'Validation error', details: err.errors });
      logger.error('PATCH /shifts/:id error:', err);
      res.status(500).json({ success: false, error: 'Failed to update shift' });
    }
  },
);

// ─── GET /shifts/:id/photo — return a short-lived signed URL for the clock-in photo ──

shiftsRouter.get(
  '/:id/photo',
  authenticate,
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const shift = await (prisma.staffShift as any).findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
        select: { clockInPhotoUrl: true },
      });

      if (!shift) {
        return res.status(404).json({ success: false, error: 'Shift not found' });
      }

      if (!shift.clockInPhotoUrl) {
        return res.json({ success: true, data: { url: null } });
      }

      const url = await getSignedPhotoUrl(shift.clockInPhotoUrl);
      res.json({ success: true, data: { url } });
    } catch (err) {
      logger.error('GET /shifts/:id/photo error:', err);
      res.status(500).json({ success: false, error: 'Failed to get photo URL' });
    }
  },
);
