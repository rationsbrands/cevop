import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';

export const pushRouter = Router();

pushRouter.use(authenticate, requireBranchAccess);

// POST /api/push/subscribe — save a push subscription
pushRouter.post(
  '/subscribe',
  authenticate,
  requireRole(
    'SERVICE',
    'WAITER',
    'KITCHEN',
    'BRANCH_ADMIN',
    'ADMIN',
    'ORG_OWNER',
    'SUPERADMIN',
    'HOST',
    'CASHIER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const { subscription, app } = z
        .object({
          subscription: z.object({
            endpoint: z.string().url(),
            keys: z.object({
              p256dh: z.string(),
              auth: z.string(),
            }),
            expirationTime: z.number().nullable().optional(),
          }),
          app: z.enum(['service', 'admin']),
        })
        .parse(req.body);

      await prisma.pushSubscription.upsert({
        where: { endpoint: subscription.endpoint },
        update: {
          subscription: subscription as any,
          userId: req.user!.userId,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope ?? null,
          app,
          updatedAt: new Date(),
        },
        create: {
          userId: req.user!.userId,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope ?? null,
          app,
          endpoint: subscription.endpoint,
          subscription: subscription as any,
        },
      });

      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      logger.error('POST /push/subscribe error', { err });
      res.status(500).json({ success: false, error: 'Failed to save subscription' });
    }
  },
);

// DELETE /api/push/unsubscribe — remove a push subscription
pushRouter.delete(
  '/unsubscribe',
  requireRole(
    'SERVICE',
    'WAITER',
    'KITCHEN',
    'BRANCH_ADMIN',
    'ADMIN',
    'ORG_OWNER',
    'SUPERADMIN',
    'HOST',
    'CASHIER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
      await prisma.pushSubscription.deleteMany({
        where: { endpoint, userId: req.user!.userId },
      });
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to remove subscription' });
    }
  },
);
