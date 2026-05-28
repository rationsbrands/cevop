import { Router, Response } from 'express';
import { prisma } from '../services/prisma';
import { authenticate, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';

export const stationsRouter = Router();

stationsRouter.use(authenticate, requireBranchAccess);

// Get all stations for a branch
stationsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const branchId = req.query.branchId as string;
    const orgId = req.user!.organizationId;

    if (!branchId) {
      return res.status(400).json({ success: false, error: 'branchId is required' });
    }

    const stations = await prisma.station.findMany({
      where: {
        organizationId: orgId,
        branchId: branchId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: stations });
  } catch (err) {
    logger.error('GET /stations error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch stations' });
  }
});
