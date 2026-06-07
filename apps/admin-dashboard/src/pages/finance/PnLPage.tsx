import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getPnL, getFinanceSummary } from '../../services/finance';
import { formatCurrency } from '../../lib/utils';

export default function PnLPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  const { data: pnlRes, loading: pLoading } = useApi(
    () => getPnL(token!, { branchId, from, to }),
    [token, branchId, from, to],
  );
  const { data: summaryRes, loading: sLoading } = useApi(
    () => getFinanceSummary(token!, { branchId, from, to }),
    [token, branchId, from, to],
  );

  const weeks = pnlRes?.data ?? [];
  const s = summaryRes?.data;

  const maxVal = Math.max(...weeks.map((w) => Math.max(w.revenue, w.expenses + w.wastage)), 1);

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const YEARS = [now.getFullYear() - 1, now.getFullYear()];

  return (
    <div className="space-y-6">
      {/* Period picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ width: 'auto' }}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          style={{ width: 'auto' }}
        >
          {MONTHS.map((m, i) => (
            <option key={i + 1} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {from} → {to}
        </span>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Revenue', value: s?.revenue, color: 'var(--success)' },
          {
            label: 'Gross Profit',
            value: s?.grossProfit,
            color: s && s.grossProfit >= 0 ? 'var(--accent)' : 'var(--danger)',
            sub: s ? `${s.grossMargin.toFixed(1)}% margin` : '',
          },
          {
            label: 'Total Costs',
            value: s ? s.cogs + s.totalOpex + s.wastage : undefined,
            color: 'var(--warning)',
          },
          {
            label: 'Net Profit',
            value: s?.netProfit,
            color: s && s.netProfit >= 0 ? 'var(--success)' : 'var(--danger)',
            sub: s ? `${s.netMargin.toFixed(1)}% margin` : '',
          },
        ].map((k) => (
          <div key={k.label} className="card p-5">
            <div
              className="text-xs font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--muted)' }}
            >
              {k.label}
            </div>
            <div className="text-2xl font-black mb-1" style={{ color: k.color }}>
              {sLoading ? '…' : k.value !== undefined ? formatCurrency(k.value, currency) : '—'}
            </div>
            {k.sub && (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {k.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Weekly breakdown chart */}
      <div className="card">
        <div className="card-header">
          <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
            Weekly Breakdown
          </span>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: 'var(--success)', display: 'inline-block' }}
              />{' '}
              Revenue
            </span>
            <span className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: 'var(--danger)', display: 'inline-block' }}
              />{' '}
              Costs
            </span>
          </div>
        </div>
        <div className="card-body">
          {pLoading ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              Loading…
            </div>
          ) : weeks.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              No data for this period.
            </div>
          ) : (
            <>
              <div className="flex items-end gap-3 h-40 mb-4">
                {weeks.map((w) => {
                  const totalCosts = w.expenses + w.wastage;
                  return (
                    <div key={w.week} className="flex-1 flex items-end gap-1 min-w-0">
                      <div className="flex-1 flex flex-col justify-end" style={{ height: '140px' }}>
                        <div
                          title={`Revenue: ${formatCurrency(w.revenue, currency)}`}
                          style={{
                            height: `${(w.revenue / maxVal) * 100}%`,
                            background: 'var(--success)',
                            opacity: 0.85,
                            borderRadius: '4px 4px 0 0',
                          }}
                        />
                      </div>
                      <div className="flex-1 flex flex-col justify-end" style={{ height: '140px' }}>
                        <div
                          title={`Costs: ${formatCurrency(totalCosts, currency)}`}
                          style={{
                            height: `${(totalCosts / maxVal) * 100}%`,
                            background: 'var(--danger)',
                            opacity: 0.75,
                            borderRadius: '4px 4px 0 0',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th>Revenue</th>
                    <th>Expenses</th>
                    <th>Wastage</th>
                    <th>Profit</th>
                    <th>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.week}>
                      <td className="text-xs" style={{ color: 'var(--muted)' }}>
                        {w.week}
                      </td>
                      <td style={{ color: 'var(--success)' }}>
                        {formatCurrency(w.revenue, currency)}
                      </td>
                      <td style={{ color: 'var(--warning)' }}>
                        {formatCurrency(w.expenses, currency)}
                      </td>
                      <td style={{ color: 'var(--danger)' }}>
                        {formatCurrency(w.wastage, currency)}
                      </td>
                      <td
                        className="font-semibold"
                        style={{ color: w.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}
                      >
                        {formatCurrency(w.profit, currency)}
                      </td>
                      <td className="text-xs" style={{ color: 'var(--muted)' }}>
                        {w.revenue > 0 ? `${((w.profit / w.revenue) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
