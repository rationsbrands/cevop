import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth';
import { prisma } from '../services/prisma';
import { logger } from '../services/logger';

export const timesheetsRouter = Router();
timesheetsRouter.use(authenticate);
timesheetsRouter.use(
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
);

const ADMIN_ROLES = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'];

function buildWhere(req: AuthRequest, from: Date, to: Date, userId?: string) {
  const orgId = req.user!.organizationId;
  const branchId = req.user!.branchId;
  return {
    organizationId: orgId,
    ...(branchId ? { branchId } : {}),
    clockedInAt: { gte: from, lte: to },
    ...(userId ? { userId } : {}),
  };
}

// ─── GET /timesheets — paginated shift list with filters ──────────────────────

timesheetsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, userId, limit, cursor } = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        userId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
        cursor: z.string().optional(),
      })
      .parse(req.query);

    // Default: current month
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = to
      ? new Date(to)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where = buildWhere(req, fromDate, toDate, userId);

    const shifts = await (prisma.staffShift as any).findMany({
      where,
      include: {
        user: { select: { id: true, name: true, role: true, staffCode: true } },
      },
      orderBy: { clockedInAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = shifts.length > limit;
    const data = hasMore ? shifts.slice(0, limit) : shifts;

    res.json({
      success: true,
      data,
      pagination: {
        hasMore,
        nextCursor: hasMore ? data[data.length - 1].id : null,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ success: false, error: 'Validation error', details: err.errors });
    logger.error('GET /timesheets error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch timesheets' });
  }
});

// ─── GET /timesheets/payroll-summary — per-staff pay totals for a period ──────

timesheetsRouter.get('/payroll-summary', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = to
      ? new Date(to)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where = buildWhere(req, fromDate, toDate);

    const shifts = await (prisma.staffShift as any).findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            role: true,
            staffCode: true,
            salaryType: true,
            monthlySalary: true,
            hourlyRate: true,
          },
        },
      },
      orderBy: { clockedInAt: 'asc' },
    });

    // Group by userId
    const byStaff = new Map<
      string,
      {
        user: any;
        shifts: any[];
        totalMinutes: number;
        totalOvertimeMinutes: number;
        totalBreakMinutes: number;
        totalPay: number;
        openShifts: number;
        daysWorked: Set<string>;
      }
    >();

    for (const shift of shifts) {
      const uid = shift.userId;
      if (!byStaff.has(uid)) {
        byStaff.set(uid, {
          user: shift.user,
          shifts: [],
          totalMinutes: 0,
          totalOvertimeMinutes: 0,
          totalBreakMinutes: 0,
          totalPay: 0,
          openShifts: 0,
          daysWorked: new Set(),
        });
      }
      const entry = byStaff.get(uid)!;
      entry.shifts.push(shift);
      entry.totalMinutes += shift.durationMinutes ?? 0;
      entry.totalOvertimeMinutes += shift.overtimeMinutes ?? 0;
      entry.totalBreakMinutes += shift.breakMinutes ?? 0;
      entry.totalPay += Number(shift.payAmount ?? 0);
      if (!shift.clockedOutAt) entry.openShifts++;
      if (shift.clockedInAt) {
        entry.daysWorked.add(new Date(shift.clockedInAt).toISOString().slice(0, 10));
      }
    }

    const summary = Array.from(byStaff.values()).map((entry) => ({
      user: entry.user,
      totalMinutes: entry.totalMinutes,
      totalHours: Number((entry.totalMinutes / 60).toFixed(2)),
      totalOvertimeMinutes: entry.totalOvertimeMinutes,
      totalBreakMinutes: entry.totalBreakMinutes,
      daysWorked: entry.daysWorked.size,
      totalPay: Number(entry.totalPay.toFixed(2)),
      openShifts: entry.openShifts,
      shiftCount: entry.shifts.length,
    }));

    res.json({
      success: true,
      data: summary,
      meta: { from: fromDate.toISOString(), to: toDate.toISOString(), staffCount: summary.length },
    });
  } catch (err) {
    logger.error('GET /timesheets/payroll-summary error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate payroll summary' });
  }
});

// ─── GET /timesheets/export.csv — download payroll as CSV ────────────────────

timesheetsRouter.get('/export.csv', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = to
      ? new Date(to)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const shifts = await (prisma.staffShift as any).findMany({
      where: buildWhere(req, fromDate, toDate),
      include: {
        user: { select: { name: true, role: true, staffCode: true } },
        branch: { select: { name: true } },
      },
      orderBy: [{ user: { name: 'asc' } }, { clockedInAt: 'asc' }],
    });

    function cell(v: any) {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }

    const CRLF = '\r\n';
    const header = [
      'Staff Name',
      'Staff Code',
      'Role',
      'Branch',
      'Date',
      'Clock In',
      'Clock Out',
      'Duration (hrs)',
      'Break (min)',
      'Overtime (min)',
      'Late (min)',
      'Pay Amount',
      'Salary Type',
      'Status',
    ]
      .map(cell)
      .join(',');

    const rows = shifts.map((s: any) => {
      const date = s.clockedInAt ? new Date(s.clockedInAt).toLocaleDateString() : '';
      const inTime = s.clockedInAt
        ? new Date(s.clockedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      const outTime = s.clockedOutAt
        ? new Date(s.clockedOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Still In';
      const hours = s.durationMinutes ? (s.durationMinutes / 60).toFixed(2) : '—';
      return [
        s.user?.name ?? '',
        s.user?.staffCode ?? '',
        s.user?.role ?? '',
        s.branch?.name ?? '',
        date,
        inTime,
        outTime,
        hours,
        s.breakMinutes ?? 0,
        s.overtimeMinutes ?? 0,
        s.lateMinutes ?? 0,
        s.payAmount != null ? Number(s.payAmount).toFixed(2) : '—',
        s.salaryType ?? '',
        s.clockedOutAt ? (s.isApproved ? 'Approved' : 'Pending') : 'Active',
      ]
        .map(cell)
        .join(',');
    });

    const csv = [header, ...rows].join(CRLF);
    const filename = `payroll-${fromDate.toISOString().slice(0, 10)}-to-${toDate.toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    logger.error('GET /timesheets/export.csv error:', err);
    res.status(500).json({ success: false, error: 'Failed to export timesheets' });
  }
});
