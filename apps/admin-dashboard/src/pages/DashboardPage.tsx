import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApi } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';
import { AutoFitText } from '../components/AutoFitText';

interface Summary {
  todayOrders: number;
  totalRevenue: number;
  activeOrders: number;
  popularItems: Array<{ menuItem?: { name: string }; totalQuantity: number }>;
}

interface OrgBranchStat {
  id: string;
  name: string;
  todayOrders: number;
  activeOrders: number;
  totalRevenue: number;
}

interface OrgDashboardData {
  summary: Summary;
  branches: OrgBranchStat[];
  staffCount: number;
  recentOrders: Array<{
    id: string;
    status: string;
    total: number;
    createdAt: string;
    branch?: { id: string; name: string } | null;
    table?: { id: string; label: string; number: number } | null;
    _count?: { items: number };
  }>;
}

interface AuditLogItem {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: any;
  createdAt: string;
  ipAddress?: string | null;
  user?: { id: string; name: string; email: string } | null;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-5 flex flex-col justify-between min-h-[140px] h-full overflow-hidden">
      <div>
        <AutoFitText
          className="text-[var(--muted)] uppercase tracking-widest font-extrabold mb-1"
          maxFontSize="10px"
          minFontSize="7px"
        >
          {label}
        </AutoFitText>
        <AutoFitText className="font-display text-[var(--accent)]">{value}</AutoFitText>
      </div>
      {sub && (
        <AutoFitText
          className="text-[var(--muted)] mt-2 font-medium"
          maxFontSize="11px"
          minFontSize="8px"
        >
          {sub}
        </AutoFitText>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const api = useApi();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [orgDashboard, setOrgDashboard] = useState<OrgDashboardData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(
    async (isSilent = false, cancelled = false) => {
      if (!isSilent) setLoading(true);
      else setSyncing(true);

      try {
        const role = user?.role ?? '';
        const isAuditor = role === 'ORG_AUDITOR';

        if (isAuditor) {
          const logsRes = await api.get('/api/orgs/audit?limit=50');
          if (!cancelled && logsRes.success) setAuditLogs(logsRes.data ?? []);
          return;
        }

        if (!api.effectiveBranchId) {
          const orgRes = await api.get('/api/orders/analytics/org-dashboard');
          if (!cancelled && orgRes.success) {
            setOrgDashboard(orgRes.data);
            setSummary(orgRes.data?.summary ?? null);
            setRecentOrders(orgRes.data?.recentOrders ?? []);
          }
          return;
        }

        const [sumRes, ordersRes] = await Promise.all([
          api.get('/api/orders/analytics/summary'),
          api.get('/api/orders?limit=10'),
        ]);
        if (!cancelled) {
          if (sumRes.success) setSummary(sumRes.data);
          if (ordersRes.success) setRecentOrders(ordersRes.data);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSyncing(false);
        }
      }
    },
    [api, user?.role],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load(false, cancelled).catch(() => void 0);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Background Heartbeat Sync (Industry Standard)
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine && !cancelled) {
        load(true, cancelled);
      }
    }, 60000); // Every 60 seconds
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [load]);

  const SC: Record<string, string> = {
    RECEIVED: 'text-blue-400',
    PREPARING: 'text-yellow-400',
    READY: 'text-green-400',
    SERVED: 'text-gray-500',
    CANCELLED: 'text-red-400',
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  const role = user?.role ?? '';
  const currency = user?.organization?.currency ?? 'NGN';
  const title =
    role === 'ORG_AUDITOR'
      ? 'AUDIT DASHBOARD'
      : role === 'ORG_FINANCE' || role === 'BRANCH_FINANCE'
        ? 'FINANCE DASHBOARD'
        : role === 'ORG_MANAGER'
          ? 'OPERATIONS DASHBOARD'
          : role === 'CASHIER'
            ? 'CASHIER DASHBOARD'
            : role === 'HOST'
              ? 'HOST DASHBOARD'
              : 'DASHBOARD';

  if (role === 'ORG_AUDITOR') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const loginsToday = auditLogs.filter(
      (l) => l.action === 'LOGIN' && new Date(l.createdAt).getTime() >= today.getTime(),
    ).length;

    return (
      <div className="space-y-6 animate-in">
        <div>
          <h1 className="font-display text-4xl">{title}</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">Welcome back, {user?.name}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Logins Today" value={loginsToday} sub="Across the organisation" />
          <StatCard label="Recent Events" value={auditLogs.length} sub="Showing latest 50" />
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Audit Trail</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[860px]">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Entity</th>
                  <th>Entity ID</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                      No audit events yet
                    </td>
                  </tr>
                )}
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="text-[var(--muted)] text-xs">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="font-semibold text-[var(--accent)]">
                      {l.action === 'IMPERSONATE_ORG' ? 'SUPPORT_ACCESS' : l.action}
                    </td>
                    <td className="text-sm">
                      {l.action === 'IMPERSONATE_ORG' ? (
                        <span className="font-medium">Cevop Support</span>
                      ) : l.user?.email ? (
                        <span className="font-medium">{l.user.email}</span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="text-[var(--muted)] text-sm">{l.entity}</td>
                    <td className="font-mono text-xs text-[var(--muted)]">{l.entityId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  const orgMode = !api.effectiveBranchId;

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">{title}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[var(--muted)] text-sm">Welcome back, {user?.name}</p>
            {syncing && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-bold animate-pulse">
                <span className="w-1 h-1 rounded-full bg-[var(--accent)]" />
                SYNCING...
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={syncing || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--surface2)] text-[var(--text)] text-xs font-bold hover:bg-[var(--surface3)] transition-all disabled:opacity-50 group"
        >
          <span
            className={`transition-transform duration-500 ${syncing ? 'animate-spin' : 'group-hover:rotate-180'}`}
          >
            ⟳
          </span>
          REFRESH
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Orders Today" value={summary?.todayOrders ?? 0} />
        <StatCard
          label="Active Orders"
          value={summary?.activeOrders ?? 0}
          sub={orgMode ? 'Across the organisation' : 'In progress now'}
        />
        <StatCard
          label="Total Revenue"
          value={formatPrice(summary?.totalRevenue ?? 0, currency)}
          sub={orgMode ? 'Across all branches' : 'All time'}
        />
        <StatCard
          label="Top Item"
          value={summary?.popularItems?.[0]?.menuItem?.name ?? '—'}
          sub={(summary?.popularItems?.[0]?.totalQuantity ?? 0) + ' sold'}
        />
      </div>

      {orgMode && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Branches"
            value={orgDashboard?.branches?.length ?? 0}
            sub="Active branches"
          />
          <StatCard label="Staff" value={orgDashboard?.staffCount ?? 0} sub="Active staff" />
          <Link to="/reports" className="card p-5 hover:bg-[var(--surface2)] transition-colors">
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-extrabold mb-1">
              Reports
            </div>
            <div className="text-sm font-semibold text-[var(--text)]">
              Organisation-wide reports
            </div>
          </Link>
          <Link to="/branches" className="card p-5 hover:bg-[var(--surface2)] transition-colors">
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-extrabold mb-1">
              Branches
            </div>
            <div className="text-sm font-semibold text-[var(--text)]">Manage branches</div>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(role === 'ORG_OWNER' ||
          role === 'ADMIN' ||
          role === 'BRANCH_ADMIN' ||
          role === 'ORG_MANAGER') &&
          !orgMode && (
            <>
              <Link to="/orders" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
                <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                  Orders
                </div>
                <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                  View and manage orders
                </div>
              </Link>
              <Link to="/users" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
                <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                  Staff
                </div>
                <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                  Create and assign roles
                </div>
              </Link>
              <Link to="/menu" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
                <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                  Menu
                </div>
                <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                  Manage items and categories
                </div>
              </Link>
              <Link to="/tables" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
                <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                  Tables
                </div>
                <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                  QR codes and tables
                </div>
              </Link>
            </>
          )}

        {(role === 'ORG_FINANCE' || role === 'BRANCH_FINANCE') && (
          <Link to="/reports" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
            <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
              Finance
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">
              Review revenue and reports
            </div>
          </Link>
        )}

        {role === 'CASHIER' && !orgMode && (
          <>
            <Link
              to="/register"
              className="card p-4 border-[var(--accent)]/40 bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10 transition-colors"
            >
              <div className="text-xs text-[var(--accent)] uppercase font-bold tracking-widest">
                Register
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                Ring up counter & takeaway sales
              </div>
            </Link>
            <Link to="/cashier" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Cashier
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                Settle table bills and payments
              </div>
            </Link>
            <Link to="/orders" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Orders
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                View current orders
              </div>
            </Link>
          </>
        )}

        {role === 'HOST' && !orgMode && (
          <>
            <Link to="/orders" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Orders
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                View and manage orders
              </div>
            </Link>
            <Link to="/sections" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Sections
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                Floor plan and seating
              </div>
            </Link>
            <Link to="/tables" className="card p-4 hover:bg-[var(--surface2)] transition-colors">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Tables
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                QR codes and status
              </div>
            </Link>
          </>
        )}
      </div>
      {orgMode && (orgDashboard?.branches?.length ?? 0) > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Branch Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px]">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Orders Today</th>
                  <th>Active Orders</th>
                  <th>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(orgDashboard?.branches ?? []).map((b) => (
                  <tr key={b.id}>
                    <td className="font-medium">{b.name}</td>
                    <td className="text-[var(--text)]">{b.todayOrders}</td>
                    <td className="text-[var(--text)]">{b.activeOrders}</td>
                    <td className="text-[var(--accent)] font-semibold">
                      {formatPrice(b.totalRevenue, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">
              {orgMode ? 'Recent Orders (All Branches)' : 'Recent Orders'}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className={orgMode ? 'min-w-[860px]' : 'min-w-[720px]'}>
              <thead>
                <tr>
                  <th>Order ID</th>
                  {orgMode && <th>Branch</th>}
                  <th>Table</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={orgMode ? 7 : 6} className="text-center text-[var(--muted)] py-6">
                      No orders yet
                    </td>
                  </tr>
                )}
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs text-[var(--muted)]">
                      {o.id.slice(-6).toUpperCase()}
                    </td>
                    {orgMode && <td className="font-medium">{o.branch?.name ?? '—'}</td>}
                    <td className="font-medium">{o.table?.label || '—'}</td>
                    <td className="text-[var(--muted)]">
                      {(o._count?.items ?? o.items?.length ?? 0) + ' item(s)'}
                    </td>
                    <td className="text-[var(--accent)] font-semibold">
                      {formatPrice(o.total, currency)}
                    </td>
                    <td>
                      <span className={'text-xs font-bold ' + (SC[o.status] || '')}>
                        {o.status}
                      </span>
                    </td>
                    <td className="text-[var(--muted)] text-xs">
                      {new Date(o.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Top Items</h2>
          </div>
          <div className="card-body space-y-3">
            {(summary?.popularItems ?? []).length === 0 && (
              <p className="text-[var(--muted)] text-sm">No data yet</p>
            )}
            {(summary?.popularItems ?? []).map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)] w-4">#{i + 1}</span>
                  <span className="text-sm font-medium">{item.menuItem?.name ?? '—'}</span>
                </div>
                <span className="text-xs text-[var(--accent)] font-bold">
                  {item.totalQuantity} sold
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
