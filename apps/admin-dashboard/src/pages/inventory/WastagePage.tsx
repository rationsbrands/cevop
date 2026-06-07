import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getWastage } from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

const REASON_LABELS: Record<string, string> = {
  EXPIRED: 'Expired',
  DAMAGED: 'Damaged',
  SPOILED: 'Spoiled',
  OVERPRODUCTION: 'Overproduction',
  THEFT: 'Theft',
  OTHER: 'Other',
};

export default function WastagePage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const { data, loading, error, refetch } = useApi(
    () => getWastage(token!, { branchId }),
    [token, branchId],
  );
  const entries = data?.data ?? [];
  const totalCost = entries.reduce((sum, e) => sum + Number(e.totalCost), 0);

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Wastage Log
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch to view its wastage records.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Track damaged, expired &amp; wasted stock
        </p>
        <button className="btn btn-primary btn-sm">+ Log Wastage</button>
      </div>

      {error && (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
        >
          {error}{' '}
          <button onClick={refetch} className="underline ml-1">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Entries',
            value: loading ? '…' : String(entries.length),
            sub: 'all time',
          },
          {
            label: 'Total Cost',
            value: loading ? '…' : formatCurrency(totalCost, currency),
            sub: 'all time loss',
          },
          {
            label: 'This Month',
            value: loading
              ? '…'
              : String(
                  entries.filter((e) => new Date(e.createdAt).getMonth() === new Date().getMonth())
                    .length,
                ),
            sub: 'entries',
          },
          {
            label: 'Top Reason',
            value: loading
              ? '…'
              : (() => {
                  const counts: Record<string, number> = {};
                  entries.forEach((e) => {
                    counts[e.reason] = (counts[e.reason] ?? 0) + 1;
                  });
                  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
                  return top ? (REASON_LABELS[top[0]] ?? top[0]) : '—';
                })(),
            sub: 'most common',
          },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div
              className="text-xs font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--muted)' }}
            >
              {s.label}
            </div>
            <div className="text-xl font-black mb-1" style={{ color: 'var(--text)' }}>
              {s.value}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No wastage recorded yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Reason</th>
                <th>Qty</th>
                <th>Unit Cost</th>
                <th>Total Loss</th>
                <th>Notes</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((w) => (
                <tr key={w.id}>
                  <td className="font-medium">{w.item?.name ?? '—'}</td>
                  <td>
                    <span className="badge badge-out">{REASON_LABELS[w.reason] ?? w.reason}</span>
                  </td>
                  <td style={{ color: 'var(--danger)' }}>
                    {Number(w.quantity)} {w.item?.unitOfMeasure}
                  </td>
                  <td>{formatCurrency(w.unitCost, currency)}</td>
                  <td className="font-semibold" style={{ color: 'var(--danger)' }}>
                    {formatCurrency(Number(w.totalCost), currency)}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {w.notes ?? '—'}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(w.createdAt).toLocaleDateString('en-NG')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
