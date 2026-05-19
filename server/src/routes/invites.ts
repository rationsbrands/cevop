import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { UserRole, Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import { sendInvite } from '../services/email';

export const invitesRouter = Router();

invitesRouter.use(authenticate);

const INVITE_TTL_HOURS = 72;

// POST /invites — send an invite to join a branch
invitesRouter.post('/', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      email: z.string().email().toLowerCase(),
      role: z.enum(['BRANCH_ADMIN', 'SERVICE', 'WAITER']),
      branchId: z.string().optional(),
    });
    const { email, role, branchId } = schema.parse(req.body);

    // Determine effective branchId
    let effectiveBranchId: string | null = null;

    if (req.user!.branchId) {
      // Branch admin can only invite to their own branch
      effectiveBranchId = req.user!.branchId;
    } else if (branchId) {
      // Org admin specifying a branch
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, organizationId: req.user!.organizationId },
      });
      if (!branch) { res.status(404).json({ success: false, error: 'Branch not found' }); return; }
      effectiveBranchId = branchId;
    }

    // BRANCH_ADMIN role must have a branchId
    if (role === 'BRANCH_ADMIN' && !effectiveBranchId) {
      res.status(400).json({ success: false, error: 'Branch Admin invites must specify a branch' });
      return;
    }

    // Branch admin cannot invite another BRANCH_ADMIN
    if (req.user!.role === 'BRANCH_ADMIN' && role === 'BRANCH_ADMIN') {
      res.status(403).json({ success: false, error: 'Branch admins cannot invite other branch admins' });
      return;
    }

    // Check: user already exists in this org
    const existing = await prisma.user.findUnique({
      where: { email_organizationId: { email, organizationId: req.user!.organizationId } },
    });
    if (existing) {
      res.status(409).json({ success: false, error: 'A user with this email already exists in this organisation' });
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
        role: role as UserRole,
        token,
        expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
        createdBy: req.user!.userId,
      },
      include: { organization: true, branch: true },
    });

    const inviteUrl = `${process.env.ADMIN_DASHBOARD_URL || 'http://localhost:5175'}/accept-invite/${token}`;
    
    // Try to send email — if it fails, the inviteUrl is still returned in the response
    // so the admin can copy and send it manually
    try {
      // Get inviting user's name for the email
      const inviter = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { name: true },
      });
      await sendInvite(
        email,
        inviteUrl,
        invite.organization.name,
        invite.branch?.name ?? null,
        role,
        inviter?.name ?? 'A team member'
      );
      logger.info('Invite email sent', { email, role, orgId: req.user!.organizationId });
    } catch {
      logger.warn('Invite email failed — invite still created, URL returned in response', {
        email,
        inviteUrl,
      });
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: 'Validation error', details: err.errors }); return; }
    res.status(500).json({ success: false, error: 'Failed to create invite' });
  }
});

// GET /invites — list pending invites for this org
invitesRouter.get('/', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
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

    res.json({ success: true, data: invites.map((i: { id: string; email: string; role: string; branch: { name: string } | null; expiresAt: Date; createdAt: Date }) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      branchName: i.branch?.name ?? null,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    })) });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch invites' });
  }
});

// DELETE /invites/:id — revoke an invite
invitesRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.inviteToken.updateMany({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      data: { usedAt: new Date() },
    });
    res.json({ success: true, message: 'Invite revoked' });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to revoke invite' });
  }
});
