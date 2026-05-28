import { useEffect, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, useAuth } from '../context/auth';
import { useSocket } from '../context/socket';
import { formatPrice } from '../../../../shared/utils/currency';
import { printReceipt } from '../utils/printReceipt';

interface OpenSession {
  sessionId: string;
  openedAt: string;
  closedAt?: string;
  table: { label: string; number: number };
  grandTotal: number;
  amountPaid: number;
  balance: number;
  isPaid: boolean;
  hasBillRequest?: boolean;
  payments: { id: string; amount: number; method: string; processedAt: string }[];
  assignedWaiter?: { id: string; name: string; staffCode?: string | null } | null;
}

interface BillDetails {
  sessionId: string;
  openedAt: string;
  closedAt: string | null;
  table: { label: string; number: number };
  assignedWaiter?: { staffCode: string | null; name: string } | null;
  currency: string;
  orders: {
    id: string;
    status: string;
    subtotal: number;
    taxAmount: number;
    serviceChargeAmount: number;
    total: number;
    createdAt: string;
    items: {
      name: string;
      quantity: number;
      unitPrice: number;
      notes: string | null;
      lineTotal: number;
    }[];
  }[];
  grandSubtotal: number;
  grandTax: number;
  grandServiceCharge: number;
  grandTotal: number;
  amountPaid: number;
  balance: number;
  isPaid: boolean;
  orderCount: number;
  payments: { id: string; amount: number; method: string; processedAt: string }[];
}

interface PaymentForm {
  method: 'CASH' | 'CARD' | 'TRANSFER';
  amount: string;
  reference: string;
  note: string;
}

export function CashierPage() {
  const { user } = useAuth();
  const api = useApi();
  const { socket, syncSignal } = useSocket();
  const currency = user?.organization?.currency ?? 'NGN';

  const [tab, setTab] = useState<'open' | 'history'>('open');
  const queryClient = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<OpenSession | null>(null);
  const [form, setForm] = useState<PaymentForm>({
    method: 'CASH',
    amount: '',
    reference: '',
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [selectedHistoryBill, setSelectedHistoryBill] = useState<BillDetails | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [syncing, setSyncing] = useState(false);

  const {
    data: sessionsData,
    refetch: refetchSessions,
    isLoading: sessionsLoading,
  } = useQuery({
    queryKey: ['cashier-open-sessions', api.effectiveBranchId],
    queryFn: async () => {
      if (!api.effectiveBranchId) return [];
      const res = await api.get('/api/payments/open-sessions');
      return res.success ? (res.data as OpenSession[]) : [];
    },
    enabled: !!api.effectiveBranchId,
  });

  const {
    data: historySessionsData,
    refetch: refetchHistory,
    isLoading: historyLoading,
  } = useQuery({
    queryKey: ['cashier-history', api.effectiveBranchId, startDate, endDate],
    queryFn: async () => {
      if (!api.effectiveBranchId) return [];
      const res = await api.get(`/api/payments/history?startDate=${startDate}&endDate=${endDate}`);
      return res.success ? (res.data as OpenSession[]) : [];
    },
    enabled: !!api.effectiveBranchId,
  });

  const sessions = sessionsData || [];
  const historySessions = historySessionsData || [];
  const loading = sessionsLoading || historyLoading;

  const load = useCallback(
    async (isSilent = false) => {
      if (!api.effectiveBranchId) return;
      if (isSilent) setSyncing(true);
      try {
        await Promise.all([refetchSessions(), refetchHistory()]);
      } finally {
        if (isSilent) setSyncing(false);
      }
    },
    [api.effectiveBranchId, refetchSessions, refetchHistory],
  );

  // Real-time synchronization
  useEffect(() => {
    if (!socket) return;

    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['cashier-open-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['cashier-history'] });
    };

    socket.on('SESSION_CLOSED', handleUpdate);
    socket.on('ORDER_CREATED', handleUpdate);
    socket.on('ORDER_UPDATED', handleUpdate);
    socket.on('SERVICE_REQUEST_CREATED', handleUpdate);
    socket.on('SERVICE_REQUEST_UPDATED', handleUpdate);
    socket.on('PAYMENT_RECORDED', handleUpdate);
    socket.on('connect', handleUpdate);

    return () => {
      socket.off('SESSION_CLOSED', handleUpdate);
      socket.off('ORDER_CREATED', handleUpdate);
      socket.off('ORDER_UPDATED', handleUpdate);
      socket.off('SERVICE_REQUEST_CREATED', handleUpdate);
      socket.off('SERVICE_REQUEST_UPDATED', handleUpdate);
      socket.off('PAYMENT_RECORDED', handleUpdate);
      socket.off('connect', handleUpdate);
    };
  }, [socket, load]);

  function openPayModal(session: OpenSession) {
    setSelectedSession(session);
    setForm({
      method: 'CASH',
      amount: String(session.balance.toFixed(2)),
      reference: '',
      note: '',
    });
    setError('');
  }

  async function fetchBillDetails(sessionId: string) {
    setBillLoading(true);
    setSelectedHistoryBill(null);
    const res = await api.get(`/api/sessions/${sessionId}/bill`);
    if (res.success) setSelectedHistoryBill(res.data);
    setBillLoading(false);
  }

  async function triggerPrint(sessionId: string) {
    const res = await api.get(`/api/sessions/${sessionId}/bill`);
    if (!res.success) return;
    const bill = res.data as BillDetails;

    const items = [];
    for (const order of bill.orders) {
      for (const item of order.items) {
        items.push({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        });
      }
    }

    printReceipt({
      organization: {
        name: user?.organization?.name || 'Cevop',
        currency: currency,
      },
      branch: {
        name: user?.branch?.name || '',
      },
      session: {
        id: bill.sessionId,
        table: bill.table,
        assignedWaiter: bill.assignedWaiter,
        openedAt: bill.openedAt,
        closedAt: bill.closedAt,
      },
      items,
      totals: {
        grandTotal: bill.grandTotal,
        amountPaid: bill.amountPaid,
        balance: bill.balance,
      },
    });
  }

  async function voidPayment(paymentId: string) {
    if (!confirm('Are you sure you want to void this payment?')) return;
    const res = await api.patch(`/api/payments/${paymentId}/void`, {});
    if (res.success) {
      if (selectedHistoryBill) {
        // Refresh the selected bill
        fetchBillDetails(selectedHistoryBill.sessionId);
      }
      void load(); // Refresh the main list
    } else {
      alert(res.error || 'Failed to void payment');
    }
  }

  async function submitPayment() {
    if (!selectedSession) return;
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    setError('');
    const res = await api.post('/api/payments', {
      sessionId: selectedSession.sessionId,
      amount,
      method: form.method,
      reference: form.reference || undefined,
      note: form.note || undefined,
    });
    setSubmitting(false);
    if (res.success) {
      const idToPrint = selectedSession.sessionId;
      setSelectedSession(null);
      void load();
      triggerPrint(idToPrint);
    } else {
      setError(res.error ?? 'Payment failed');
    }
  }

  function exportCSV() {
    if (filteredHistory.length === 0) return;

    const headers = [
      'Table',
      'Waiter',
      'Time Opened',
      'Time Closed',
      'Grand Total',
      'Amount Paid',
      'Methods',
    ];
    const rows = filteredHistory.map((s) => [
      `"${s.table.label}"`,
      `"${s.assignedWaiter ? s.assignedWaiter.name + (s.assignedWaiter.staffCode ? ' (#' + s.assignedWaiter.staffCode + ')' : '') : '—'}"`,
      `"${new Date(s.openedAt).toLocaleString()}"`,
      `"${s.closedAt ? new Date(s.closedAt).toLocaleString() : ''}"`,
      s.grandTotal,
      s.amountPaid,
      `"${s.payments.map((p) => p.method).join(', ')}"`,
    ]);

    const csvContent = [headers, ...rows].map((e) => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `payment_history_${startDate}_to_${endDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const filteredHistory = historySessions.filter((s) => {
    if (!historyFilter) return true;
    const search = historyFilter.toLowerCase();
    return (
      s.table.label.toLowerCase().includes(search) ||
      s.payments.some((p) => p.method.toLowerCase().includes(search))
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl uppercase tracking-tight">CASHIER CONSOLE</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[var(--muted)] text-sm font-medium">Payment & Session Management</p>
            {syncing && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-black animate-pulse uppercase tracking-widest">
                <span className="w-1 h-1 rounded-full bg-[var(--accent)]" />
                Live Sync
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => {
            load(true);
          }}
          disabled={syncing || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--surface2)] text-[var(--text)] text-xs font-black uppercase tracking-widest hover:bg-[var(--surface3)] transition-all disabled:opacity-50 group border border-[var(--border)]"
        >
          <span
            className={`transition-transform duration-500 ${syncing ? 'animate-spin' : 'group-hover:rotate-180'}`}
          >
            ⟳
          </span>
          Sync
        </button>
      </div>

      <div className="flex border-b border-[var(--border)] overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setTab('open')}
          className={`px-4 py-2 text-sm font-bold transition-all ${tab === 'open' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
        >
          Open Bills ({sessions.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-bold transition-all ${tab === 'history' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
        >
          History (Past 24h)
        </button>
      </div>

      {tab === 'open' ? (
        sessions.length === 0 ? (
          <div className="card p-8 text-center text-[var(--muted)]">
            No open bills at the moment.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                className={`card p-4 space-y-3 ${s.hasBillRequest ? 'border-amber-500/40' : ''}`}
              >
                {/* Table header */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-lg text-[var(--text)]">{s.table.label}</p>
                    <p className="text-xs text-[var(--muted)]">
                      Opened{' '}
                      {new Date(s.openedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {s.assignedWaiter && (
                      <p className="text-xs text-[var(--accent)] font-medium mt-0.5">
                        Waiter: {s.assignedWaiter.name}
                      </p>
                    )}
                  </div>
                  {s.hasBillRequest && (
                    <span className="text-xs font-bold text-amber-400 border border-amber-800/50 px-2 py-0.5">
                      BILL REQUESTED
                    </span>
                  )}
                </div>

                {/* Payment history */}
                {s.payments.length > 0 && (
                  <div className="space-y-1">
                    {s.payments.map((p, i) => (
                      <div key={i} className="flex justify-between text-xs text-[var(--muted)]">
                        <span>{p.method}</span>
                        <span>{formatPrice(p.amount, currency)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Totals */}
                <div className="border-t border-[var(--border)] pt-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Bill total</span>
                    <span className="font-medium">{formatPrice(s.grandTotal, currency)}</span>
                  </div>
                  {s.amountPaid > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--muted)]">Paid</span>
                      <span className="text-[var(--success)]">
                        {formatPrice(s.amountPaid, currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold">
                    <span>Balance</span>
                    <span className={s.isPaid ? 'text-[var(--success)]' : 'text-[var(--text)]'}>
                      {s.isPaid ? 'PAID' : formatPrice(s.balance, currency)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 w-full">
                  {!s.isPaid && (
                    <button
                      className="btn btn-primary btn-sm flex-1"
                      onClick={() => openPayModal(s)}
                    >
                      Record Payment
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm flex-1"
                    onClick={() => triggerPrint(s.sessionId)}
                  >
                    Print Receipt
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 justify-between items-center bg-[var(--surface2)] p-3 rounded-md border border-[var(--border)]">
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="text"
                placeholder="Filter by table name or payment method..."
                className="input max-w-xs bg-[var(--surface)] text-sm"
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--muted)]">From:</span>
                <input
                  type="date"
                  className="input py-1 px-2 text-sm bg-[var(--surface)] w-auto"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <span className="text-sm text-[var(--muted)]">To:</span>
                <input
                  type="date"
                  className="input py-1 px-2 text-sm bg-[var(--surface)] w-auto"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <button className="btn btn-secondary btn-sm" onClick={() => void load()}>
                  Apply
                </button>
              </div>
            </div>
            <button
              className="btn btn-secondary btn-sm flex items-center gap-2"
              onClick={exportCSV}
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export CSV
            </button>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="card p-8 text-center text-[var(--muted)]">
              No matching closed bills.
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left">
                    <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                      Table
                    </th>
                    <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                      Waiter
                    </th>
                    <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                      Time Opened
                    </th>
                    <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                      Time Closed
                    </th>
                    <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider text-right">
                      Total
                    </th>
                    <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider text-right">
                      Paid
                    </th>
                    <th className="px-4 py-3 text-xs text-[var(--muted)] uppercase tracking-wider">
                      Methods
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredHistory.map((s) => (
                    <tr
                      key={s.sessionId}
                      className="hover:bg-[var(--surface2)] transition-colors cursor-pointer"
                      onClick={() => fetchBillDetails(s.sessionId)}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--text)]">{s.table.label}</td>
                      <td className="px-4 py-3">
                        {s.assignedWaiter ? (
                          <div className="flex flex-col">
                            <span className="text-[var(--text)] font-medium">
                              {s.assignedWaiter.name}
                            </span>
                            {s.assignedWaiter.staffCode && (
                              <span className="text-[10px] text-[var(--muted)] mono">
                                #{s.assignedWaiter.staffCode}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {new Date(s.openedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {s.closedAt
                          ? new Date(s.closedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatPrice(s.grandTotal, currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--success)]">
                        {formatPrice(s.amountPaid, currency)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {s.payments.map((p, i) => (
                            <span
                              key={i}
                              className="text-[10px] border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 rounded-sm text-[var(--muted)] uppercase"
                            >
                              {p.method}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Payment modal */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="card w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl">PAYMENT</h2>
                <p className="text-sm text-[var(--muted)]">{selectedSession.table.label}</p>
              </div>
              <button
                onClick={() => setSelectedSession(null)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-lg"
              >
                ×
              </button>
            </div>

            <div className="border border-[var(--border)] p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">Bill total</span>
                <span className="font-medium">
                  {formatPrice(selectedSession.grandTotal, currency)}
                </span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Balance due</span>
                <span className="text-[var(--accent)]">
                  {formatPrice(selectedSession.balance, currency)}
                </span>
              </div>
            </div>

            {/* Method */}
            <div>
              <label className="label">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                {(['CASH', 'CARD', 'TRANSFER'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setForm((f) => ({ ...f, method: m }))}
                    className={`py-2 text-sm font-bold border transition-all ${
                      form.method === m
                        ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="label">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>

            {/* Reference (optional) */}
            {form.method !== 'CASH' && (
              <div>
                <label className="label">Reference (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder={form.method === 'CARD' ? 'Terminal ref' : 'Transfer ref'}
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                />
              </div>
            )}

            {/* Note (optional) */}
            <div>
              <label className="label">Note (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="Any note..."
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

            <button
              className="btn btn-primary w-full"
              onClick={() => void submitPayment()}
              disabled={submitting}
            >
              {submitting ? 'Recording…' : 'Confirm Payment'}
            </button>
          </div>
        </div>
      )}

      {/* Bill Details Modal */}
      {(billLoading || selectedHistoryBill) && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 print:bg-white print:p-0">
          <div className="card w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto print:max-h-none print:shadow-none print:border-none print:w-[80mm] print:m-0 print:p-2 bg-[var(--surface)] print:text-black">
            {billLoading ? (
              <div className="flex justify-center p-8">
                <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : selectedHistoryBill ? (
              <>
                <style
                  dangerouslySetInnerHTML={{
                    __html: `
                  @media print {
                    body > :not(.fixed) { display: none !important; }
                    .card { box-shadow: none !important; border: none !important; color: black !important; }
                    .text-\\[var\\(--muted\\)\\] { color: #444 !important; }
                    .btn, .close-btn { display: none !important; }
                  }
                `,
                  }}
                />

                <div className="flex items-center justify-between print:hidden mb-4">
                  <h2 className="font-display text-2xl">TRANSACTION</h2>
                  <button
                    onClick={() => setSelectedHistoryBill(null)}
                    className="close-btn text-[var(--muted)] hover:text-[var(--text)] text-lg"
                  >
                    ×
                  </button>
                </div>

                <div className="text-center space-y-1 pb-4 border-b border-[var(--border)] print:border-black/20">
                  <h1 className="font-bold text-xl">{user?.organization?.name}</h1>
                  <p className="text-sm">Table: {selectedHistoryBill.table.label}</p>
                  {selectedHistoryBill.assignedWaiter && (
                    <p className="text-xs font-mono font-bold">
                      Waiter: #{selectedHistoryBill.assignedWaiter.staffCode || ''}{' '}
                      {selectedHistoryBill.assignedWaiter.name}
                    </p>
                  )}
                  <p className="text-xs text-[var(--muted)]">
                    {new Date(selectedHistoryBill.openedAt).toLocaleString()}
                  </p>
                </div>

                <div className="space-y-4 py-2">
                  {selectedHistoryBill.orders.map((order) => (
                    <div key={order.id} className="space-y-2">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <div>
                            <span className="font-medium">{item.quantity}x</span> {item.name}
                          </div>
                          <span>{formatPrice(item.lineTotal, selectedHistoryBill.currency)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="border-t border-[var(--border)] print:border-black/20 pt-4 space-y-1">
                  <div className="flex justify-between text-sm text-[var(--muted)]">
                    <span>Subtotal</span>
                    <span>
                      {formatPrice(selectedHistoryBill.grandSubtotal, selectedHistoryBill.currency)}
                    </span>
                  </div>
                  {selectedHistoryBill.grandTax > 0 && (
                    <div className="flex justify-between text-sm text-[var(--muted)]">
                      <span>Tax</span>
                      <span>
                        {formatPrice(selectedHistoryBill.grandTax, selectedHistoryBill.currency)}
                      </span>
                    </div>
                  )}
                  {selectedHistoryBill.grandServiceCharge > 0 && (
                    <div className="flex justify-between text-sm text-[var(--muted)]">
                      <span>Service Charge</span>
                      <span>
                        {formatPrice(
                          selectedHistoryBill.grandServiceCharge,
                          selectedHistoryBill.currency,
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t border-[var(--border)] print:border-black/20">
                    <span>Total</span>
                    <span>
                      {formatPrice(selectedHistoryBill.grandTotal, selectedHistoryBill.currency)}
                    </span>
                  </div>
                </div>

                <div className="pt-2 space-y-1">
                  {selectedHistoryBill.payments.map((p, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center text-sm text-[var(--muted)] hover:bg-[var(--surface2)] px-2 py-1 -mx-2 rounded transition-colors group"
                    >
                      <div className="flex flex-col">
                        <span>Paid ({p.method})</span>
                        <span className="text-[10px] text-[var(--muted)] opacity-70">
                          {new Date(p.processedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-[var(--text)]">
                          {formatPrice(p.amount, selectedHistoryBill.currency)}
                        </span>
                        {p.id && (
                          <button
                            onClick={() => voidPayment(p.id)}
                            className="text-[10px] uppercase font-bold tracking-wider text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-opacity border border-[var(--danger)] px-2 py-0.5 rounded print:hidden"
                          >
                            Void
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-6 print:hidden">
                  <button
                    className="btn btn-secondary w-full flex items-center justify-center gap-2"
                    onClick={() => window.print()}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 6 2 18 2 18 9"></polyline>
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                      <rect x="6" y="14" width="12" height="8"></rect>
                    </svg>
                    Print Receipt
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
