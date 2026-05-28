import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth, useApi } from '../context/auth';
import { ConfirmDialog, showToast } from '../components/Popup';

interface Station {
  id: string;
  name: string;
  isActive: boolean;
  branchId: string;
}

export function StationsPage() {
  const { user, activeBranchFilter } = useAuth();
  const api = useApi();

  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editing, setEditing] = useState<Station | null>(null);
  const [editForm, setEditForm] = useState({ name: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmLabel, setConfirmLabel] = useState('Confirm');
  const [confirmVariant, setConfirmVariant] = useState<'default' | 'danger'>('default');
  const confirmActionRef = useRef<null | (() => Promise<void> | void)>(null);

  const branchId = user?.branchId || activeBranchFilter?.id;

  function openConfirm(opts: {
    title: string;
    message?: string;
    confirmLabel?: string;
    variant?: 'default' | 'danger';
    action: () => Promise<void> | void;
  }) {
    confirmActionRef.current = opts.action;
    setConfirmTitle(opts.title);
    setConfirmMessage(opts.message ?? '');
    setConfirmLabel(opts.confirmLabel ?? 'Confirm');
    setConfirmVariant(opts.variant ?? 'default');
    setConfirmOpen(true);
  }

  async function onConfirm() {
    if (confirmBusy) return;
    const action = confirmActionRef.current;
    if (!action) {
      setConfirmOpen(false);
      return;
    }
    setConfirmBusy(true);
    try {
      await action();
      setConfirmOpen(false);
    } catch (e: any) {
      showToast(e?.message ? String(e.message) : 'Action failed', 'error');
    } finally {
      setConfirmBusy(false);
    }
  }

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/stations?branchId=${branchId}`);
      setStations(res.data ?? []);
    } catch {
      setError('Failed to load stations');
    } finally {
      setLoading(false);
    }
  }, [api, branchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (branchId) void load();
  }, [load, branchId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId) return;
    setCreating(true);
    setCreateError('');
    try {
      const {
        success,
        error: err,
        data,
      } = await api.post('/api/stations', {
        name: form.name,
        branchId,
      });
      if (!success) {
        setCreateError(err || 'Failed to create station');
        return;
      }
      setStations((prev) => [...prev, data]);
      setForm({ name: '' });
      setShowCreate(false);
    } catch {
      setCreateError('Failed to create station');
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError('');
    try {
      const {
        success,
        error: err,
        data,
      } = await api.patch(`/api/stations/${editing.id}`, {
        name: editForm.name,
      });
      if (!success) {
        setEditError(err || 'Failed to update station');
        return;
      }
      setStations((prev) => prev.map((s) => (s.id === editing.id ? { ...s, ...data } : s)));
      setEditing(null);
    } catch {
      setEditError('Failed to update station');
    } finally {
      setEditSaving(false);
    }
  }

  function deleteStation(station: Station) {
    openConfirm({
      title: 'Delete Station',
      message: `Are you sure you want to delete ${station.name}?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      action: async () => {
        const { success, error: err } = await api.delete(`/api/stations/${station.id}`);
        if (!success) throw new Error(err || 'Failed to delete station');
        setStations((prev) => prev.filter((s) => s.id !== station.id));
      },
    });
  }

  if (!branchId) {
    return (
      <div className="text-[var(--muted)] text-sm">
        Please select a branch to view its stations.
      </div>
    );
  }

  if (loading) return <div className="text-[var(--muted)] text-sm">Loading…</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        variant={confirmVariant}
        busy={confirmBusy}
        onCancel={() => {
          if (confirmBusy) return;
          setConfirmOpen(false);
        }}
        onConfirm={() => void onConfirm()}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">KITCHEN STATIONS</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            Manage preparation areas (e.g. Grill, Drinks)
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary btn-sm">
          + Add Station
        </button>
      </div>

      {showCreate && (
        <div className="card p-5 space-y-4 border-[var(--accent)]">
          <h2 className="font-semibold text-[var(--text)]">New Station</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label htmlFor="station_name">Name *</label>
              <input
                id="station_name"
                value={form.name}
                onChange={(e) => setForm({ name: e.target.value })}
                required
                autoFocus
                placeholder="e.g. Grill"
              />
            </div>
            {createError && <p className="text-red-400 text-sm">{createError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="btn btn-secondary flex-1 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="btn btn-primary flex-1 py-2 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create Station'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div className="card p-5 space-y-4 border-[var(--accent)]">
          <h2 className="font-semibold text-[var(--text)]">Edit Station: {editing.name}</h2>
          <form onSubmit={saveEdit} className="space-y-3">
            <div>
              <label htmlFor="edit_station_name">Name *</label>
              <input
                id="edit_station_name"
                value={editForm.name}
                onChange={(e) => setEditForm({ name: e.target.value })}
                required
                autoFocus
              />
            </div>
            {editError && <p className="text-red-400 text-sm">{editError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="btn btn-secondary flex-1 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="btn btn-primary flex-1 py-2 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {stations.length === 0 && !showCreate && !editing ? (
        <div className="card p-8 text-center text-[var(--muted)] space-y-2">
          <p>No stations configured.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="text-[var(--accent)] hover:underline"
          >
            Create your first station
          </button>
        </div>
      ) : (
        <div className="card divide-y divide-[var(--border)]">
          {stations.map((s) => (
            <div
              key={s.id}
              className="p-4 flex items-center justify-between hover:bg-[var(--surface2)] transition-colors"
            >
              <div>
                <h3 className="font-semibold text-[var(--text)]">{s.name}</h3>
                {!s.isActive && (
                  <span className="text-xs text-red-400 border border-red-800 bg-red-900/20 px-1 rounded">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditing(s);
                    setEditForm({ name: s.name });
                  }}
                  className="text-[var(--muted)] hover:text-[var(--text)] p-2 transition-colors"
                  title="Edit Station"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                </button>
                <button
                  onClick={() => deleteStation(s)}
                  className="text-[var(--muted)] hover:text-[var(--danger)] p-2 transition-colors"
                  title="Delete Station"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
