const reports = [
  { title: 'Stock Valuation', desc: 'Current value of all stock at cost price', icon: '📦' },
  { title: 'Low Stock Report', desc: 'Items below their reorder point', icon: '⚠️' },
  { title: 'Dead Stock', desc: 'Items with no movement in 30+ days', icon: '🕐' },
  { title: 'Stock Movement History', desc: 'Full in/out log for any item or period', icon: '📋' },
  { title: 'Wastage & Shrinkage', desc: 'Total losses by type, item and period', icon: '🗑️' },
  { title: 'Supplier Spend', desc: 'Total purchases per supplier', icon: '🤝' },
  { title: 'Purchase Order Status', desc: 'Outstanding, received and late POs', icon: '📄' },
  { title: 'Expiry Report', desc: 'Items expiring in the next 7 / 14 / 30 days', icon: '📅' },
];

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Export or view detailed inventory reports
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {reports.map((r) => (
          <button
            key={r.title}
            className="card p-5 text-left hover:border-[var(--accent)]/20 transition-colors group"
          >
            <div className="text-2xl mb-3">{r.icon}</div>
            <div
              className="font-semibold text-sm mb-1 group-hover:text-[var(--accent)] transition-colors"
              style={{ color: 'var(--text)' }}
            >
              {r.title}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {r.desc}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
