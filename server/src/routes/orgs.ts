import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
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
  } catch (err) {
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
        createdAt: true,
      },
    });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }
    res.json({ success: true, data: org });
  } catch (err) {
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
  requireRole('ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = orgSchema.partial().parse(req.body);
      // Convert empty strings to null for optional db fields, if necessary, or just save empty strings.
      // Prisma usually accepts empty strings, but for URLs it's better to store empty string if not null.
      const org = await prisma.organization.update({
        where: { id: req.user!.organizationId },
        data,
      });
      res.json({ success: true, data: org });
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
        data: { organizationId: req.params.orgId, name, email, passwordHash, role: 'ADMIN' },
      });

      res
        .status(201)
        .json({
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

// Delete own org (Danger Zone)
orgsRouter.delete('/me', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
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
});
