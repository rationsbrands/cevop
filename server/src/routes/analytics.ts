import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate, requireRole('ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'));

// GET /api/analytics/turnover — table turnover metrics
analyticsRouter.get('/turnover', async (req: AuthRequest, res: Response) => {
  try {
    const branchId = req.branchScope!;
    const orgId = req.user!.organizationId;

    const sessions = await prisma.tableSession.findMany({
      where: {
        organizationId: orgId,
        branchId: branchId,
        closedAt: { not: null },
        openedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
      },
      select: {
        openedAt: true,
        closedAt: true,
        orders: {
          select: {
            total: true,
            createdAt: true,
          },
        },
      },
    });

    const metrics = sessions.map((s) => {
      const durationMs = s.closedAt!.getTime() - s.openedAt.getTime();
      const durationMins = Math.floor(durationMs / 60000);
      const totalRevenue = s.orders.reduce((sum, o) => sum + Number(o.total), 0);
      return { durationMins, totalRevenue };
    });

    const avgDuration =
      metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.durationMins, 0) / metrics.length : 0;

    const avgRevenue =
      metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.totalRevenue, 0) / metrics.length : 0;

    res.json({
      success: true,
      data: {
        avgDurationMins: Math.round(avgDuration),
        avgRevenuePerTable: Math.round(avgRevenue * 100) / 100,
        totalSessions: sessions.length,
      },
    });
  } catch (err) {
    logger.error('GET /analytics/turnover error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch turnover metrics' });
  }
});

// GET /api/analytics/waiters — waiter performance
analyticsRouter.get('/waiters', async (req: AuthRequest, res: Response) => {
  try {
    const branchId = req.branchScope!;
    const orgId = req.user!.organizationId;

    const waiterStats = await prisma.order.groupBy({
      by: ['assignedWaiter'],
      where: {
        organizationId: orgId,
        branchId: branchId,
        assignedWaiter: { not: null },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
      },
      _count: { _all: true },
      _sum: { total: true },
    });

    // Fetch names for the waiters
    const waiterIds = waiterStats.map((s) => s.assignedWaiter).filter(Boolean) as string[];
    const waiters = await prisma.user.findMany({
      where: { id: { in: waiterIds } },
      select: { id: true, name: true, staffCode: true },
    });

    const result = waiterStats.map((stat) => {
      const waiter = waiters.find((w) => w.id === stat.assignedWaiter);
      return {
        waiterId: stat.assignedWaiter,
        name: waiter?.name || waiter?.staffCode || 'Unknown',
        orderCount: stat._count._all,
        totalRevenue: Number(stat._sum.total || 0),
      };
    });

    res.json({ success: true, data: result.sort((a, b) => b.totalRevenue - a.totalRevenue) });
  } catch (err) {
    logger.error('GET /analytics/waiters error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch waiter analytics' });
  }
});
