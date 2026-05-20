/**
 * Ops routes — SUPERADMIN only. Platform-wide visibility and control.
 * All routes require authenticate + SUPERADMIN role.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const PLATFORM_SLUG = 'cevop-internal'; // Internal platform org — excluded from client metrics

export const opsRouter = Router();
opsRouter.use(authenticate, requireRole('SUPERADMIN'));

// ─── Platform metrics ─────────────────────────────────────────────────────────
opsRouter.get('/metrics', async (_req, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const [
      totalOrgs,
      activeOrgs,
      trialingOrgs,
      suspendedOrgs,
      selfSignupOrgs,
      newOrgsThisMonth,
      freeOrgs,
      totalUsers,
      totalOrders,
      ordersToday,
      totalBranches,
      totalRevenue,
    ] = await Promise.all([
      prisma.organization.count({ where: { slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({ where: { planStatus: 'active', slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({
        where: { planStatus: 'trialing', slug: { not: PLATFORM_SLUG } },
      }),
      prisma.organization.count({
        where: { planStatus: 'suspended', slug: { not: PLATFORM_SLUG } },
      }),
      prisma.organization.count({ where: { selfSignup: true, slug: { not: PLATFORM_SLUG } } }),
      prisma.organization.count({
        where: { createdAt: { gte: thirtyDaysAgo }, slug: { not: PLATFORM_SLUG } },
      }),
      prisma.organization.count({ where: { plan: 'free', slug: { not: PLATFORM_SLUG } } }),
      prisma.user.count({ where: { isActive: true, role: { not: 'SUPERADMIN' } } }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.branch.count({ where: { isActive: true } }),
      prisma.order.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { total: true } }),
    ]);

    res.json({
      success: true,
      data: {
        orgs: {
          total: totalOrgs,
          active: activeOrgs,
          trialing: trialingOrgs,
          suspended: suspendedOrgs,
          selfSignup: selfSignupOrgs,
          newThisMonth: newOrgsThisMonth,
          free: freeOrgs,
        },
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
    const {
      search,
      planStatus,
      plan,
      page = '1',
      limit = '20',
    } = req.query as Record<string, string>;
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
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
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
        branches: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { users: true, orders: true } } },
        },
        users: {
          where: { role: { in: ['ADMIN', 'BRANCH_ADMIN'] } },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
            branchId: true,
          },
        },
      },
    });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organisation not found' });
      return;
    }

    // Revenue for this org
    const revenue = await prisma.order.aggregate({
      where: { organizationId: org.id, status: { not: 'CANCELLED' } },
      _sum: { total: true },
    });

    // Orders last 30 days
    const recentOrders = await prisma.order.count({
      where: {
        organizationId: org.id,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
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
      ...(data.planStatus === 'active'
        ? { verifiedAt: new Date(), verifiedBy: req.user!.userId }
        : {}),
    };

    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: updateData,
    });

    res.json({ success: true, data: org });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
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
      data: {
        planStatus: 'active',
        isActive: true,
        verifiedAt: new Date(),
        verifiedBy: req.user!.userId,
      },
    });
    res.json({ success: true, data: org, message: 'Organisation activated' });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to activate' });
  }
});

// ─── Soft Delete org ──────────────────────────────────────────────────────────
opsRouter.delete('/orgs/:orgId', async (req: AuthRequest, res: Response) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.params.orgId } });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organisation not found' });
      return;
    }
    if (org.slug === PLATFORM_SLUG) {
      res.status(403).json({ success: false, error: 'Cannot delete platform org' });
      return;
    }

    const deleteDate = new Date();
    deleteDate.setDate(deleteDate.getDate() + 30);

    await prisma.organization.update({
      where: { id: req.params.orgId },
      data: { scheduledForDeletionAt: deleteDate, planStatus: 'cancelled', isActive: false },
    });

    logger.info('Organization scheduled for deletion', {
      orgId: req.params.orgId,
      by: req.user!.userId,
    });
    res.json({ success: true, message: 'Organisation scheduled for deletion in 30 days' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to schedule deletion' });
  }
});

// ─── Impersonate org admin ────────────────────────────────────────────────────
opsRouter.post('/orgs/:orgId/impersonate', async (req: AuthRequest, res: Response) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.params.orgId } });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organisation not found' });
      return;
    }
    if (org.slug === PLATFORM_SLUG) {
      res.status(403).json({ success: false, error: 'Cannot impersonate platform org' });
      return;
    }

    const payload = {
      userId: req.user!.userId, // Track original ops user
      organizationId: org.id, // Target org
      role: 'ADMIN', // Elevated role for the target org
      branchId: null,
      impersonating: true,
    };

    const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET!;
    const token = jwt.sign(payload, secret, { expiresIn: '2h' });

    logger.info('Ops user impersonating organization', {
      orgId: org.id,
      opsUserId: req.user!.userId,
    });

    res.json({ success: true, data: { token } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to impersonate' });
  }
});

// ─── Recent activity across platform ─────────────────────────────────────────
opsRouter.get('/activity', async (_req, res: Response) => {
  try {
    const [recentOrgs, recentOrders, recentAudit] = await Promise.all([
      prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          planStatus: true,
          selfSignup: true,
          createdAt: true,
        },
      }),
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { organization: { select: { name: true } }, table: { select: { label: true } } },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          organization: { select: { name: true } },
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    res.json({ success: true, data: { recentOrgs, recentOrders, recentAudit } });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch activity' });
  }
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
opsRouter.get('/audit', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50', orgId, action } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: Prisma.AuditLogWhereInput = {};
    if (orgId) where.organizationId = orgId;
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          organization: { select: { name: true, slug: true } },
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
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

// ─── Team Management ─────────────────────────────────────────────────────────

opsRouter.get('/team', async (req: AuthRequest, res: Response) => {
  try {
    const team = await prisma.user.findMany({
      where: { role: 'SUPERADMIN' },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: team });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch team' });
  }
});

opsRouter.post('/team', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(100).trim(),
      email: z.string().email().toLowerCase().trim(),
      password: z
        .string()
        .min(8)
        .regex(
          /^(?=.*[A-Z])(?=.*\d).+$/,
          'Password must contain at least one uppercase letter and one number',
        ),
    });
    const { name, email, password } = schema.parse(req.body);

    // Find the cevop-internal org — all SUPERADMIN accounts live here
    const internalOrg = await prisma.organization.findUnique({
      where: { slug: 'cevop-internal' },
      select: { id: true },
    });
    if (!internalOrg) {
      res.status(500).json({ success: false, error: 'Internal org not found. Run seed first.' });
      return;
    }

    // Check for duplicate email within the internal org
    const existing = await prisma.user.findFirst({
      where: { email, organizationId: internalOrg.id },
    });
    if (existing) {
      res.status(409).json({ success: false, error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        organizationId: internalOrg.id,
        name,
        email,
        passwordHash,
        role: 'SUPERADMIN',
        isActive: true,
        mustChangePassword: true, // Force change on first login
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });

    logger.info('New SUPERADMIN account created', {
      createdBy: req.user!.userId,
      newUserId: user.id,
      email: user.email,
    });

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create team member' });
  }
});

opsRouter.post('/team/change-password', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z
        .string()
        .min(8)
        .regex(
          /^(?=.*[A-Z])(?=.*\d).+$/,
          'Password must contain at least one uppercase letter and one number',
        ),
    });
    const { currentPassword, newPassword } = schema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Current password is incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false, // Clear the force-change flag
      },
    });

    // Revoke all existing refresh tokens — forces re-login on all devices
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    logger.info('SUPERADMIN password changed', { userId: user.id });

    res.json({ success: true, message: 'Password changed. Please log in again.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

opsRouter.patch('/team/:userId', async (req: AuthRequest, res: Response) => {
  try {
    // Prevent self-deactivation
    if (req.params.userId === req.user!.userId) {
      res.status(400).json({ success: false, error: 'You cannot deactivate your own account' });
      return;
    }

    const schema = z.object({
      isActive: z.boolean(),
    });
    const { isActive } = schema.parse(req.body);

    // Ensure target is actually a SUPERADMIN
    const target = await prisma.user.findFirst({
      where: { id: req.params.userId, role: 'SUPERADMIN' },
    });
    if (!target) {
      res.status(404).json({ success: false, error: 'Team member not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.userId },
      data: { isActive },
      select: { id: true, name: true, email: true, isActive: true },
    });

    // If deactivating, revoke all their refresh tokens immediately
    if (!isActive) {
      await prisma.refreshToken.updateMany({
        where: { userId: req.params.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    logger.info(`SUPERADMIN account ${isActive ? 'activated' : 'deactivated'}`, {
      actorId: req.user!.userId,
      targetId: req.params.userId,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update team member' });
  }
});
