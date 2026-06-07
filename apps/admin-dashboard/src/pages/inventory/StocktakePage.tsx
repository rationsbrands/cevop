import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import {
  getStocktakes,
  startStocktake,
  submitStocktake,
  type Stocktake,
} from '../../services/inventory';
import { formatCurrency } from '../../lib/utils';

export default function StocktakePage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const [showStartModal, setShowStartModal] = useState(false);
  const [startForm, setStartForm] = useState({ reference: '', isBlindCount: true });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  const [activeStocktake, setActiveStocktake] = useState<Stocktake | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const { data, loading, error, refetch } = useApi(
    () => getStocktakes(token!, { branchId }),
    [token, branchId],
  );
  const stocktakes: Stocktake[] = data?.data ?? [];
  const last = stocktakes[0];

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId) {
      setStartError('Select a branch first.');
      return;
    }
    setStarting(true);
    setStartError('');
    try {
      const res = await startStocktake(token!, {
        branchId,
        reference: startForm.reference || undefined,
        isBlindCount: startForm.isBlindCount,
      });
      setShowStartModal(false);
      setActiveStocktake(res.data);
      setCounts({});
      refetch();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start stocktake');
    } finally {
      setStarting(false);
    }
  }

  async function handleSubmit() {
    if (!activeStocktake) return;
    // Build counts from form — only lines that have a count entered
    const lines = (activeStocktake as any).lines ?? [];
    const countPayload = lines
      .filter((l: any) => counts[l.id] !== undefined)
      .map((l: any) => ({ lineId: l.id, countedQty: Number(counts[l.id]) }));
    if (countPayload.length === 0) {
      setSubmitError('Enter counts for at least one item.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitStocktake(token!, activeStocktake.id, { counts: countPayload });
      setActiveStocktake(null);
      setCounts({});
      refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit stocktake');
    } finally {
      setSubmitting(false);
    }
  }

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
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setStartError('');
            setStartForm({ reference: '', isBlindCount: true });
            setShowStartModal(true);
          }}
        >
          + Start Count
        </button>
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

      {/* Summary cards */}
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
                <th></th>
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
                  <td>
                    {!s.completedAt && (
                      <button
                        className="text-xs px-2 py-1 rounded-md"
                        style={{ color: 'var(--accent)' }}
                        onClick={() => setActiveStocktake(s)}
                      >
                        Continue
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Start Stocktake Modal */}
      {showStartModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowStartModal(false)}
        >
          <div className="card w-full max-w-md animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <span className="font-bold">Start Stock Count</span>
              <button onClick={() => setShowStartModal(false)} style={{ color: 'var(--muted)' }}>
                ✕
              </button>
            </div>
            <form onSubmit={handleStart} className="card-body space-y-4">
              {startError && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
                >
                  {startError}
                </div>
              )}
              <div>
                <label>Reference / Name</label>
                <input
                  type="text"
                  placeholder="e.g. Monthly Count June 2026"
                  value={startForm.reference}
                  onChange={(e) => setStartForm({ ...startForm, reference: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="blind"
                  checked={startForm.isBlindCount}
                  onChange={(e) => setStartForm({ ...startForm, isBlindCount: e.target.checked })}
                  style={{ width: 'auto' }}
                />
                <label
                  htmlFor="blind"
                  style={{
                    margin: 0,
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  Blind count (hide expected quantities)
                </label>
              </div>
              <div
                className="text-xs px-3 py-2 rounded-lg"
                style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
              >
                This will create a count session for all active items in this branch. Count items
                one by one, then submit to apply adjustments.
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowStartModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={starting}>
                  {starting ? 'Starting…' : 'Start Count'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Count Modal */}
      {activeStocktake && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            className="card w-full max-w-2xl animate-in overflow-y-auto"
            style={{ maxHeight: '90vh' }}
          >
            <div className="card-header">
              <span className="font-bold">
                Count: {activeStocktake.reference ?? activeStocktake.id.slice(0, 8)}
              </span>
              <button onClick={() => setActiveStocktake(null)} style={{ color: 'var(--muted)' }}>
                ✕
              </button>
            </div>
            <div className="card-body space-y-4">
              {submitError && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
                >
                  {submitError}
                </div>
              )}
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Enter the counted quantity for each item. Leave blank to skip.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    {!activeStocktake.isBlindCount && <th>Expected</th>}
                    <th>Counted Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {((activeStocktake as any).lines ?? []).map((line: any) => (
                    <tr key={line.id}>
                      <td className="font-medium">{line.item?.name ?? line.itemId}</td>
                      {!activeStocktake.isBlindCount && (
                        <td style={{ color: 'var(--muted)' }}>{Number(line.expectedQty)}</td>
                      )}
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          placeholder="Count"
                          value={counts[line.id] ?? ''}
                          onChange={(e) => setCounts({ ...counts, [line.id]: e.target.value })}
                          style={{ width: '100px' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end gap-3 pt-2">
                <button className="btn btn-secondary" onClick={() => setActiveStocktake(null)}>
                  Save & Exit
                </button>
                <button className="btn btn-primary" disabled={submitting} onClick={handleSubmit}>
                  {submitting ? 'Submitting…' : 'Submit & Apply Adjustments'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
