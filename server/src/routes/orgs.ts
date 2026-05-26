import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';

export const orgsRouter = Router();

orgsRouter.use(authenticate);

// Superadmin: list all orgs
orgsRouter.get('/', requireRole('SUPERADMIN'), async (_req: Request, res: Response) => {
  try {
    const orgs = await prisma.organization.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: orgs });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
  }
});

// Get own org
orgsRouter.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        timezone: true,
        currency: true,
        isActive: true,
        plan: true,
        planStatus: true,
        trialEndsAt: true,
        contactPhone: true,
        contactEmail: true,
        whatsappNumber: true,
        slackWebhook: true,
        notifyNewOrders: true,
        notifyWaiterCalls: true,
        notifyServiceRequests: true,
        createdAt: true,
      } as any,
    });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }
    res.json({ success: true, data: org });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch organization' });
  }
});

const orgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only letters, numbers, and hyphens'),
  logo: z.union([z.string().trim().url(), z.literal('')]).optional(),
  whatsappNumber: z.union([z.string().trim(), z.literal('')]).optional(),
  slackWebhook: z.union([z.string().trim().url(), z.literal('')]).optional(),
  notifyNewOrders: z.boolean().optional(),
  notifyWaiterCalls: z.boolean().optional(),
  notifyServiceRequests: z.boolean().optional(),
});

// Superadmin: create org
orgsRouter.post('/', requireRole('SUPERADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = orgSchema.parse(req.body);
    const org = await prisma.organization.create({ data });
    res.status(201).json({ success: true, data: org });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create organization' });
  }
});

// Update own org settings
orgsRouter.put(
  '/me',
  requireRole('ORG_OWNER', 'ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = orgSchema.partial().parse(req.body);
      // Convert empty strings to null for optional db fields, if necessary, or just save empty strings.
      // Prisma usually accepts empty strings, but for URLs it's better to store empty string if not null.
      const updated = await prisma.organization.update({
        where: { id: req.user!.organizationId },
        data,
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          organizationId: updated.id,
          userId: req.user!.userId,
          action: 'ORG_SETTINGS_UPDATED',
          entity: 'organization',
          entityId: updated.id,
          metadata: data as any,
        },
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.warn('Validation error in PUT /orgs/me', { errors: err.errors });
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update organization' });
    }
  },
);

// Org audit logs (org-scoped)
orgsRouter.get(
  '/audit',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'ORG_AUDITOR', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().trim().min(1).max(100).optional(),
        entity: z.string().trim().min(1).max(100).optional(),
        userId: z.string().trim().min(1).optional(),
        entityId: z.string().trim().min(1).optional(),
      });
      const { page, limit, action, entity, userId, entityId } = schema.parse(req.query);
      const skip = (page - 1) * limit;

      const where: Prisma.AuditLogWhereInput = { organizationId: req.user!.organizationId };
      if (action) where.action = action;
      if (entity) where.entity = entity;
      if (userId) where.userId = userId;
      if (entityId) where.entityId = entityId;

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        success: true,
        data: logs,
        meta: { total, page, limit, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
    }
  },
);

// Superadmin: create initial admin for a new org
orgsRouter.post(
  '/:orgId/admin',
  requireRole('SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        name: z.string(),
        email: z.string().email(),
        password: z.string().min(8),
      });
      const { name, email, password } = schema.parse(req.body);

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
          organizationId: req.params.orgId,
          name,
          email,
          passwordHash,
          role: 'ORG_OWNER' as any,
        },
      });

      res.status(201).json({
        success: true,
        data: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create admin' });
    }
  },
);

// POST /api/orgs/me/change-password — change password while staying logged in
orgsRouter.post(
  '/me/change-password',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
    'SERVICE',
    'WAITER',
    'SUPERADMIN',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        currentPassword: z.string().min(1, 'Current password is required'),
        newPassword: z
          .string()
          .min(8, 'Password must be at least 8 characters')
          .regex(
            /^(?=.*[A-Z])(?=.*\d).+$/,
            'Password must contain at least one uppercase letter and one number',
          ),
      });

      const { currentPassword, newPassword } = schema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { id: true, passwordHash: true, organizationId: true, role: true, branchId: true },
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
        data: { passwordHash: newHash },
      });

      // Preserve current session — revoke all others (by rotating refresh token)
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      const rawRefresh = crypto.randomBytes(48).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(rawRefresh).digest('hex');
      const ttlMs = 18 * 60 * 60 * 1000;
      const refreshExpiry = new Date(Date.now() + ttlMs);

      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refreshHash,
          expiresAt: refreshExpiry,
          ipAddress:
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
            req.socket?.remoteAddress,
          userAgent: req.headers['user-agent']?.slice(0, 500),
        },
      });

      res.cookie('cevop_refresh', rawRefresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
        path: '/api/auth',
        maxAge: ttlMs,
      });

      // Issue a fresh access token for the current session
      const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET!;
      const org = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { plan: true },
      });

      const freshAccessToken = jwt.sign(
        {
          userId: user.id,
          organizationId: user.organizationId,
          role: user.role,
          branchId: user.branchId ?? undefined,
          plan: org?.plan ?? 'free',
        },
        secret,
        { expiresIn: '15m' },
      );

      logger.info('User password changed — other sessions revoked', { userId: user.id });

      res.json({
        success: true,
        message: 'Password changed. All other devices have been signed out.',
        data: { accessToken: freshAccessToken },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      logger.error('POST /orgs/me/change-password error', { err });
      res.status(500).json({ success: false, error: 'Failed to change password' });
    }
  },
);

// Delete own org (Danger Zone)
orgsRouter.delete(
  '/me',
  requireRole('ORG_OWNER', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;

      // Check if org exists
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        res.status(404).json({ success: false, error: 'Organization not found' });
        return;
      }

      // Delete the organization. Prisma handles cascading deletes for users, branches, orders, etc.
      await prisma.organization.delete({
        where: { id: orgId },
      });

      logger.info(`Organization deleted: ${orgId}`);
      res.json({ success: true, message: 'Organization successfully deleted' });
    } catch (err) {
      logger.error('Failed to delete organization', { err });
      res.status(500).json({ success: false, error: 'Failed to delete organization' });
    }
  },
);
