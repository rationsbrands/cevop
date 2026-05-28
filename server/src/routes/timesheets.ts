import { Router, Response } from 'express';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth';
import { prisma } from '../services/prisma';

export const timesheetsRouter = Router();

timesheetsRouter.use(authenticate);

timesheetsRouter.get(
  '/',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const branchId = req.user!.branchId;

      const branchFilter = branchId ? { branchId } : {};

      const shifts = await prisma.staffShift.findMany({
        where: {
          organizationId: orgId,
          ...branchFilter,
        },
        include: {
          user: {
            select: { name: true, role: true },
          },
        },
        orderBy: { clockedInAt: 'desc' },
        take: 200,
      });

      res.json({ success: true, data: shifts });
    } catch (err) {
      console.error('Fetch timesheets error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },
);
