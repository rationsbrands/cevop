import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/prisma';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;

    const logs = await prisma.notificationLog.findMany({
      where: { organizationId: orgId },
      orderBy: { sentAt: 'desc' },
      take: 100,
    });

    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
