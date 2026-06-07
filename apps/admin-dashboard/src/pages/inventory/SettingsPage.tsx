const sections = [
  {
    title: 'Organisation',
    fields: [
      { label: 'Organisation Name', value: 'My Business', type: 'text' },
      {
        label: 'Default Currency',
        value: 'NGN',
        type: 'select',
        options: ['NGN', 'USD', 'GBP', 'EUR'],
      },
      {
        label: 'Timezone',
        value: 'Africa/Lagos',
        type: 'select',
        options: ['Africa/Lagos', 'UTC', 'Europe/London'],
      },
    ],
  },
  {
    title: 'Stock Defaults',
    fields: [
      { label: 'Low Stock Alert Threshold', value: '20', type: 'text' },
      {
        label: 'Cost Method',
        value: 'Weighted Average',
        type: 'select',
        options: ['Weighted Average', 'FIFO', 'LIFO'],
      },
      { label: 'Auto-raise PO on low stock', value: 'off', type: 'toggle' },
    ],
  },
  {
    title: 'Notifications',
    fields: [
      { label: 'Low stock email alerts', value: 'on', type: 'toggle' },
      { label: 'Out of stock push alerts', value: 'on', type: 'toggle' },
      { label: 'PO delivery reminders', value: 'off', type: 'toggle' },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      {sections.map((s) => (
        <div key={s.title} className="card p-6">
          <h2 className="font-semibold mb-4" style={{ color: 'var(--text)' }}>
            {s.title}
          </h2>
          <div className="space-y-4">
            {s.fields.map((f) => (
              <div key={f.label} className="flex items-center justify-between gap-4">
                <label className="text-sm" style={{ color: 'var(--muted)' }}>
                  {f.label}
                </label>
                {f.type === 'toggle' ? (
                  <div
                    className="w-10 h-5 rounded-full relative cursor-pointer transition-colors"
                    style={{ background: f.value === 'on' ? 'var(--brand)' : 'var(--border)' }}
                  >
                    <div
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                      style={{
                        transform: f.value === 'on' ? 'translateX(21px)' : 'translateX(2px)',
                      }}
                    />
                  </div>
                ) : f.type === 'select' ? (
                  <select style={{ width: '180px' }}>
                    {f.options?.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" defaultValue={f.value} style={{ width: '180px' }} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button className="btn btn-primary">Save Changes</button>
      </div>
    </div>
  );
}
