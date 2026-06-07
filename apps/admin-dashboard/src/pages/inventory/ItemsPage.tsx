import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import {
  getItems,
  getCategories,
  createItem,
  updateItem,
  type InventoryItem,
  type UOM,
} from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

const UOM_OPTIONS: UOM[] = [
  'KG',
  'G',
  'LB',
  'OZ',
  'L',
  'ML',
  'PCS',
  'BOX',
  'CARTON',
  'BAG',
  'BOTTLE',
  'PACK',
  'PORTION',
  'SERVING',
];

const emptyForm = () => ({
  name: '',
  sku: '',
  description: '',
  categoryId: '',
  supplierId: '',
  unitOfMeasure: 'PCS' as UOM,
  costPrice: '',
  sellingPrice: '',
  reorderPoint: '',
  reorderQuantity: '',
  expiryTracking: false,
});

export default function ItemsPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

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

  function openAdd() {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setShowModal(true);
  }

  function openEdit(item: InventoryItem) {
    setEditing(item);
    setForm({
      name: item.name,
      sku: item.sku ?? '',
      description: item.description ?? '',
      categoryId: item.categoryId ?? '',
      supplierId: item.supplierId ?? '',
      unitOfMeasure: item.unitOfMeasure,
      costPrice: String(item.costPrice),
      sellingPrice: item.sellingPrice != null ? String(item.sellingPrice) : '',
      reorderPoint: String(item.reorderPoint),
      reorderQuantity: String(item.reorderQuantity),
      expiryTracking: item.expiryTracking,
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('Item name is required.');
      return;
    }
    if (!form.costPrice) {
      setFormError('Cost price is required.');
      return;
    }
    if (!branchId) {
      setFormError('Select a branch first.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        branchId,
        costPrice: Number(form.costPrice),
        sellingPrice: form.sellingPrice ? Number(form.sellingPrice) : undefined,
        reorderPoint: Number(form.reorderPoint) || 0,
        reorderQuantity: Number(form.reorderQuantity) || 0,
        categoryId: form.categoryId || undefined,
        supplierId: form.supplierId || undefined,
        sku: form.sku || undefined,
        description: form.description || undefined,
      };
      if (editing) {
        await updateItem(token!, editing.id, payload);
      } else {
        await createItem(token!, payload);
      }
      setShowModal(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSaving(false);
    }
  }

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
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          + Add Item
        </button>
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
                <th></th>
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
                  <td>
                    <button
                      onClick={() => openEdit(item)}
                      className="text-xs px-2 py-1 rounded-md"
                      style={{ color: 'var(--accent)' }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="card w-full max-w-lg animate-in overflow-y-auto"
            style={{ maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <span className="font-bold">{editing ? 'Edit Item' : 'Add Inventory Item'}</span>
              <button onClick={() => setShowModal(false)} style={{ color: 'var(--muted)' }}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="card-body space-y-4">
              {formError && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
                >
                  {formError}
                </div>
              )}
              <div>
                <label>Item Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Chicken Breast"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>SKU / Code</label>
                  <input
                    type="text"
                    placeholder="e.g. CHK-001"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>
                <div>
                  <label>Unit of Measure *</label>
                  <select
                    value={form.unitOfMeasure}
                    onChange={(e) => setForm({ ...form, unitOfMeasure: e.target.value as UOM })}
                  >
                    {UOM_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label>Category</label>
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                >
                  <option value="">— No category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Cost Price ({currency}) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  />
                </div>
                <div>
                  <label>Selling Price ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.sellingPrice}
                    onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Reorder Point</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="10"
                    value={form.reorderPoint}
                    onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
                  />
                </div>
                <div>
                  <label>Reorder Qty</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="50"
                    value={form.reorderQuantity}
                    onChange={(e) => setForm({ ...form, reorderQuantity: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label>Description</label>
                <textarea
                  rows={2}
                  placeholder="Optional description…"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="expiry"
                  checked={form.expiryTracking}
                  onChange={(e) => setForm({ ...form, expiryTracking: e.target.checked })}
                  style={{ width: 'auto' }}
                />
                <label
                  htmlFor="expiry"
                  style={{
                    margin: 0,
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  Track expiry dates
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
