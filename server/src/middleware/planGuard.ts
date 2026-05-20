import { Response, NextFunction } from 'express';
import { prisma } from '../services/prisma';
import { AuthRequest } from './auth';
import { logger } from '../services/logger';

export const planGuard = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    next();
    return;
  }
  if (req.user.role === 'SUPERADMIN') {
    next();
    return;
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { plan: true, planStatus: true, trialEndsAt: true },
    });

    if (!org) {
      res.status(403).json({ success: false, error: 'Organisation not found' });
      return;
    }

    // Hard block — suspended or cancelled
    if (org.planStatus === 'suspended' || org.planStatus === 'cancelled') {
      res
        .status(402)
        .json({
          success: false,
          error: 'Your account has been suspended. Please contact support.',
        });
      return;
    }

    // Trial expired — silently downgrade to free, do NOT block
    if (org.planStatus === 'trialing' && org.trialEndsAt && org.trialEndsAt < new Date()) {
      await prisma.organization.update({
        where: { id: req.user!.organizationId },
        data: { plan: 'free', planStatus: 'active', trialEndsAt: null },
      });
      // Update the in-request user context so limit checks below use the new plan
      req.user = { ...req.user, plan: 'free' } as any;
      logger.info('Trial expired — org downgraded to free', { orgId: req.user?.organizationId });
    }

    next();
  } catch {
    next(); // Fail open — don't block requests on guard errors
  }
};
