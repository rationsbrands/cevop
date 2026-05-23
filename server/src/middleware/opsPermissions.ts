import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export type OpsPermission =
  | 'view_metrics'
  | 'view_orgs'
  | 'view_org_detail'
  | 'manage_plans'
  | 'assign_trial'
  | 'suspend_org'
  | 'activate_org'
  | 'delete_org'
  | 'impersonate'
  | 'view_audit'
  | 'view_team'
  | 'manage_team'
  | 'change_own_password'
  | 'onboard_org';

// Permission matrix per opsRole
const PERMISSIONS: Record<string, OpsPermission[]> = {
  SUPER: [
    'view_metrics',
    'view_orgs',
    'view_org_detail',
    'manage_plans',
    'assign_trial',
    'suspend_org',
    'activate_org',
    'delete_org',
    'impersonate',
    'view_audit',
    'view_team',
    'manage_team',
    'change_own_password',
    'onboard_org',
  ],
  BILLING: [
    'view_metrics',
    'view_orgs',
    'view_org_detail',
    'manage_plans',
    'assign_trial',
    'view_audit',
    'change_own_password',
  ],
  SUPPORT: ['view_orgs', 'view_org_detail', 'assign_trial', 'view_audit', 'change_own_password'],
  READONLY: ['view_metrics', 'view_orgs', 'change_own_password'],
};

export function hasOpsPermission(opsRole: string | undefined, permission: OpsPermission): boolean {
  if (!opsRole) return false;
  const allowed = PERMISSIONS[opsRole] ?? [];
  return allowed.includes(permission);
}

export function requireOpsPermission(permission: OpsPermission) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const opsRole = req.user?.opsRole;

    if (!opsRole) {
      // SUPERADMIN with no opsRole set — treat as SUPER (backwards compatibility)
      // This handles accounts created before opsRole was added
      if (req.user?.role === 'SUPERADMIN') {
        next();
        return;
      }
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    if (!hasOpsPermission(opsRole, permission)) {
      res.status(403).json({
        success: false,
        error: `Your role does not have permission to perform this action`,
      });
      return;
    }

    next();
  };
}
