import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getStocktakes } from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

export default function StocktakePage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const { data, loading, error, refetch } = useApi(() => getStocktakes(token!), [token, branchId]);
  const stocktakes = data?.data ?? [];
  const last = stocktakes[0];

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Stocktake
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch to manage its stocktakes.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Physical stock counts
        </p>
        <button className="btn btn-primary btn-sm">+ Start Count</button>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            label: 'Last Count',
            value: last ? new Date(last.startedAt).toLocaleDateString('en-NG') : '—',
            sub: last?.completedAt ? 'completed' : last ? 'in progress' : 'none yet',
          },
          {
            label: 'Last Variance',
            value:
              last?.varianceValue != null
                ? formatCurrency(Number(last.varianceValue), currency)
                : '—',
            sub: 'stock value difference',
          },
          { label: 'Total Counts', value: String(stocktakes.length), sub: 'all time' },
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
        ) : stocktakes.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No stocktakes yet. Start your first physical count.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Items Counted</th>
                <th>Variance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stocktakes.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs font-semibold">
                    {s.reference ?? s.id.slice(0, 8)}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(s.startedAt).toLocaleDateString('en-NG')}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {s.completedAt ? new Date(s.completedAt).toLocaleDateString('en-NG') : '—'}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{s._count?.lines ?? '—'}</td>
                  <td
                    style={{
                      color:
                        s.varianceValue && Number(s.varianceValue) < 0
                          ? 'var(--danger)'
                          : 'var(--muted)',
                    }}
                  >
                    {s.varianceValue != null
                      ? formatCurrency(Number(s.varianceValue), currency)
                      : '—'}
                  </td>
                  <td>
                    <span className={`badge ${s.completedAt ? 'badge-ok' : 'badge-pending'}`}>
                      {s.completedAt ? 'Completed' : 'In Progress'}
                    </span>
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
