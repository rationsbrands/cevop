/**
 * Ops routes — SUPERADMIN only. Platform-wide visibility and control.
 * All routes require authenticate + SUPERADMIN role.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';


const PLATFORM_SLUG = 'cevop-internal'; // Internal platform org — excluded from client metrics

export const opsRouter = Router();
opsRouter.use(authenticate, requireRole('SUPERADMIN'));

// ─── Platform metrics ─────────────────────────────────────────────────────────
opsRouter.get('/metrics', async (_req, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const today = new Date(now); today.setHours(0, 0, 0, 0);

    const [
      totalOrgs,
      activeOrgs,
      trialingOrgs,
      suspendedOrgs,
      selfSignupOrgs,
      newOrgsThisMonth,
      totalUsers,
      totalOrders,
      ordersToday,
      totalBranches,
      totalRevenue,
    ] = await Promise.all([
      prisma.organization.count({ where: { slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({ where: { planStatus: 'active', slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({ where: { planStatus: 'trialing', slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({ where: { planStatus: 'suspended', slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({ where: { selfSignup: true, slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({ where: { createdAt: { gte: thirtyDaysAgo }, slug: { not: PLATFORM_SLUG } } }),
      prisma.user.count({ where: { isActive: true, role: { not: 'SUPERADMIN' } } }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.branch.count({ where: { isActive: true } }),
      prisma.order.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { total: true } }),
    ]);

    res.json({
      success: true,
      data: {
        orgs: { total: totalOrgs, active: activeOrgs, trialing: trialingOrgs, suspended: suspendedOrgs, selfSignup: selfSignupOrgs, newThisMonth: newOrgsThisMonth },
        users: { total: totalUsers },
        orders: { total: totalOrders, today: ordersToday },
        branches: { total: totalBranches },
        revenue: { total: Number(totalRevenue._sum.total ?? 0) },
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
});

// ─── List all organisations ───────────────────────────────────────────────────
opsRouter.get('/orgs', async (req: AuthRequest, res: Response) => {
  try {
    const { search, planStatus, plan, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: Prisma.OrganizationWhereInput = { slug: { not: PLATFORM_SLUG } };
    if (planStatus) where.planStatus = planStatus;
    if (plan) where.plan = plan;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orgs, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          _count: { select: { users: true, branches: true, orders: true } },
        },
      }),
      prisma.organization.count({ where }),
    ]);

    res.json({
      success: true,
      data: orgs,
      meta: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch organisations' });
  }
});

// ─── Get single org detail ────────────────────────────────────────────────────
opsRouter.get('/orgs/:orgId', async (req: AuthRequest, res: Response) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.orgId },
      include: {
        _count: { select: { users: true, branches: true, orders: true, tables: true } },
        branches: { orderBy: { createdAt: 'asc' }, include: { _count: { select: { users: true, orders: true } } } },
        users: { where: { role: { in: ['ADMIN', 'BRANCH_ADMIN'] } }, select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, branchId: true } },
      },
    });
    if (!org) { res.status(404).json({ success: false, error: 'Organisation not found' }); return; }

    // Revenue for this org
    const revenue = await prisma.order.aggregate({
      where: { organizationId: org.id, status: { not: 'CANCELLED' } },
      _sum: { total: true },
    });

    // Orders last 30 days
    const recentOrders = await prisma.order.count({
      where: { organizationId: org.id, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    });

    res.json({
      success: true,
      data: {
        ...org,
        stats: {
          totalRevenue: Number(revenue._sum.total ?? 0),
          ordersLast30Days: recentOrders,
        },
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch organisation' });
  }
});

// ─── Update org plan/status ───────────────────────────────────────────────────
opsRouter.patch('/orgs/:orgId', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      plan: z.enum(['trial', 'starter', 'growth', 'enterprise']).optional(),
      planStatus: z.enum(['trialing', 'active', 'suspended', 'cancelled']).optional(),
      isActive: z.boolean().optional(),
      notes: z.string().max(2000).optional(),
      trialEndsAt: z.string().datetime().optional(),
    });
    const data = schema.parse(req.body);

    const updateData: Prisma.OrganizationUpdateInput = {
      ...data,
      ...(data.trialEndsAt ? { trialEndsAt: new Date(data.trialEndsAt) } : {}),
      ...(data.planStatus === 'active' ? { verifiedAt: new Date(), verifiedBy: req.user!.userId } : {}),
    };

    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: updateData,
    });

    res.json({ success: true, data: org });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: 'Validation error', details: err.errors }); return; }
    res.status(500).json({ success: false, error: 'Failed to update organisation' });
  }
});

// ─── Suspend / Reactivate org ─────────────────────────────────────────────────
opsRouter.post('/orgs/:orgId/suspend', async (req: AuthRequest, res: Response) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: { planStatus: 'suspended', isActive: false },
    });
    res.json({ success: true, data: org, message: 'Organisation suspended' });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to suspend' });
  }
});

opsRouter.post('/orgs/:orgId/activate', async (req: AuthRequest, res: Response) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: { planStatus: 'active', isActive: true, verifiedAt: new Date(), verifiedBy: req.user!.userId },
    });
    res.json({ success: true, data: org, message: 'Organisation activated' });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to activate' });
  }
});

// ─── Recent activity across platform ─────────────────────────────────────────
opsRouter.get('/activity', async (_req, res: Response) => {
  try {
    const [recentOrgs, recentOrders, recentAudit] = await Promise.all([
      prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, slug: true, plan: true, planStatus: true, selfSignup: true, createdAt: true },
      }),
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { organization: { select: { name: true } }, table: { select: { label: true } } },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { organization: { select: { name: true } }, user: { select: { name: true, email: true } } },
      }),
    ]);

    res.json({ success: true, data: { recentOrgs, recentOrders, recentAudit } });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch activity' });
  }
});

// ─── Orgs approaching trial end ───────────────────────────────────────────────
opsRouter.get('/trials/expiring', async (_req, res: Response) => {
  try {
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const orgs = await prisma.organization.findMany({
      where: { planStatus: 'trialing', trialEndsAt: { lte: in7Days } },
      orderBy: { trialEndsAt: 'asc' },
      include: { _count: { select: { orders: true, users: true } } },
    });
    res.json({ success: true, data: orgs });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch expiring trials' });
  }
});
