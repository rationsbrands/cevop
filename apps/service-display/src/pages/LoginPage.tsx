import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<any[] | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (accounts) {
        await login(email, password, selectedOrgId);
      } else {
        await login(email, password);
      }
      navigate('/', { replace: true });
    } catch (err: any) {
      if (err?.code === 'MULTI_ACCOUNT' && Array.isArray(err.accounts)) {
        setAccounts(err.accounts);
        const saved = localStorage.getItem(`cevop_last_org:${email.toLowerCase()}`) || '';
        const initial = err.accounts.some((a: any) => a.organizationId === saved)
          ? saved
          : err.accounts[0]?.organizationId || '';
        setSelectedOrgId(initial);
        setLoading(false);
        return;
      }
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
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
            Live service display for the floor and pass.
          </p>
        </div>
        <div className="space-y-3 max-w-md">
          <div className="card p-4">
            <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
              Real-time
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">
              Keep staff aligned with what’s next.
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
              Focused
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">
              Built for speed and clarity.
            </div>
          </div>
        </div>
        <div className="text-xs text-[var(--muted)] font-medium">
          Powered by <span className="brand-mark text-[var(--text)]">CEVOP</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8 animate-in">
          <div className="space-y-2">
            <div className="brand-mark text-5xl text-[var(--accent)] leading-none lg:hidden">
              CEVOP
            </div>
            <h1 className="font-display text-3xl text-[var(--text)]">Service display sign in</h1>
            <p className="text-sm text-[var(--muted)]">Access the service board.</p>
          </div>

          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
            <div>
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAccounts(null);
                  setSelectedOrgId('');
                }}
                required
                placeholder="name@restaurant.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label>Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAccounts(null);
                    setSelectedOrgId('');
                  }}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] text-xs"
                >
                  {showPassword ? 'hide' : 'show'}
                </button>
              </div>
            </div>

            {accounts && (
              <div>
                <label>Select organisation</label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => {
                    setSelectedOrgId(e.target.value);
                    localStorage.setItem(`cevop_last_org:${email.toLowerCase()}`, e.target.value);
                  }}
                  required
                >
                  {accounts.map((a: any) => (
                    <option key={a.organizationId} value={a.organizationId}>
                      {(a.organizationName || 'Organisation') +
                        ' • ' +
                        (a.role || 'ROLE') +
                        (a.branchName ? ` • ${a.branchName}` : '')}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--muted)] mt-2">
                  This email exists in multiple organisations. Pick the correct one to continue.
                </p>
              </div>
            )}

            {error && (
              <div className="border border-[var(--danger)] text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 tracking-widest text-sm"
            >
              {loading ? 'SIGNING IN...' : 'SIGN IN'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
