import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';

export const helpOptionsRouter = Router();

const helpOptionSchema = z.object({
  type: z.enum(['WAITER', 'SERVICE', 'BILL']),
  label: z.string().min(1).max(100),
  icon: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

// GET /public — list help options for Customer PWA
helpOptionsRouter.get('/public', async (req: Request, res: Response) => {
  try {
    const { organizationId, branchId } = req.query;
    const orgId = organizationId as string;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization ID is required' });
    }

    const branches = await prisma.branch.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true },
      take: 2,
      orderBy: { createdAt: 'asc' },
    });

    const effectiveBranchId =
      typeof branchId === 'string' ? branchId : branches.length === 1 ? branches[0].id : null;

    if (!effectiveBranchId) {
      return res.status(400).json({ success: false, error: 'branchId is required' });
    }

    const options = await prisma.helpOption.findMany({
      where: {
        organizationId: orgId,
        branchId: effectiveBranchId,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ success: true, data: options });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch help options' });
  }
});

// Admin routes below
helpOptionsRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

// GET / — list help options (Admin)
helpOptionsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const branchId = req.branchScope!;
    const options = await prisma.helpOption.findMany({
      where: {
        organizationId: user.organizationId,
        branchId,
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: options });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch help options' });
  }
});

// POST / — create help option (ADMIN/SUPERADMIN/BRANCH_ADMIN)
helpOptionsRouter.post(
  '/',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = helpOptionSchema.parse(req.body);
      const user = req.user!;

      const branchId = req.branchScope!;

      const option = await prisma.helpOption.create({
        data: {
          ...data,
          branchId,
          organizationId: user.organizationId,
        },
      });
      res.status(201).json({ success: true, data: option });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create help option' });
    }
  },
);

// PATCH /:id — update help option
helpOptionsRouter.patch(
  '/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const data = helpOptionSchema.partial().parse(req.body);
      const user = req.user!;
      const branchId = req.branchScope!;

      const existing = await prisma.helpOption.findFirst({
        where: { id, organizationId: user.organizationId, branchId },
      });

      if (!existing) {
        res.status(404).json({ success: false, error: 'Help option not found' });
        return;
      }

      const updated = await prisma.helpOption.update({
        where: { id },
        data: { ...data, branchId },
      });

      res.json({ success: true, data: updated });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update help option' });
    }
  },
);

// DELETE /:id — delete help option
helpOptionsRouter.delete(
  '/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      const branchId = req.branchScope!;

      const existing = await prisma.helpOption.findFirst({
        where: { id, organizationId: user.organizationId, branchId },
      });

      if (!existing) {
        res.status(404).json({ success: false, error: 'Help option not found' });
        return;
      }

      await prisma.helpOption.delete({ where: { id } });

      res.json({ success: true, message: 'Help option deleted' });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to delete help option' });
    }
  },
);
