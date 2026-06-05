import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApi, useAuth } from '../context/auth';
import { ConfirmDialog, showToast } from '../components/Popup';
import { QRCodeSVG } from 'qrcode.react';

interface Branch {
  id: string;
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  maxTablesPerWaiter?: number | null;
  isActive: boolean;
  taxRate?: string | number | null;
  serviceChargeRate?: string | number | null;
  createdAt: string;
  _count?: { users: number; tables: number };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

const SERVICE_DISPLAY_URL = (
  import.meta.env.VITE_SERVICE_DISPLAY_URL ||
  (import.meta.env.DEV ? 'http://localhost:5174' : 'https://service.cevop.com')
).replace(/\/$/, '');

export function BranchesPage() {
  const api = useApi();
  const { user } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create branch form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    slug: '',
    address: '',
    phone: '',
    maxTablesPerWaiter: '',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit branch form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    address: '',
    phone: '',
    maxTablesPerWaiter: '',
    taxRate: '',
    serviceChargeRate: '',
  });
  const [saving, setSaving] = useState(false);

  // Create branch admin form
  const [adminBranchId, setAdminBranchId] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState({ name: '', email: '', password: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminSuccess, setAdminSuccess] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  const [kioskBranch, setKioskBranch] = useState<Branch | null>(null);
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmActionRef, setConfirmActionRef] = useState<{
    action: () => Promise<void> | void;
  } | null>(null);

  function openConfirm(title: string, message: string, action: () => Promise<void> | void) {
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmActionRef({ action });
    setConfirmOpen(true);
  }

  async function onConfirm() {
    if (confirmBusy || !confirmActionRef) return;
    setConfirmBusy(true);
    try {
      await confirmActionRef.action();
      setConfirmOpen(false);
    } catch (e: any) {
      showToast(e?.message ? String(e.message) : 'Action failed', 'error');
    } finally {
      setConfirmBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/branches');
      setBranches(data ?? []);
    } catch {
      setError('Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const payload = {
        ...createForm,
        maxTablesPerWaiter: createForm.maxTablesPerWaiter
          ? parseInt(createForm.maxTablesPerWaiter, 10)
          : null,
      };
      const { success, error: err, data } = await api.post('/api/branches', payload);
      if (!success) {
        setCreateError(err || 'Failed to create branch');
        return;
      }
      setBranches((prev) => [...prev, data]);
      setCreateForm({ name: '', slug: '', address: '', phone: '', maxTablesPerWaiter: '' });
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
      const payload = {
        ...editForm,
        maxTablesPerWaiter: editForm.maxTablesPerWaiter
          ? parseInt(editForm.maxTablesPerWaiter, 10)
          : null,
        taxRate: editForm.taxRate === '' ? null : Number(editForm.taxRate),
        serviceChargeRate:
          editForm.serviceChargeRate === '' ? null : Number(editForm.serviceChargeRate),
      };
      const { success, data } = await api.put(`/api/branches/${id}`, payload);
      if (success) {
        setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, ...data } : b)));
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(branch: Branch) {
    const { success, data } = await api.put(`/api/branches/${branch.id}`, {
      isActive: !branch.isActive,
    });
    if (success)
      setBranches((prev) => prev.map((b) => (b.id === branch.id ? { ...b, ...data } : b)));
  }

  function handleDelete(id: string) {
    openConfirm(
      'Permanent Delete',
      'Are you sure you want to permanently delete this branch? All associated data, orders, and staff may be lost. This cannot be undone.',
      async () => {
        const res = await api.delete(`/api/branches/${id}`);
        if (!res.success) throw new Error(res.error || 'Failed to delete branch');
        setBranches((prev) => prev.filter((b) => b.id !== id));
      },
    );
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!adminBranchId) return;
    setCreatingAdmin(true);
    setAdminError('');
    setAdminSuccess('');
    try {
      const {
        success,
        error: err,
        data,
      } = await api.post(`/api/branches/${adminBranchId}/admin`, adminForm);
      if (!success) {
        setAdminError(err || 'Failed to create admin');
        return;
      }
      setAdminSuccess(
        `Branch admin "${data.name}" created. They can log in with their email and password.`,
      );
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
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel="Permanent Delete"
        variant="danger"
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirmOpen(false);
        }}
        onConfirm={() => void onConfirm()}
      />

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
                <label
                  htmlFor="branch_create_name"
                  className="text-xs text-[var(--muted)] uppercase tracking-wider"
                >
                  Branch Name *
                </label>
                <input
                  id="branch_create_name"
                  name="name"
                  type="text"
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      name: e.target.value,
                      slug: slugify(e.target.value),
                    }))
                  }
                  placeholder="e.g. Cevop Lekki"
                  required
                  autoComplete="off"
                />
              </div>
              <div>
                <label
                  htmlFor="branch_create_slug"
                  className="text-xs text-[var(--muted)] uppercase tracking-wider"
                >
                  Slug *
                </label>
                <input
                  id="branch_create_slug"
                  name="slug"
                  type="text"
                  value={createForm.slug}
                  onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="e.g. cevop-lekki"
                  required
                  autoComplete="off"
                />
              </div>
              <div>
                <label
                  htmlFor="branch_create_address"
                  className="text-xs text-[var(--muted)] uppercase tracking-wider"
                >
                  Address
                </label>
                <input
                  id="branch_create_address"
                  name="address"
                  type="text"
                  value={createForm.address}
                  onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. 5 Admiralty Way, Lekki"
                  autoComplete="street-address"
                />
              </div>
              <div>
                <label
                  htmlFor="branch_create_phone"
                  className="text-xs text-[var(--muted)] uppercase tracking-wider"
                >
                  Phone
                </label>
                <input
                  id="branch_create_phone"
                  name="phone"
                  type="text"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="e.g. +234 800 000 0000"
                  autoComplete="tel"
                />
              </div>
              <div>
                <label
                  htmlFor="branch_create_max_tables"
                  className="text-xs text-[var(--muted)] uppercase tracking-wider"
                >
                  Max Tables/Waiter
                </label>
                <input
                  id="branch_create_max_tables"
                  name="maxTablesPerWaiter"
                  type="number"
                  min="1"
                  value={createForm.maxTablesPerWaiter}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, maxTablesPerWaiter: e.target.value }))
                  }
                  placeholder="e.g. 5 (Leave blank for unlimited)"
                />
              </div>
            </div>
            {createError && <p className="text-red-400 text-sm">{createError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="btn btn-secondary px-4 py-2 text-sm flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="btn btn-primary px-4 py-2 text-sm flex-1 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create Branch'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Branches List */}
      {branches.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)]">
          <div className="w-10 h-10 border border-[var(--border)] rounded-sm mx-auto mb-3 flex items-center justify-center text-[var(--muted)] text-xs font-bold">
            0
          </div>
          <p>No branches yet. Create your first branch to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {branches.map((branch) => (
            <div key={branch.id} className={`card p-4 ${!branch.isActive ? 'opacity-50' : ''}`}>
              {editingId === branch.id ? (
                /* Edit form */
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label
                        htmlFor={`branch_edit_name_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Name
                      </label>
                      <input
                        id={`branch_edit_name_${branch.id}`}
                        name="name"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`branch_edit_address_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Address
                      </label>
                      <input
                        id={`branch_edit_address_${branch.id}`}
                        name="address"
                        value={editForm.address}
                        onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                        autoComplete="street-address"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`branch_edit_phone_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Phone
                      </label>
                      <input
                        id={`branch_edit_phone_${branch.id}`}
                        name="phone"
                        value={editForm.phone}
                        onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                        autoComplete="tel"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`branch_edit_max_tables_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Max Tables/Waiter
                      </label>
                      <input
                        id={`branch_edit_max_tables_${branch.id}`}
                        name="maxTablesPerWaiter"
                        type="number"
                        min="1"
                        value={editForm.maxTablesPerWaiter}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, maxTablesPerWaiter: e.target.value }))
                        }
                        placeholder="Unlimited"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`branch_edit_tax_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Tax Rate (%)
                      </label>
                      <input
                        id={`branch_edit_tax_${branch.id}`}
                        name="taxRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={editForm.taxRate}
                        onChange={(e) => setEditForm((f) => ({ ...f, taxRate: e.target.value }))}
                        placeholder="Org Default"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`branch_edit_service_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Service Chg (%)
                      </label>
                      <input
                        id={`branch_edit_service_${branch.id}`}
                        name="serviceChargeRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={editForm.serviceChargeRate}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, serviceChargeRate: e.target.value }))
                        }
                        placeholder="Org Default"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="btn btn-secondary text-xs px-3 py-1.5"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleEdit(branch.id)}
                      disabled={saving}
                      className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                    >
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
                      <span className="text-xs text-[var(--muted)] font-mono bg-[var(--surface2)] px-1.5 py-0.5">
                        {branch.slug}
                      </span>
                      {!branch.isActive && (
                        <span className="text-xs text-red-400 bg-red-900/20 border border-red-800 px-1.5 py-0.5">
                          Inactive
                        </span>
                      )}
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
                        setEditForm({
                          name: branch.name,
                          address: branch.address ?? '',
                          phone: branch.phone ?? '',
                          maxTablesPerWaiter: branch.maxTablesPerWaiter?.toString() ?? '',
                          taxRate: branch.taxRate?.toString() ?? '',
                          serviceChargeRate: branch.serviceChargeRate?.toString() ?? '',
                        });
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
                          ? 'text-amber-400 border-amber-800 hover:bg-amber-900/20'
                          : 'text-green-400 border-green-800 hover:bg-green-900/20'
                      }`}
                    >
                      {branch.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => {
                        setKioskBranch(branch);
                        setCopied(false);
                      }}
                      className="flex-1 sm:flex-none text-xs text-[var(--accent)] border border-[var(--accent)]/50 hover:bg-[var(--accent)]/10 px-2.5 py-1.5 transition-colors"
                    >
                      Kiosk QR
                    </button>
                    <button
                      onClick={() => handleDelete(branch.id)}
                      className="flex-1 sm:flex-none text-xs text-red-400 border border-red-800 hover:bg-red-900/20 px-2.5 py-1.5 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {/* Create Admin sub-form */}
              {adminBranchId === branch.id && (
                <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-3">
                  <h4 className="text-sm font-semibold text-[var(--text)]">
                    Create Branch Admin for {branch.name}
                  </h4>
                  <form
                    onSubmit={handleCreateAdmin}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-3"
                  >
                    <div>
                      <label
                        htmlFor={`branch_admin_name_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Name *
                      </label>
                      <input
                        id={`branch_admin_name_${branch.id}`}
                        name="name"
                        type="text"
                        value={adminForm.name}
                        onChange={(e) => setAdminForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Jane Doe"
                        required
                        autoComplete="name"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`branch_admin_email_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Email *
                      </label>
                      <input
                        id={`branch_admin_email_${branch.id}`}
                        name="email"
                        type="email"
                        value={adminForm.email}
                        onChange={(e) => setAdminForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="e.g. manager@branch.com"
                        required
                        autoComplete="email"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`branch_admin_password_${branch.id}`}
                        className="text-xs text-[var(--muted)] uppercase tracking-wider"
                      >
                        Password *
                      </label>
                      <div className="relative">
                        <input
                          id={`branch_admin_password_${branch.id}`}
                          name="password"
                          type={showAdminPassword ? 'text' : 'password'}
                          value={adminForm.password}
                          onChange={(e) =>
                            setAdminForm((f) => ({ ...f, password: e.target.value }))
                          }
                          placeholder="••••••••"
                          required
                          minLength={8}
                          className="pr-10"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAdminPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-xs select-none"
                          tabIndex={-1}
                          title={showAdminPassword ? 'Hide password' : 'Show password'}
                        >
                          {showAdminPassword ? (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          ) : (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                    {adminError && (
                      <p className="sm:col-span-3 text-red-400 text-sm">{adminError}</p>
                    )}
                    {adminSuccess && (
                      <p className="sm:col-span-3 text-green-400 text-sm">{adminSuccess}</p>
                    )}
                    <div className="sm:col-span-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAdminBranchId(null);
                          setAdminError('');
                          setAdminSuccess('');
                        }}
                        className="btn btn-secondary flex-1 sm:flex-none text-xs px-3 py-1.5"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={creatingAdmin}
                        className="btn btn-primary flex-1 sm:flex-none text-xs px-3 py-1.5 disabled:opacity-50"
                      >
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
      {/* Kiosk QR Modal */}
      {kioskBranch &&
        (() => {
          const branch = kioskBranch;
          const orgId = user?.organizationId ?? '';
          const kioskUrl = `${SERVICE_DISPLAY_URL}/kiosk?orgId=${orgId}&branchId=${branch.id}`;

          function copyUrl() {
            navigator.clipboard.writeText(kioskUrl).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }

          function printKiosk() {
            const w = window.open('', '_blank', 'width=600,height=700');
            if (!w) return;
            const svgEl = printRef.current?.querySelector('svg');
            const svgHtml = svgEl ? svgEl.outerHTML : '';
            w.document.write(`
            <!DOCTYPE html><html><head><title>Kiosk QR — ${branch.name}</title>
            <style>
              body { font-family: system-ui, sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:2rem; box-sizing:border-box; text-align:center; }
              h1 { font-size:2rem; font-weight:900; letter-spacing:0.05em; text-transform:uppercase; margin:0 0 0.25rem; }
              p { color:#666; margin:0 0 1.5rem; font-size:0.875rem; }
              .qr { margin: 1rem 0; }
              .url { font-family:monospace; font-size:0.7rem; color:#888; word-break:break-all; margin-top:1rem; border:1px solid #ddd; padding:0.5rem; border-radius:4px; }
              .instructions { margin-top:1.5rem; font-size:0.8rem; color:#555; line-height:1.6; }
              @media print { body { padding:1rem; } }
            </style></head>
            <body>
              <h1>Staff Clock-In</h1>
              <p>${branch.name}</p>
              <div class="qr">${svgHtml}</div>
              <p style="font-size:0.75rem;color:#999">Scan with phone camera to open kiosk</p>
              <div class="instructions">
                Enter your staff code (e.g. W-01, K-02) to clock in or out.<br>
                The code on your staff profile card.
              </div>
              <div class="url">${kioskUrl}</div>
              <script>window.onload=()=>window.print();</script>
            </body></html>
          `);
            w.document.close();
          }

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setKioskBranch(null)}
            >
              <div
                className="card w-full max-w-sm p-6 space-y-5"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-2xl">STAFF KIOSK</h2>
                    <p className="text-sm text-[var(--muted)] mt-0.5">{branch.name}</p>
                  </div>
                  <button
                    onClick={() => setKioskBranch(null)}
                    className="text-[var(--muted)] text-2xl leading-none hover:text-[var(--text)] w-8 h-8 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>

                {/* QR Code */}
                <div
                  ref={printRef}
                  className="flex flex-col items-center gap-3 p-5 border border-[var(--border)] bg-white"
                >
                  <QRCodeSVG
                    value={kioskUrl}
                    size={200}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="M"
                  />
                  <p className="text-xs text-gray-500 font-medium text-center">
                    {branch.name} · Staff Clock-In
                  </p>
                </div>

                {/* Instructions */}
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Put this QR code on a shared tablet in the break room or at the entrance. Staff
                  scan it to open the clock-in kiosk — no login needed. They enter their staff code
                  (e.g. <span className="font-mono bg-[var(--surface2)] px-1">W-01</span>) to clock
                  in or out.
                </p>

                {/* URL + copy */}
                <div className="flex items-center gap-2 p-2.5 bg-[var(--surface2)] border border-[var(--border)]">
                  <span className="font-mono text-[10px] text-[var(--muted)] flex-1 break-all leading-tight">
                    {kioskUrl}
                  </span>
                  <button
                    onClick={copyUrl}
                    className={`shrink-0 text-xs font-bold px-2.5 py-1.5 border transition-all ${
                      copied
                        ? 'border-[var(--ready)] text-[var(--ready)]'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button onClick={() => setKioskBranch(null)} className="btn btn-secondary flex-1">
                    Close
                  </button>
                  <button
                    onClick={printKiosk}
                    className="btn btn-primary flex-1 flex items-center justify-center gap-1.5"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 6 2 18 2 18 9" />
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                      <rect x="6" y="14" width="12" height="8" />
                    </svg>
                    Print / Save PDF
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
