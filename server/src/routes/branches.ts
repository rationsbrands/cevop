import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { checkBranchLimit, checkStaffLimit } from '../middleware/checkLimits';

export const branchesRouter = Router();

branchesRouter.use(authenticate, requireBranchAccess);

const branchSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  address: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});

// GET / — list all branches for org (org-wide admin)
branchesRouter.get(
  '/',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const branches = await prisma.branch.findMany({
        where: {
          organizationId: req.user!.organizationId,
          ...(req.branchScope ? { id: req.branchScope } : {}),
        },
        orderBy: { createdAt: 'asc' },
        include: {
          _count: {
            select: { users: true, tables: true },
          },
        },
      });
      res.json({ success: true, data: branches });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to fetch branches' });
    }
  },
);

// POST / — create a branch (org-wide admin)
branchesRouter.post(
  '/',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'),
  checkBranchLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = branchSchema.parse(req.body);

      // Check slug uniqueness within org
      const existing = await prisma.branch.findFirst({
        where: { organizationId: req.user!.organizationId, slug: data.slug },
      });
      if (existing) {
        res.status(409).json({ success: false, error: 'A branch with this slug already exists' });
        return;
      }

      const branch = await prisma.branch.create({
        data: {
          ...data,
          organizationId: req.user!.organizationId,
        },
      });
      res.status(201).json({ success: true, data: branch });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create branch' });
    }
  },
);

// GET /:branchId — get a branch (ADMIN/SUPERADMIN or the BRANCH_ADMIN of that branch)
branchesRouter.get('/:branchId', async (req: AuthRequest, res: Response) => {
  try {
    const { branchId } = req.params;
    const user = req.user!;

    // BRANCH_ADMIN can only see their own branch
    if (
      (user.role === 'BRANCH_ADMIN' || user.role === 'BRANCH_FINANCE') &&
      user.branchId !== branchId
    ) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // WAITER/SERVICE cannot access branch management
    if (
      ![
        'SUPERADMIN',
        'ORG_OWNER',
        'ADMIN',
        'ORG_MANAGER',
        'ORG_FINANCE',
        'ORG_AUDITOR',
        'BRANCH_ADMIN',
        'BRANCH_FINANCE',
      ].includes(user.role)
    ) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId: user.organizationId },
      include: {
        _count: { select: { users: true, tables: true, orders: true } },
      },
    });

    if (!branch) {
      res.status(404).json({ success: false, error: 'Branch not found' });
      return;
    }

    res.json({ success: true, data: branch });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch branch' });
  }
});

// PUT /:branchId — update a branch
branchesRouter.put('/:branchId', async (req: AuthRequest, res: Response) => {
  try {
    const { branchId } = req.params;
    const user = req.user!;

    // BRANCH_ADMIN can only update their own branch (and cannot change slug/isActive)
    if (user.role === 'BRANCH_ADMIN') {
      if (user.branchId !== branchId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      // Branch admin can only update name, address, phone
      const safeSchema = z.object({
        name: z.string().min(1).max(200).optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
      });
      const data = safeSchema.parse(req.body);
      const existing = await prisma.branch.findFirst({
        where: { id: branchId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Branch not found' });
        return;
      }
      const branch = await prisma.branch.update({ where: { id: branchId }, data });
      res.json({ success: true, data: branch });
      return;
    }

    if (!['SUPERADMIN', 'ORG_OWNER', 'ADMIN', 'ORG_MANAGER'].includes(user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    const data = branchSchema.partial().parse(req.body);

    // If slug is changing, check uniqueness
    if (data.slug) {
      const existing = await prisma.branch.findFirst({
        where: { organizationId: user.organizationId, slug: data.slug, NOT: { id: branchId } },
      });
      if (existing) {
        res.status(409).json({ success: false, error: 'A branch with this slug already exists' });
        return;
      }
    }

    const exists = await prisma.branch.findFirst({
      where: { id: branchId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!exists) {
      res.status(404).json({ success: false, error: 'Branch not found' });
      return;
    }

    const branch = await prisma.branch.update({
      where: { id: branchId },
      data,
    });
    res.json({ success: true, data: branch });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update branch' });
  }
});

// DELETE /:branchId — deactivate a branch (org-wide admin only)
branchesRouter.delete(
  '/:branchId',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const result = await prisma.branch.updateMany({
        where: { id: branchId, organizationId: req.user!.organizationId },
        data: { isActive: false },
      });
      if (result.count === 0) {
        res.status(404).json({ success: false, error: 'Branch not found' });
        return;
      }
      res.json({ success: true, message: 'Branch deactivated' });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to deactivate branch' });
    }
  },
);

// POST /:branchId/admin — create a BRANCH_ADMIN user for a branch (org-wide admin only)
branchesRouter.post(
  '/:branchId/admin',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'),
  checkStaffLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const schema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8),
      });
      const { name, email, password } = schema.parse(req.body);

      // Confirm branch belongs to org
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, organizationId: req.user!.organizationId },
      });
      if (!branch) {
        res.status(404).json({ success: false, error: 'Branch not found' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
          organizationId: req.user!.organizationId,
          branchId,
          name,
          email,
          passwordHash,
          role: 'BRANCH_ADMIN',
        },
        select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true },
      });

      res.status(201).json({ success: true, data: user });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create branch admin' });
    }
  },
);
