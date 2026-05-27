import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApi, useAuth } from '../context/auth';
import { useSocket } from '../context/socket';
import { ConfirmDialog, showToast } from '../components/Popup';

interface Table {
  id: string;
  label: string;
  number: number;
  isActive: boolean;
  organizationId: string;
  branchId: string | null;
  status: string;
  activeSessionId: string | null;
  activeSession?: {
    id: string;
    assignedWaiter?: {
      id: string;
      name: string;
      staffCode?: string | null;
    } | null;
  } | null;
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
  const { user } = useAuth();
  const api = useApi();
  const { socket, syncSignal } = useSocket();
  const [tables, setTables] = useState<Table[]>([]);
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const [qrCodes, setQrCodes] = useState<QREntry[]>([]);
  const [qrCardCache, setQrCardCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [staffList, setStaffStaffList] = useState<any[]>([]);
  const [assignModal, setAssignModal] = useState<{ sessionId: string; tableLabel: string } | null>(
    null,
  );
  const [assigning, setAssigning] = useState(false);

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ label: '', number: '', sectionId: '' });
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [error, setError] = useState('');
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false);
  const [qrPreviewTable, setQrPreviewTable] = useState<Table | null>(null);
  const [qrPreviewDataUrl, setQrPreviewDataUrl] = useState<string | null>(null);
  const [qrPreviewBusy, setQrPreviewBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmLabel, setConfirmLabel] = useState('Confirm');
  const [confirmVariant, setConfirmVariant] = useState<'default' | 'danger'>('default');
  const confirmActionRef = useRef<null | (() => Promise<void> | void)>(null);

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
    setLoading(true);
    if (!api.effectiveBranchId) {
      setTables([]);
      setLoading(false);
      return;
    }
    const [res, secRes, staffRes] = await Promise.all([
      api.get('/api/tables'),
      api.get('/api/sections'),
      api.get('/api/users'),
    ]);
    if (res.success) setTables(res.data);
    if (secRes.success) setSections(secRes.data);
    if (staffRes.success) {
      setStaffStaffList(
        staffRes.data.filter(
          (u: any) => ['WAITER', 'SERVICE', 'CASHIER', 'HOST'].includes(u.role) && u.isActive,
        ),
      );
    }
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

  // Re-fetch whenever server signals sync needed
  useEffect(() => {
    if (syncSignal === 0) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [syncSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time updates
  useEffect(() => {
    if (!socket) return;

    const handleTableStatusChanged = ({ tableId, status }: { tableId: string; status: string }) => {
      setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, status } : t)));
    };

    const handleSessionOpened = ({
      tableId,
      sessionId,
    }: {
      tableId: string;
      sessionId: string;
    }) => {
      setTables((prev) =>
        prev.map((t) =>
          t.id === tableId ? { ...t, activeSessionId: sessionId, status: 'OCCUPIED' } : t,
        ),
      );
    };

    const handleSessionClosed = ({ tableId }: { tableId: string }) => {
      setTables((prev) =>
        prev.map((t) =>
          t.id === tableId ? { ...t, activeSessionId: null, activeSession: null } : t,
        ),
      );
    };

    const handleTableClaimed = ({
      tableId,
      waiterId,
      waiterName,
      staffCode,
      sessionId,
    }: {
      tableId: string;
      waiterId: string;
      waiterName: string;
      staffCode?: string | null;
      sessionId: string;
    }) => {
      setTables((prev) =>
        prev.map((t) => {
          if (t.id === tableId) {
            return {
              ...t,
              activeSessionId: sessionId,
              activeSession: {
                id: sessionId,
                assignedWaiter: {
                  id: waiterId,
                  name: waiterName,
                  staffCode,
                },
              },
            };
          }
          return t;
        }),
      );
    };

    socket.on('TABLE_STATUS_CHANGED', handleTableStatusChanged);
    socket.on('SESSION_OPENED', handleSessionOpened);
    socket.on('SESSION_CLOSED', handleSessionClosed);
    socket.on('TABLE_CLAIMED', handleTableClaimed);

    function handleReconnect() {
      void load();
    }
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('TABLE_STATUS_CHANGED', handleTableStatusChanged);
      socket.off('SESSION_OPENED', handleSessionOpened);
      socket.off('SESSION_CLOSED', handleSessionClosed);
      socket.off('TABLE_CLAIMED', handleTableClaimed);
      socket.off('connect', handleReconnect);
    };
  }, [socket]);

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
    const orgSlug = user?.organization?.slug || t.organizationId;
    const url = `${PWA_URL}/menu/${orgSlug}/${t.number}`;
    navigator.clipboard.writeText(url);
    showToast('Customer link copied to clipboard!', 'success');
  }

  async function deactivate(id: string) {
    openConfirm({
      title: 'Deactivate Table',
      message: 'Deactivate this table? It will no longer be accessible by customers.',
      confirmLabel: 'Deactivate',
      variant: 'danger',
      action: async () => {
        await api.delete(`/api/tables/${id}`);
        await load();
      },
    });
  }

  async function activate(id: string) {
    await api.put(`/api/tables/${id}`, { isActive: true });
    load();
  }

  async function deleteTable(id: string, label: string) {
    openConfirm({
      title: 'Delete Table',
      message: `Permanently delete "${label}"? All historical orders, sessions and payments for this table are preserved — only the table record is removed. This cannot be undone.`,
      confirmLabel: 'Delete Permanently',
      variant: 'danger',
      action: async () => {
        const res = await api.delete(`/api/tables/${id}?permanent=true`);
        if (!res.success) throw new Error(res.error || 'Failed to delete table');
        await load();
      },
    });
  }

  function downloadQR(entry: QREntry) {
    const a = document.createElement('a');
    a.href = entry.qrDataUrl;
    a.download = `table-${entry.tableNumber}-qr.png`;
    a.click();
  }

  function downloadPng(dataUrl: string, filename: string) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  async function getOrFetchQrEntry(tableId: string): Promise<QREntry | null> {
    const existing = qrCodes.find((q) => q.tableId === tableId);
    if (existing) return existing;
    const res = await api.get('/api/tables/qr/bulk');
    if (!res?.success) return null;
    const list: QREntry[] = res.data ?? [];
    setQrCodes(list);
    return list.find((q) => q.tableId === tableId) ?? null;
  }

  async function buildQrCardPng(entry: QREntry, orgName: string): Promise<string> {
    const cached = qrCardCache[entry.tableId];
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    const w = 900;
    const h = 1200;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return entry.qrDataUrl;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#111111';
    ctx.strokeRect(30, 30, w - 60, h - 60);

    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';

    const safeOrg = (orgName || 'CEVOP').toUpperCase();
    ctx.font = '800 44px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(safeOrg.length > 24 ? safeOrg.slice(0, 24) + '…' : safeOrg, w / 2, 110);

    const tableTitle = entry.tableLabel?.trim() ? entry.tableLabel : `TABLE ${entry.tableNumber}`;
    ctx.font = '900 80px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(
      tableTitle.length > 14 ? tableTitle.slice(0, 14) + '…' : tableTitle.toUpperCase(),
      w / 2,
      210,
    );

    const img = new Image();
    img.src = entry.qrDataUrl;
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });

    const qrSize = 620;
    const qrX = Math.round((w - qrSize) / 2);
    const qrY = 290;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(qrX - 20, qrY - 20, qrSize + 40, qrSize + 40);
    ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

    ctx.fillStyle = '#111111';
    ctx.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText('SCAN TO VIEW MENU', w / 2, 980);

    const dataUrl = canvas.toDataURL('image/png');
    setQrCardCache((prev) => ({ ...prev, [entry.tableId]: dataUrl }));
    return dataUrl;
  }

  async function openQrPreview(t: Table) {
    setQrPreviewOpen(true);
    setQrPreviewTable(t);
    setQrPreviewDataUrl(null);
    setQrPreviewBusy(true);
    try {
      const entry = await getOrFetchQrEntry(t.id);
      if (!entry) return;
      const orgName = user?.organization?.name ?? 'CEVOP';
      const card = await buildQrCardPng(entry, orgName);
      setQrPreviewDataUrl(card);
    } finally {
      setQrPreviewBusy(false);
    }
  }

  async function saveQrCard(entry: QREntry) {
    const orgName = user?.organization?.name ?? 'CEVOP';
    const card = await buildQrCardPng(entry, orgName);
    downloadPng(card, `table-${entry.tableNumber}-qr.png`);
  }

  async function clearTable(sessionId: string) {
    openConfirm({
      title: 'Clear Table',
      message: 'Clear this table? It will move to CLEANING.',
      confirmLabel: 'Clear',
      action: async () => {
        await api.patch(`/api/sessions/${sessionId}/close`, { nextStatus: 'CLEANING' });
        await load();
      },
    });
  }

  async function markTableEmpty(tableId: string) {
    openConfirm({
      title: 'Mark Clean',
      message: 'Mark this table as clean/empty?',
      confirmLabel: 'Mark Clean',
      action: async () => {
        await api.patch(`/api/tables/${tableId}/status`, { status: 'EMPTY' });
        await load();
      },
    });
  }

  async function assignWaiter(waiterId: string | null) {
    if (!assignModal) return;
    setAssigning(true);
    try {
      const res = await api.patch(`/api/sessions/${assignModal.sessionId}/assign-waiter`, {
        waiterId,
      });
      if (res.success) {
        setAssignModal(null);
        load();
      } else {
        showToast(res.error || 'Failed to assign waiter', 'error');
      }
    } finally {
      setAssigning(false);
    }
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
                  {t.activeSessionId && (
                    <div className="mt-1.5">
                      {t.activeSession?.assignedWaiter ? (
                        <button
                          onClick={() =>
                            setAssignModal({
                              sessionId: t.activeSessionId!,
                              tableLabel: t.label,
                            })
                          }
                          className="text-[10px] bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider border border-indigo-500/20 transition-colors"
                        >
                          {t.activeSession.assignedWaiter.staffCode
                            ? `#${t.activeSession.assignedWaiter.staffCode} - ${t.activeSession.assignedWaiter.name}`
                            : t.activeSession.assignedWaiter.name}
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setAssignModal({
                              sessionId: t.activeSessionId!,
                              tableLabel: t.label,
                            })
                          }
                          className="text-[10px] text-[var(--muted)] hover:text-indigo-500 font-bold uppercase border border-dashed border-[var(--border)] px-2 py-0.5 rounded-sm transition-colors"
                        >
                          + Staff
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void openQrPreview(t)}
                    >
                      View QR
                    </button>
                    <a
                      href={`${API_BASE}/api/tables/${t.id}/qr?format=png`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                    >
                      Raw
                    </a>
                  </div>
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
                    {t.status === 'CLEANING' && !t.activeSessionId && (
                      <button
                        className="btn btn-secondary btn-sm text-green-500"
                        onClick={() => markTableEmpty(t.id)}
                      >
                        Mark Clean
                      </button>
                    )}
                    {!t.isActive && !t.activeSessionId && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => deleteTable(t.id, t.label)}
                      >
                        Delete
                      </button>
                    )}
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
                  src={qrCardCache[entry.tableId] || entry.qrDataUrl}
                  alt={entry.tableLabel}
                  className="w-full aspect-square"
                  onClick={() => {
                    const t = tables.find((x) => x.id === entry.tableId);
                    if (t) void openQrPreview(t);
                  }}
                />
                <p className="font-bold text-sm">{entry.tableLabel}</p>
                <div className="space-y-2">
                  <button
                    className="btn btn-secondary btn-sm w-full"
                    onClick={() => void saveQrCard(entry)}
                  >
                    ↓ Save
                  </button>
                  <button
                    className="btn btn-secondary btn-sm w-full"
                    onClick={() => downloadQR(entry)}
                  >
                    Raw
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {qrPreviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setQrPreviewOpen(false)}
        >
          <div
            className="card w-full max-w-xl p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">TABLE QR</h2>
                <p className="text-sm text-[var(--muted)]">
                  {qrPreviewTable?.label ? qrPreviewTable.label : ''}
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setQrPreviewOpen(false)}>
                Close
              </button>
            </div>

            <div className="flex items-center justify-center">
              {qrPreviewBusy || !qrPreviewDataUrl ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <img
                  src={qrPreviewDataUrl}
                  alt="QR preview"
                  className="w-full max-w-[420px] border border-[var(--border)] bg-white"
                />
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                className="btn btn-primary flex-1 disabled:opacity-50"
                disabled={qrPreviewBusy || !qrPreviewDataUrl}
                onClick={() => {
                  if (!qrPreviewDataUrl || !qrPreviewTable) return;
                  downloadPng(qrPreviewDataUrl, `table-${qrPreviewTable.number}-qr.png`);
                }}
              >
                Download PNG
              </button>
              <button
                className="btn btn-secondary flex-1 disabled:opacity-50"
                disabled={!qrPreviewTable}
                onClick={() => {
                  if (!qrPreviewTable) return;
                  copyLink(qrPreviewTable);
                }}
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      )}

      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in">
          <div
            className="card w-full max-w-sm p-6 space-y-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl text-[var(--text)] uppercase tracking-tight">
                Assign Staff
              </h3>
              <button
                onClick={() => setAssignModal(null)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-xl"
              >
                ×
              </button>
            </div>

            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Manually assign a staff member to{' '}
              <span className="text-[var(--text)] font-bold">{assignModal.tableLabel}</span> for the
              current active session.
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
              <button
                onClick={() => assignWaiter(null)}
                disabled={assigning}
                className="w-full text-left p-3 rounded-sm border border-[var(--border)] hover:border-[var(--danger)] hover:bg-[var(--danger)]/5 text-[var(--danger)] text-xs font-bold uppercase tracking-widest transition-all"
              >
                Remove Current Assignment
              </button>
              <div className="h-px bg-[var(--border)] my-4 opacity-50" />
              {staffList.map((staff) => (
                <button
                  key={staff.id}
                  disabled={assigning}
                  onClick={() => assignWaiter(staff.id)}
                  className="w-full text-left p-3 rounded-sm border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                        {staff.name}
                      </div>
                      <div className="text-[10px] text-[var(--muted)] uppercase tracking-widest mt-0.5">
                        {staff.role}
                      </div>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-[var(--border)] group-hover:bg-[var(--accent)] transition-colors" />
                  </div>
                </button>
              ))}
            </div>

            <div className="pt-2">
              <button
                onClick={() => setAssignModal(null)}
                className="w-full btn btn-secondary py-3 text-xs font-bold uppercase tracking-widest"
                disabled={assigning}
              >
                Cancel
              </button>
            </div>
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
            <div>
              <label htmlFor="table_form_section">Section</label>
              <select
                id="table_form_section"
                name="sectionId"
                value={form.sectionId}
                onChange={(e) => setForm({ ...form, sectionId: e.target.value })}
              >
                <option value="">No Section (Unassigned)</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
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
