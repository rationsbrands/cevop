import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../services/prisma';
import { AuthRequest } from './auth';

export const planGuard = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const publicPaths = ['/auth', '/menu/public', '/orders/public', '/waiter-calls/public', '/service-requests/public'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    next();
    return;
  }

  if (!req.user) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        req.user = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as any;
      } catch {
        // Silently fail and let authenticate handle it later
      }
    }
  }

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
      select: { planStatus: true, trialEndsAt: true },
    });

    if (!org) {
      res.status(403).json({ success: false, error: 'Organisation not found' });
      return;
    }

    if (org.planStatus === 'suspended' || org.planStatus === 'cancelled') {
      res.status(402).json({ success: false, error: 'Your account has been suspended. Please contact support.' });
      return;
    }

    if (org.planStatus === 'trialing' && org.trialEndsAt && org.trialEndsAt < new Date()) {
      res.status(402).json({ success: false, error: 'Your free trial has expired. Please subscribe to continue using Cevop.' });
      return;
    }

    next();
  } catch (err) {
    next();
  }
};
