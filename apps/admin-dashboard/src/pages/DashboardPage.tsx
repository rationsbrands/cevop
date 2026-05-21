import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';

interface Summary {
  todayOrders: number;
  totalRevenue: number;
  activeOrders: number;
  popularItems: Array<{ menuItem?: { name: string }; totalQuantity: number }>;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  const str = String(value);
  return (
    <div className="card p-5 flex flex-col justify-between min-h-[140px] h-full overflow-hidden">
      <div>
        <p className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-extrabold mb-1 truncate">
          {label}
        </p>
        <div style={{ containerType: 'inline-size' }} className="w-full">
          <p
            className="font-display whitespace-nowrap leading-tight text-[var(--accent)]"
            style={{
              fontSize: `clamp(1rem, 100cqi / (${Math.max(str.length, 5)} * 0.55), 1.875rem)`,
            }}
            title={str}
          >
            {value}
          </p>
        </div>
      </div>
      {sub && <p className="text-[11px] text-[var(--muted)] mt-2 font-medium truncate">{sub}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { user, activeBranchFilter } = useAuth();
  const api = useApi();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [sumRes, ordersRes] = await Promise.all([
          api.get('/api/orders/analytics/summary'),
          api.get('/api/orders?limit=10'),
        ]);
        if (sumRes.success) setSummary(sumRes.data);
        if (ordersRes.success) setRecentOrders(ordersRes.data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeBranchFilter]);

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

  return (
    <div className="space-y-6 animate-in">
      <div>
        <h1 className="font-display text-4xl">DASHBOARD</h1>
        <p className="text-[var(--muted)] text-sm mt-0.5">Welcome back, {user?.name}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Orders Today" value={summary?.todayOrders ?? 0} />
        <StatCard label="Active Orders" value={summary?.activeOrders ?? 0} sub="In progress now" />
        <StatCard
          label="Total Revenue"
          value={formatPrice(summary?.totalRevenue ?? 0)}
          sub="All time"
        />
        <StatCard
          label="Top Item"
          value={summary?.popularItems?.[0]?.menuItem?.name ?? '—'}
          sub={(summary?.popularItems?.[0]?.totalQuantity ?? 0) + ' sold'}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <h2 className="font-semibold text-sm">Recent Orders</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px]">
              <thead>
                <tr>
                  <th>Order ID</th>
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
                    <td colSpan={6} className="text-center text-[var(--muted)] py-6">
                      No orders yet
                    </td>
                  </tr>
                )}
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs text-[var(--muted)]">
                      #{o.id.slice(-6).toUpperCase()}
                    </td>
                    <td className="font-medium">{o.table?.label || '—'}</td>
                    <td className="text-[var(--muted)]">{o.items?.length ?? 0} item(s)</td>
                    <td className="text-[var(--accent)] font-semibold">{formatPrice(o.total)}</td>
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
