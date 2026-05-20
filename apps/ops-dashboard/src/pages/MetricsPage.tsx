import React, { useEffect, useState } from 'react';
import { useApi } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';

interface Metrics {
  orgs: { total: number; active: number; trialing: number; suspended: number; selfSignup: number; newThisMonth: number; free: number };
  users: { total: number };
  orders: { total: number; today: number };
  branches: { total: number };
  revenue: { total: number };
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="card p-5">
      <p className="text-xs text-[var(--muted)] uppercase tracking-widest font-semibold">{label}</p>
      <p className={`font-display text-4xl mt-1 ${accent ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--muted)] mt-1">{sub}</p>}
    </div>
  );
}

export function MetricsPage() {
  const api = useApi();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/api/ops/metrics'),
      api.get('/api/ops/trials/expiring'),
      api.get('/api/ops/activity'),
    ]).then(([m, e, a]) => {
      if (m.success) setMetrics(m.data);
      if (e.success) setExpiring(e.data);
      if (a.success) setActivity(a.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-48"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>;

  const PLAN_COLOR: Record<string, string> = {
    trialing: 'text-yellow-400 border-yellow-800 bg-yellow-900/20',
    active: 'text-green-400 border-green-800 bg-green-900/20',
    suspended: 'text-red-400 border-red-800 bg-red-900/20',
    cancelled: 'text-gray-400 border-gray-700 bg-gray-900/20',
  };

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="font-display text-4xl">PLATFORM OVERVIEW</h1>
        <p className="text-[var(--muted)] text-sm mt-0.5">Live across all Cevop organisations</p>
      </div>

      {/* Primary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Orgs" value={metrics?.orgs.total ?? 0} sub={`${metrics?.orgs.newThisMonth ?? 0} new this month`} accent />
        <StatCard label="Active" value={metrics?.orgs.active ?? 0} sub="Paying customers" />
        <StatCard label="On Trial" value={metrics?.orgs.trialing ?? 0} sub="7-day trial" />
        <StatCard label="Free Tier" value={metrics?.orgs.free ?? 0} sub="Forever free" />
        <StatCard label="Total Revenue" value={formatPrice(metrics?.revenue.total ?? 0)} sub="All time, all orgs" accent />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={metrics?.users.total ?? 0} sub="Across all orgs" />
        <StatCard label="Total Orders" value={metrics?.orders.total ?? 0} sub="All time" />
        <StatCard label="Orders Today" value={metrics?.orders.today ?? 0} sub="Platform-wide" accent />
        <StatCard label="Active Branches" value={metrics?.branches.total ?? 0} sub="Across all orgs" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trials expiring */}
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Trials Expiring Soon</h2>
            <span className="text-xs text-[var(--muted)]">{expiring.length} orgs</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {expiring.length === 0 && <p className="card-body text-[var(--muted)] text-sm">None expiring soon — good.</p>}
            {expiring.map((org: any) => (
              <div key={org.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-[var(--text)]">{org.name}</p>
                  <p className="text-xs text-[var(--muted)]">{org._count?.orders} orders · {org._count?.users} users</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-yellow-400 font-semibold">{org.trialEndsAt ? new Date(org.trialEndsAt).toLocaleDateString() : '—'}</p>
                  <a href={`/orgs/${org.id}`} className="text-xs text-[var(--accent)] hover:underline">View →</a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent signups */}
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Recent Organisations</h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {(activity?.recentOrgs ?? []).map((org: any) => (
              <div key={org.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-[var(--text)]">{org.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[var(--muted)] font-mono">{org.slug}</span>
                    {org.selfSignup && <span className="text-xs text-blue-400 border border-blue-800 px-1">self-signup</span>}
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-0.5 border ${PLAN_COLOR[org.planStatus] ?? 'text-[var(--muted)] border-[var(--border)]'}`}>{org.planStatus}</span>
                  <p className="text-xs text-[var(--muted)] mt-1">{new Date(org.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
