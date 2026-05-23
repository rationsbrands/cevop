import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, useApi } from '../context/auth';

interface Branch {
  id: string;
  name: string;
}
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  staffCode?: string;
}

const ROLE_NAMES: Record<string, string> = {
  ORG_OWNER: 'Owner',
  ADMIN: 'Admin',
  ORG_MANAGER: 'Manager',
  ORG_FINANCE: 'Finance',
  ORG_AUDITOR: 'Auditor',
  BRANCH_ADMIN: 'Admin',
  BRANCH_FINANCE: 'Finance',
  SERVICE: 'Service',
  WAITER: 'Waiter',
  KITCHEN: 'Kitchen',
  SUPERADMIN: 'Superadmin',
};

const ROLE_SELECT_LABELS: Record<string, string> = {
  ORG_OWNER: 'Org Owner',
  ADMIN: 'Org Admin',
  ORG_MANAGER: 'Org Manager',
  ORG_FINANCE: 'Org Finance',
  ORG_AUDITOR: 'Org Auditor',
  BRANCH_ADMIN: 'Branch Admin',
  BRANCH_FINANCE: 'Branch Finance',
  SERVICE: 'Service',
  WAITER: 'Waiter',
  KITCHEN: 'Kitchen',
  SUPERADMIN: 'Superadmin',
};

const ORG_SCOPED_ROLES = new Set([
  'ORG_OWNER',
  'ADMIN',
  'ORG_MANAGER',
  'ORG_FINANCE',
  'ORG_AUDITOR',
  'SUPERADMIN',
]);

export function UsersPage() {
  const { user: me } = useAuth();
  const api = useApi();

  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'users' | 'invites'>('users');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'WAITER',
    branchId: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'WAITER', branchId: '' });
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<any>(null);
  const [inviteError, setInviteError] = useState('');
  const [passwordResetResult, setPasswordResetResult] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ role: 'WAITER', branchId: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const isOrgAdmin =
    !!me?.role && ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(me.role);
  const isOrgWideRole =
    !!me?.role &&
    ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'ORG_FINANCE', 'ORG_AUDITOR', 'SUPERADMIN'].includes(
      me.role,
    );
  const isBranchAdmin = me?.role === 'BRANCH_ADMIN';

  const canCreateOrgOwner = me?.role === 'ORG_OWNER' || me?.role === 'SUPERADMIN';
  const canCreateOrgAdmin =
    me?.role === 'ORG_OWNER' || me?.role === 'ADMIN' || me?.role === 'SUPERADMIN';
  const availableRoles = isBranchAdmin
    ? ['SERVICE', 'WAITER', 'KITCHEN']
    : [
        ...(canCreateOrgOwner ? ['ORG_OWNER'] : []),
        ...(canCreateOrgAdmin ? ['ADMIN'] : []),
        'ORG_MANAGER',
        'ORG_FINANCE',
        'ORG_AUDITOR',
        'BRANCH_ADMIN',
        'BRANCH_FINANCE',
        'SERVICE',
        'WAITER',
        'KITCHEN',
      ];
  const inviteRoles = isBranchAdmin
    ? ['SERVICE', 'WAITER', 'KITCHEN']
    : [
        'ORG_MANAGER',
        'ORG_FINANCE',
        'ORG_AUDITOR',
        'BRANCH_ADMIN',
        'BRANCH_FINANCE',
        'SERVICE',
        'WAITER',
        'KITCHEN',
      ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, branchesRes, invitesRes] = await Promise.all([
        api.get('/api/users'),
        isOrgWideRole ? api.get('/api/branches') : Promise.resolve({ data: [] }),
        api.get('/api/invites'),
      ]);
      setUsers(usersRes.data ?? []);
      setBranches(branchesRes.data ?? []);
      setInvites(invitesRes.data ?? []);
    } catch {
      setError('Failed to load');
    } finally {
      setLoading(false);
    }
  }, [api, isOrgWideRole]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const payload: any = { ...form };
      if (!payload.branchId) delete payload.branchId;
      const { success, error: err, data } = await api.post('/api/users', payload);
      if (!success) {
        setCreateError(err || 'Failed to create user');
        return;
      }
      setUsers((prev) => [data, ...prev]);
      setForm({ name: '', email: '', password: '', role: 'WAITER', branchId: '' });
      setShowCreate(false);
    } catch {
      setCreateError('Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError('');
    setInviteResult(null);
    try {
      const payload: any = { ...inviteForm };
      if (!payload.branchId) delete payload.branchId;
      const { success, error: err, data } = await api.post('/api/invites', payload);
      if (!success) {
        setInviteError(err || 'Failed to send invite');
        return;
      }
      setInviteResult(data);
      setInviteForm({ email: '', role: 'WAITER', branchId: '' });
      load(); // Refresh invites list
    } catch {
      setInviteError('Failed to send invite');
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: string) {
    await api.delete(`/api/invites/${id}`);
    setInvites((prev) => prev.filter((i) => i.id !== id));
  }

  async function toggleActive(user: User) {
    const { success, data } = await api.patch(`/api/users/${user.id}`, {
      isActive: !user.isActive,
    });
    if (success) setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...data } : u)));
  }

  async function resetPassword(user: User) {
    if (actionLoading.has(user.id)) return;
    setPasswordResetResult(null);
    setActionError('');
    setActionLoading((prev) => new Set(prev).add(user.id));
    try {
      const {
        success,
        data,
        error: err,
      } = await api.post(`/api/users/${user.id}/password-reset`, {});
      if (!success) {
        setActionError(err || 'Failed to generate reset link');
        return;
      }
      setPasswordResetResult(data);
    } finally {
      setActionLoading((prev) => {
        const n = new Set(prev);
        n.delete(user.id);
        return n;
      });
    }
  }

  async function deleteUser(user: User) {
    if (actionLoading.has(user.id)) return;
    const ok = window.confirm(
      `Deactivate ${user.name}? They will be logged out and won’t be able to sign in.`,
    );
    if (!ok) return;
    setActionError('');
    setActionLoading((prev) => new Set(prev).add(user.id));
    try {
      const { success, error: err } = await api.delete(`/api/users/${user.id}`);
      if (!success) {
        setActionError(err || 'Failed to deactivate user');
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, isActive: false } : u)));
    } finally {
      setActionLoading((prev) => {
        const n = new Set(prev);
        n.delete(user.id);
        return n;
      });
    }
  }

  async function saveUserEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setEditSaving(true);
    setEditError('');
    try {
      const role = editForm.role;
      const isOrgWideTargetRole =
        role === 'ORG_OWNER' ||
        role === 'ADMIN' ||
        role === 'ORG_MANAGER' ||
        role === 'ORG_FINANCE' ||
        role === 'ORG_AUDITOR';
      const roleRequiresBranch =
        role === 'BRANCH_ADMIN' ||
        role === 'BRANCH_FINANCE' ||
        role === 'WAITER' ||
        role === 'SERVICE' ||
        role === 'KITCHEN';

      let branchId: string | null = editForm.branchId ? editForm.branchId : null;

      if (isOrgAdmin) {
        if (isOrgWideTargetRole) branchId = null;
        if (roleRequiresBranch && !branchId && branches.length === 1) {
          branchId = branches[0].id;
        }
        if (roleRequiresBranch && !branchId) {
          setEditError('This role requires a branch assignment.');
          return;
        }
      }

      const payload: any = { role };
      if (isOrgAdmin) payload.branchId = branchId;
      const {
        success,
        error: err,
        data,
      } = await api.patch(`/api/users/${editingUser.id}`, payload);
      if (!success) {
        setEditError(err || 'Failed to update user');
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? { ...u, ...data } : u)));
      setEditingUser(null);
    } catch {
      setEditError('Failed to update user');
    } finally {
      setEditSaving(false);
    }
  }

  if (loading) return <div className="text-[var(--muted)] text-sm">Loading…</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">STAFF</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            {me?.branch
              ? `Managing staff for ${me.branch.name}`
              : 'All staff across your organisation'}
          </p>
        </div>
        <div className="flex gap-2">
          {(isOrgAdmin || isBranchAdmin) && (
            <button
              onClick={() => {
                setShowInvite(true);
                setInviteResult(null);
                setInviteError('');
              }}
              className="btn btn-secondary btn-sm"
            >
              Invite via Email
            </button>
          )}
          {isOrgAdmin && (
            <button onClick={() => setShowCreate(true)} className="btn btn-primary btn-sm">
              + Add Staff
            </button>
          )}
        </div>
      </div>

      {/* Invite Result Banner */}
      {inviteResult && (
        <div className="card p-4 border-[var(--accent)] bg-[var(--accent-dim)] space-y-2">
          <p className="text-sm font-semibold text-[var(--text)]">
            Invite sent for {inviteResult.email}
          </p>
          <p className="text-xs text-[var(--muted)]">
            Share this invite link with them (if email isn't configured):
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-[var(--surface2)] border border-[var(--border)] px-2 py-1 flex-1 break-all">
              {inviteResult.inviteUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(inviteResult.inviteUrl)}
              className="btn btn-secondary btn-sm shrink-0"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Expires: {new Date(inviteResult.expiresAt).toLocaleString()}
          </p>
        </div>
      )}

      {actionError && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
          {actionError}
        </div>
      )}

      {passwordResetResult && (
        <div className="card p-4 border-[var(--accent)] bg-[var(--accent-dim)] space-y-2">
          <p className="text-sm font-semibold text-[var(--text)]">
            Password reset link generated for {passwordResetResult.email}
          </p>
          <p className="text-xs text-[var(--muted)]">Share this link with them:</p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-[var(--surface2)] border border-[var(--border)] px-2 py-1 flex-1 break-all">
              {passwordResetResult.resetUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(passwordResetResult.resetUrl)}
              className="btn btn-secondary btn-sm shrink-0"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Expires: {new Date(passwordResetResult.expiresAt).toLocaleString()}
          </p>
        </div>
      )}

      {/* Create Staff Form */}
      {showCreate && (
        <div className="card p-5 space-y-4 border-[var(--accent)]">
          <h2 className="font-semibold text-[var(--text)]">Add Staff Member</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="staff_create_name">Name *</label>
                <input
                  id="staff_create_name"
                  name="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="staff_create_email">Email *</label>
                <input
                  id="staff_create_email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="staff_create_password">Password *</label>
                <div className="relative">
                  <input
                    id="staff_create_password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    minLength={8}
                    placeholder="••••••••"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-xs select-none"
                  >
                    {showPassword ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="staff_create_role">Role *</label>
                <select
                  id="staff_create_role"
                  name="role"
                  value={form.role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setForm((f) => ({
                      ...f,
                      role: nextRole,
                      branchId: [
                        'BRANCH_ADMIN',
                        'BRANCH_FINANCE',
                        'WAITER',
                        'SERVICE',
                        'KITCHEN',
                      ].includes(nextRole)
                        ? f.branchId
                        : '',
                    }));
                  }}
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_SELECT_LABELS[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>
              {isOrgAdmin &&
                branches.length > 0 &&
                ['BRANCH_ADMIN', 'BRANCH_FINANCE', 'WAITER', 'SERVICE', 'KITCHEN'].includes(
                  form.role,
                ) && (
                  <div className="sm:col-span-2">
                    <label htmlFor="staff_create_branch">Assign to Branch *</label>
                    <select
                      id="staff_create_branch"
                      name="branchId"
                      value={form.branchId}
                      onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                      required
                    >
                      <option value="">— Select branch —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
            </div>
            {createError && <p className="text-red-400 text-sm">{createError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="btn btn-secondary flex-1 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="btn btn-primary flex-1 py-2 text-sm disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Add Staff'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Invite Form */}
      {showInvite && (
        <div className="card p-5 space-y-4 border-[var(--accent)]">
          <h2 className="font-semibold text-[var(--text)]">Invite Staff by Email</h2>
          <p className="text-xs text-[var(--muted)]">
            They'll receive a link to set up their account. The invite expires in 72 hours.
          </p>
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="staff_invite_email">Email *</label>
                <input
                  id="staff_invite_email"
                  name="email"
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  placeholder="e.g. name@restaurant.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="staff_invite_role">Role *</label>
                <select
                  id="staff_invite_role"
                  name="role"
                  value={inviteForm.role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setInviteForm((f) => ({
                      ...f,
                      role: nextRole,
                      branchId: [
                        'BRANCH_ADMIN',
                        'BRANCH_FINANCE',
                        'WAITER',
                        'SERVICE',
                        'KITCHEN',
                      ].includes(nextRole)
                        ? f.branchId
                        : '',
                    }));
                  }}
                >
                  {inviteRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_SELECT_LABELS[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>
              {isOrgAdmin &&
                branches.length > 0 &&
                ['BRANCH_ADMIN', 'BRANCH_FINANCE', 'WAITER', 'SERVICE', 'KITCHEN'].includes(
                  inviteForm.role,
                ) && (
                  <div>
                    <label htmlFor="staff_invite_branch">Branch *</label>
                    <select
                      id="staff_invite_branch"
                      name="branchId"
                      value={inviteForm.branchId}
                      onChange={(e) => setInviteForm((f) => ({ ...f, branchId: e.target.value }))}
                      required
                    >
                      <option value="">— Select branch —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
            </div>
            {inviteError && <p className="text-red-400 text-sm">{inviteError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowInvite(false);
                  setInviteResult(null);
                }}
                className="btn btn-secondary flex-1 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="btn btn-primary flex-1 py-2 text-sm disabled:opacity-50"
              >
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        <button
          onClick={() => setTab('users')}
          className={`px-4 py-2 text-sm font-bold transition-all ${tab === 'users' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
        >
          Users ({users.length})
        </button>
        <button
          onClick={() => setTab('invites')}
          className={`px-4 py-2 text-sm font-bold transition-all ${tab === 'invites' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
        >
          Pending Invites ({invites.length})
        </button>
      </div>

      {tab === 'users' ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wider text-[var(--muted)] pb-2 pr-4">
                  Code
                </th>
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Role
                </th>
                {isOrgAdmin && (
                  <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                    Branch
                  </th>
                )}
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {users.map((u) => (
                <tr
                  key={u.id}
                  className={`hover:bg-[var(--surface2)] transition-colors ${!u.isActive ? 'opacity-40' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-[var(--text)]">{u.name}</td>
                  <td className="py-3 pr-4">
                    {u.staffCode ? (
                      <span className="font-mono text-xs border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">
                        {u.staffCode}
                      </span>
                    ) : (
                      <span className="text-[var(--border)] text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)] text-sm">{u.email}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const branchName = u.branch?.name ?? '';
                      const roleName = ROLE_NAMES[u.role] ?? u.role;

                      const isOrgScoped = ORG_SCOPED_ROLES.has(u.role);
                      const label = isOrgScoped
                        ? `Org ${roleName}`
                        : branchName
                          ? `${branchName} ${roleName}`
                          : roleName;

                      const badgeClass = isOrgScoped
                        ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                        : u.role === 'BRANCH_ADMIN'
                          ? 'border-[var(--role-branch-admin)] text-[var(--role-branch-admin)] bg-[var(--role-branch-admin-dim)]'
                          : u.role === 'BRANCH_FINANCE'
                            ? 'border-[var(--role-branch-finance)] text-[var(--role-branch-finance)] bg-[var(--role-branch-finance-dim)]'
                            : u.role === 'SERVICE'
                              ? 'border-[var(--role-service)] text-[var(--role-service)] bg-[var(--role-service-dim)]'
                              : u.role === 'WAITER'
                                ? 'border-[var(--role-waiter)] text-[var(--role-waiter)] bg-[var(--role-waiter-dim)]'
                                : 'border-[var(--border)] text-[var(--muted)] bg-[var(--surface2)]';

                      return (
                        <span
                          title={label}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 border rounded-md max-w-full whitespace-nowrap ${badgeClass}`}
                        >
                          {!isOrgScoped && branchName ? (
                            <>
                              <span className="min-w-0 max-w-36 truncate">{branchName}</span>
                              <span className="opacity-90">{roleName}</span>
                            </>
                          ) : (
                            label
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  {isOrgAdmin && (
                    <td className="px-4 py-3 text-[var(--muted)] text-xs">
                      {u.branch?.name ?? <span className="opacity-40">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`text-xs ${u.isActive ? 'text-green-400' : 'text-red-400'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.id !== me?.id && (isOrgAdmin || isBranchAdmin) && (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => {
                            setEditingUser(u);
                            setEditForm({ role: u.role, branchId: u.branchId ?? '' });
                            setEditError('');
                          }}
                          disabled={actionLoading.has(u.id)}
                          className="text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isOrgAdmin ? 'Edit Role/Branch' : 'Edit Role'}
                        </button>
                        <button
                          onClick={() => resetPassword(u)}
                          disabled={actionLoading.has(u.id) || !u.isActive}
                          className="text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {actionLoading.has(u.id) ? 'Working…' : 'Reset Password'}
                        </button>
                        <button
                          onClick={() => toggleActive(u)}
                          disabled={actionLoading.has(u.id)}
                          className="text-xs text-[var(--muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        {u.isActive && (
                          <button
                            onClick={() => deleteUser(u)}
                            disabled={actionLoading.has(u.id)}
                            className="text-xs text-[var(--danger)] hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)]">
                    No staff found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Branch
                </th>
                <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                  Expires
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {invites.map((i) => (
                <tr key={i.id} className="hover:bg-[var(--surface2)]">
                  <td className="px-4 py-3 text-[var(--text)]">{i.email}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const branchName = i.branchName ?? '';
                      const roleName = ROLE_NAMES[i.role] ?? i.role;
                      const isOrgScoped = ORG_SCOPED_ROLES.has(i.role);
                      const label = isOrgScoped
                        ? `Org ${roleName}`
                        : branchName
                          ? `${branchName} ${roleName}`
                          : roleName;

                      const badgeClass = isOrgScoped
                        ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                        : i.role === 'BRANCH_ADMIN'
                          ? 'border-[var(--role-branch-admin)] text-[var(--role-branch-admin)] bg-[var(--role-branch-admin-dim)]'
                          : i.role === 'BRANCH_FINANCE'
                            ? 'border-[var(--role-branch-finance)] text-[var(--role-branch-finance)] bg-[var(--role-branch-finance-dim)]'
                            : i.role === 'SERVICE'
                              ? 'border-[var(--role-service)] text-[var(--role-service)] bg-[var(--role-service-dim)]'
                              : i.role === 'WAITER'
                                ? 'border-[var(--role-waiter)] text-[var(--role-waiter)] bg-[var(--role-waiter-dim)]'
                                : 'border-[var(--border)] text-[var(--muted)] bg-[var(--surface2)]';

                      return (
                        <span
                          title={label}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 border rounded-md max-w-full whitespace-nowrap ${badgeClass}`}
                        >
                          {!isOrgScoped && branchName ? (
                            <>
                              <span className="min-w-0 max-w-36 truncate">{branchName}</span>
                              <span className="opacity-90">{roleName}</span>
                            </>
                          ) : (
                            label
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)] text-xs">{i.branchName ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--muted)] text-xs">
                    {new Date(i.expiresAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => revokeInvite(i.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {invites.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)]">
                    No pending invites
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setEditingUser(null)}
        >
          <div
            className="card w-full max-w-md p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="font-display text-2xl">EDIT STAFF</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                {editingUser.name} • {editingUser.email}
              </p>
            </div>

            <form onSubmit={saveUserEdit} className="space-y-3">
              <div>
                <label htmlFor="admin_user_edit_role">Role *</label>
                <select
                  id="admin_user_edit_role"
                  name="role"
                  value={editForm.role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setEditForm((f) => ({
                      ...f,
                      role: nextRole,
                      branchId: [
                        'BRANCH_ADMIN',
                        'BRANCH_FINANCE',
                        'WAITER',
                        'SERVICE',
                        'KITCHEN',
                      ].includes(nextRole)
                        ? f.branchId
                        : '',
                    }));
                  }}
                  autoComplete="off"
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_SELECT_LABELS[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>

              {isOrgAdmin &&
                branches.length > 0 &&
                ['BRANCH_ADMIN', 'BRANCH_FINANCE', 'WAITER', 'SERVICE', 'KITCHEN'].includes(
                  editForm.role,
                ) && (
                  <div>
                    <label htmlFor="admin_user_edit_branch">Branch *</label>
                    <select
                      id="admin_user_edit_branch"
                      name="branchId"
                      value={editForm.branchId}
                      onChange={(e) => setEditForm((f) => ({ ...f, branchId: e.target.value }))}
                      required
                      autoComplete="off"
                    >
                      <option value="">— Select branch —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              {editError && <div className="text-red-400 text-sm">{editError}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="btn btn-secondary flex-1 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="btn btn-primary flex-1 py-2 text-sm disabled:opacity-50"
                >
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
