import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { checkStaffLimit } from '../middleware/checkLimits';
import { logger } from '../services/logger';

async function generateStaffCode(branchId: string, role: string): Promise<string> {
  // Prefix based on role
  const prefix =
    role === 'WAITER'
      ? 'W'
      : role === 'SERVICE'
        ? 'S'
        : role === 'KITCHEN'
          ? 'K'
          : role === 'BRANCH_ADMIN'
            ? 'M'
            : role === 'HOST'
              ? 'H'
              : role === 'CASHIER'
                ? 'C'
                : 'T'; // T for team/other

  // Find the highest existing code number for this branch + prefix
  const existing = await (prisma.user as any).findMany({
    where: {
      branchId,
      staffCode: { startsWith: `${prefix}-` },
    },
    select: { staffCode: true },
  });

  const nums = existing
    .map((u: any) => parseInt(u.staffCode?.split('-')[1] ?? '0', 10))
    .filter((n: number) => !isNaN(n));

  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}-${String(next).padStart(2, '0')}`;
}

export const usersRouter = Router();

usersRouter.use(authenticate, requireBranchAccess);

function generateSecureToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

usersRouter.get(
  '/',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'ORG_FINANCE',
    'ORG_AUDITOR',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const where: Prisma.UserWhereInput = { organizationId: req.user!.organizationId };

      // Branch-scoped users only see staff in their branch
      if (req.branchScope) where.branchId = req.branchScope;
      if (req.user!.role === 'BRANCH_ADMIN') {
        if (!req.branchScope) {
          res
            .status(403)
            .json({ success: false, error: 'Branch admins must be assigned to a branch' });
          return;
        }
        where.role = {
          notIn: [
            'ORG_OWNER',
            'ADMIN',
            'ORG_MANAGER',
            'ORG_FINANCE',
            'ORG_AUDITOR',
            'SUPERADMIN',
          ] as any,
        };
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          branchId: true,
          staffCode: true,
          branch: { select: { id: true, name: true } },
        } as any,
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: users });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
  },
);

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
    'SERVICE',
    'WAITER',
    'KITCHEN',
    'HOST',
    'CASHIER',
    'SUPERADMIN',
  ]),
  branchId: z.string().optional(),
});

usersRouter.post(
  '/',
  requireRole('ADMIN', 'ORG_OWNER', 'ORG_MANAGER', 'SUPERADMIN'),
  checkStaffLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, email, password, role, branchId } = createUserSchema.parse(req.body);
      const passwordHash = await bcrypt.hash(password, 12);

      const existingAnyOrg = await prisma.user.findFirst({
        where: { email, isActive: true, NOT: { organizationId: req.user!.organizationId } },
        select: { id: true },
      });
      if (existingAnyOrg) {
        res.status(409).json({
          success: false,
          error: 'This email is already used in another organisation. Use a different email.',
        });
        return;
      }

      if (
        role === 'ORG_OWNER' &&
        req.user!.role !== 'SUPERADMIN' &&
        req.user!.role !== 'ORG_OWNER'
      ) {
        res
          .status(403)
          .json({ success: false, error: 'Only org owners can create other org owners' });
        return;
      }

      if (req.user!.role === 'ORG_MANAGER' && (role === 'ADMIN' || role === 'SUPERADMIN')) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      // BRANCH_ADMIN must have a branchId
      if (role === 'BRANCH_ADMIN' && !branchId) {
        res.status(400).json({ success: false, error: 'BRANCH_ADMIN role requires a branchId' });
        return;
      }
      if (role === 'BRANCH_FINANCE' && !branchId) {
        res.status(400).json({ success: false, error: 'BRANCH_FINANCE role requires a branchId' });
        return;
      }

      let finalBranchId: string | null = branchId ?? null;
      if (
        role === 'ORG_OWNER' ||
        role === 'ADMIN' ||
        role === 'ORG_MANAGER' ||
        role === 'ORG_FINANCE' ||
        role === 'ORG_AUDITOR'
      ) {
        finalBranchId = null;
      }
      if (role === 'BRANCH_ADMIN' && !finalBranchId) {
        const branches = await prisma.branch.findMany({
          where: { organizationId: req.user!.organizationId, isActive: true },
          select: { id: true },
        });
        if (branches.length === 1) {
          finalBranchId = branches[0].id;
        } else {
          res.status(400).json({ success: false, error: 'BRANCH_ADMIN role requires a branch' });
          return;
        }
      }
      if (
        (role === 'WAITER' ||
          role === 'SERVICE' ||
          role === 'KITCHEN' ||
          role === 'HOST' ||
          role === 'CASHIER') &&
        !finalBranchId
      ) {
        const branches = await prisma.branch.findMany({
          where: { organizationId: req.user!.organizationId, isActive: true },
          select: { id: true },
        });
        if (branches.length === 1) {
          finalBranchId = branches[0].id;
        } else {
          res.status(400).json({
            success: false,
            error: `${role} role requires a branch when your organisation has multiple branches`,
          });
          return;
        }
      }
      if (role === 'BRANCH_FINANCE' && !finalBranchId) {
        const branches = await prisma.branch.findMany({
          where: { organizationId: req.user!.organizationId, isActive: true },
          select: { id: true },
        });
        if (branches.length === 1) {
          finalBranchId = branches[0].id;
        } else {
          res.status(400).json({
            success: false,
            error:
              'BRANCH_FINANCE role requires a branch when your organisation has multiple branches',
          });
          return;
        }
      }

      // Confirm branchId belongs to this org if provided
      if (finalBranchId) {
        const branch = await prisma.branch.findFirst({
          where: { id: finalBranchId, organizationId: req.user!.organizationId },
        });
        if (!branch) {
          res.status(404).json({ success: false, error: 'Branch not found' });
          return;
        }
      }

      // Auto-generate staffCode for branch-scoped staff roles
      let staffCode: string | undefined;
      if (
        finalBranchId &&
        ['SERVICE', 'WAITER', 'KITCHEN', 'BRANCH_ADMIN', 'HOST', 'CASHIER'].includes(role)
      ) {
        staffCode = await generateStaffCode(finalBranchId, role).catch(() => undefined);
      }

      const user = await prisma.user.create({
        data: {
          organizationId: req.user!.organizationId,
          branchId: finalBranchId,
          name,
          email,
          passwordHash,
          role: role as any,
          staffCode,
          emailVerified: new Date(),
          emailVerificationToken: null,
        } as any,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          branchId: true,
          staffCode: true,
          branch: { select: { id: true, name: true } },
        } as any,
      });

      res.status(201).json({ success: true, data: user });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create user' });
    }
  },
);

usersRouter.patch(
  '/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        name: z.string().optional(),
        role: z
          .enum([
            'ORG_OWNER',
            'ADMIN',
            'ORG_MANAGER',
            'ORG_FINANCE',
            'ORG_AUDITOR',
            'BRANCH_ADMIN',
            'BRANCH_FINANCE',
            'SERVICE',
            'WAITER',
            'KITCHEN',
            'HOST',
            'CASHIER',
          ])
          .optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(8).optional(),
        branchId: z.string().nullable().optional(),
      });

      const data = schema.parse(req.body);

      // BRANCH_ADMIN cannot promote anyone to ADMIN or change branchId
      if (req.user!.role === 'BRANCH_ADMIN') {
        if (
          data.role &&
          [
            'ORG_OWNER',
            'ADMIN',
            'ORG_MANAGER',
            'ORG_FINANCE',
            'ORG_AUDITOR',
            'SUPERADMIN',
          ].includes(data.role)
        ) {
          res
            .status(403)
            .json({ success: false, error: 'Branch admins cannot assign org-wide roles' });
          return;
        }
        if ('branchId' in data) {
          res
            .status(403)
            .json({ success: false, error: 'Branch admins cannot change branch assignments' });
          return;
        }
      }

      // Enforce org ownership
      const targetUser = await prisma.user.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!targetUser) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (
        req.user!.role === 'ORG_MANAGER' &&
        ['ORG_OWNER', 'ADMIN', 'SUPERADMIN'].includes(targetUser.role)
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      if (
        req.user!.role === 'BRANCH_ADMIN' &&
        req.branchScope &&
        targetUser.branchId !== req.branchScope
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      if (
        (data.role as string) === 'ORG_OWNER' &&
        req.user!.role !== 'SUPERADMIN' &&
        req.user!.role !== 'ORG_OWNER'
      ) {
        res
          .status(403)
          .json({ success: false, error: 'Only org owners can assign ORG_OWNER role' });
        return;
      }

      if (
        req.user!.role === 'ORG_MANAGER' &&
        data.role &&
        ['ORG_OWNER', 'ADMIN', 'SUPERADMIN'].includes(data.role)
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const { password, ...rest } = data;
      const updateData: any = { ...rest };
      if (password) {
        updateData.passwordHash = await bcrypt.hash(password, 12);
      }

      const nextRole = (data.role as string | undefined) ?? targetUser.role;
      const nextBranchId =
        'branchId' in data ? (data.branchId as string | null | undefined) : targetUser.branchId;
      if (
        nextRole === 'ORG_OWNER' ||
        nextRole === 'ADMIN' ||
        nextRole === 'ORG_MANAGER' ||
        nextRole === 'ORG_FINANCE' ||
        nextRole === 'ORG_AUDITOR'
      ) {
        updateData.branchId = null;
      }
      if (
        (nextRole === 'WAITER' ||
          nextRole === 'SERVICE' ||
          nextRole === 'KITCHEN' ||
          nextRole === 'HOST' ||
          nextRole === 'CASHIER') &&
        !nextBranchId
      ) {
        const branches = await prisma.branch.findMany({
          where: { organizationId: req.user!.organizationId, isActive: true },
          select: { id: true },
        });
        if (branches.length === 1) {
          updateData.branchId = branches[0].id;
        } else {
          res.status(400).json({
            success: false,
            error: `${nextRole} role requires a branch when your organisation has multiple branches`,
          });
          return;
        }
      }
      if (nextRole === 'BRANCH_FINANCE' && !nextBranchId) {
        const branches = await prisma.branch.findMany({
          where: { organizationId: req.user!.organizationId, isActive: true },
          select: { id: true },
        });
        if (branches.length === 1) {
          updateData.branchId = branches[0].id;
        } else {
          res.status(400).json({
            success: false,
            error:
              'BRANCH_FINANCE role requires a branch when your organisation has multiple branches',
          });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id: req.params.id },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          branchId: true,
          staffCode: true,
          branch: { select: { id: true, name: true } },
        } as any,
      });

      res.json({ success: true, data: user });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update user' });
    }
  },
);

usersRouter.post(
  '/:id/password-reset',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetUser = await prisma.user.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
        include: { organization: { select: { name: true } } },
      });
      if (!targetUser) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      if (
        req.user!.role === 'ORG_MANAGER' &&
        ['ORG_OWNER', 'ADMIN', 'SUPERADMIN'].includes(targetUser.role)
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      if (targetUser.id === req.user!.userId) {
        res.status(400).json({ success: false, error: 'You cannot reset your own password here' });
        return;
      }
      if (targetUser.role === 'SUPERADMIN' && req.user!.role !== 'SUPERADMIN') {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      if (req.user!.role === 'BRANCH_ADMIN') {
        if (req.branchScope && targetUser.branchId !== req.branchScope) {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
        if (targetUser.role === 'ADMIN' || targetUser.role === 'SUPERADMIN') {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
      }

      const token = generateSecureToken();
      const expiry = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.user.update({
        where: { id: targetUser.id },
        data: {
          passwordResetToken: token,
          passwordResetExpiry: expiry,
          emailVerified: targetUser.emailVerified ?? new Date(),
          emailVerificationToken: null,
        },
      });

      const resetUrl = `${process.env.ADMIN_DASHBOARD_URL || 'http://localhost:5175'}/reset-password/${token}`;
      res.json({
        success: true,
        data: {
          userId: targetUser.id,
          email: targetUser.email,
          resetUrl,
          expiresAt: expiry,
        },
      });
    } catch (err: unknown) {
      logger.error('Failed to generate password reset link', { err });
      res.status(500).json({ success: false, error: 'Failed to generate reset link' });
    }
  },
);

usersRouter.delete(
  '/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetUser = await prisma.user.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!targetUser) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      if (
        req.user!.role === 'ORG_MANAGER' &&
        ['ORG_OWNER', 'ADMIN', 'SUPERADMIN'].includes(targetUser.role)
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      if (targetUser.id === req.user!.userId) {
        res.status(400).json({ success: false, error: 'You cannot delete your own account' });
        return;
      }
      if (targetUser.role === 'SUPERADMIN' && req.user!.role !== 'SUPERADMIN') {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      if (req.user!.role === 'BRANCH_ADMIN') {
        if (req.branchScope && targetUser.branchId !== req.branchScope) {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
        if (targetUser.role === 'ADMIN' || targetUser.role === 'SUPERADMIN') {
          res.status(403).json({ success: false, error: 'Access denied' });
          return;
        }
      }

      await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
      await prisma.refreshToken.updateMany({
        where: { userId: req.params.id },
        data: { revokedAt: new Date() },
      });
      res.json({ success: true, message: 'User deactivated' });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to deactivate user' });
    }
  },
);
