import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApi } from '../context/auth';
import { ConfirmDialog, showToast } from '../components/Popup';

interface User {
  id: string;
  name: string;
  staffCode: string | null;
  isOnShift: boolean;
  role: string;
  isActive: boolean;
}

interface SectionStaff {
  id: string;
  user: User;
}

interface Section {
  id: string;
  name: string;
  colour: string | null;
  sortOrder: number;
  isActive: boolean;
  staff: SectionStaff[];
  _count: { tables: number };
}

export function SectionsPage() {
  const api = useApi();
  const [sections, setSections] = useState<Section[]>([]);
  const [branchStaff, setBranchStaff] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', colour: '' });

  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
      setSections([]);
      setLoading(false);
      return;
    }
    const [secRes, staffRes] = await Promise.all([api.get('/api/sections'), api.get('/api/users')]);

    if (secRes.success) setSections(secRes.data);
    if (staffRes.success) {
      setBranchStaff(
        staffRes.data.filter(
          (u: User) => ['WAITER', 'SERVICE', 'KITCHEN'].includes(u.role) && u.isActive,
        ),
      );
    }

    setLoading(false);
  }, [api]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function saveSection() {
    setSaving(true);
    setError('');
    try {
      let res;
      const payload = { name: form.name, colour: form.colour || undefined };
      if (editingId) {
        res = await api.put(`/api/sections/${editingId}`, payload);
      } else {
        res = await api.post('/api/sections', payload);
      }
      if (!res.success) throw new Error(res.error);
      setModalOpen(false);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSection(id: string) {
    openConfirm({
      title: 'Delete Section',
      message:
        'Are you sure you want to delete this section?\n\nTables assigned to it will become unassigned.',
      confirmLabel: 'Delete',
      variant: 'danger',
      action: async () => {
        await api.delete(`/api/sections/${id}`);
        await load();
      },
    });
  }

  async function saveStaff() {
    if (!activeSectionId) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/api/sections/${activeSectionId}/staff`, {
        userIds: selectedStaffIds,
      });
      if (!res.success) throw new Error(res.error);
      setStaffModalOpen(false);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading sections...</div>;

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Floor Sections</h1>
          <p className="text-sm text-gray-500">Manage floor zones and assign staff to them.</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setForm({ name: '', colour: '#4f46e5' });
            setError('');
            setModalOpen(true);
          }}
          className="btn-primary"
        >
          Add Section
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <div key={section.id} className="card p-5 relative overflow-hidden group">
            <div
              className="absolute top-0 left-0 bottom-0 w-2"
              style={{ backgroundColor: section.colour || '#e5e7eb' }}
            />
            <div className="pl-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">{section.name}</h3>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => {
                      setEditingId(section.id);
                      setForm({ name: section.name, colour: section.colour || '#e5e7eb' });
                      setError('');
                      setModalOpen(true);
                    }}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteSection(section.id)}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="text-sm text-gray-500 mb-4">
                {section._count.tables} tables assigned
                <span className="text-xs text-gray-400 block mt-0.5">
                  Assign tables to this section from the Tables &amp; QR page.
                </span>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mt-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Assigned Staff
                  </span>
                  <button
                    onClick={() => {
                      setActiveSectionId(section.id);
                      setSelectedStaffIds(section.staff.map((s) => s.user.id));
                      setError('');
                      setStaffModalOpen(true);
                    }}
                    className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-medium"
                  >
                    Manage
                  </button>
                </div>
                {section.staff.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No staff assigned</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {section.staff.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800"
                      >
                        {s.user.name} {s.user.staffCode ? `(${s.user.staffCode})` : ''}
                        {s.user.isOnShift && (
                          <span
                            className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-500"
                            title="Online"
                          />
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {sections.length === 0 && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-lg">
            <p className="text-gray-500 mb-2">No sections created yet.</p>
            <p className="text-sm text-gray-400">
              Sections help you route requests to specific waiters based on table location.
            </p>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-gray-800">
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              {editingId ? 'Edit Section' : 'Add Section'}
            </h2>
            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Name
                </label>
                <input
                  autoFocus
                  className="input"
                  placeholder="e.g. Main Floor, Patio"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Colour Label
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-16 p-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-black cursor-pointer"
                    value={form.colour}
                    onChange={(e) => setForm({ ...form, colour: e.target.value })}
                  />
                  <input
                    type="text"
                    className="input flex-1 font-mono uppercase"
                    value={form.colour}
                    onChange={(e) => setForm({ ...form, colour: e.target.value })}
                    placeholder="#HEX"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={saveSection}
                disabled={saving || !form.name.trim()}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {staffModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-gray-800">
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Assign Staff</h2>
            <p className="text-sm text-gray-500 mb-4">
              Select waiters to handle requests from this section.
            </p>
            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-2 mb-6 p-1">
              {branchStaff.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No waiters found in this branch.
                </p>
              ) : (
                branchStaff.map((staff) => (
                  <label
                    key={staff.id}
                    className="flex items-center gap-3 p-3 border border-gray-100 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                      checked={selectedStaffIds.includes(staff.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedStaffIds([...selectedStaffIds, staff.id]);
                        else setSelectedStaffIds(selectedStaffIds.filter((id) => id !== staff.id));
                      }}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm text-gray-900 dark:text-white">
                        {staff.name}
                      </div>
                      {staff.staffCode && (
                        <div className="text-xs text-gray-500">Code: {staff.staffCode}</div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
              <button className="btn-secondary" onClick={() => setStaffModalOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={saveStaff} disabled={saving}>
                {saving ? 'Saving...' : 'Apply Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
