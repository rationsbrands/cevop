import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthPayload } from '../../../shared/types';

export interface AuthRequest extends Request {
  user?: AuthPayload;
  branchScope?: string | null; // set by requireBranchAccess
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET!;
    const payload = jwt.verify(token, secret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Injects req.branchScope:
 *   - If user has a branchId (branch-scoped staff) → req.branchScope = that branchId
 *   - If user is org-wide admin but passed ?branchId= query param → req.branchScope = that param
 *   - Otherwise → req.branchScope = null (see everything)
 *
 * Route handlers use req.branchScope to filter Prisma queries.
 */
export function requireBranchAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthenticated' });
    return;
  }

  if (
    (req.user.role === 'BRANCH_ADMIN' ||
      req.user.role === 'BRANCH_FINANCE' ||
      req.user.role === 'WAITER' ||
      req.user.role === 'SERVICE' ||
      req.user.role === 'KITCHEN') &&
    !req.user.branchId
  ) {
    res.status(403).json({ success: false, error: 'This account must be assigned to a branch' });
    return;
  }

  if (req.user.branchId) {
    // Branch-scoped user: always locked to their branch
    req.branchScope = req.user.branchId;
  } else if (req.query.branchId && typeof req.query.branchId === 'string') {
    // Org-wide admin drilling into a specific branch
    req.branchScope = req.query.branchId;
  } else {
    // Org-wide admin with no filter: see everything
    req.branchScope = null;
  }

  next();
}

export function requireBranchSelected(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthenticated' });
    return;
  }
  if (!req.branchScope) {
    res.status(400).json({ success: false, error: 'branchId is required for this operation' });
    return;
  }
  next();
}

export function requireOrg(req: AuthRequest, res: Response, next: NextFunction): void {
  const orgId = req.params.orgId || (req.query.orgId as string) || req.body.organizationId;
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthenticated' });
    return;
  }
  // Superadmin can access any org; others only their own
  if (req.user.role !== 'SUPERADMIN' && req.user.organizationId !== orgId) {
    res.status(403).json({ success: false, error: 'Access denied to this organization' });
    return;
  }
  next();
}
