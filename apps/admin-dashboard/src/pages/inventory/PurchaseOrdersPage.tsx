import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import {
  getPurchaseOrders,
  getSuppliers,
  getItems,
  createPurchaseOrder,
  updatePOStatus,
  type PurchaseOrder,
} from '../../services/inventory';
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

type POLine = { itemId: string; quantityOrdered: string; unitCost: string };

export default function PurchaseOrdersPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [form, setForm] = useState({ supplierId: '', expectedDelivery: '', notes: '' });
  const [lines, setLines] = useState<POLine[]>([{ itemId: '', quantityOrdered: '', unitCost: '' }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, loading, error, refetch } = useApi(
    () => getPurchaseOrders(token!, { branchId, status: statusFilter || undefined }),
    [token, branchId, statusFilter],
  );
  const { data: suppliersRes } = useApi(() => getSuppliers(token!), [token]);
  const { data: itemsRes } = useApi(() => getItems(token!, { branchId }), [token, branchId]);

  const orders: PurchaseOrder[] = data?.data ?? [];
  const suppliers = suppliersRes?.data ?? [];
  const items = itemsRes?.data ?? [];

  function openNew() {
    setForm({ supplierId: '', expectedDelivery: '', notes: '' });
    setLines([{ itemId: '', quantityOrdered: '', unitCost: '' }]);
    setFormError('');
    setShowModal(true);
  }

  function addLine() {
    setLines([...lines, { itemId: '', quantityOrdered: '', unitCost: '' }]);
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof POLine, value: string) {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    // Auto-fill unit cost from item cost price
    if (field === 'itemId') {
      const item = items.find((i) => i.id === value);
      if (item) next[idx].unitCost = String(item.costPrice);
    }
    setLines(next);
  }

  const poTotal = lines.reduce(
    (sum, l) => sum + (Number(l.quantityOrdered) || 0) * (Number(l.unitCost) || 0),
    0,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplierId) {
      setFormError('Select a supplier.');
      return;
    }
    if (!branchId) {
      setFormError('Select a branch first.');
      return;
    }
    const validLines = lines.filter(
      (l) => l.itemId && l.quantityOrdered && Number(l.quantityOrdered) > 0,
    );
    if (validLines.length === 0) {
      setFormError('Add at least one item.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await createPurchaseOrder(token!, {
        branchId,
        supplierId: form.supplierId,
        expectedDelivery: form.expectedDelivery
          ? new Date(form.expectedDelivery).toISOString()
          : undefined,
        notes: form.notes || undefined,
        lines: validLines.map((l) => ({
          itemId: l.itemId,
          quantityOrdered: Number(l.quantityOrdered),
          unitCost: Number(l.unitCost) || 0,
        })),
      });
      setShowModal(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  }

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
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          + New Purchase Order
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
                <th>Lines</th>
                <th>Total</th>
                <th>Expected</th>
                <th>Created</th>
                <th></th>
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
                  <td>
                    <button
                      onClick={() => setSelectedPO(po)}
                      className="text-xs px-2 py-1 rounded-md"
                      style={{ color: 'var(--accent)' }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New PO Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="card w-full max-w-2xl animate-in overflow-y-auto"
            style={{ maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <span className="font-bold">New Purchase Order</span>
              <button onClick={() => setShowModal(false)} style={{ color: 'var(--muted)' }}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="card-body space-y-5">
              {formError && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
                >
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Supplier *</label>
                  <select
                    value={form.supplierId}
                    onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                  >
                    <option value="">— Select supplier —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Expected Delivery</label>
                  <input
                    type="date"
                    value={form.expectedDelivery}
                    onChange={(e) => setForm({ ...form, expectedDelivery: e.target.value })}
                  />
                </div>
              </div>

              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label style={{ marginBottom: 0 }}>Order Lines *</label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addLine}>
                    + Add Line
                  </button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select
                        value={line.itemId}
                        onChange={(e) => updateLine(idx, 'itemId', e.target.value)}
                        style={{ flex: 3 }}
                      >
                        <option value="">— Item —</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.unitOfMeasure})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        placeholder="Qty"
                        value={line.quantityOrdered}
                        onChange={(e) => updateLine(idx, 'quantityOrdered', e.target.value)}
                        style={{ flex: 1.5 }}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Unit cost"
                        value={line.unitCost}
                        onChange={(e) => updateLine(idx, 'unitCost', e.target.value)}
                        style={{ flex: 1.5 }}
                      />
                      <span
                        className="text-xs font-semibold"
                        style={{ color: 'var(--muted)', minWidth: '80px' }}
                      >
                        ={' '}
                        {formatCurrency(
                          (Number(line.quantityOrdered) || 0) * (Number(line.unitCost) || 0),
                          currency,
                        )}
                      </span>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          style={{ color: 'var(--danger)', flexShrink: 0 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-sm font-bold text-right" style={{ color: 'var(--text)' }}>
                  Total: {formatCurrency(poTotal, currency)}
                </div>
              </div>

              <div>
                <label>Notes</label>
                <textarea
                  rows={2}
                  placeholder="Any notes for this order…"
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
                  {saving ? 'Creating…' : 'Create Purchase Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Detail Modal */}
      {selectedPO && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setSelectedPO(null)}
        >
          <div
            className="card w-full max-w-lg animate-in overflow-y-auto"
            style={{ maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <span className="font-bold">
                PO {selectedPO.poNumber ?? selectedPO.id.slice(0, 8)}
              </span>
              <button onClick={() => setSelectedPO(null)} style={{ color: 'var(--muted)' }}>
                ✕
              </button>
            </div>
            <div className="card-body space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span style={{ color: 'var(--muted)' }}>Supplier</span>
                  <br />
                  <strong>{selectedPO.supplier?.name}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Status</span>
                  <br />
                  <span className={`badge ${STATUS_BADGE[selectedPO.status] ?? 'badge-draft'}`}>
                    {selectedPO.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Created</span>
                  <br />
                  {new Date(selectedPO.createdAt).toLocaleDateString('en-NG')}
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Expected</span>
                  <br />
                  {selectedPO.expectedDelivery
                    ? new Date(selectedPO.expectedDelivery).toLocaleDateString('en-NG')
                    : '—'}
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    <th>Unit Cost</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPO.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.item?.name ?? '—'}</td>
                      <td>
                        {l.quantityOrdered} {l.item?.unitOfMeasure}
                      </td>
                      <td
                        style={{
                          color: l.quantityReceived > 0 ? 'var(--success)' : 'var(--muted)',
                        }}
                      >
                        {l.quantityReceived}
                      </td>
                      <td>{formatCurrency(l.unitCost, currency)}</td>
                      <td className="font-semibold">{formatCurrency(l.totalCost, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right font-bold text-sm" style={{ color: 'var(--text)' }}>
                Total: {formatCurrency(selectedPO.total, currency)}
              </div>
              {selectedPO.notes && (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {selectedPO.notes}
                </p>
              )}
              {/* Status actions */}
              {!['RECEIVED', 'CANCELLED'].includes(selectedPO.status) && (
                <div className="flex gap-2 flex-wrap pt-2">
                  {selectedPO.status === 'DRAFT' && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        await updatePOStatus(token!, selectedPO.id, 'SUBMITTED');
                        setSelectedPO(null);
                        refetch();
                      }}
                    >
                      Submit Order
                    </button>
                  )}
                  {selectedPO.status === 'SUBMITTED' && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        await updatePOStatus(token!, selectedPO.id, 'SENT');
                        setSelectedPO(null);
                        refetch();
                      }}
                    >
                      Mark as Sent
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ color: 'var(--danger)' }}
                    onClick={async () => {
                      if (!confirm('Cancel this purchase order?')) return;
                      await updatePOStatus(token!, selectedPO.id, 'CANCELLED');
                      setSelectedPO(null);
                      refetch();
                    }}
                  >
                    Cancel PO
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
