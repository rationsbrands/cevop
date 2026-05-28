import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import { notificationQueue } from '../services/queue';

export const invitesRouter = Router();

invitesRouter.use(authenticate);

const INVITE_TTL_HOURS = 72;

// POST /invites — send an invite to join a branch
invitesRouter.post(
  '/',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        email: z.string().email().toLowerCase(),
        role: z.enum([
          'ORG_MANAGER',
          'ORG_FINANCE',
          'ORG_AUDITOR',
          'BRANCH_ADMIN',
          'BRANCH_FINANCE',
          'SERVICE',
          'WAITER',
          'KITCHEN',
        ]),
        branchId: z.string().optional(),
      });
      const { email, role, branchId } = schema.parse(req.body);

      const isOrgWideRole =
        role === 'ORG_MANAGER' || role === 'ORG_FINANCE' || role === 'ORG_AUDITOR';
      const isBranchRole =
        role === 'BRANCH_ADMIN' ||
        role === 'BRANCH_FINANCE' ||
        role === 'SERVICE' ||
        role === 'WAITER' ||
        role === 'KITCHEN';

      // Determine effective branchId for the invite
      let effectiveBranchId: string | null = null;

      if (req.user!.branchId) {
        // Branch-scoped inviter (BRANCH_ADMIN): can only invite branch-scoped roles into their own branch
        if (isOrgWideRole) {
          res
            .status(403)
            .json({ success: false, error: 'Branch admins cannot invite org-wide roles' });
          return;
        }
        effectiveBranchId = req.user!.branchId;
      } else {
        // Org-wide inviter
        if (isOrgWideRole) {
          if (branchId) {
            res
              .status(400)
              .json({ success: false, error: 'Org-wide roles cannot be assigned to a branch' });
            return;
          }
          effectiveBranchId = null;
        } else if (isBranchRole) {
          if (branchId) {
            const branch = await prisma.branch.findFirst({
              where: { id: branchId, organizationId: req.user!.organizationId },
              select: { id: true },
            });
            if (!branch) {
              res.status(404).json({ success: false, error: 'Branch not found' });
              return;
            }
            effectiveBranchId = branch.id;
          } else {
            const branches = await prisma.branch.findMany({
              where: { organizationId: req.user!.organizationId, isActive: true },
              select: { id: true },
            });
            if (branches.length === 1) {
              effectiveBranchId = branches[0].id;
            } else {
              res
                .status(400)
                .json({ success: false, error: 'This role requires a branch assignment' });
              return;
            }
          }
        }
      }

      // Check: user already exists in this org
      const existing = await prisma.user.findUnique({
        where: { email_organizationId: { email, organizationId: req.user!.organizationId } },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          error: 'A user with this email already exists in this organisation',
        });
        return;
      }

      const existingOtherOrg = await prisma.user.findFirst({
        where: { email, isActive: true, NOT: { organizationId: req.user!.organizationId } },
        select: { id: true },
      });
      if (existingOtherOrg) {
        res.status(409).json({
          success: false,
          error: 'This email is already used in another organisation. Use a different email.',
        });
        return;
      }

      // Revoke any previous unused invites for same email+org
      await prisma.inviteToken.updateMany({
        where: { email, organizationId: req.user!.organizationId, usedAt: null },
        data: { usedAt: new Date() }, // Mark as used/revoked so it cannot be accepted.
      });

      const token = crypto.randomBytes(48).toString('hex');
      const invite = await prisma.inviteToken.create({
        data: {
          organizationId: req.user!.organizationId,
          branchId: effectiveBranchId,
          email,
          role: role as any,
          token,
          expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
          createdBy: req.user!.userId,
        },
        include: { organization: true, branch: true },
      });

      const inviteUrl = `${process.env.ADMIN_DASHBOARD_URL || 'http://localhost:5175'}/accept-invite/${token}`;

      // Try to send email via background queue
      try {
        const inviter = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { name: true },
        });

        notificationQueue.add('EMAIL_INVITE', {
          type: 'EMAIL_INVITE',
          data: {
            email,
            inviteUrl,
            organizationName: invite.organization.name,
            branchName: invite.branch?.name ?? null,
            role,
            inviterName: inviter?.name ?? 'A team member',
          },
        });
        logger.info('Invite email queued', { email, role, orgId: req.user!.organizationId });
      } catch (err) {
        logger.warn('Failed to queue invite email', { email, err });
      }

      res.status(201).json({
        success: true,
        data: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          branchName: invite.branch?.name ?? null,
          expiresAt: invite.expiresAt,
          inviteUrl, // Return so admin can copy/send manually if email isn't configured
        },
      });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create invite' });
    }
  },
);

// GET /invites — list pending invites for this org
invitesRouter.get(
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
      const where: Prisma.InviteTokenWhereInput = {
        organizationId: req.user!.organizationId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      };
      if (req.user!.branchId) where.branchId = req.user!.branchId;

      const invites = await prisma.inviteToken.findMany({
        where,
        include: { branch: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        data: invites.map(
          (i: {
            id: string;
            email: string;
            role: string;
            branch: { name: string } | null;
            expiresAt: Date;
            createdAt: Date;
          }) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            branchName: i.branch?.name ?? null,
            expiresAt: i.expiresAt,
            createdAt: i.createdAt,
          }),
        ),
      });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to fetch invites' });
    }
  },
);

// DELETE /invites/:id — revoke an invite
invitesRouter.delete(
  '/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      await prisma.inviteToken.updateMany({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
        data: { usedAt: new Date() },
      });
      res.json({ success: true, message: 'Invite revoked' });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to revoke invite' });
    }
  },
);
