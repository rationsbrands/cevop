import { useState } from 'react';
import { useAuth, useApi as useAdminApi } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getFinanceSummary, getCashFlow } from '../../services/finance';
import { formatCurrency } from '../../lib/utils';

function periodDates(preset: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  switch (preset) {
    case 'today': {
      const s = fmt(now);
      return { from: s, to: s };
    }
    case 'week': {
      const mon = new Date(now);
      mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return { from: fmt(mon), to: fmt(now) };
    }
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(first), to: fmt(last) };
    }
    default: {
      // this_month
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(first), to: fmt(now) };
    }
  }
}

export default function FinanceDashboardPage() {
  const { token, user } = useAuth();
  const api = useAdminApi();
  const branchId = api.effectiveBranchId ?? undefined;
  const currency = user?.organization?.currency ?? 'NGN';

  const [preset, setPreset] = useState('this_month');
  const { from, to } = periodDates(preset);

  const { data: summaryRes, loading: sLoading } = useApi(
    () => getFinanceSummary(token!, { branchId, from, to }),
    [token, branchId, from, to],
  );
  const { data: cashflowRes, loading: cfLoading } = useApi(
    () => getCashFlow(token!, { branchId, from, to }),
    [token, branchId, from, to],
  );

  const s = summaryRes?.data;
  const days = cashflowRes?.data ?? [];

  const PRESETS = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
  ];

  const kpis = [
    {
      label: 'Revenue',
      value: s?.revenue,
      color: 'var(--success)',
      sub: `${s?.transactionCount ?? 0} transactions`,
    },
    {
      label: 'Gross Profit',
      value: s?.grossProfit,
      color: s && s.grossProfit >= 0 ? 'var(--accent)' : 'var(--danger)',
      sub: `${s ? s.grossMargin.toFixed(1) : '—'}% margin`,
    },
    {
      label: 'Net Profit',
      value: s?.netProfit,
      color: s && s.netProfit >= 0 ? 'var(--success)' : 'var(--danger)',
      sub: `${s ? s.netMargin.toFixed(1) : '—'}% margin`,
    },
    {
      label: 'Total Expenses',
      value: s ? s.totalOpex + s.wastage + (s.otherExpenses ?? 0) : undefined,
      color: 'var(--warning)',
      sub: `${s?.expenseCount ?? 0} expense entries`,
    },
  ];

  const breakdown = s
    ? [
        { label: 'Gross Revenue', value: s.revenue, positive: true },
        { label: 'Tax Collected', value: -s.tax, positive: false },
        { label: 'Service Charge', value: s.serviceCharge, positive: true },
        { label: 'Net Revenue', value: s.netRevenue, positive: s.netRevenue >= 0, bold: true },
        { label: 'Cost of Goods Sold', value: -s.cogs, positive: false },
        { label: 'Gross Profit', value: s.grossProfit, positive: s.grossProfit >= 0, bold: true },
        { label: 'Wastage', value: -s.wastage, positive: false },
        { label: 'Labour Cost', value: -s.labour, positive: false },
        { label: 'Other Expenses', value: -s.otherExpenses, positive: false },
        {
          label: 'Net Profit',
          value: s.netProfit,
          positive: s.netProfit >= 0,
          bold: true,
          border: true,
        },
      ]
    : [];

  // Simple bar chart — max inflow for scale
  const maxBar = Math.max(...days.map((d) => Math.max(d.inflow, d.outflow)), 1);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text)' }}>
            Finance Overview
          </h1>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {from === to ? from : `${from} → ${to}`}
            {branchId ? '' : ' · All Branches'}
          </p>
        </div>
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={`btn btn-sm ${preset === p.value ? 'btn-primary' : 'btn-secondary'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
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
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* P&L breakdown */}
        <div className="card xl:col-span-1">
          <div className="card-header">
            <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              P&L Breakdown
            </span>
          </div>
          <div className="card-body space-y-2">
            {sLoading ? (
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                Loading…
              </div>
            ) : !s ? (
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                No data for this period.
              </div>
            ) : (
              breakdown.map((row) => (
                <div
                  key={row.label}
                  className={`flex justify-between items-center py-1.5 ${row.border ? 'border-t mt-2 pt-3' : ''}`}
                  style={row.border ? { borderColor: 'var(--border)' } : {}}
                >
                  <span
                    className={`text-sm ${row.bold ? 'font-bold' : ''}`}
                    style={{ color: row.bold ? 'var(--text)' : 'var(--muted)' }}
                  >
                    {row.label}
                  </span>
                  <span
                    className={`text-sm font-${row.bold ? 'black' : 'semibold'}`}
                    style={{
                      color: row.positive
                        ? row.bold
                          ? 'var(--accent)'
                          : 'var(--text)'
                        : 'var(--danger)',
                    }}
                  >
                    {row.value >= 0 ? '' : '−'}
                    {formatCurrency(Math.abs(row.value), currency)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Cash flow chart + payment methods */}
        <div className="card xl:col-span-2 flex flex-col">
          <div className="card-header">
            <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              Daily Cash Flow
            </span>
            {days.length > 0 && (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {days.length} days
              </span>
            )}
          </div>
          <div className="card-body flex-1">
            {cfLoading ? (
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                Loading…
              </div>
            ) : days.length === 0 ? (
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                No cash flow data for this period.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Bar chart */}
                <div className="flex items-end gap-1 h-32 overflow-x-auto">
                  {days.map((d) => (
                    <div
                      key={d.date}
                      className="flex flex-col items-center gap-0.5 shrink-0"
                      style={{ minWidth: '20px', flex: '1 0 0' }}
                    >
                      <div
                        className="w-full flex flex-col-reverse gap-0.5"
                        style={{ height: '112px' }}
                      >
                        <div
                          title={`Inflow: ${formatCurrency(d.inflow, currency)}`}
                          style={{
                            height: `${(d.inflow / maxBar) * 100}%`,
                            background: 'var(--success)',
                            borderRadius: '3px 3px 0 0',
                            opacity: 0.8,
                          }}
                        />
                      </div>
                      <div
                        title={`Outflow: ${formatCurrency(d.outflow, currency)}`}
                        style={{
                          height: `${(d.outflow / maxBar) * 56}%`,
                          background: 'var(--danger)',
                          borderRadius: '0 0 3px 3px',
                          opacity: 0.7,
                          width: '100%',
                          marginTop: '2px',
                        }}
                      />
                      <span className="text-[9px] mt-1" style={{ color: 'var(--muted)' }}>
                        {d.date.slice(5)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-sm inline-block"
                      style={{ background: 'var(--success)' }}
                    />{' '}
                    Inflow
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-sm inline-block"
                      style={{ background: 'var(--danger)' }}
                    />{' '}
                    Outflow
                  </span>
                </div>

                {/* Payment method split */}
                {s && s.byMethod.length > 0 && (
                  <div>
                    <div
                      className="text-xs font-bold uppercase tracking-widest mb-2"
                      style={{ color: 'var(--muted)' }}
                    >
                      Revenue by Method
                    </div>
                    <div className="space-y-2">
                      {s.byMethod.map((m) => (
                        <div key={m.method} className="flex items-center gap-3">
                          <div
                            className="text-xs font-semibold w-20"
                            style={{ color: 'var(--muted)' }}
                          >
                            {m.method}
                          </div>
                          <div
                            className="flex-1 h-2 rounded-full overflow-hidden"
                            style={{ background: 'var(--surface2)' }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${s.revenue > 0 ? (m.amount / s.revenue) * 100 : 0}%`,
                                background: 'var(--accent)',
                              }}
                            />
                          </div>
                          <div
                            className="text-xs font-semibold w-24 text-right"
                            style={{ color: 'var(--text)' }}
                          >
                            {formatCurrency(m.amount, currency)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
