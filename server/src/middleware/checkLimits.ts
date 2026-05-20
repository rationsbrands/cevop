import { Response, NextFunction } from 'express';
import { prisma } from '../services/prisma';
import { AuthRequest } from './auth';
import { getLimits, getUpgradeMessage } from '../lib/planLimits';

export async function checkTableLimit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { plan: true, planStatus: true },
    });
    if (!org) { next(); return; }

    const effectivePlan = org.planStatus === 'trialing' ? 'trial' : org.plan;
    const limits = getLimits(effectivePlan);

    if (limits.tables === Infinity) { next(); return; }

    const count = await prisma.table.count({
      where: { organizationId: req.user!.organizationId, isActive: true },
    });

    if (count >= limits.tables) {
      res.status(402).json({
        success: false,
        error: getUpgradeMessage('tables', effectivePlan),
        upgradeRequired: true,
        limit: 'tables',
        currentPlan: effectivePlan,
        current: count,
        max: limits.tables,
      });
      return;
    }
    next();
  } catch {
    next();
  }
}

export async function checkBranchLimit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { plan: true, planStatus: true },
    });
    if (!org) { next(); return; }

    const effectivePlan = org.planStatus === 'trialing' ? 'trial' : org.plan;
    const limits = getLimits(effectivePlan);

    if (limits.branches === Infinity) { next(); return; }

    const count = await prisma.branch.count({
      where: { organizationId: req.user!.organizationId, isActive: true },
    });

    if (count >= limits.branches) {
      res.status(402).json({
        success: false,
        error: getUpgradeMessage('branches', effectivePlan),
        upgradeRequired: true,
        limit: 'branches',
        currentPlan: effectivePlan,
        current: count,
        max: limits.branches,
      });
      return;
    }
    next();
  } catch {
    next();
  }
}

export async function checkStaffLimit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { plan: true, planStatus: true },
    });
    if (!org) { next(); return; }

    const effectivePlan = org.planStatus === 'trialing' ? 'trial' : org.plan;
    const limits = getLimits(effectivePlan);

    if (limits.staff === Infinity) { next(); return; }

    const count = await prisma.user.count({
      where: {
        organizationId: req.user!.organizationId,
        isActive: true,
        role: { not: 'SUPERADMIN' },
      },
    });

    if (count >= limits.staff) {
      res.status(402).json({
        success: false,
        error: getUpgradeMessage('staff', effectivePlan),
        upgradeRequired: true,
        limit: 'staff',
        currentPlan: effectivePlan,
        current: count,
        max: limits.staff,
      });
      return;
    }
    next();
  } catch {
    next();
  }
}
