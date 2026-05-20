import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { checkStaffLimit } from '../middleware/checkLimits';
import { logger } from '../services/logger';

export const usersRouter = Router();

usersRouter.use(authenticate, requireBranchAccess);

usersRouter.get('/', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const where: Prisma.UserWhereInput = { organizationId: req.user!.organizationId };

    // Branch-scoped users only see staff in their branch
    if (req.branchScope) where.branchId = req.branchScope;

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, createdAt: true, branchId: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: users });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'BRANCH_ADMIN', 'SERVICE', 'WAITER']),
  branchId: z.string().optional(),
});

usersRouter.post('/', requireRole('ADMIN', 'SUPERADMIN'), checkStaffLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role, branchId } = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);

    // BRANCH_ADMIN must have a branchId
    if (role === 'BRANCH_ADMIN' && !branchId) {
      res.status(400).json({ success: false, error: 'BRANCH_ADMIN role requires a branchId' });
      return;
    }

    // Confirm branchId belongs to this org if provided
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, organizationId: req.user!.organizationId },
      });
      if (!branch) {
        res.status(404).json({ success: false, error: 'Branch not found' });
        return;
      }
    }

    const user = await prisma.user.create({
      data: {
        organizationId: req.user!.organizationId,
        branchId: branchId ?? null,
        name,
        email,
        passwordHash,
        role: role as UserRole,
      },
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, createdAt: true, branchId: true,
        branch: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: user });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

usersRouter.patch('/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().optional(),
      role: z.enum(['ADMIN', 'BRANCH_ADMIN', 'SERVICE', 'WAITER']).optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(8).optional(),
      branchId: z.string().nullable().optional(),
    });

    const data = schema.parse(req.body);

    // BRANCH_ADMIN cannot promote anyone to ADMIN or change branchId
    if (req.user!.role === 'BRANCH_ADMIN') {
      if ((data.role as string) === 'ADMIN' || (data.role as string) === 'SUPERADMIN') {
        res.status(403).json({ success: false, error: 'Branch admins cannot assign ADMIN or SUPERADMIN roles' });
        return;
      }
      if ('branchId' in data) {
        res.status(403).json({ success: false, error: 'Branch admins cannot change branch assignments' });
        return;
      }
    }

    // Enforce org ownership
    const targetUser = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!targetUser) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    if (req.user!.role === 'BRANCH_ADMIN' && req.branchScope && targetUser.branchId !== req.branchScope) {
      res.status(403).json({ success: false, error: 'Access denied' }); return;
    }

    const { password, ...rest } = data;
    const updateData: Prisma.UserUpdateInput = { ...rest };
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, branchId: true,
        branch: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: user });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

usersRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const targetUser = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!targetUser) { res.status(404).json({ success: false, error: 'User not found' }); return; }
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'User deactivated' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to deactivate user' });
  }
});
