import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getWastage, getItems, logWastage, type WastageEntry } from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

const REASON_LABELS: Record<string, string> = {
  EXPIRED: 'Expired',
  DAMAGED: 'Damaged',
  SPOILED: 'Spoiled',
  OVERPRODUCTION: 'Overproduction',
  THEFT: 'Theft',
  OTHER: 'Other',
};

const REASONS = Object.keys(REASON_LABELS);

export default function WastagePage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ itemId: '', quantity: '', reason: 'EXPIRED', notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, loading, error, refetch } = useApi(
    () => getWastage(token!, { branchId }),
    [token, branchId],
  );
  const { data: itemsRes } = useApi(() => getItems(token!, { branchId }), [token, branchId]);

  const entries: WastageEntry[] = data?.data ?? [];
  const items = itemsRes?.data ?? [];
  const totalCost = entries.reduce((sum, e) => sum + Number(e.totalCost), 0);

  function openModal() {
    setForm({ itemId: '', quantity: '', reason: 'EXPIRED', notes: '' });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.itemId) {
      setFormError('Select an item.');
      return;
    }
    if (!form.quantity || Number(form.quantity) <= 0) {
      setFormError('Enter a valid quantity.');
      return;
    }
    if (!branchId) {
      setFormError('Select a branch first.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const selectedItem = items.find((i) => i.id === form.itemId);
      const unitCost = selectedItem ? Number(selectedItem.costPrice) : 0;
      await logWastage(token!, {
        branchId,
        itemId: form.itemId,
        quantity: Number(form.quantity),
        unitCost,
        totalCost: unitCost * Number(form.quantity),
        reason: form.reason,
        notes: form.notes || undefined,
      });
      setShowModal(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to log wastage');
    } finally {
      setSaving(false);
    }
  }

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Wastage Log
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch to view its wastage records.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Track damaged, expired &amp; wasted stock
        </p>
        <button className="btn btn-primary btn-sm" onClick={openModal}>
          + Log Wastage
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Entries',
            value: loading ? '…' : String(entries.length),
            sub: 'all time',
          },
          {
            label: 'Total Cost',
            value: loading ? '…' : formatCurrency(totalCost, currency),
            sub: 'all time loss',
          },
          {
            label: 'This Month',
            value: loading
              ? '…'
              : String(
                  entries.filter((e) => new Date(e.createdAt).getMonth() === new Date().getMonth())
                    .length,
                ),
            sub: 'entries',
          },
          {
            label: 'Top Reason',
            value: loading
              ? '…'
              : (() => {
                  const counts: Record<string, number> = {};
                  entries.forEach((e) => {
                    counts[e.reason] = (counts[e.reason] ?? 0) + 1;
                  });
                  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
                  return top ? (REASON_LABELS[top[0]] ?? top[0]) : '—';
                })(),
            sub: 'most common',
          },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div
              className="text-xs font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--muted)' }}
            >
              {s.label}
            </div>
            <div className="text-xl font-black mb-1" style={{ color: 'var(--text)' }}>
              {s.value}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No wastage recorded yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Reason</th>
                <th>Qty</th>
                <th>Unit Cost</th>
                <th>Total Loss</th>
                <th>Notes</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((w) => (
                <tr key={w.id}>
                  <td className="font-medium">{w.item?.name ?? '—'}</td>
                  <td>
                    <span className="badge badge-out">{REASON_LABELS[w.reason] ?? w.reason}</span>
                  </td>
                  <td style={{ color: 'var(--danger)' }}>
                    {Number(w.quantity)} {w.item?.unitOfMeasure}
                  </td>
                  <td>{formatCurrency(w.unitCost, currency)}</td>
                  <td className="font-semibold" style={{ color: 'var(--danger)' }}>
                    {formatCurrency(Number(w.totalCost), currency)}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {w.notes ?? '—'}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(w.createdAt).toLocaleDateString('en-NG')}
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
              <span className="font-bold">Log Wastage</span>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Quantity Wasted *</label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    placeholder="0"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label>Reason *</label>
                  <select
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  >
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {REASON_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {form.itemId && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                >
                  Estimated loss:{' '}
                  {formatCurrency(
                    (items.find((i) => i.id === form.itemId)?.costPrice ?? 0) *
                      (Number(form.quantity) || 0),
                    currency,
                  )}
                </div>
              )}
              <div>
                <label>Notes</label>
                <textarea
                  rows={2}
                  placeholder="What happened?"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
                  {saving ? 'Saving…' : 'Log Wastage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
