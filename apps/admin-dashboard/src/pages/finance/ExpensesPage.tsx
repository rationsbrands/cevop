import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import {
  getExpenses,
  createExpense,
  deleteExpense,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  type Expense,
} from '../../services/finance';
import { formatCurrency } from '../../lib/utils';

const CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

const empty = () => ({
  category: 'OTHER' as ExpenseCategory,
  amount: '',
  description: '',
  date: new Date().toISOString().slice(0, 10),
  isRecurring: false,
  notes: '',
});

export default function ExpensesPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const now = new Date();
  const [from] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
  const to = new Date().toISOString().slice(0, 10);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const { data, loading, error, refetch } = useApi(
    () => getExpenses(token!, { branchId, from, to, category: categoryFilter || undefined }),
    [token, branchId, from, to, categoryFilter],
  );
  const expenses: Expense[] = data?.data ?? [];
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description || !form.amount || !form.date) {
      setFormError('Description, amount, and date are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await createExpense(token!, {
        ...form,
        branchId,
        amount: Number(form.amount),
      });
      setShowModal(false);
      setForm(empty());
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return;
    try {
      await deleteExpense(token!, id);
      refetch();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {loading
              ? 'Loading…'
              : `${expenses.length} entries · Total: ${formatCurrency(total, currency)}`}
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setForm(empty());
              setShowModal(true);
            }}
          >
            + Log Expense
          </button>
        </div>
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
            Loading…
          </div>
        ) : expenses.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No expenses logged for this period.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Branch</th>
                <th>Amount</th>
                <th>Logged By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((exp) => (
                <tr key={exp.id}>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(exp.date).toLocaleDateString('en-NG')}
                  </td>
                  <td>
                    <span className="badge badge-info">
                      {EXPENSE_CATEGORY_LABELS[exp.category]}
                    </span>
                  </td>
                  <td className="font-medium">{exp.description}</td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {exp.branch?.name ?? 'Org-wide'}
                  </td>
                  <td className="font-semibold">{formatCurrency(Number(exp.amount), currency)}</td>
                  <td className="text-xs" style={{ color: 'var(--muted)' }}>
                    {exp.recorder?.name ?? '—'}
                  </td>
                  <td>
                    <button
                      onClick={() => handleDelete(exp.id)}
                      className="text-xs px-2 py-1 rounded-md transition-colors"
                      style={{ color: 'var(--danger)' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Expense Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowModal(false)}
        >
          <div className="card w-full max-w-md animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <span className="font-bold">Log Expense</span>
              <button onClick={() => setShowModal(false)} style={{ color: 'var(--muted)' }}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="card-body space-y-4">
              {formError && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
                >
                  {formError}
                </div>
              )}
              <div>
                <label>Category</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as ExpenseCategory })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {EXPENSE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Description</label>
                <input
                  type="text"
                  placeholder="e.g. Monthly electricity bill"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label>Amount ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label>Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label>Notes (optional)</label>
                <textarea
                  rows={2}
                  placeholder="Any additional notes…"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="recurring"
                  checked={form.isRecurring}
                  onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
                  style={{ width: 'auto' }}
                />
                <label
                  htmlFor="recurring"
                  style={{
                    margin: 0,
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  Recurring expense
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Log Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
