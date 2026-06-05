import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, usePermission } from '../context/auth';

function parseBulkCsv(raw: string): { rows: any[]; errors: string[] } {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length < 2)
    return { rows: [], errors: ['Need at least a header row and one data row'] };

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const required = ['orgname', 'orgslug', 'adminname', 'adminemail', 'adminpassword'];
  const missing = required.filter((f) => !header.includes(f));
  if (missing.length > 0) return { rows: [], errors: [`Missing columns: ${missing.join(', ')}`] };

  const rows: any[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: any = {};
    header.forEach((h, idx) => {
      row[h] = vals[idx] ?? '';
    });
    if (!row.orgname || !row.orgslug || !row.adminname || !row.adminemail || !row.adminpassword) {
      errors.push(`Row ${i}: missing required fields`);
      continue;
    }
    rows.push({
      orgName: row.orgname,
      orgSlug: row.orgslug,
      adminName: row.adminname,
      adminEmail: row.adminemail,
      adminPassword: row.adminpassword,
      timezone: row.timezone || 'Africa/Lagos',
      currency: row.currency || 'NGN',
    });
  }
  return { rows, errors };
}

export function OnboardPage() {
  const api = useApi();
  const navigate = useNavigate();
  const can = usePermission();
  const [tab, setTab] = useState<'single' | 'bulk'>('single');
  const [form, setForm] = useState({
    orgName: '',
    orgSlug: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    timezone: 'Africa/Lagos',
    currency: 'NGN',
  });
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [error, setError] = useState('');

  // Bulk state
  const [bulkCsv, setBulkCsv] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [bulkError, setBulkError] = useState('');

  async function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { rows, errors } = parseBulkCsv(bulkCsv);
    if (errors.length > 0) {
      setBulkError(errors.join('; '));
      return;
    }
    if (rows.length === 0) {
      setBulkError('No valid rows found');
      return;
    }
    setBulkSubmitting(true);
    setBulkError('');
    setBulkResult(null);
    const res = await api.post('/api/auth/onboard/bulk', { rows });
    if (res.success) setBulkResult(res.data);
    else setBulkError(res.error || 'Failed');
    setBulkSubmitting(false);
  }

  function slugify(s: string) {
    return s
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const res = await api.post('/api/auth/onboard', form);
    if (res.success) setSuccess(res.data);
    else setError(res.error || 'Failed');
    setSubmitting(false);
  }

  if (!can('onboard_org')) return <div className="text-red-400 p-8">Permission denied</div>;

  if (success)
    return (
      <div className="max-w-lg space-y-6 animate-in">
        <div>
          <h1 className="font-display text-4xl text-[var(--accent)]">DONE</h1>
        </div>
        <div className="card p-6 space-y-4">
          <p className="font-semibold">
            {success.organization.name}{' '}
            <span className="text-[var(--muted)] font-normal font-mono text-sm">
              ({success.organization.slug})
            </span>
          </p>
          <p className="text-sm text-[var(--muted)]">
            Admin: <span className="text-[var(--text)]">{success.admin.email}</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSuccess(null);
                setForm({
                  orgName: '',
                  orgSlug: '',
                  adminName: '',
                  adminEmail: '',
                  adminPassword: '',
                  timezone: 'Africa/Lagos',
                  currency: 'NGN',
                });
              }}
              className="btn btn-secondary flex-1 py-2 text-sm"
            >
              Create Another
            </button>
            <button
              onClick={() => navigate('/orgs')}
              className="btn btn-primary flex-1 py-2 text-sm"
            >
              View All Orgs
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="max-w-2xl space-y-6 animate-in">
      <div>
        <h1 className="font-display text-4xl">ONBOARD ORG</h1>
        <p className="text-[var(--muted)] text-sm mt-1">Provision a new restaurant on Cevop</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {(['single', 'bulk'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${tab === t ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
          >
            {t === 'single' ? 'Single' : 'Bulk CSV'}
          </button>
        ))}
      </div>

      {/* Bulk CSV UI */}
      {tab === 'bulk' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-1 text-xs text-[var(--muted)]">
            <p className="font-bold text-[var(--text)] text-sm">CSV Format</p>
            <p>Required columns (header row + data rows):</p>
            <code className="block bg-[var(--surface2)] p-2 font-mono text-[10px] leading-relaxed">
              orgName,orgSlug,adminName,adminEmail,adminPassword,timezone,currency
            </code>
            <p className="text-[10px]">
              timezone and currency are optional — default to Africa/Lagos and NGN.
            </p>
          </div>
          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <textarea
              value={bulkCsv}
              onChange={(e) => {
                setBulkCsv(e.target.value);
                setBulkError('');
                setBulkResult(null);
              }}
              placeholder={`orgName,orgSlug,adminName,adminEmail,adminPassword\nTest Restaurant,test-restaurant,John Doe,john@test.com,password123`}
              rows={10}
              className="w-full font-mono text-xs bg-[var(--surface2)] border border-[var(--border)] p-3 focus:border-[var(--accent)] outline-none resize-y"
            />
            {bulkError && <p className="text-xs text-red-400">{bulkError}</p>}
            {bulkResult && (
              <div className="card p-4 space-y-3">
                <p className="font-bold text-sm text-[var(--text)]">
                  {bulkResult.created} created · {bulkResult.errors} errors
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {bulkResult.results.map((r: any) => (
                    <div
                      key={r.row}
                      className={`flex items-center gap-3 text-xs ${r.status === 'error' ? 'text-red-400' : 'text-green-400'}`}
                    >
                      <span className="w-6 text-right font-mono">{r.row}.</span>
                      <span className="font-mono">{r.slug}</span>
                      <span className="text-[var(--muted)]">
                        {r.status === 'error' ? r.error : 'created'}
                      </span>
                    </div>
                  ))}
                </div>
                <button onClick={() => navigate('/orgs')} className="btn btn-primary btn-sm w-full">
                  View All Orgs
                </button>
              </div>
            )}
            <button
              type="submit"
              disabled={bulkSubmitting || !bulkCsv.trim()}
              className="btn btn-primary w-full py-3 disabled:opacity-50"
            >
              {bulkSubmitting ? 'Creating…' : `Import ${parseBulkCsv(bulkCsv).rows.length} Org(s)`}
            </button>
          </form>
        </div>
      )}

      {/* Single onboard form */}
      {tab === 'single' && (
        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label htmlFor="ops_onboard_org_name">Restaurant Name *</label>
            <input
              id="ops_onboard_org_name"
              name="orgName"
              type="text"
              value={form.orgName}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  orgName: e.target.value,
                  orgSlug: slugify(e.target.value),
                }))
              }
              required
              autoComplete="organization"
            />
          </div>
          <div>
            <label htmlFor="ops_onboard_org_slug">
              Slug *{' '}
              <span className="text-[var(--muted)] normal-case font-normal">
                (lowercase, no spaces)
              </span>
            </label>
            <input
              id="ops_onboard_org_slug"
              name="orgSlug"
              type="text"
              value={form.orgSlug}
              onChange={(e) => setForm((f) => ({ ...f, orgSlug: e.target.value }))}
              required
              pattern="^[a-z0-9-]+"
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ops_onboard_timezone">Timezone</label>
              <select
                id="ops_onboard_timezone"
                name="timezone"
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                autoComplete="off"
              >
                <option value="Africa/Lagos">Africa/Lagos</option>
                <option value="Africa/Nairobi">Africa/Nairobi</option>
                <option value="Europe/London">Europe/London</option>
                <option value="America/New_York">America/New_York</option>
              </select>
            </div>
            <div>
              <label htmlFor="ops_onboard_currency">Currency</label>
              <select
                id="ops_onboard_currency"
                name="currency"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                autoComplete="off"
              >
                <option value="NGN">NGN</option>
                <option value="GHS">GHS</option>
                <option value="KES">KES</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
          <div className="border-t border-[var(--border)] pt-3 space-y-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider font-bold">
              First Admin Account
            </p>
            <div>
              <label htmlFor="ops_onboard_admin_name">Name *</label>
              <input
                id="ops_onboard_admin_name"
                name="adminName"
                type="text"
                value={form.adminName}
                onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
                required
                autoComplete="name"
              />
            </div>
            <div>
              <label htmlFor="ops_onboard_admin_email">Email *</label>
              <input
                id="ops_onboard_admin_email"
                name="adminEmail"
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="ops_onboard_admin_password">Password *</label>
              <div className="relative">
                <input
                  id="ops_onboard_admin_password"
                  name="adminPassword"
                  type={showPw ? 'text' : 'password'}
                  value={form.adminPassword}
                  onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                  required
                  minLength={8}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs"
                >
                  {showPw ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          {error && (
            <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full py-3 text-sm disabled:opacity-50"
          >
            {submitting ? 'CREATING…' : 'CREATE ORGANISATION'}
          </button>
        </form>
      )}
    </div>
  );
}
