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

// Create a new station
stationsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const { name, branchId } = req.body;

    if (!name || !branchId) {
      return res.status(400).json({ success: false, error: 'Name and branchId are required' });
    }

    const station = await prisma.station.create({
      data: {
        name,
        branchId,
        organizationId: orgId,
        isActive: true,
      },
    });

    res.status(201).json({ success: true, data: station });
  } catch (err) {
    logger.error('POST /stations error:', err);
    res.status(500).json({ success: false, error: 'Failed to create station' });
  }
});

// Update a station
stationsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const stationId = req.params.id;
    const { name, isActive } = req.body;

    // Verify ownership
    const existing = await prisma.station.findFirst({
      where: { id: stationId, organizationId: orgId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Station not found' });
    }

    const updated = await prisma.station.update({
      where: { id: stationId },
      data: {
        ...(name !== undefined && { name }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('PATCH /stations/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to update station' });
  }
});

// Delete (soft delete) a station
stationsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const stationId = req.params.id;

    const existing = await prisma.station.findFirst({
      where: { id: stationId, organizationId: orgId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Station not found' });
    }

    // Soft delete to preserve historical order logs
    const deleted = await prisma.station.update({
      where: { id: stationId },
      data: { isActive: false },
    });

    res.json({ success: true, data: deleted });
  } catch (err) {
    logger.error('DELETE /stations/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete station' });
  }
});
