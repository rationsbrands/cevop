import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getMovements } from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

const TYPE_COLOR: Record<string, string> = {
  PURCHASE_RECEIPT: 'var(--success)',
  SALE: 'var(--info)',
  MANUAL_ADJUSTMENT: 'var(--warning)',
  WRITE_OFF: 'var(--danger)',
  TRANSFER_IN: 'var(--success)',
  TRANSFER_OUT: 'var(--danger)',
  STOCKTAKE_ADJUSTMENT: 'var(--warning)',
  PRODUCTION_IN: 'var(--success)',
  PRODUCTION_OUT: 'var(--danger)',
};

export default function StockMovementsPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const { data, loading, error, refetch } = useApi(
    () => getMovements(token!, { branchId, limit: 50 }),
    [token, branchId],
  );
  const movements = data?.data ?? [];
  const total = data?.total ?? 0;

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>
          Stock Movements
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Select a branch to view its stock movement history.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${total} total movements`}
        </p>
        <button className="btn btn-primary btn-sm">+ Manual Adjustment</button>
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

      <div className="card">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            Loading movements…
          </div>
        ) : movements.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No stock movements yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Unit Cost</th>
                <th>Note</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.item?.name ?? '—'}</td>
                  <td>
                    <span
                      className="text-xs font-semibold"
                      style={{ color: TYPE_COLOR[m.type] ?? 'var(--muted)' }}
                    >
                      {m.type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td
                    className="font-mono text-xs font-semibold"
                    style={{ color: Number(m.quantity) >= 0 ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {Number(m.quantity) >= 0 ? '+' : ''}
                    {Number(m.quantity)} {m.item?.unitOfMeasure}
                  </td>
                  <td>{formatCurrency(m.unitCost, currency)}</td>
                  <td style={{ color: 'var(--muted)' }} className="text-xs">
                    {m.note ?? '—'}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(m.createdAt).toLocaleDateString('en-NG')}
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
