import React, { useState, useEffect } from 'react';
import { useApi } from '../context/auth';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function TeamPage() {
  const api = useApi();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadTeam() {
    setLoading(true);
    try {
      const res = await api.get('/api/ops/team');
      if (res.success) setTeam(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTeam(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await api.post('/api/ops/team', form);
      if (!res.success) { setError(res.error || 'Failed to create account'); return; }
      setSuccess(`Account created for ${form.email}. They must change their password on first login.`);
      setForm({ name: '', email: '', password: '' });
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
    if (!confirm(`${action === 'deactivate' ? 'Deactivate' : 'Reactivate'} ${member.name}?`)) return;
    try {
      const res = await api.patch(`/api/ops/team/${member.id}`, { isActive: !member.isActive });
      if (res.success) await loadTeam();
      else setError(res.error || 'Failed to update');
    } catch {
      setError('Something went wrong');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl text-[var(--text)]">Ops Team</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Manage Cevop operator accounts.</p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setError(''); setSuccess(''); }}
          className="btn btn-primary px-4 py-2 text-sm"
        >
          {showForm ? 'Cancel' : '+ Add Member'}
        </button>
      </div>

      {error && <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 text-sm">{error}</div>}
      {success && <div className="bg-green-900/20 border border-green-800 text-green-400 px-4 py-3 text-sm">{success}</div>}

      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold text-[var(--text)] mb-4">New Ops Account</h2>
          <form onSubmit={handleCreate} className="space-y-4 max-w-md">
            <div>
              <label>Full Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(v => ({ ...v, name: e.target.value }))}
                required
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(v => ({ ...v, email: e.target.value }))}
                required
                placeholder="jane@cevop.com"
              />
            </div>
            <div>
              <label>Temporary Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(v => ({ ...v, password: e.target.value }))}
                  required
                  className="pr-10"
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
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
            <button type="submit" disabled={saving} className="btn btn-primary px-6 py-2 text-sm disabled:opacity-50">
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
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">Last Login</th>
                <th className="text-left px-4 py-3 text-[var(--muted)] font-medium text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {team.map(member => (
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
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {member.lastLoginAt
                      ? new Date(member.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 ${
                      member.isActive
                        ? 'text-green-400 bg-green-900/20 border border-green-800'
                        : 'text-red-400 bg-red-900/20 border border-red-800'
                    }`}>
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
