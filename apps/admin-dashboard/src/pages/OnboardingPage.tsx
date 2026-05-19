import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';

// SUPERADMIN only — provisions a new organisation
export function OnboardingPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_URL || '';

  const [form, setForm] = useState({
    orgName: '',
    orgSlug: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    timezone: 'Africa/Lagos',
    currency: 'NGN',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [error, setError] = useState('');

  function slugify(name: string) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Failed to onboard'); return; }
      setSuccess(body.data);
    } catch {
      setError('Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) return (
    <div className="space-y-6 max-w-lg animate-in">
      <div>
        <h1 className="font-display text-4xl text-[var(--accent)]">ORGANISATION CREATED</h1>
      </div>
      <div className="card p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider">Organisation</p>
          <p className="font-semibold text-[var(--text)]">{success.organization.name}</p>
          <p className="text-sm text-[var(--muted)] font-mono">{success.organization.slug}</p>
        </div>
        <div className="space-y-1 border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider">Admin Account</p>
          <p className="font-semibold text-[var(--text)]">{success.admin.name}</p>
          <p className="text-sm text-[var(--muted)]">{success.admin.email}</p>
        </div>
        <div className="bg-[var(--accent-dim)] border border-[var(--accent)] p-3 text-sm text-[var(--text)]">
          The admin can now log in at <span className="font-mono text-[var(--accent)]">{import.meta.env.VITE_ADMIN_DASHBOARD_URL || 'http://localhost:5175'}</span> using their email and password.
        </div>
        <div className="flex gap-2">
          <button onClick={() => setSuccess(null)} className="btn btn-secondary flex-1 py-2 text-sm">Create Another</button>
          <button onClick={() => navigate('/')} className="btn btn-primary flex-1 py-2 text-sm">Done</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-lg animate-in">
      <div>
        <h1 className="font-display text-4xl">ONBOARD ORGANISATION</h1>
        <p className="text-[var(--muted)] text-sm mt-1">Create a new restaurant organisation and its first admin account</p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider font-bold">Organisation Details</p>
        </div>

        <div>
          <label>Restaurant Name *</label>
          <input
            value={form.orgName}
            onChange={(e) => setForm(f => ({ ...f, orgName: e.target.value, orgSlug: slugify(e.target.value) }))}
            placeholder="Rations Restaurant"
            required
          />
        </div>

        <div>
          <label>Slug * <span className="text-[var(--muted)] normal-case font-normal">(URL identifier — lowercase, no spaces)</span></label>
          <input
            value={form.orgSlug}
            onChange={(e) => setForm(f => ({ ...f, orgSlug: e.target.value }))}
            placeholder="rations-restaurant"
            required
            pattern="^[a-z0-9-]+$"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Timezone</label>
            <select value={form.timezone} onChange={(e) => setForm(f => ({ ...f, timezone: e.target.value }))}>
              <option value="Africa/Lagos">Africa/Lagos (WAT)</option>
              <option value="Africa/Nairobi">Africa/Nairobi (EAT)</option>
              <option value="Africa/Accra">Africa/Accra (GMT)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="America/New_York">America/New_York (EST)</option>
            </select>
          </div>
          <div>
            <label>Currency</label>
            <select value={form.currency} onChange={(e) => setForm(f => ({ ...f, currency: e.target.value }))}>
              <option value="NGN">NGN — Nigerian Naira</option>
              <option value="GHS">GHS — Ghanaian Cedi</option>
              <option value="KES">KES — Kenyan Shilling</option>
              <option value="ZAR">ZAR — South African Rand</option>
              <option value="USD">USD — US Dollar</option>
              <option value="GBP">GBP — British Pound</option>
            </select>
          </div>
        </div>

        <div className="border-t border-[var(--border)] pt-4 space-y-1">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider font-bold">First Admin Account</p>
        </div>

        <div>
          <label>Admin Name *</label>
          <input
            value={form.adminName}
            onChange={(e) => setForm(f => ({ ...f, adminName: e.target.value }))}
            placeholder="Restaurant Manager"
            required
          />
        </div>

        <div>
          <label>Admin Email *</label>
          <input
            type="email"
            value={form.adminEmail}
            onChange={(e) => setForm(f => ({ ...f, adminEmail: e.target.value }))}
            placeholder="admin@restaurant.com"
            required
          />
        </div>

        <div>
          <label>Admin Password * <span className="text-[var(--muted)] normal-case font-normal">(min 8 characters)</span></label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={form.adminPassword}
              onChange={(e) => setForm(f => ({ ...f, adminPassword: e.target.value }))}
              placeholder="Strong password"
              required
              minLength={8}
              className="pr-10"
            />
            <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] text-xs">
              {showPassword ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
            </button>
          </div>
        </div>

        {error && <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">{error}</div>}

        <button type="submit" disabled={submitting} className="btn btn-primary w-full py-3 text-sm tracking-widest disabled:opacity-50">
          {submitting ? 'CREATING…' : 'CREATE ORGANISATION'}
        </button>
      </form>
    </div>
  );
}
