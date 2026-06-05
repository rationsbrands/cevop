import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, useAuth } from '../context/auth';
import { showToast } from '../components/Popup';

function ClockInPhoto({ shiftId, api }: { shiftId: string; api: any }) {
  const [url, setUrl] = useState<string | null | 'loading' | 'none'>('loading');
  const [enlarged, setEnlarged] = useState(false);

  React.useEffect(() => {
    api
      .get(`/api/shifts/${shiftId}/photo`)
      .then((res: any) => {
        setUrl(res.success && res.data?.url ? res.data.url : 'none');
      })
      .catch(() => setUrl('none'));
  }, [shiftId]);

  if (url === 'loading')
    return <div className="w-8 h-8 rounded bg-[var(--surface2)] animate-pulse" />;
  if (url === 'none' || !url) return <span className="text-[var(--muted)] text-[10px]">—</span>;

  return (
    <>
      <button onClick={() => setEnlarged(true)} className="block">
        <img
          src={url}
          alt="Clock-in photo"
          className="w-8 h-8 rounded object-cover border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
        />
      </button>
      {enlarged && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => setEnlarged(false)}
        >
          <img
            src={url}
            alt="Clock-in photo"
            className="max-w-xs max-h-[80vh] rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}

interface StaffShift {
  id: string;
  userId: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  durationMinutes: number | null;
  breakMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  payAmount: number | null;
  salaryType: 'HOURLY' | 'MONTHLY';
  notes: string | null;
  isApproved: boolean;
  clockInPhotoUrl: string | null;
  user: { id: string; name: string; role: string; staffCode: string | null };
}

interface PayrollSummary {
  user: {
    id: string;
    name: string;
    role: string;
    staffCode: string | null;
    salaryType: string;
    monthlySalary: number | null;
    hourlyRate: number | null;
  };
  totalMinutes: number;
  totalHours: number;
  totalOvertimeMinutes: number;
  daysWorked: number;
  totalPay: number;
  openShifts: number;
  shiftCount: number;
}

function formatDuration(minutes: number | null) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatMoney(amount: number | null, currency = 'NGN') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function TimesheetsPage() {
  const api = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currency = (user as any)?.organization?.currency ?? 'NGN';

  const now = new Date();
  const [from, setFrom] = useState(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [staffFilter, setStaffFilter] = useState('');
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const [editShift, setEditShift] = useState<StaffShift | null>(null);
  const [addShiftOpen, setAddShiftOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const queryKey = ['timesheets-summary', user?.organizationId, from, to];
  const detailKey = ['timesheets-detail', user?.organizationId, from, to];

  const { data: summary = [], isLoading: summaryLoading } = useQuery<PayrollSummary[]>({
    queryKey,
    queryFn: async () => {
      const res = await api.get(
        `/api/timesheets/payroll-summary?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`,
      );
      return res.success ? res.data : [];
    },
    enabled: !!user?.organizationId,
  });

  const { data: shiftsData, isLoading: detailLoading } = useQuery<{ data: StaffShift[] }>({
    queryKey: detailKey,
    queryFn: async () => {
      const res = await api.get(
        `/api/timesheets?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z&limit=500`,
      );
      return res.success ? res : { data: [] };
    },
    enabled: !!user?.organizationId && view === 'detail',
  });

  const shifts = shiftsData?.data ?? [];

  const filteredSummary = useMemo(() => {
    if (!staffFilter.trim()) return summary;
    const q = staffFilter.toLowerCase();
    return summary.filter(
      (s) =>
        s.user.name.toLowerCase().includes(q) ||
        s.user.staffCode?.toLowerCase().includes(q) ||
        s.user.role.toLowerCase().includes(q),
    );
  }, [summary, staffFilter]);

  const filteredShifts = useMemo(() => {
    if (!staffFilter.trim()) return shifts;
    const q = staffFilter.toLowerCase();
    return shifts.filter(
      (s) => s.user.name.toLowerCase().includes(q) || s.user.staffCode?.toLowerCase().includes(q),
    );
  }, [shifts, staffFilter]);

  const totals = useMemo(
    () => ({
      totalPay: filteredSummary.reduce((a, s) => a + s.totalPay, 0),
      totalHours: filteredSummary.reduce((a, s) => a + s.totalHours, 0),
      staffCount: filteredSummary.length,
      openShifts: filteredSummary.reduce((a, s) => a + s.openShifts, 0),
    }),
    [filteredSummary],
  );

  function exportCSV() {
    const url = `/api/timesheets/export.csv?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`;
    window.open(url, '_blank');
  }

  async function approveShift(shiftId: string) {
    const res = await api.patch(`/api/shifts/${shiftId}`, { isApproved: true });
    if (res.success) {
      queryClient.invalidateQueries({ queryKey: detailKey });
      showToast('Shift approved', 'success');
    }
  }

  async function saveEditShift() {
    if (!editShift) return;
    setSaving(true);
    try {
      const res = await api.patch(`/api/shifts/${editShift.id}`, {
        clockedInAt: editShift.clockedInAt,
        clockedOutAt: editShift.clockedOutAt,
        breakMinutes: editShift.breakMinutes,
        overtimeMinutes: editShift.overtimeMinutes,
        lateMinutes: editShift.lateMinutes,
        notes: editShift.notes,
      });
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: detailKey });
        queryClient.invalidateQueries({ queryKey });
        setEditShift(null);
        showToast('Shift updated', 'success');
      } else {
        showToast(res.error ?? 'Failed to update shift', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  // Quick period selectors
  const periods = [
    {
      label: 'This month',
      from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    },
    {
      label: 'Last month',
      from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    },
    {
      label: '1st–15th',
      from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: isoDate(new Date(now.getFullYear(), now.getMonth(), 15)),
    },
    {
      label: '16th–end',
      from: isoDate(new Date(now.getFullYear(), now.getMonth(), 16)),
      to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    },
  ];

  const roleLabel: Record<string, string> = {
    WAITER: 'Waiter',
    KITCHEN: 'Kitchen',
    BAR: 'Bar',
    SERVICE: 'Service',
    CASHIER: 'Cashier',
    HOST: 'Host',
    BRANCH_ADMIN: 'Manager',
    ADMIN: 'Admin',
    ORG_OWNER: 'Owner',
  };

  return (
    <div className="space-y-5 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl uppercase tracking-tight">TIMESHEETS & PAYROLL</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            Clock records, attendance, and pay calculation
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportCSV}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
          >
            ↓ Export CSV
          </button>
          <button onClick={() => setAddShiftOpen(true)} className="btn btn-secondary btn-sm">
            + Add Shift
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        {/* Period quick-select */}
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
              }}
              className={`text-xs px-3 py-1 border transition-all ${from === p.from && to === p.to ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--muted)] uppercase tracking-wider">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--muted)] uppercase tracking-wider">To</label>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="text-sm"
            />
          </div>
          <input
            type="search"
            placeholder="Filter by name, code, role…"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="text-sm w-48"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Pay Owed', value: formatMoney(totals.totalPay, currency), accent: true },
          { label: 'Total Hours', value: `${totals.totalHours.toFixed(1)}h` },
          { label: 'Staff', value: String(totals.staffCount) },
          { label: 'Open Shifts', value: String(totals.openShifts), warn: totals.openShifts > 0 },
        ].map((card) => (
          <div key={card.label} className="card p-4 space-y-1">
            <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
              {card.label}
            </p>
            <p
              className={`font-display text-2xl ${card.accent ? 'text-[var(--accent)]' : card.warn ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex border-b border-[var(--border)]">
        {(['summary', 'detail'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${view === v ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
          >
            {v === 'summary' ? 'Pay Summary' : 'Shift Detail'}
          </button>
        ))}
      </div>

      {/* Summary view */}
      {view === 'summary' &&
        (summaryLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredSummary.length === 0 ? (
          <div className="card p-8 text-center text-[var(--muted)]">No records for this period</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-[700px]">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Pay Type</th>
                  <th>Days</th>
                  <th>Hours</th>
                  <th>Overtime</th>
                  <th>Open</th>
                  <th className="text-right">Pay Owed</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummary.map((s) => (
                  <tr key={s.user.id}>
                    <td>
                      <div className="font-medium">{s.user.name}</div>
                      {s.user.staffCode && (
                        <div className="text-[10px] text-[var(--muted)] font-mono">
                          {s.user.staffCode}
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-[var(--muted)] uppercase tracking-wider">
                      {roleLabel[s.user.role] ?? s.user.role}
                    </td>
                    <td>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 font-bold border ${s.user.salaryType === 'HOURLY' ? 'border-blue-500/50 text-blue-400' : 'border-[var(--accent)]/50 text-[var(--accent)]'}`}
                      >
                        {s.user.salaryType}
                      </span>
                    </td>
                    <td className="font-mono text-sm">{s.daysWorked}</td>
                    <td className="font-mono text-sm">{s.totalHours.toFixed(1)}h</td>
                    <td className="font-mono text-sm text-[var(--muted)]">
                      {s.totalOvertimeMinutes > 0
                        ? `${Math.round((s.totalOvertimeMinutes / 60) * 10) / 10}h`
                        : '—'}
                    </td>
                    <td>
                      {s.openShifts > 0 && (
                        <span className="text-[10px] text-[var(--danger)] font-bold border border-[var(--danger)]/40 px-1.5 py-0.5">
                          {s.openShifts} open
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <span className="font-bold text-[var(--accent)]">
                        {formatMoney(s.totalPay, currency)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)]">
                  <td
                    colSpan={7}
                    className="text-right text-xs font-bold text-[var(--muted)] uppercase tracking-wider pr-4"
                  >
                    Total
                  </td>
                  <td className="text-right font-display text-lg text-[var(--accent)]">
                    {formatMoney(totals.totalPay, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

      {/* Detail view */}
      {view === 'detail' &&
        (detailLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredShifts.length === 0 ? (
          <div className="card p-8 text-center text-[var(--muted)]">No shifts for this period</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-[900px]">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Photo</th>
                  <th>Date</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Duration</th>
                  <th>Break</th>
                  <th>OT</th>
                  <th>Late</th>
                  <th>Pay</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShifts.map((shift) => (
                  <tr key={shift.id} className={!shift.clockedOutAt ? 'bg-[var(--ready)]/5' : ''}>
                    <td>
                      <ClockInPhoto shiftId={shift.id} api={api} />
                    </td>
                    <td>
                      <div className="font-medium text-sm">{shift.user.name}</div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {roleLabel[shift.user.role] ?? shift.user.role}
                      </div>
                    </td>
                    <td className="text-sm">
                      {new Date(shift.clockedInAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="font-mono text-xs">
                      {new Date(shift.clockedInAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="font-mono text-xs">
                      {shift.clockedOutAt ? (
                        new Date(shift.clockedOutAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      ) : (
                        <span className="text-[var(--ready)] font-bold text-[10px]">ACTIVE</span>
                      )}
                    </td>
                    <td className="font-mono text-xs">{formatDuration(shift.durationMinutes)}</td>
                    <td className="text-xs text-[var(--muted)]">
                      {shift.breakMinutes > 0 ? `${shift.breakMinutes}m` : '—'}
                    </td>
                    <td className="text-xs text-[var(--muted)]">
                      {shift.overtimeMinutes > 0 ? `${shift.overtimeMinutes}m` : '—'}
                    </td>
                    <td className="text-xs text-[var(--muted)]">
                      {shift.lateMinutes > 0 ? (
                        <span className="text-[var(--warning)]">{shift.lateMinutes}m</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="font-bold text-[var(--accent)] text-sm">
                      {shift.payAmount != null ? formatMoney(shift.payAmount, currency) : '—'}
                    </td>
                    <td>
                      {!shift.clockedOutAt ? (
                        <span className="text-[10px] text-[var(--ready)] font-bold border border-[var(--ready)]/40 px-1.5 py-0.5">
                          Active
                        </span>
                      ) : shift.isApproved ? (
                        <span className="text-[10px] text-[var(--muted)] font-bold border border-[var(--border)] px-1.5 py-0.5">
                          Approved
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--warning)] font-bold border border-[var(--warning)]/40 px-1.5 py-0.5">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="space-x-1">
                      <button
                        onClick={() => setEditShift(shift)}
                        className="text-[10px] border border-[var(--border)] px-2 py-0.5 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                      >
                        Edit
                      </button>
                      {shift.clockedOutAt && !shift.isApproved && (
                        <button
                          onClick={() => approveShift(shift.id)}
                          className="text-[10px] border border-[var(--ready)]/40 text-[var(--ready)] px-2 py-0.5 hover:bg-[var(--ready)]/10 transition-colors"
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* Edit Shift Modal */}
      {editShift && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setEditShift(null)}
        >
          <div className="card w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <ClockInPhoto shiftId={editShift.id} api={api} />
              <div>
                <h2 className="font-display text-2xl">EDIT SHIFT</h2>
                <p className="text-sm text-[var(--muted)]">
                  {editShift.user.name} · {new Date(editShift.clockedInAt).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
                  Clock In
                </label>
                <input
                  type="datetime-local"
                  className="w-full text-sm mt-1"
                  value={editShift.clockedInAt.slice(0, 16)}
                  onChange={(e) =>
                    setEditShift((s) =>
                      s ? { ...s, clockedInAt: e.target.value + ':00.000Z' } : s,
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
                  Clock Out
                </label>
                <input
                  type="datetime-local"
                  className="w-full text-sm mt-1"
                  value={editShift.clockedOutAt?.slice(0, 16) ?? ''}
                  onChange={(e) =>
                    setEditShift((s) =>
                      s
                        ? {
                            ...s,
                            clockedOutAt: e.target.value ? e.target.value + ':00.000Z' : null,
                          }
                        : s,
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
                  Break (min)
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full text-sm mt-1"
                  value={editShift.breakMinutes}
                  onChange={(e) =>
                    setEditShift((s) => (s ? { ...s, breakMinutes: Number(e.target.value) } : s))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
                  Overtime (min)
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full text-sm mt-1"
                  value={editShift.overtimeMinutes}
                  onChange={(e) =>
                    setEditShift((s) => (s ? { ...s, overtimeMinutes: Number(e.target.value) } : s))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
                  Late (min)
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full text-sm mt-1"
                  value={editShift.lateMinutes}
                  onChange={(e) =>
                    setEditShift((s) => (s ? { ...s, lateMinutes: Number(e.target.value) } : s))
                  }
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Notes</label>
              <textarea
                className="w-full text-sm mt-1 resize-none"
                rows={2}
                value={editShift.notes ?? ''}
                onChange={(e) => setEditShift((s) => (s ? { ...s, notes: e.target.value } : s))}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditShift(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={saveEditShift}
                disabled={saving}
                className="btn btn-primary flex-1 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Shift Modal */}
      {addShiftOpen && (
        <AddShiftModal
          api={api}
          onClose={() => setAddShiftOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: detailKey });
            setAddShiftOpen(false);
            showToast('Shift added', 'success');
          }}
        />
      )}
    </div>
  );
}

function AddShiftModal({
  api,
  onClose,
  onSaved,
}: {
  api: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    userId: '',
    clockedInAt: '',
    clockedOutAt: '',
    breakMinutes: 0,
    overtimeMinutes: 0,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: staff = [] } = useQuery({
    queryKey: ['staff-list-for-shift'],
    queryFn: async () => {
      const res = await api.get('/api/users?limit=200');
      return res.success ? res.data : [];
    },
  });

  async function submit() {
    if (!form.userId || !form.clockedInAt) {
      setError('Staff and clock-in time are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/api/shifts', {
        ...form,
        clockedInAt: new Date(form.clockedInAt).toISOString(),
        clockedOutAt: form.clockedOutAt ? new Date(form.clockedOutAt).toISOString() : undefined,
      });
      if (res.success) {
        onSaved();
      } else {
        setError(res.error ?? 'Failed to add shift');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-2xl">ADD SHIFT</h2>
        <div>
          <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
            Staff Member
          </label>
          <select
            className="w-full text-sm mt-1"
            value={form.userId}
            onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
          >
            <option value="">Select staff…</option>
            {(staff as any[]).map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.staffCode ?? s.role})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Clock In</label>
            <input
              type="datetime-local"
              className="w-full text-sm mt-1"
              value={form.clockedInAt}
              onChange={(e) => setForm((f) => ({ ...f, clockedInAt: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
              Clock Out
            </label>
            <input
              type="datetime-local"
              className="w-full text-sm mt-1"
              value={form.clockedOutAt}
              onChange={(e) => setForm((f) => ({ ...f, clockedOutAt: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
              Break (min)
            </label>
            <input
              type="number"
              min={0}
              className="w-full text-sm mt-1"
              value={form.breakMinutes}
              onChange={(e) => setForm((f) => ({ ...f, breakMinutes: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] uppercase tracking-wider">
              Overtime (min)
            </label>
            <input
              type="number"
              min={0}
              className="w-full text-sm mt-1"
              value={form.overtimeMinutes}
              onChange={(e) => setForm((f) => ({ ...f, overtimeMinutes: Number(e.target.value) }))}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-[var(--muted)] uppercase tracking-wider">Notes</label>
          <textarea
            className="w-full text-sm mt-1 resize-none"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="btn btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}
