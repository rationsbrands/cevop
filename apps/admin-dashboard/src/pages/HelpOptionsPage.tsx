import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';

interface Branch {
  id: string;
  name: string;
}
interface HelpOption {
  id: string;
  type: 'WAITER' | 'SERVICE';
  label: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  branchId?: string | null;
}

export function HelpOptionsPage() {
  const { user: me, activeBranchFilter } = useAuth();
  const api = useApi();

  const [options, setOptions] = useState<HelpOption[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: 'SERVICE' as 'WAITER' | 'SERVICE',
    label: '',
    icon: '',
    sortOrder: 0,
    isActive: true,
    branchId: '' as string | null,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const isOrgAdmin = me?.role === 'ADMIN' || me?.role === 'SUPERADMIN';

  async function load() {
    setLoading(true);
    setError('');
    try {
      const branchId = activeBranchFilter?.id || (me?.branchId ?? '');
      const [optRes, branchesRes] = await Promise.all([
        api.get(`/api/help-options?organizationId=${me?.organizationId}&branchId=${branchId}`),
        isOrgAdmin ? api.get('/api/branches') : Promise.resolve({ data: [] }),
      ]);
      console.log('Help Options Response:', optRes);
      if (!optRes.success) throw new Error(optRes.error || 'Failed to fetch options');
      setOptions(optRes.data ?? []);
      setBranches(branchesRes.data ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load help options');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [activeBranchFilter, me?.branchId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const payload: any = { ...form };
      if (!payload.branchId) payload.branchId = null;

      let res;
      if (editingId) {
        res = await api.patch(`/api/help-options/${editingId}`, payload);
      } else {
        res = await api.post('/api/help-options', payload);
      }

      if (!res.success) {
        setSaveError(res.error || 'Failed to save help option');
        return;
      }

      setShowForm(false);
      setEditingId(null);
      setForm({
        type: 'SERVICE',
        label: '',
        icon: '',
        sortOrder: 0,
        isActive: true,
        branchId: activeBranchFilter?.id || me?.branchId || '',
      });
      load();
    } catch {
      setSaveError('Failed to save help option');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Are you sure you want to delete this option?')) return;
    try {
      const res = await api.delete(`/api/help-options/${id}`);
      if (res.success) {
        setOptions((prev) => prev.filter((o) => o.id !== id));
      }
    } catch {
      alert('Failed to delete help option');
    }
  }

  function startEdit(opt: HelpOption) {
    setEditingId(opt.id);
    setForm({
      type: opt.type,
      label: opt.label,
      icon: opt.icon || '',
      sortOrder: opt.sortOrder,
      isActive: opt.isActive,
      branchId: opt.branchId || '',
    });
    setShowForm(true);
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl uppercase">Help Options</h1>
          <p className="text-[var(--muted)] text-sm">
            Configure what customers see in the "Need Help?" section.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setForm({
              type: 'SERVICE',
              label: '',
              icon: '',
              sortOrder: options.length,
              isActive: true,
              branchId: activeBranchFilter?.id || me?.branchId || '',
            });
            setShowForm(true);
          }}
          className="btn btn-primary"
        >
          + Add Option
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {options.length === 0 ? (
          <div className="card p-12 text-center text-[var(--muted)]">
            No custom help options configured yet.
          </div>
        ) : (
          options.map((opt) => (
            <div key={opt.id} className="card p-4 flex items-center justify-between group">
              <div className="flex items-center gap-4">
                <div className="text-2xl w-12 h-12 flex items-center justify-center bg-[var(--surface2)] rounded-lg shrink-0 border border-[var(--border)]">
                  {opt.icon || (opt.type === 'WAITER' ? '🛎️' : '✨')}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--text)]">{opt.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${opt.type === 'WAITER' ? 'bg-blue-900/30 text-blue-400' : 'bg-yellow-900/30 text-yellow-400'}`}
                    >
                      {opt.type}
                    </span>
                    {!opt.isActive && (
                      <span className="text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="text-[var(--muted)] text-xs mt-0.5">
                    Order: {opt.sortOrder}{' '}
                    {opt.branchId ? '• Branch Specific' : '• Organization Wide'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => startEdit(opt)}
                  className="p-2 text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(opt.id)}
                  className="p-2 text-[var(--muted)] hover:text-red-400 transition-colors"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowForm(false)}
          />
          <form
            onSubmit={handleSave}
            className="relative card w-full max-w-md p-6 space-y-5 animate-in"
          >
            <h2 className="font-display text-2xl">{editingId ? 'EDIT OPTION' : 'NEW OPTION'}</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label>Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                >
                  <option value="SERVICE">Service Request</option>
                  <option value="WAITER">Call Waiter</option>
                </select>
              </div>
              <div>
                <label>Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) })}
                />
              </div>
            </div>

            <div>
              <label>Label</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. More Napkins"
                required
              />
            </div>

            <div>
              <label>Icon (Emoji)</label>
              <input
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="e.g. Needs Assistance"
              />
            </div>

            {isOrgAdmin && (
              <div>
                <label>Scope</label>
                <select
                  value={form.branchId || ''}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value || null })}
                >
                  <option value="">Organization Wide</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <label htmlFor="isActive" className="!mb-0">
                Active and visible to customers
              </label>
            </div>

            {saveError && (
              <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
                {saveError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? 'Saving…' : 'Save Option'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
