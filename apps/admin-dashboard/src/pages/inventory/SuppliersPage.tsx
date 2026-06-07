import { useState } from 'react';
import { useAuth } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  type Supplier,
} from '../../services/inventory';

const empty = (): Partial<Supplier> => ({
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  paymentTerms: '',
  leadTimeDays: undefined,
  notes: '',
});

export default function SuppliersPage() {
  const { token } = useAuth();
  const { data, loading, error, refetch } = useApi(() => getSuppliers(token!), [token]);
  const suppliers = data?.data ?? [];

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(empty());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function openAdd() {
    setEditing(null);
    setForm(empty());
    setFormError('');
    setShowModal(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      contactName: s.contactName ?? '',
      email: s.email ?? '',
      phone: s.phone ?? '',
      address: s.address ?? '',
      paymentTerms: s.paymentTerms ?? '',
      leadTimeDays: s.leadTimeDays ?? undefined,
      notes: s.notes ?? '',
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) {
      setFormError('Supplier name is required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : undefined,
      };
      if (editing) {
        await updateSupplier(token!, editing.id, payload);
      } else {
        await createSupplier(token!, payload);
      }
      setShowModal(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save supplier');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${suppliers.length} suppliers`}
        </p>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          + Add Supplier
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>
            Loading suppliers…
          </div>
        ) : suppliers.length === 0 ? (
          <div className="card p-5 flex flex-col items-center justify-center gap-2 border-dashed col-span-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
              No suppliers yet
            </p>
            <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
              Add your first supplier to start creating purchase orders
            </p>
            <button className="btn btn-primary btn-sm mt-2" onClick={openAdd}>
              + Add Supplier
            </button>
          </div>
        ) : (
          suppliers.map((s) => (
            <div key={s.id} className="card p-5 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                    {s.name}
                  </div>
                  {s.contactName && (
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {s.contactName}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${s.isActive ? 'badge-ok' : 'badge-inactive'}`}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={() => openEdit(s)}
                    className="text-xs px-2 py-1 rounded-md transition-colors"
                    style={{ color: 'var(--accent)' }}
                  >
                    Edit
                  </button>
                </div>
              </div>
              {s.email && (
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {s.email}
                </div>
              )}
              {s.phone && (
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {s.phone}
                </div>
              )}
              <div className="flex gap-3 text-xs pt-1" style={{ color: 'var(--muted)' }}>
                <span>{s._count?.items ?? 0} items</span>
                <span>{s._count?.purchaseOrders ?? 0} POs</span>
                {s.leadTimeDays != null && <span>{s.leadTimeDays}d lead time</span>}
              </div>
            </div>
          ))
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
              <span className="font-bold">{editing ? 'Edit Supplier' : 'Add Supplier'}</span>
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
                <label>Supplier Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Lagos Fresh Produce"
                  value={form.name ?? ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Contact Name</label>
                  <input
                    type="text"
                    placeholder="Contact person"
                    value={form.contactName ?? ''}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  />
                </div>
                <div>
                  <label>Phone</label>
                  <input
                    type="tel"
                    placeholder="+234..."
                    value={form.phone ?? ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label>Email</label>
                <input
                  type="email"
                  placeholder="supplier@example.com"
                  value={form.email ?? ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label>Address</label>
                <input
                  type="text"
                  placeholder="Supplier address"
                  value={form.address ?? ''}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Payment Terms</label>
                  <input
                    type="text"
                    placeholder="e.g. Net 30"
                    value={form.paymentTerms ?? ''}
                    onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                  />
                </div>
                <div>
                  <label>Lead Time (days)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="7"
                    value={form.leadTimeDays ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        leadTimeDays: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <label>Notes</label>
                <textarea
                  rows={2}
                  placeholder="Any notes about this supplier…"
                  value={form.notes ?? ''}
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
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
