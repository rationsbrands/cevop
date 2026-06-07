import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';

export const financeRouter = Router();

const FINANCE_ROLES = [
  'ORG_OWNER',
  'ADMIN',
  'ORG_MANAGER',
  'ORG_FINANCE',
  'BRANCH_ADMIN',
  'BRANCH_FINANCE',
  'SUPERADMIN',
] as const;

financeRouter.use(authenticate, requireRole(...FINANCE_ROLES));

const orgId = (req: AuthRequest) => req.user!.organizationId;
const userId = (req: AuthRequest) => req.user!.userId;

function dateRange(from?: string, to?: string) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? new Date(to) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

// ─── GET /api/finance/summary ─────────────────────────────────────────────────
// Top-level P&L figures for a period
financeRouter.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { branchId, from, to } = req.query as Record<string, string>;
    const { start, end } = dateRange(from, to);
    const oid = orgId(req);

    const branchFilter = branchId ? { branchId } : {};

    // Revenue — sum of all payments in period
    const revenueAgg = await prisma.payment.aggregate({
      where: { organizationId: oid, ...branchFilter, processedAt: { gte: start, lte: end } },
      _sum: { amount: true, taxAmount: true, serviceChargeAmount: true },
      _count: { _all: true },
    });

    // COGS — stock movements typed as SALE or PRODUCTION_OUT (quantity × unitCost)
    const cogsMovements = await prisma.stockMovement.findMany({
      where: {
        organizationId: oid,
        ...branchFilter,
        type: { in: ['SALE', 'PRODUCTION_OUT', 'WRITE_OFF'] },
        createdAt: { gte: start, lte: end },
      },
      select: { quantity: true, unitCost: true, type: true },
    });
    const cogs = cogsMovements.reduce(
      (sum, m) => sum + Math.abs(Number(m.quantity)) * Number(m.unitCost),
      0,
    );

    // Wastage cost
    const wastageAgg = await prisma.wastageEntry.aggregate({
      where: { organizationId: oid, ...branchFilter, createdAt: { gte: start, lte: end } },
      _sum: { totalCost: true },
    });

    // Labour cost — staff shifts in period
    const shiftsAgg = await prisma.staffShift.aggregate({
      where: {
        organizationId: oid,
        ...(branchId ? { branchId } : {}),
        clockedInAt: { gte: start, lte: end },
        isApproved: true,
        payAmount: { not: null },
      },
      _sum: { payAmount: true },
    });

    // Inventory purchase spend (received POs)
    const poAgg = await prisma.purchaseOrder.aggregate({
      where: {
        organizationId: oid,
        ...branchFilter,
        status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
        updatedAt: { gte: start, lte: end },
      },
      _sum: { total: true },
    });

    // Expenses
    const expensesAgg = await prisma.expense.aggregate({
      where: {
        organizationId: oid,
        ...(branchId ? { branchId } : {}),
        date: { gte: start, lte: end },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    // Revenue by payment method
    const byMethod = await prisma.payment.groupBy({
      by: ['method'],
      where: { organizationId: oid, ...branchFilter, processedAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const revenue = Number(revenueAgg._sum.amount ?? 0);
    const tax = Number(revenueAgg._sum.taxAmount ?? 0);
    const serviceCharge = Number(revenueAgg._sum.serviceChargeAmount ?? 0);
    const netRevenue = revenue - tax - serviceCharge;
    const grossProfit = netRevenue - cogs;
    const totalWastage = Number(wastageAgg._sum.totalCost ?? 0);
    const labour = Number(shiftsAgg._sum.payAmount ?? 0);
    const inventorySpend = Number(poAgg._sum.total ?? 0);
    const otherExpenses = Number(expensesAgg._sum.amount ?? 0);
    const totalOpex = labour + otherExpenses;
    const netProfit = grossProfit - totalOpex - totalWastage;

    res.json({
      success: true,
      data: {
        period: { from: start, to: end },
        revenue,
        tax,
        serviceCharge,
        netRevenue,
        cogs,
        grossProfit,
        grossMargin: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
        wastage: totalWastage,
        labour,
        inventorySpend,
        otherExpenses,
        totalOpex,
        netProfit,
        netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
        transactionCount: revenueAgg._count._all,
        expenseCount: expensesAgg._count._all,
        byMethod: byMethod.map((m) => ({
          method: m.method,
          amount: Number(m._sum.amount ?? 0),
          count: m._count._all,
        })),
      },
    });
  } catch (err) {
    logger.error('GET /finance/summary error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch finance summary' });
  }
});

// ─── GET /api/finance/cashflow ────────────────────────────────────────────────
// Daily cash in / cash out for the period
financeRouter.get('/cashflow', async (req: AuthRequest, res: Response) => {
  try {
    const { branchId, from, to } = req.query as Record<string, string>;
    const { start, end } = dateRange(from, to);
    const oid = orgId(req);
    const branchFilter = branchId ? { branchId } : {};

    // Daily revenue
    const payments = await prisma.payment.findMany({
      where: { organizationId: oid, ...branchFilter, processedAt: { gte: start, lte: end } },
      select: { processedAt: true, amount: true },
      orderBy: { processedAt: 'asc' },
    });

    // Daily expenses
    const expenses = await prisma.expense.findMany({
      where: {
        organizationId: oid,
        ...(branchId ? { branchId } : {}),
        date: { gte: start, lte: end },
      },
      select: { date: true, amount: true },
      orderBy: { date: 'asc' },
    });

    // Daily PO spend
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        organizationId: oid,
        ...branchFilter,
        status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
        updatedAt: { gte: start, lte: end },
      },
      select: { updatedAt: true, total: true },
    });

    // Build day map
    const dayMap: Record<string, { date: string; inflow: number; outflow: number }> = {};

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);

    for (const p of payments) {
      const k = dayKey(p.processedAt);
      if (!dayMap[k]) dayMap[k] = { date: k, inflow: 0, outflow: 0 };
      dayMap[k].inflow += Number(p.amount);
    }
    for (const e of expenses) {
      const k = dayKey(e.date);
      if (!dayMap[k]) dayMap[k] = { date: k, inflow: 0, outflow: 0 };
      dayMap[k].outflow += Number(e.amount);
    }
    for (const po of pos) {
      const k = dayKey(po.updatedAt);
      if (!dayMap[k]) dayMap[k] = { date: k, inflow: 0, outflow: 0 };
      dayMap[k].outflow += Number(po.total);
    }

    const days = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    // Running balance
    let running = 0;
    const result = days.map((d) => {
      running += d.inflow - d.outflow;
      return { ...d, net: d.inflow - d.outflow, running };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('GET /finance/cashflow error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch cash flow' });
  }
});

// ─── GET /api/finance/pnl ─────────────────────────────────────────────────────
// Weekly P&L breakdown for charts
financeRouter.get('/pnl', async (req: AuthRequest, res: Response) => {
  try {
    const { branchId, from, to } = req.query as Record<string, string>;
    const { start, end } = dateRange(from, to);
    const oid = orgId(req);
    const branchFilter = branchId ? { branchId } : {};

    const payments = await prisma.payment.findMany({
      where: { organizationId: oid, ...branchFilter, processedAt: { gte: start, lte: end } },
      select: { processedAt: true, amount: true },
    });

    const expenses = await prisma.expense.findMany({
      where: {
        organizationId: oid,
        ...(branchId ? { branchId } : {}),
        date: { gte: start, lte: end },
      },
      select: { date: true, amount: true, category: true },
    });

    const wastage = await prisma.wastageEntry.findMany({
      where: { organizationId: oid, ...branchFilter, createdAt: { gte: start, lte: end } },
      select: { createdAt: true, totalCost: true },
    });

    // Group by week (ISO week starting Monday)
    const weekKey = (d: Date) => {
      const day = new Date(d);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - ((day.getDay() + 6) % 7)); // Monday
      return day.toISOString().slice(0, 10);
    };

    const weeks: Record<
      string,
      { week: string; revenue: number; expenses: number; wastage: number }
    > = {};

    for (const p of payments) {
      const k = weekKey(p.processedAt);
      if (!weeks[k]) weeks[k] = { week: k, revenue: 0, expenses: 0, wastage: 0 };
      weeks[k].revenue += Number(p.amount);
    }
    for (const e of expenses) {
      const k = weekKey(e.date);
      if (!weeks[k]) weeks[k] = { week: k, revenue: 0, expenses: 0, wastage: 0 };
      weeks[k].expenses += Number(e.amount);
    }
    for (const w of wastage) {
      const k = weekKey(w.createdAt);
      if (!weeks[k]) weeks[k] = { week: k, revenue: 0, expenses: 0, wastage: 0 };
      weeks[k].wastage += Number(w.totalCost);
    }

    const result = Object.values(weeks)
      .sort((a, b) => a.week.localeCompare(b.week))
      .map((w) => ({ ...w, profit: w.revenue - w.expenses - w.wastage }));

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('GET /finance/pnl error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch P&L' });
  }
});

// ─── Expenses CRUD ────────────────────────────────────────────────────────────

const ExpenseSchema = z.object({
  branchId: z.string().optional(),
  category: z.enum([
    'RENT',
    'UTILITIES',
    'MAINTENANCE',
    'MARKETING',
    'SALARY_SUPPLEMENT',
    'EQUIPMENT',
    'SUPPLIES',
    'TRANSPORT',
    'INSURANCE',
    'PROFESSIONAL_FEES',
    'OTHER',
  ]),
  amount: z.number().positive(),
  currency: z.string().default('NGN'),
  description: z.string().min(1),
  date: z.string(), // ISO date string
  isRecurring: z.boolean().default(false),
  recurringFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY']).optional(),
  attachmentUrl: z.string().optional(),
  notes: z.string().optional(),
});

// GET /api/finance/expenses
financeRouter.get('/expenses', async (req: AuthRequest, res: Response) => {
  try {
    const { branchId, from, to, category } = req.query as Record<string, string>;
    const { start, end } = dateRange(from, to);
    const oid = orgId(req);

    const expenses = await prisma.expense.findMany({
      where: {
        organizationId: oid,
        ...(branchId ? { branchId } : {}),
        date: { gte: start, lte: end },
        ...(category ? { category: category as any } : {}),
      },
      include: {
        recorder: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    res.json({ success: true, data: expenses });
  } catch (err) {
    logger.error('GET /finance/expenses error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch expenses' });
  }
});

// POST /api/finance/expenses
financeRouter.post('/expenses', async (req: AuthRequest, res: Response) => {
  try {
    const body = ExpenseSchema.parse(req.body);
    const expense = await prisma.expense.create({
      data: {
        ...body,
        date: new Date(body.date),
        organizationId: orgId(req),
        recordedBy: userId(req),
      },
    });
    res.json({ success: true, data: expense });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ success: false, error: err.errors[0].message });
    logger.error('POST /finance/expenses error:', err);
    res.status(500).json({ success: false, error: 'Failed to create expense' });
  }
});

// PATCH /api/finance/expenses/:id
financeRouter.patch('/expenses/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const body = ExpenseSchema.partial().parse(req.body);
    const existing = await prisma.expense.findFirst({ where: { id, organizationId: orgId(req) } });
    if (!existing) return res.status(404).json({ success: false, error: 'Expense not found' });

    const expense = await prisma.expense.update({
      where: { id },
      data: { ...body, ...(body.date ? { date: new Date(body.date) } : {}) },
    });
    res.json({ success: true, data: expense });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ success: false, error: err.errors[0].message });
    logger.error('PATCH /finance/expenses/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to update expense' });
  }
});

// DELETE /api/finance/expenses/:id
financeRouter.delete('/expenses/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findFirst({ where: { id, organizationId: orgId(req) } });
    if (!existing) return res.status(404).json({ success: false, error: 'Expense not found' });
    await prisma.expense.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /finance/expenses/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete expense' });
  }
});
