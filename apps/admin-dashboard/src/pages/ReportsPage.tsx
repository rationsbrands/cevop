import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, useApi } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SummaryData {
  todayOrders: number;
  totalRevenue: number;
  activeOrders: number;
  popularItems: Array<{
    menuItem: { name: string } | null;
    totalQuantity: number | null;
  }>;
}

interface BranchData {
  id: string;
  name: string;
  totalRevenue: number;
  todayOrders: number;
  activeOrders: number;
}

interface TimelineEntry {
  date: string;
  revenue: number;
  orders: number;
}

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${accent ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-[var(--muted)] mt-1">{sub}</p>}
    </div>
  );
}

// Mini bar chart using pure CSS/SVG — no dependencies
function RevenueChart({ timeline, currency }: { timeline: TimelineEntry[]; currency: string }) {
  const [view, setView] = useState<'7d' | '30d'>('7d');

  if (!timeline.length) return null;

  const last7 = timeline.slice(-7);
  const last30 = timeline;

  const data = view === '7d' ? last7 : last30;
  const max = Math.max(...data.map((t) => t.revenue), 1);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Revenue Over Time
        </p>
        <div className="flex gap-1">
          {(['7d', '30d'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs px-2 py-1 border transition-colors ${
                view === v
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)]'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-1 h-32">
        {data.map((entry) => {
          const heightPct = max > 0 ? (entry.revenue / max) * 100 : 0;
          const dateLabel = new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
          return (
            <div
              key={entry.date}
              className="flex-1 flex flex-col items-center gap-1 group relative"
              title={`${dateLabel}: ${formatPrice(entry.revenue, currency)} (${entry.orders} orders)`}
            >
              <div className="w-full flex items-end justify-center" style={{ height: '112px' }}>
                <div
                  className="w-full bg-[var(--accent)] opacity-80 group-hover:opacity-100 transition-all"
                  style={{ height: `${Math.max(heightPct, 2)}%` }}
                />
              </div>
              {data.length <= 7 && (
                <p className="text-[9px] text-[var(--muted)] whitespace-nowrap">
                  {dateLabel.split(' ')[1]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {data.length > 7 && (
        <div className="flex justify-between mt-1">
          <p className="text-[9px] text-[var(--muted)]">
            {new Date(data[0].date + 'T00:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </p>
          <p className="text-[9px] text-[var(--muted)]">
            {new Date(data[data.length - 1].date + 'T00:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ReportsPage() {
  const { user, token } = useAuth();
  const api = useApi();

  const role = user?.role ?? '';
  const isAuditor = role === 'ORG_AUDITOR';
  const isFinance = ['ORG_FINANCE', 'BRANCH_FINANCE'].includes(role);
  const isOrgWide = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'ORG_FINANCE', 'ORG_AUDITOR'].includes(
    role,
  );
  const currency = user?.organization?.currency ?? 'NGN';

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [branches, setBranches] = useState<BranchData[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportDays, setExportDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryRes, timelineRes] = await Promise.all([
        api.get('/api/orders/analytics/summary'),
        api.get('/api/orders/analytics/revenue-timeline'),
      ]);

      if (summaryRes.success) setSummary(summaryRes.data);
      if (timelineRes.success) setTimeline(timelineRes.data);

      // Org-wide roles also see per-branch breakdown
      if (isOrgWide) {
        const orgRes = await api.get('/api/orders/analytics/org-dashboard');
        if (orgRes.success) setBranches(orgRes.data?.branches ?? []);
      }
    } catch {
      setError('Failed to load reports. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, [api, isOrgWide]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function handleExportCSV() {
    setExporting(true);
    try {
      const from = new Date();
      from.setDate(from.getDate() - exportDays);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = new Date().toISOString().slice(0, 10);

      const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/orders/export/csv?from=${fromStr}&to=${toStr}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cevop-orders-${fromStr}-to-${toStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-red-400">{error}</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Reports</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {isAuditor
              ? 'Read-only financial overview for audit purposes.'
              : isFinance
                ? 'Revenue summary and financial data for your location.'
                : 'Revenue and order analytics across your operation.'}
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-3 py-1.5 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Revenue"
            value={formatPrice(summary.totalRevenue, currency)}
            sub="All time, non-cancelled orders"
            accent
          />
          <StatCard
            label="Today's Orders"
            value={String(summary.todayOrders)}
            sub="Orders placed today"
          />
          <StatCard
            label="Active Orders"
            value={String(summary.activeOrders)}
            sub="Currently in progress"
          />
          <StatCard
            label="Top Item"
            value={summary.popularItems[0]?.menuItem?.name ?? '—'}
            sub={
              summary.popularItems[0]?.totalQuantity
                ? `${summary.popularItems[0].totalQuantity} sold`
                : 'No orders yet'
            }
          />
        </div>
      )}

      {/* Revenue chart */}
      {timeline.length > 0 && <RevenueChart timeline={timeline} currency={currency} />}

      {/* Popular items */}
      {summary && summary.popularItems.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-4">
            Top Menu Items (All Time)
          </p>
          <div className="space-y-2">
            {summary.popularItems.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[var(--muted)] w-4">{i + 1}</span>
                  <span className="text-sm text-[var(--text)]">
                    {item.menuItem?.name ?? 'Unknown item'}
                  </span>
                </div>
                <span className="text-sm font-bold text-[var(--accent)]">
                  {item.totalQuantity ?? 0} sold
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-branch breakdown — org-wide roles only */}
      {isOrgWide && branches.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-4">
            Revenue by Branch
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left pb-2 text-[var(--muted)] font-bold text-xs uppercase tracking-wider">
                    Branch
                  </th>
                  <th className="text-right pb-2 text-[var(--muted)] font-bold text-xs uppercase tracking-wider">
                    Total Revenue
                  </th>
                  <th className="text-right pb-2 text-[var(--muted)] font-bold text-xs uppercase tracking-wider">
                    Today
                  </th>
                  <th className="text-right pb-2 text-[var(--muted)] font-bold text-xs uppercase tracking-wider">
                    Active
                  </th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-3 text-[var(--text)] font-medium">{b.name}</td>
                    <td className="py-3 text-right text-[var(--accent)] font-bold">
                      {formatPrice(b.totalRevenue, currency)}
                    </td>
                    <td className="py-3 text-right text-[var(--text)]">{b.todayOrders}</td>
                    <td className="py-3 text-right text-[var(--text)]">{b.activeOrders}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)]">
                  <td className="pt-3 font-bold text-[var(--text)]">Total</td>
                  <td className="pt-3 text-right font-bold text-[var(--accent)]">
                    {formatPrice(
                      branches.reduce((sum, b) => sum + b.totalRevenue, 0),
                      currency,
                    )}
                  </td>
                  <td className="pt-3 text-right font-bold text-[var(--text)]">
                    {branches.reduce((sum, b) => sum + b.todayOrders, 0)}
                  </td>
                  <td className="pt-3 text-right font-bold text-[var(--text)]">
                    {branches.reduce((sum, b) => sum + b.activeOrders, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* CSV Export — not for read-only auditor */}
      {!isAuditor && (
        <div className="bg-[var(--surface)] border border-[var(--border)] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] mb-4">
            Export Orders
          </p>
          <div className="flex items-center gap-3">
            <div>
              <label className="text-xs text-[var(--muted)] block mb-1">Date range</label>
              <select
                value={exportDays}
                onChange={(e) => setExportDays(Number(e.target.value))}
                className="bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--text)] px-3 py-1.5 focus:outline-none focus:border-[var(--accent)]"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 365 days</option>
              </select>
            </div>
            <div className="mt-4">
              <button
                onClick={handleExportCSV}
                disabled={exporting}
                className="px-4 py-1.5 text-sm border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting ? 'Exporting…' : 'Download CSV'}
              </button>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)] mt-2">
            Downloads all orders in the selected date range as a CSV file.
          </p>
        </div>
      )}

      {/* Auditor note */}
      {isAuditor && (
        <div className="border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--muted)]">
            You have read-only access to financial data. To export order data, contact your
            organisation admin.
          </p>
        </div>
      )}
    </div>
  );
}
