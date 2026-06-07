import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import {
  getMovements,
  getItems,
  createMovement,
  type StockMovement,
} from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

const TYPE_COLOR: Record<string, string> = {
  PURCHASE: 'var(--success)',
  PURCHASE_RECEIPT: 'var(--success)',
  SALE: 'var(--info)',
  MANUAL_ADJUSTMENT: 'var(--warning)',
  ADJUSTMENT: 'var(--warning)',
  WRITE_OFF: 'var(--danger)',
  TRANSFER_IN: 'var(--success)',
  TRANSFER_OUT: 'var(--danger)',
  STOCKTAKE_ADJUSTMENT: 'var(--warning)',
  PRODUCTION_IN: 'var(--success)',
  PRODUCTION_OUT: 'var(--danger)',
};

const ADJUSTMENT_TYPES = [
  { value: 'MANUAL_ADJUSTMENT', label: 'Manual Adjustment' },
  { value: 'PURCHASE_RECEIPT', label: 'Purchase / Stock In' },
  { value: 'WRITE_OFF', label: 'Write Off' },
  { value: 'TRANSFER_IN', label: 'Transfer In' },
  { value: 'TRANSFER_OUT', label: 'Transfer Out' },
  { value: 'PRODUCTION_IN', label: 'Production In' },
  { value: 'PRODUCTION_OUT', label: 'Production Out' },
];

export default function StockMovementsPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    itemId: '',
    type: 'ADJUSTMENT',
    quantity: '',
    unitCost: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, loading, error, refetch } = useApi(
    () => getMovements(token!, { branchId, limit: 100 }),
    [token, branchId],
  );
  const { data: itemsRes } = useApi(() => getItems(token!, { branchId }), [token, branchId]);

  const movements: StockMovement[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const items = itemsRes?.data ?? [];

  function openModal() {
    setForm({ itemId: '', type: 'ADJUSTMENT', quantity: '', unitCost: '', note: '' });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.itemId) {
      setFormError('Select an item.');
      return;
    }
    if (!form.quantity) {
      setFormError('Quantity is required.');
      return;
    }
    if (!branchId) {
      setFormError('Select a branch first.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await createMovement(token!, {
        branchId,
        itemId: form.itemId,
        type: form.type,
        quantity: Number(form.quantity),
        unitCost: form.unitCost ? Number(form.unitCost) : 0,
        note: form.note || undefined,
      });
      setShowModal(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to record movement');
    } finally {
      setSaving(false);
    }
  }

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Stock Movements
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch to view its stock movement history.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${total} total movements`}
        </p>
        <button className="btn btn-primary btn-sm" onClick={openModal}>
          + Manual Adjustment
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

      <div className="card">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            Loading movements…
          </div>
        ) : movements.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No stock movements yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Unit Cost</th>
                <th>Note</th>
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
                    className="font-mono text-xs font-semibold"
                    style={{ color: Number(m.quantity) >= 0 ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {Number(m.quantity) >= 0 ? '+' : ''}
                    {Number(m.quantity)} {m.item?.unitOfMeasure}
                  </td>
                  <td>{m.unitCost ? formatCurrency(m.unitCost, currency) : '—'}</td>
                  <td style={{ color: 'var(--muted)' }} className="text-xs">
                    {m.note ?? '—'}
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

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowModal(false)}
        >
          <div className="card w-full max-w-md animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <span className="font-bold">Record Stock Movement</span>
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
                <label>Item *</label>
                <select
                  value={form.itemId}
                  onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                >
                  <option value="">— Select item —</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (Stock: {Number(i.currentStock)} {i.unitOfMeasure})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Movement Type *</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {ADJUSTMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Quantity *</label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="e.g. 10 or -5"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    Use negative to reduce stock
                  </p>
                </div>
                <div>
                  <label>Unit Cost ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.unitCost}
                    onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label>Note / Reference</label>
                <input
                  type="text"
                  placeholder="e.g. Spoilage from fridge failure"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
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
                  {saving ? 'Saving…' : 'Record Movement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
