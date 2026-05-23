import React, { useState, useEffect, useCallback } from 'react';
import { useApi, usePermission } from '../context/auth';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  opsRole: 'SUPER' | 'SUPPORT' | 'BILLING' | 'READONLY' | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export function TeamPage() {
  const api = useApi();
  const can = usePermission();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', opsRole: 'SUPPORT' });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadTeam = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/ops/team');
      if (res.success) setTeam(res.data);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadTeam(), 0);
    return () => window.clearTimeout(t);
  }, [loadTeam]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/api/ops/team', form);
      if (!res.success) {
        setError(res.error || 'Failed to create account');
        return;
      }
      setSuccess(
        `Account created for ${form.email}. They must change their password on first login.`,
      );
      setForm({ name: '', email: '', password: '', opsRole: 'SUPPORT' });
      setShowForm(false);
      await loadTeam();
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(member: TeamMember) {
    const action = member.isActive ? 'deactivate' : 'reactivate';
    if (!confirm(`${action === 'deactivate' ? 'Deactivate' : 'Reactivate'} ${member.name}?`))
      return;
    try {
      const res = await api.patch(`/api/ops/team/${member.id}`, { isActive: !member.isActive });
      if (res.success) await loadTeam();
      else setError(res.error || 'Failed to update');
    } catch {
      setError('Something went wrong');
    }
  }

  if (!can('view_team')) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--muted)] text-sm">
        You do not have permission to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl text-[var(--text)]">Ops Team</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Manage Cevop operator accounts.</p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setError('');
            setSuccess('');
          }}
          className="btn btn-primary px-4 py-2 text-sm"
        >
          {showForm ? 'Cancel' : '+ Add Member'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/20 border border-green-800 text-green-400 px-4 py-3 text-sm">
          {success}
        </div>
      )}

      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold text-[var(--text)] mb-4">New Ops Account</h2>
          <form onSubmit={handleCreate} className="space-y-4 max-w-md">
            <div>
              <label htmlFor="ops_team_full_name">Full Name</label>
              <input
                id="ops_team_full_name"
                name="name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                required
                placeholder="e.g. Jane Doe"
                autoComplete="name"
              />
            </div>
            <div>
              <label htmlFor="ops_team_email">Email</label>
              <input
                id="ops_team_email"
                name="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
                required
                placeholder="e.g. jane@cevop.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="ops_team_temp_password">Temporary Password</label>
              <div className="relative">
                <input
                  id="ops_team_temp_password"
                  name="password"
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))}
                  required
                  className="pr-10"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs"
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">
                They will be forced to change this on first login.
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-1">
                Role
              </label>
              <select
                value={form.opsRole}
                onChange={(e) => setForm((f) => ({ ...f, opsRole: e.target.value }))}
                className="w-full bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--text)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="SUPPORT">Support — can view orgs, assign trials, view audit</option>
                <option value="BILLING">Billing — can manage plans and view revenue</option>
                <option value="READONLY">Read Only — metrics and org list only</option>
                <option value="SUPER">Super — full access (founders only)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Account'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">
                  Email
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-wider text-[var(--muted)] pb-2 px-4">
                  Role
                </th>
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">
                  Last Login
                </th>
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 text-[var(--text)] font-medium">
                    {member.name}
                    {member.mustChangePassword && (
                      <span className="ml-2 text-[10px] bg-amber-900/30 text-amber-400 border border-amber-800 px-1.5 py-0.5 font-bold">
                        MUST CHANGE PW
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{member.email}</td>
                  <td className="py-3 pr-4 px-4">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 border ${
                        member.opsRole === 'SUPER'
                          ? 'border-[var(--accent)] text-[var(--accent)]'
                          : member.opsRole === 'BILLING'
                            ? 'border-blue-700 text-blue-400'
                            : member.opsRole === 'SUPPORT'
                              ? 'border-green-700 text-green-400'
                              : 'border-[var(--border)] text-[var(--muted)]'
                      }`}
                    >
                      {member.opsRole ?? 'SUPER'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {member.lastLoginAt
                      ? new Date(member.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 ${
                        member.isActive
                          ? 'text-green-400 bg-green-900/20 border border-green-800'
                          : 'text-red-400 bg-red-900/20 border border-red-800'
                      }`}
                    >
                      {member.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleActive(member)}
                      className={`text-xs font-medium transition-colors ${
                        member.isActive
                          ? 'text-[var(--muted)] hover:text-red-400'
                          : 'text-[var(--muted)] hover:text-green-400'
                      }`}
                    >
                      {member.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
