import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';

interface Table { id: string; label: string; number: number; isActive: boolean; organizationId: string; branchId: string | null; }
interface QREntry { tableId: string; tableLabel: string; tableNumber: number; qrDataUrl: string; url: string; }

const API_BASE = import.meta.env.VITE_API_URL || '';
const PWA_URL = import.meta.env.VITE_CUSTOMER_PWA_URL || 'http://localhost:5173';

export function TablesPage() {
  const api = useApi();
  const [tables, setTables] = useState<Table[]>([]);
  const [qrCodes, setQrCodes] = useState<QREntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ label: '', number: '' });
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const res = await api.get('/api/tables');
    if (res.success) setTables(res.data);
    setLoading(false);
  }

  async function loadQR() {
    setQrLoading(true);
    const res = await api.get('/api/tables/qr/bulk');
    if (res.success) setQrCodes(res.data);
    setQrLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveTable() {
    setSaving(true); setError('');
    try {
      let res;
      if (editingTableId) {
        res = await api.put(`/api/tables/${editingTableId}`, { label: form.label, number: parseInt(form.number) });
      } else {
        res = await api.post('/api/tables', { label: form.label, number: parseInt(form.number) });
      }
      if (!res.success) throw new Error(res.error);
      setModal(false); setForm({ label: '', number: '' }); setEditingTableId(null); load();
    } catch (e: any) { setError(e.message); }
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

  if (loading) return <div className="flex items-center justify-center h-48"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">TABLES & QR</h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={loadQR} disabled={qrLoading}>{qrLoading ? 'Loading…' : '↓ Generate All QR'}</button>
          <button className="btn btn-primary btn-sm" onClick={() => { setForm({ label: '', number: '' }); setEditingTableId(null); setModal(true); setError(''); }}>+ Add Table</button>
        </div>
      </div>

      {/* Tables grid */}
      <div className="card overflow-x-auto">
        <table>
          <thead><tr><th>#</th><th>Label</th><th>Status</th><th>QR Code</th><th>Actions</th></tr></thead>
          <tbody>
            {tables.length === 0 && <tr><td colSpan={5} className="text-center text-[var(--muted)] py-8">No tables yet. Add your first table.</td></tr>}
            {tables.map((t) => (
              <tr key={t.id}>
                <td className="font-bold text-[var(--accent)]">{t.number}</td>
                <td className="font-medium">{t.label}</td>
                <td><span className={`badge ${t.isActive ? 'badge-active' : 'badge-inactive'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <a href={`${API_BASE}/api/tables/${t.id}/qr?format=png`} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] hover:underline">↓ Download QR</a>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => copyLink(t)}>Copy Link</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setForm({ label: t.label, number: t.number.toString() }); setEditingTableId(t.id); setModal(true); setError(''); }}>Edit</button>
                    {t.isActive ? (
                      <button className="btn btn-secondary btn-sm text-yellow-500" onClick={() => deactivate(t.id)}>Deactivate</button>
                    ) : (
                      <button className="btn btn-secondary btn-sm text-green-500" onClick={() => activate(t.id)}>Activate</button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => deleteTable(t.id)}>Delete</button>
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
          <h2 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider">QR Codes — Print & Place</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {qrCodes.map((entry) => (
              <div key={entry.tableId} className="card p-4 text-center space-y-2">
                <img src={entry.qrDataUrl} alt={entry.tableLabel} className="w-full aspect-square" />
                <p className="font-bold text-sm">{entry.tableLabel}</p>
                <button className="btn btn-secondary btn-sm w-full" onClick={() => downloadQR(entry)}>↓ Save</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Table Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setModal(false)}>
          <div className="card w-full max-w-sm p-6 space-y-4 animate-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl">{editingTableId ? 'EDIT TABLE' : 'ADD TABLE'}</h2>
            <div><label>Table Number *</label><input type="number" min="1" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="1" /></div>
            <div><label>Label *</label><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Table 1 / Bar Seat A" /></div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button className="btn btn-secondary flex-1" onClick={() => { setModal(false); setEditingTableId(null); }}>Cancel</button>
              <button className="btn btn-primary flex-1" disabled={saving} onClick={saveTable}>{saving ? 'Saving…' : 'Save Table'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
