import { Router, Response, Request } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { AuthPayload } from '../../../shared/types';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

export const helpOptionsRouter = Router();

const helpOptionSchema = z.object({
  type: z.enum(['WAITER', 'SERVICE']),
  label: z.string().min(1).max(100),
  icon: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  branchId: z.string().optional().nullable(),
});

// GET / — list help options
// Public access for PWA (with organizationId) OR authenticated for Admin
helpOptionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { organizationId, branchId } = req.query;
    let orgId = organizationId as string;

    // If no orgId in query, try to get from JWT (Admin portal)
    if (!orgId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const token = authHeader.slice(7);
          const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
          orgId = decoded.organizationId;
        } catch (err: unknown) {
          // Token invalid, continue — will fail on !orgId check below
        }
      }
    }

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization ID is required' });
    }

    console.log('Fetching help options for org:', orgId, 'branch:', branchId);

    const options = await prisma.helpOption.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { branchId: branchId ? (branchId as string) : null },
          { branchId: null },
        ],
      },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ success: true, data: options });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch help options' });
  }
});

// Admin routes below
helpOptionsRouter.use(authenticate);

// POST / — create help option (ADMIN/SUPERADMIN/BRANCH_ADMIN)
helpOptionsRouter.post('/', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = helpOptionSchema.parse(req.body);
    const user = req.user!;

    // BRANCH_ADMIN can only create for their own branch
    if (user.role === 'BRANCH_ADMIN' && data.branchId !== user.branchId) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    const option = await prisma.helpOption.create({
      data: {
        ...data,
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
});

// PATCH /:id — update help option
helpOptionsRouter.patch('/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = helpOptionSchema.partial().parse(req.body);
    const user = req.user!;

    const existing = await prisma.helpOption.findFirst({
      where: { id, organizationId: user.organizationId },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Help option not found' });
      return;
    }

    if (user.role === 'BRANCH_ADMIN' && existing.branchId !== user.branchId) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    const updated = await prisma.helpOption.update({
      where: { id },
      data,
    });

    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update help option' });
  }
});

// DELETE /:id — delete help option
helpOptionsRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const existing = await prisma.helpOption.findFirst({
      where: { id, organizationId: user.organizationId },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Help option not found' });
      return;
    }

    if (user.role === 'BRANCH_ADMIN' && existing.branchId !== user.branchId) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    await prisma.helpOption.delete({ where: { id } });

    res.json({ success: true, message: 'Help option deleted' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to delete help option' });
  }
});
