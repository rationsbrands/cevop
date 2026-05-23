import React, { useEffect, useState, useCallback } from 'react';
import { useApi } from '../context/auth';

interface Table {
  id: string;
  label: string;
  number: number;
  isActive: boolean;
  organizationId: string;
  branchId: string | null;
  status: string;
  activeSessionId: string | null;
  sectionId: string | null;
  section: { id: string; name: string; colour: string | null } | null;
}
interface QREntry {
  tableId: string;
  tableLabel: string;
  tableNumber: number;
  qrDataUrl: string;
  url: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';
const PWA_URL =
  import.meta.env.VITE_CUSTOMER_PWA_URL ||
  (import.meta.env.PROD ? 'https://order.cevop.com' : 'http://localhost:5173');

export function TablesPage() {
  const api = useApi();
  const [tables, setTables] = useState<Table[]>([]);
  const [, setSections] = useState<{ id: string; name: string }[]>([]);
  const [qrCodes, setQrCodes] = useState<QREntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ label: '', number: '', sectionId: '' });
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    if (!api.effectiveBranchId) {
      setTables([]);
      setLoading(false);
      return;
    }
    const [res, secRes] = await Promise.all([api.get('/api/tables'), api.get('/api/sections')]);
    if (res.success) setTables(res.data);
    if (secRes.success) setSections(secRes.data);
    setLoading(false);
  }, [api]);

  async function loadQR() {
    setQrLoading(true);
    const res = await api.get('/api/tables/qr/bulk');
    if (res.success) setQrCodes(res.data);
    setQrLoading(false);
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function saveTable() {
    setSaving(true);
    setError('');
    try {
      let res;
      const payload = {
        label: form.label,
        number: parseInt(form.number),
        sectionId: form.sectionId || null,
      };
      if (editingTableId) {
        res = await api.put(`/api/tables/${editingTableId}`, payload);
      } else {
        res = await api.post('/api/tables', payload);
      }
      if (!res.success) throw new Error(res.error);
      setModal(false);
      setForm({ label: '', number: '', sectionId: '' });
      setEditingTableId(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  function copyLink(t: Table) {
    const url = `${PWA_URL}/menu/${t.organizationId}/${t.id}`;
    navigator.clipboard.writeText(url);
    alert('Customer Link copied to clipboard!');
  }

  async function deactivate(id: string) {
    if (!confirm('Deactivate this table? It will no longer be accessible by customers.')) return;
    await api.delete(`/api/tables/${id}`);
    load();
  }

  async function activate(id: string) {
    await api.put(`/api/tables/${id}`, { isActive: true });
    load();
  }

  async function deleteTable(id: string) {
    if (!confirm('Permanently delete this table? This cannot be undone.')) return;
    await api.delete(`/api/tables/${id}?permanent=true`);
    load();
  }

  function downloadQR(entry: QREntry) {
    const a = document.createElement('a');
    a.href = entry.qrDataUrl;
    a.download = `table-${entry.tableNumber}-qr.png`;
    a.click();
  }

  async function clearTable(sessionId: string) {
    if (!confirm('Clear this table?')) return;
    await api.patch(`/api/sessions/${sessionId}/close`, { nextStatus: 'CLEANING' });
    load();
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="font-display text-3xl mb-2">TABLES & QR</h1>
        <p className="text-[var(--muted)] text-sm">
          Select a branch to manage tables and QR codes for that branch.
        </p>
      </div>
    );

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">TABLES & QR</h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={loadQR} disabled={qrLoading}>
            {qrLoading ? 'Loading…' : '↓ Generate All QR'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditingTableId(null);
              setForm({ label: '', number: String(tables.length + 1), sectionId: '' });
              setModal(true);
            }}
          >
            Add Table
          </button>
        </div>
      </div>

      {/* Tables grid */}
      <div className="card overflow-x-auto">
        <table className="min-w-[720px]">
          <thead>
            <tr>
              <th>#</th>
              <th>Label</th>
              <th>Section</th>
              <th>State</th>
              <th>Status</th>
              <th>QR Code</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tables.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-8">
                  No tables yet. Add your first table.
                </td>
              </tr>
            )}
            {tables.map((t) => (
              <tr key={t.id}>
                <td className="font-bold text-[var(--accent)]">{t.number}</td>
                <td className="font-medium">{t.label}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {t.section ? (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border"
                      style={{
                        backgroundColor: `${t.section.colour || '#4f46e5'}20`,
                        color: t.section.colour || '#4f46e5',
                        borderColor: `${t.section.colour || '#4f46e5'}40`,
                      }}
                    >
                      {t.section.name}
                    </span>
                  ) : (
                    <span className="text-gray-400 italic">Unassigned</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${t.isActive ? 'badge-active' : 'badge-inactive'}`}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${
                      t.status === 'EMPTY'
                        ? 'border-[var(--border)] text-[var(--muted)]'
                        : t.status === 'OCCUPIED'
                          ? 'border-[var(--preparing)] text-[var(--preparing)] bg-[var(--surface2)]'
                          : 'border-[var(--accent)] text-[var(--accent)] bg-[var(--surface2)]'
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td>
                  <a
                    href={`${API_BASE}/api/tables/${t.id}/qr?format=png`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    ↓ Download QR
                  </a>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => copyLink(t)}>
                      Copy Link
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setForm({
                          label: t.label,
                          number: t.number.toString(),
                          sectionId: t.sectionId || '',
                        });
                        setEditingTableId(t.id);
                        setModal(true);
                        setError('');
                      }}
                    >
                      Edit
                    </button>
                    {t.isActive ? (
                      <button
                        className="btn btn-secondary btn-sm text-yellow-500"
                        onClick={() => deactivate(t.id)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm text-green-500"
                        onClick={() => activate(t.id)}
                      >
                        Activate
                      </button>
                    )}
                    {t.activeSessionId && (
                      <button
                        className="btn btn-secondary btn-sm text-yellow-500"
                        onClick={() => clearTable(t.activeSessionId!)}
                      >
                        Clear Table
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => deleteTable(t.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* QR Grid */}
      {qrCodes.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider">
            QR Codes — Print & Place
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {qrCodes.map((entry) => (
              <div key={entry.tableId} className="card p-4 text-center space-y-2">
                <img
                  src={entry.qrDataUrl}
                  alt={entry.tableLabel}
                  className="w-full aspect-square"
                />
                <p className="font-bold text-sm">{entry.tableLabel}</p>
                <button
                  className="btn btn-secondary btn-sm w-full"
                  onClick={() => downloadQR(entry)}
                >
                  ↓ Save
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Table Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setModal(false)}
        >
          <div
            className="card w-full max-w-sm p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-2xl">{editingTableId ? 'EDIT TABLE' : 'ADD TABLE'}</h2>
            <div>
              <label htmlFor="table_form_number">Table Number *</label>
              <input
                id="table_form_number"
                name="number"
                type="number"
                min="1"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="e.g. 1"
              />
            </div>
            <div>
              <label htmlFor="table_form_label">Label *</label>
              <input
                id="table_form_label"
                name="label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Table 1 / Bar Seat A"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button
                className="btn btn-secondary flex-1"
                onClick={() => {
                  setModal(false);
                  setEditingTableId(null);
                }}
              >
                Cancel
              </button>
              <button className="btn btn-primary flex-1" disabled={saving} onClick={saveTable}>
                {saving ? 'Saving…' : 'Save Table'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
