import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getItems, getCategories, type InventoryItem } from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

export default function ItemsPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const {
    data: itemsRes,
    loading,
    error,
    refetch,
  } = useApi(
    () =>
      getItems(token!, {
        branchId,
        search: search || undefined,
        categoryId: categoryId || undefined,
        status: statusFilter || undefined,
      }),
    [token, branchId, search, categoryId, statusFilter],
  );
  const { data: catsRes } = useApi(() => getCategories(token!), [token]);

  const items: InventoryItem[] = itemsRes?.data ?? [];
  const categories = catsRes?.data ?? [];

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Items
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch to manage its inventory items.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${items.length} items`}
        </p>
        <button className="btn btn-primary btn-sm">+ Add Item</button>
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

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="search"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '220px' }}
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">All statuses</option>
          <option value="ok">OK</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            Loading items…
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No items found.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Stock</th>
                <th>Reorder At</th>
                <th>Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium">{item.name}</td>
                  <td className="font-mono text-xs" style={{ color: 'var(--muted)' }}>
                    {item.sku ?? '—'}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{item.category?.name ?? '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{item.unitOfMeasure}</td>
                  <td
                    className="font-semibold"
                    style={{
                      color:
                        item.stockStatus === 'out'
                          ? 'var(--danger)'
                          : item.stockStatus === 'low'
                            ? 'var(--warning)'
                            : 'var(--success)',
                    }}
                  >
                    {Number(item.currentStock)}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{Number(item.reorderPoint)}</td>
                  <td>{formatCurrency(item.costPrice, currency)}</td>
                  <td>
                    <span className={`badge badge-${item.stockStatus}`}>{item.stockStatus}</span>
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
