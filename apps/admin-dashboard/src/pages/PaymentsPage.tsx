import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, useApi } from '../context/auth';
import { printReceipt } from '../utils/printReceipt';

interface Payment {
  id: string;
  amount: number;
  method: 'CASH' | 'CARD' | 'TRANSFER';
  processedAt: string;
}

interface AssignedWaiter {
  id: string;
  name: string;
  staffCode: string | null;
}

interface TableInfo {
  label: string | null;
  number: number;
}

interface SessionWithPayments {
  sessionId: string;
  openedAt: string;
  closedAt: string | null;
  guestCount: number;
  table: TableInfo | null;
  assignedWaiter: AssignedWaiter | null;
  grandTotal: number;
  amountPaid: number;
  balance: number;
  isPaid: boolean;
  payments: Payment[];
}

export function PaymentsPage() {
  const { user, activeBranchFilter } = useAuth();
  const api = useApi();

  const [sessions, setSessions] = useState<SessionWithPayments[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const branchId = user?.branchId || activeBranchFilter?.id;

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/payments/history`);
      if (res.success) {
        setSessions(res.data ?? []);
      } else {
        setError(res.error || 'Failed to load transactions');
      }
    } catch {
      setError('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [api, branchId]);

  async function triggerPrint(sessionId: string) {
    const res = await api.get(`/api/sessions/${sessionId}/bill`);
    if (!res.success) return;
    const bill = res.data as any; // We can use any since we don't have the interface defined here

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
        currency: user?.organization?.currency || 'NGN',
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (branchId) void load();
  }, [load, branchId]);

  if (!branchId) {
    return (
      <div className="text-[var(--muted)] text-sm">
        Please select a branch to view its transactions.
      </div>
    );
  }

  if (loading) return <div className="text-[var(--muted)] text-sm">Loading transactions…</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl uppercase">Transactions</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            History of completed sessions and payments (Last 24h)
          </p>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)] space-y-2">
          <p>No transactions recorded recently.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)] text-[var(--muted)]">
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Table</th>
                <th className="px-4 py-3 font-semibold">Waiter</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold text-right">Paid</th>
                <th className="px-4 py-3 font-semibold text-right">Method</th>
                <th className="px-4 py-3 font-semibold text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sessions.map((s) => {
                const methods = Array.from(new Set(s.payments.map((p) => p.method))).join(', ');
                return (
                  <tr key={s.sessionId} className="hover:bg-[var(--surface2)] transition-colors">
                    <td className="px-4 py-3">
                      {s.closedAt
                        ? new Date(s.closedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Open'}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--text)]">
                      {s.table ? s.table.label || `Table ${s.table.number}` : 'No Table'}
                    </td>
                    <td className="px-4 py-3">{s.assignedWaiter ? s.assignedWaiter.name : '—'}</td>
                    <td className="px-4 py-3">
                      {s.isPaid ? (
                        <span className="text-xs text-green-400 border border-green-800 bg-green-900/20 px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                          PAID
                        </span>
                      ) : (
                        <span className="text-xs text-yellow-400 border border-yellow-800 bg-yellow-900/20 px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                          DUE ({user?.organization?.currency} {s.balance.toFixed(2)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      {user?.organization?.currency} {s.grandTotal.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--accent)] font-bold">
                      {user?.organization?.currency} {s.amountPaid.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--muted)] text-xs">
                      {methods || '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => triggerPrint(s.sessionId)}
                        className="btn btn-secondary btn-sm"
                      >
                        Reprint
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
