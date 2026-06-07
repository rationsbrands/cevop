import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getSummary, getMovements } from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

const TYPE_COLOR: Record<string, string> = {
  PURCHASE_RECEIPT: 'var(--success)',
  SALE: 'var(--info)',
  MANUAL_ADJUSTMENT: 'var(--warning)',
  WRITE_OFF: 'var(--danger)',
  TRANSFER_IN: 'var(--success)',
  TRANSFER_OUT: 'var(--danger)',
  STOCKTAKE_ADJUSTMENT: 'var(--warning)',
  PRODUCTION_IN: 'var(--success)',
  PRODUCTION_OUT: 'var(--danger)',
};

export default function DashboardPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const { data: summaryRes, loading: sLoading } = useApi(
    () => getSummary(token!, branchId),
    [token, branchId],
  );
  const { data: movementsRes, loading: mLoading } = useApi(
    () => getMovements(token!, { branchId, limit: 8 }),
    [token, branchId],
  );

  const summary = summaryRes?.data;
  const movements = movementsRes?.data ?? [];

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Inventory
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch from the sidebar to view and manage inventory for that branch.
        </p>
      </div>
    );

  const stats = [
    {
      label: 'Total Items',
      value: sLoading ? '…' : String(summary?.totalItems ?? 0),
      sub: 'active stock items',
      color: 'var(--info)',
    },
    {
      label: 'Low Stock',
      value: sLoading ? '…' : String(summary?.lowStockCount ?? 0),
      sub: 'below reorder point',
      color: 'var(--warning)',
    },
    {
      label: 'Out of Stock',
      value: sLoading ? '…' : String(summary?.outOfStockCount ?? 0),
      sub: 'need restocking now',
      color: 'var(--danger)',
    },
    {
      label: 'Stock Value',
      value: sLoading ? '…' : formatCurrency(summary?.totalStockValue ?? 0, currency),
      sub: 'total at cost price',
      color: 'var(--success)',
    },
  ];

  const actions = [
    { label: 'Add New Item', desc: 'Register a stock item', href: '/inventory/items' },
    { label: 'Record Wastage', desc: 'Log damaged or expired stock', href: '/inventory/wastage' },
    {
      label: 'New Purchase Order',
      desc: 'Order from a supplier',
      href: '/inventory/purchase-orders',
    },
    { label: 'Start Stocktake', desc: 'Begin a physical count', href: '/inventory/stocktake' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div
              className="text-xs font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--muted)' }}
            >
              {s.label}
            </div>
            <div className="text-2xl font-black mb-1" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Low stock items */}
        <div className="xl:col-span-2 card">
          <div className="card-header">
            <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              Low Stock Alerts
            </span>
          </div>
          {sLoading ? (
            <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
              Loading…
            </div>
          ) : (summary?.lowStockItems?.length ?? 0) === 0 ? (
            <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
              All items are well stocked.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Current Stock</th>
                  <th>Reorder Point</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {summary!.lowStockItems.map((item) => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.name}</td>
                    <td>
                      {Number(item.currentStock)} {item.unitOfMeasure}
                    </td>
                    <td>
                      {Number(item.reorderPoint)} {item.unitOfMeasure}
                    </td>
                    <td>
                      <span className={`badge badge-${item.stockStatus}`}>{item.stockStatus}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Quick actions */}
        <div className="card p-5 space-y-3">
          <div className="font-semibold text-sm mb-2" style={{ color: 'var(--text)' }}>
            Quick Actions
          </div>
          {actions.map((a) => (
            <a
              key={a.label}
              href={a.href}
              className="block p-3 rounded-lg transition-colors hover:bg-[var(--surface2)] no-underline"
              style={{ border: '1px solid var(--border)' }}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {a.label}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {a.desc}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Recent movements */}
      <div className="card">
        <div className="card-header">
          <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
            Recent Stock Movements
          </span>
        </div>
        {mLoading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            Loading…
          </div>
        ) : movements.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No movements yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.item?.name ?? '—'}</td>
                  <td>
                    <span
                      className="text-xs font-semibold"
                      style={{ color: TYPE_COLOR[m.type] ?? 'var(--muted)' }}
                    >
                      {m.type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td
                    className="py-2.5 pr-4 font-mono text-xs font-semibold"
                    style={{ color: Number(m.quantity) >= 0 ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {Number(m.quantity) >= 0 ? '+' : ''}
                    {Number(m.quantity)} {m.item?.unitOfMeasure}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(m.createdAt).toLocaleDateString('en-NG')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
