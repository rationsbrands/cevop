import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';

interface Branch {
  id: string;
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  _count?: { users: number; tables: number };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function BranchesPage() {
  const { } = useAuth();
  const api = useApi();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create branch form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', slug: '', address: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit branch form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', address: '', phone: '' });
  const [saving, setSaving] = useState(false);

  // Create branch admin form
  const [adminBranchId, setAdminBranchId] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState({ name: '', email: '', password: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminSuccess, setAdminSuccess] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/branches');
      setBranches(data ?? []);
    } catch {
      setError('Failed to load branches');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const { success, error: err, data } = await api.post('/api/branches', createForm);
      if (!success) { setCreateError(err || 'Failed to create branch'); return; }
      setBranches((prev) => [...prev, data]);
      setCreateForm({ name: '', slug: '', address: '', phone: '' });
      setShowCreate(false);
    } catch {
      setCreateError('Failed to create branch');
    } finally {
      setCreating(false);
    }
  }

  async function handleEdit(id: string) {
    setSaving(true);
    try {
      const { success, data } = await api.put(`/api/branches/${id}`, editForm);
      if (success) {
        setBranches((prev) => prev.map((b) => b.id === id ? { ...b, ...data } : b));
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(branch: Branch) {
    const { success, data } = await api.put(`/api/branches/${branch.id}`, { isActive: !branch.isActive });
    if (success) setBranches((prev) => prev.map((b) => b.id === branch.id ? { ...b, ...data } : b));
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!adminBranchId) return;
    setCreatingAdmin(true);
    setAdminError('');
    setAdminSuccess('');
    try {
      const { success, error: err, data } = await api.post(`/api/branches/${adminBranchId}/admin`, adminForm);
      if (!success) { setAdminError(err || 'Failed to create admin'); return; }
      setAdminSuccess(`Branch admin "${data.name}" created. They can log in with their email and password.`);
      setAdminForm({ name: '', email: '', password: '' });
    } catch {
      setAdminError('Failed to create admin');
    } finally {
      setCreatingAdmin(false);
    }
  }

  if (loading) return <div className="text-[var(--muted)] text-sm">Loading branches…</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-[var(--text)]">BRANCHES</h1>
          <p className="text-[var(--muted)] text-sm mt-1">Manage your restaurant locations</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary px-4 py-2 text-sm">
          + Add Branch
        </button>
      </div>

      {/* Create Branch Form */}
      {showCreate && (
        <div className="card p-5 space-y-4 border-[var(--accent)]">
          <h2 className="font-semibold text-[var(--text)]">New Branch</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Branch Name *</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
                  placeholder="Rations Lekki"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Slug *</label>
                <input
                  type="text"
                  value={createForm.slug}
                  onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="rations-lekki"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Address</label>
                <input
                  type="text"
                  value={createForm.address}
                  onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="5 Admiralty Way, Lekki"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Phone</label>
                <input
                  type="text"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+234 800 000 0000"
                />
              </div>
            </div>
            {createError && <p className="text-red-400 text-sm">{createError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary px-4 py-2 text-sm flex-1">Cancel</button>
              <button type="submit" disabled={creating} className="btn btn-primary px-4 py-2 text-sm flex-1 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create Branch'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Branches List */}
      {branches.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)]">
          <div className="w-10 h-10 border border-[var(--border)] rounded-sm mx-auto mb-3 flex items-center justify-center text-[var(--muted)] text-xs font-bold">0</div>
          <p>No branches yet. Create your first branch to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {branches.map((branch) => (
            <div key={branch.id} className={`card p-4 ${!branch.isActive ? 'opacity-50' : ''}`}>
              {editingId === branch.id ? (
                /* Edit form */
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Name</label>
                      <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Address</label>
                      <input value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Phone</label>
                      <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingId(null)} className="btn btn-secondary text-xs px-3 py-1.5">Cancel</button>
                    <button onClick={() => handleEdit(branch.id)} disabled={saving} className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Branch card */
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[var(--text)]">{branch.name}</h3>
                      <span className="text-xs text-[var(--muted)] font-mono bg-[var(--surface2)] px-1.5 py-0.5">{branch.slug}</span>
                      {!branch.isActive && <span className="text-xs text-red-400 bg-red-900/20 border border-red-800 px-1.5 py-0.5">Inactive</span>}
                    </div>
                    <div className="text-sm text-[var(--muted)] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {branch.address && <span>{branch.address}</span>}
                      {branch.phone && <span>{branch.phone}</span>}
                    </div>
                    {branch._count && (
                      <div className="text-xs text-[var(--muted)] mt-1.5 space-x-3">
                        <span>{branch._count.users} staff</span>
                        <span>{branch._count.tables} tables</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
                    <button
                      onClick={() => {
                        setEditingId(branch.id);
                        setEditForm({ name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '' });
                      }}
                      className="flex-1 sm:flex-none text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-2.5 py-1.5 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setAdminBranchId(branch.id);
                        setAdminError('');
                        setAdminSuccess('');
                      }}
                      className="flex-1 sm:flex-none text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-2.5 py-1.5 transition-colors"
                    >
                      + Admin
                    </button>
                    <button
                      onClick={() => toggleActive(branch)}
                      className={`flex-1 sm:flex-none text-xs border px-2.5 py-1.5 transition-colors ${
                        branch.isActive
                          ? 'text-red-400 border-red-800 hover:bg-red-900/20'
                          : 'text-green-400 border-green-800 hover:bg-green-900/20'
                      }`}
                    >
                      {branch.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              )}

              {/* Create Admin sub-form */}
              {adminBranchId === branch.id && (
                <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-3">
                  <h4 className="text-sm font-semibold text-[var(--text)]">Create Branch Admin for {branch.name}</h4>
                  <form onSubmit={handleCreateAdmin} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Name *</label>
                      <input
                        type="text"
                        value={adminForm.name}
                        onChange={(e) => setAdminForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Branch Manager"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Email *</label>
                      <input
                        type="email"
                        value={adminForm.email}
                        onChange={(e) => setAdminForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="manager@lekki.com"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Password *</label>
                      <div className="relative">
                        <input
                          type={showAdminPassword ? 'text' : 'password'}
                          value={adminForm.password}
                          onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
                          placeholder="Min 8 characters"
                          required
                          minLength={8}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAdminPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-xs select-none"
                          tabIndex={-1}
                          title={showAdminPassword ? 'Hide password' : 'Show password'}
                        >
                          {showAdminPassword ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                        </button>
                      </div>
                    </div>
                    {adminError && <p className="sm:col-span-3 text-red-400 text-sm">{adminError}</p>}
                    {adminSuccess && <p className="sm:col-span-3 text-green-400 text-sm">{adminSuccess}</p>}
                    <div className="sm:col-span-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setAdminBranchId(null); setAdminError(''); setAdminSuccess(''); }}
                        className="btn btn-secondary flex-1 sm:flex-none text-xs px-3 py-1.5"
                      >
                        Cancel
                      </button>
                      <button type="submit" disabled={creatingAdmin} className="btn btn-primary flex-1 sm:flex-none text-xs px-3 py-1.5 disabled:opacity-50">
                        {creatingAdmin ? 'Creating…' : 'Create Admin'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
