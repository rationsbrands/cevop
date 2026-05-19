import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { useTheme } from '../context/theme';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface InviteInfo {
  email: string;
  role: string;
  organizationName: string;
  branchName: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  BRANCH_ADMIN: 'Branch Admin',
  SERVICE: 'Service Staff',
  WAITER: 'Waiter',
  ADMIN: 'Admin',
};

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { login } = useAuth();

  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [validating, setValidating] = useState(true);
  const [invalidReason, setInvalidReason] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  const PageShell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-dvh w-full bg-[var(--bg)] grid lg:grid-cols-2 relative">
      <button
        onClick={() => setMode(nextThemeMode)}
        className={`absolute top-6 right-6 z-10 w-10 h-10 rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
          mode === 'system'
            ? 'bg-[var(--surface2)] border-[var(--border)] text-[var(--text)] shadow-sm'
            : mode === 'dark'
              ? 'bg-black border-[var(--border)] text-[var(--text)] shadow-sm'
              : 'bg-white border-[var(--border)] text-black shadow-sm'
        }`}
        title={`Theme: ${themeLabel} (click → ${nextThemeLabel})`}
        aria-label={`Theme ${themeLabel}. Click to switch to ${nextThemeLabel}.`}
      >
        {themeLabel}
      </button>

      <div className="hidden lg:flex flex-col justify-between p-10 border-r border-[var(--border)] bg-[var(--surface)]">
        <div className="space-y-3">
          <div className="brand-mark text-4xl text-[var(--accent)] leading-none">CEVOP</div>
          <p className="text-sm text-[var(--muted)] max-w-sm">
            Join your team and start managing service.
          </p>
        </div>
        <div className="text-xs text-[var(--muted)] font-medium">
          Powered by <span className="brand-mark text-[var(--text)]">CEVOP</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 animate-in">
          <div className="brand-mark text-5xl text-[var(--accent)] leading-none lg:hidden">CEVOP</div>
          {children}
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    if (!token) { setInvalidReason('Invalid invite link'); setValidating(false); return; }
    fetch(`${API_BASE}/api/auth/validate-invite/${token}`)
      .then((r) => r.json())
      .then(({ success, data, error: err }) => {
        if (success) setInviteInfo(data);
        else setInvalidReason(err || 'Invalid or expired invite');
      })
      .catch(() => setInvalidReason('Could not validate invite'))
      .finally(() => setValidating(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSubmitting(true); setError('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/accept-invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Failed to create account'); return; }

      // Auto login with the returned cookie
      window.location.href = '/';
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (validating) return (
    <PageShell>
      <div className="card p-6 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    </PageShell>
  );

  if (invalidReason) return (
    <PageShell>
      <div className="space-y-4">
        <div className="w-10 h-10 rounded-full bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] border border-[var(--danger)] flex items-center justify-center text-[var(--danger)] text-lg font-bold">!</div>
        <div className="space-y-1">
          <h1 className="font-display text-3xl text-[var(--text)]">Invite link invalid</h1>
          <p className="text-[var(--muted)] text-sm">{invalidReason}</p>
        </div>
        <a href="/login" className="btn btn-secondary w-full py-3 tracking-widest text-sm">
          Back to login
        </a>
      </div>
    </PageShell>
  );

  return (
    <PageShell>
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-[var(--text)]">Create your account</h1>
        <p className="text-sm text-[var(--muted)]">You’ve been invited to join your organisation.</p>
      </div>

      <div className="card p-4 space-y-1">
        <p className="text-[var(--text)] font-semibold">{inviteInfo?.organizationName}</p>
        {inviteInfo?.branchName && (
          <p className="text-[var(--muted)] text-sm">Branch: {inviteInfo.branchName}</p>
        )}
        <p className="text-[var(--muted)] text-sm">Role: {ROLE_LABELS[inviteInfo?.role ?? ''] ?? inviteInfo?.role}</p>
        <p className="text-xs text-[var(--muted)] mt-2">Signing up as: <span className="text-[var(--text)]">{inviteInfo?.email}</span></p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
          <div>
            <label>Your Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              required
            />
          </div>

          <div>
            <label>Password *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
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

          <div>
            <label>Confirm Password *</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                required
                className="pr-10"
              />
              <button type="button" onClick={() => setShowConfirm(v => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] text-xs">
                {showConfirm ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full py-3 tracking-widest text-sm disabled:opacity-50"
          >
            {submitting ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT & SIGN IN'}
          </button>
      </form>
    </PageShell>
  );
}
