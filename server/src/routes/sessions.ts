import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';
import { closeSession } from '../services/tableSession';
import { logger } from '../services/logger';

export const sessionsRouter = Router();

sessionsRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

// Close an active session
sessionsRouter.patch(
  '/:id/close',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'SERVICE',
    'WAITER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const session = await (prisma as any).tableSession.findUnique({
        where: { id: req.params.id },
      });

      if (!session) {
        res.status(404).json({ success: false, error: 'Session not found' });
        return;
      }

      // Enforce org and branch scoped access
      if (
        session.organizationId !== req.user!.organizationId ||
        session.branchId !== req.branchScope
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const bodySchema = z.object({
        nextStatus: z.enum(['CLEANING', 'EMPTY']).default('CLEANING'),
      });

      const { nextStatus } = bodySchema.parse(req.body);

      await closeSession(req.params.id, req.user!.userId, nextStatus);

      res.json({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Session already closed') {
        res.status(400).json({ success: false, error: 'Session already closed' });
        return;
      }
      logger.error('PATCH /sessions/:id/close error:', err);
      res.status(500).json({ success: false, error: 'Failed to close session' });
    }
  },
);
