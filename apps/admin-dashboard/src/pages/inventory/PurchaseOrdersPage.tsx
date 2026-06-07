import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getPurchaseOrders } from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

const STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
];

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-draft',
  SUBMITTED: 'badge-info',
  APPROVED: 'badge-ok',
  SENT: 'badge-info',
  PARTIALLY_RECEIVED: 'badge-low',
  RECEIVED: 'badge-ok',
  CANCELLED: 'badge-out',
};

export default function PurchaseOrdersPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';
  const [statusFilter, setStatusFilter] = useState('');

  const { data, loading, error, refetch } = useApi(
    () => getPurchaseOrders(token!, { status: statusFilter || undefined }),
    [token, branchId, statusFilter],
  );
  const orders = data?.data ?? [];

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Purchase Orders
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch to manage its purchase orders.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-3 flex-wrap items-center">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {loading ? 'Loading…' : `${orders.length} orders`}
          </p>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary btn-sm">+ New Purchase Order</button>
      </div>

      {error && (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
        >
          {error}{' '}
          <button onClick={refetch} className="underline ml-1">
            Retry
          </button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            Loading orders…
          </div>
        ) : orders.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No purchase orders yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>PO #</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Items</th>
                <th>Total</th>
                <th>Expected</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id}>
                  <td className="font-mono text-xs font-semibold">
                    {po.poNumber ?? po.id.slice(0, 8)}
                  </td>
                  <td className="font-medium">{po.supplier?.name ?? '—'}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[po.status] ?? 'badge-draft'}`}>
                      {po.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{po.lines.length} lines</td>
                  <td className="font-semibold">{formatCurrency(po.total, currency)}</td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {po.expectedDelivery
                      ? new Date(po.expectedDelivery).toLocaleDateString('en-NG')
                      : '—'}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(po.createdAt).toLocaleDateString('en-NG')}
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
