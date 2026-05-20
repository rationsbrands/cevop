import { Response, NextFunction } from 'express';
import { prisma } from '../services/prisma';
import { AuthRequest } from './auth';
import { logger } from '../services/logger';

// How long to trust the plan in the JWT before doing a live DB check (in ms)
// Access tokens are 15 minutes, so we check at most once per token lifetime
const PLAN_CHECK_INTERVAL_MS = 15 * 60 * 1000;

// In-memory cache: orgId -> { planStatus, trialEndsAt, checkedAt }
// This is per-process but that's fine — worst case a suspended org gets 15 extra minutes
// For zero-tolerance suspension, ops team should also revoke all refresh tokens
const planCache = new Map<
  string,
  { planStatus: string; trialEndsAt: Date | null; checkedAt: number }
>();

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

  const orgId = req.user.organizationId;
  const now = Date.now();

  try {
    // Check in-memory cache first
    const cached = planCache.get(orgId);
    let planStatus: string;
    let trialEndsAt: Date | null;

    if (cached && now - cached.checkedAt < PLAN_CHECK_INTERVAL_MS) {
      // Use cached value — no DB call
      planStatus = cached.planStatus;
      trialEndsAt = cached.trialEndsAt;
    } else {
      // Cache miss or stale — fetch from DB
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { planStatus: true, trialEndsAt: true },
      });

      if (!org) {
        res.status(403).json({ success: false, error: 'Organisation not found' });
        return;
      }

      planStatus = org.planStatus;
      trialEndsAt = org.trialEndsAt;

      // Update cache
      planCache.set(orgId, { planStatus, trialEndsAt, checkedAt: now });
    }

    // Hard block — suspended or cancelled
    if (planStatus === 'suspended' || planStatus === 'cancelled') {
      res.status(402).json({
        success: false,
        error: 'Your account has been suspended. Please contact support.',
      });
      return;
    }

    // Trial expired — silently downgrade to free
    if (planStatus === 'trialing' && trialEndsAt && trialEndsAt < new Date()) {
      // Update DB async — don't await, don't block the request
      prisma.organization
        .update({
          where: { id: orgId },
          data: { plan: 'free', planStatus: 'active', trialEndsAt: null },
        })
        .then(() => {
          // Invalidate cache so next request gets fresh status
          planCache.delete(orgId);
          logger.info('Trial expired — org downgraded to free', { orgId });
        })
        .catch((err) => {
          logger.error('Failed to downgrade expired trial', { orgId, err });
        });

      // Don't block — continue as free plan
      req.user = { ...req.user, plan: 'free' } as typeof req.user;
    }

    next();
  } catch {
    next(); // Fail open
  }
};

// Export cache invalidation for use when ops team suspends/activates an org
export function invalidatePlanCache(orgId: string): void {
  planCache.delete(orgId);
}

// Clear entire cache periodically to prevent memory growth
setInterval(() => {
  const cutoff = Date.now() - PLAN_CHECK_INTERVAL_MS * 2;
  for (const [orgId, entry] of planCache.entries()) {
    if (entry.checkedAt < cutoff) planCache.delete(orgId);
  }
}, PLAN_CHECK_INTERVAL_MS * 2);
