import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi, usePermission } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';

const PLAN_OPTS = ['free', 'trial', 'starter', 'growth', 'enterprise'];
const STATUS_OPTS = ['trialing', 'active', 'suspended', 'cancelled'];

const STATUS_COLOR: Record<string, string> = {
  trialing: 'text-yellow-400 border-yellow-800 bg-yellow-900/20',
  active: 'text-green-400 border-green-800 bg-green-900/20',
  suspended: 'text-red-400 border-red-800 bg-red-900/20',
  cancelled: 'text-gray-400 border-gray-700',
};

const PLAN_COLOR: Record<string, string> = {
  free: 'text-gray-400 border-gray-700 bg-gray-900/20',
  trial: 'text-yellow-400 border-yellow-800 bg-yellow-900/20',
  starter: 'text-blue-400 border-blue-800 bg-blue-900/20',
  growth: 'text-green-400 border-green-800 bg-green-900/20',
  enterprise: 'text-purple-400 border-purple-800 bg-purple-900/20',
};

export function OrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const api = useApi();
  const can = usePermission();
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTrialEnd, setEditTrialEnd] = useState('');

  const load = useCallback(async () => {
    const res = await api.get(`/api/ops/orgs/${orgId}`);
    if (res.success) {
      setOrg(res.data);
      setEditPlan(res.data.plan);
      setEditStatus(res.data.planStatus);
      setEditNotes(res.data.notes ?? '');
      setEditTrialEnd(
        res.data.trialEndsAt ? new Date(res.data.trialEndsAt).toISOString().slice(0, 10) : '',
      );
    }
    setLoading(false);
  }, [api, orgId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function save() {
    setSaving(true);
    setSuccess('');
    setError('');
    const body: any = { plan: editPlan, planStatus: editStatus, notes: editNotes };
    if (editTrialEnd) body.trialEndsAt = new Date(editTrialEnd).toISOString();
    const res = await api.patch(`/api/ops/orgs/${orgId}`, body);
    if (res.success) {
      setOrg((prev: any) => ({ ...prev, ...res.data }));
      setSuccess('Saved.');
    } else setError(res.error || 'Failed to save');
    setSaving(false);
  }

  async function quickAction(action: 'suspend' | 'activate' | 'delete') {
    if (action === 'delete') {
      if (
        !confirm(
          'Are you sure you want to schedule this organization for deletion in 30 days? This action will disable their access immediately.',
        )
      )
        return;
    }
    setSaving(true);
    setSuccess('');
    setError('');
    const res =
      (await action) === 'delete'
        ? await api.delete(`/api/ops/orgs/${orgId}`)
        : await api.post(`/api/ops/orgs/${orgId}/${action}`, {});

    if (res.success) {
      if (res.data) {
        setOrg((prev: any) => ({ ...prev, ...res.data }));
        setEditStatus(res.data.planStatus);
      }
      setSuccess(res.message);
    } else setError(res.error || 'Failed');
    setSaving(false);
  }

  async function impersonate() {
    setSaving(true);
    setSuccess('');
    setError('');
    const res = await api.post(`/api/ops/orgs/${orgId}/impersonate`, {});
    if (res.success) {
      const adminDashUrl =
        import.meta.env.VITE_ADMIN_DASHBOARD_URL ||
        (import.meta.env.PROD ? 'https://admin.cevop.com' : 'http://localhost:5175');
      window.open(`${adminDashUrl}?token=${res.data.token}`, '_blank');
      setSuccess('Impersonation session started.');
    } else {
      setError(res.error || 'Failed to impersonate');
    }
    setSaving(false);
  }

  async function assignTrial() {
    if (!confirm('Assign a 7-day Growth trial to this organisation?')) return;
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await api.patch(`/api/ops/orgs/${org.id}/plan`, {
      plan: 'trial',
      planStatus: 'trialing',
      trialEndsAt,
    });
    if (res.success) {
      setOrg((prev: any) => ({ ...prev, plan: 'trial', planStatus: 'trialing', trialEndsAt }));
      setSuccess('7-day trial assigned');
    } else {
      setError(res.error || 'Failed to assign trial');
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  if (!can('view_org_detail')) return <div className="text-red-400 p-8">Permission denied</div>;
  if (!org) return <div className="text-red-400 p-8">Organisation not found</div>;

  return (
    <div className="space-y-6 animate-in max-w-4xl">
      {/* Breadcrumb */}
      <Link
        to="/orgs"
        className="text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
      >
        ← All Organisations
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-[var(--text)]">{org.name}</h1>
          <p className="text-[var(--muted)] font-mono text-sm mt-0.5">{org.slug}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs px-2 py-0.5 border ${STATUS_COLOR[org.planStatus] ?? ''}`}>
              {org.planStatus}
            </span>
            <span className={`text-xs px-2 py-0.5 border uppercase ${PLAN_COLOR[org.plan] ?? ''}`}>
              {org.plan}
            </span>
            {org.selfSignup && (
              <span className="text-xs text-blue-400 border border-blue-800 px-1.5 py-0.5">
                Self-signup
              </span>
            )}
            {org.scheduledForDeletionAt && (
              <span className="text-xs text-red-400 border border-red-800 px-1.5 py-0.5">
                Deletes {new Date(org.scheduledForDeletionAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {can('assign_trial') && org.planStatus === 'active' && org.plan === 'free' && (
            <button onClick={assignTrial} className="btn btn-secondary text-xs px-3 py-1.5">
              Assign 7-Day Trial
            </button>
          )}
          {can('suspend_org') && org.planStatus !== 'suspended' && (
            <button
              onClick={() => quickAction('suspend')}
              disabled={saving}
              className="btn btn-danger btn-sm"
            >
              Suspend
            </button>
          )}
          {can('activate_org') &&
            (org.planStatus === 'suspended' || org.planStatus === 'trialing') && (
              <button
                onClick={() => quickAction('activate')}
                disabled={saving}
                className="btn btn-secondary btn-sm"
              >
                Activate
              </button>
            )}
          {can('delete_org') && org.planStatus !== 'cancelled' && (
            <button
              onClick={() => quickAction('delete')}
              disabled={saving}
              className="btn btn-danger btn-sm border-red-900 bg-red-900/10"
            >
              Delete Data
            </button>
          )}
          {can('impersonate') && (
            <button onClick={impersonate} disabled={saving} className="btn btn-secondary btn-sm">
              Login as Admin ↗
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider">Revenue</p>
          <p className="font-display text-3xl text-[var(--accent)] mt-1">
            {formatPrice(org.stats?.totalRevenue ?? 0, org.currency ?? 'NGN')}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider">Orders (30d)</p>
          <p className="font-display text-3xl mt-1">{org.stats?.ordersLast30Days ?? 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider">Total Orders</p>
          <p className="font-display text-3xl mt-1">{org._count?.orders ?? 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider">Tables</p>
          <p className="font-display text-3xl mt-1">{org._count?.tables ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan Management */}
        {can('manage_plans') && (
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-sm uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] pb-2">
              Plan & Status
            </h2>
            <div>
              <label htmlFor="ops_org_detail_plan">Plan</label>
              <select
                id="ops_org_detail_plan"
                name="plan"
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value)}
                autoComplete="off"
              >
                {PLAN_OPTS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ops_org_detail_status">Status</label>
              <select
                id="ops_org_detail_status"
                name="planStatus"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                autoComplete="off"
              >
                {STATUS_OPTS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ops_org_detail_trial_end">Trial End Date</label>
              <input
                id="ops_org_detail_trial_end"
                name="trialEndDate"
                type="date"
                value={editTrialEnd}
                onChange={(e) => setEditTrialEnd(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="ops_org_detail_internal_notes">Internal Notes</label>
              <textarea
                id="ops_org_detail_internal_notes"
                name="internalNotes"
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="resize-none"
                placeholder="Notes visible to ops team only"
              />
            </div>
            {success && <p className="text-green-400 text-sm">{success}</p>}
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={save}
              disabled={saving}
              className="btn btn-primary w-full py-2 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Org Info */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] pb-2">
            Organisation Info
          </h2>
          <InfoRow label="Contact Email" value={org.contactEmail || '—'} />
          <InfoRow label="Contact Phone" value={org.contactPhone || '—'} />
          <InfoRow label="Timezone" value={org.timezone} />
          <InfoRow label="Currency" value={org.currency} />
          <InfoRow label="Created" value={new Date(org.createdAt).toLocaleString()} />
          <InfoRow
            label="Verified At"
            value={org.verifiedAt ? new Date(org.verifiedAt).toLocaleString() : 'Not yet'}
          />
        </div>
      </div>

      {/* Branches */}
      {org.branches?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Branches ({org.branches.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Users</th>
                  <th>Orders</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {org.branches.map((b: any) => (
                  <tr key={b.id}>
                    <td className="font-medium">{b.name}</td>
                    <td className="font-mono text-xs text-[var(--muted)]">{b.slug}</td>
                    <td className="text-center text-[var(--muted)]">{b._count?.users}</td>
                    <td className="text-center text-[var(--muted)]">{b._count?.orders}</td>
                    <td>
                      <span className={`text-xs ${b.isActive ? 'text-green-400' : 'text-red-400'}`}>
                        {b.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Admins */}
      {org.users?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Admin Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[800px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Last Login</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {org.users.map((u: any) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.name}</td>
                    <td className="text-[var(--muted)] text-sm">{u.email}</td>
                    <td className="text-xs">
                      <span
                        className={`border px-2 py-0.5 ${u.role === 'ADMIN' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-blue-700 text-blue-400'}`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="text-xs text-[var(--muted)]">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                    </td>
                    <td>
                      <span className={`text-xs ${u.isActive ? 'text-green-400' : 'text-red-400'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-[var(--text)] font-medium">{value}</span>
    </div>
  );
}
