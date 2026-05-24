import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { useTheme } from '../context/theme';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<any[] | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [navigate, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (accounts) {
        await login(email, password, selectedOrgId, rememberMe);
      } else {
        await login(email, password, undefined, rememberMe);
      }
      navigate('/');
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
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell min-h-dvh w-full bg-[var(--bg)] grid lg:grid-cols-2 relative">
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
          <div role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-lg" />
          <p className="text-sm text-[var(--muted)] max-w-sm">
            Modern restaurant operations for tables, staff and service.
          </p>
        </div>

        <div className="space-y-6 max-w-md">
          <h2 className="font-display text-4xl text-[var(--text)] leading-tight">
            Keep service fast. Keep teams aligned.
          </h2>
          <div className="grid gap-3">
            <div className="card p-4">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Orders
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                Track and manage orders across tables.
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Help Options
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                Waiter calls and service requests, organised.
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-[var(--muted)] uppercase font-bold tracking-widest">
                Branches
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                Operate multi-branch with clear controls.
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-[var(--muted)] font-medium flex items-center gap-2">
          <span>Powered by</span>
          <div role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-sm" />
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8 animate-in">
          <div className="space-y-2">
            <div className="lg:hidden">
              <div role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-lg" />
            </div>
            <h1 className="font-display text-3xl text-[var(--text)]">Sign in</h1>
            <p className="text-sm text-[var(--muted)]">Access your admin dashboard.</p>
          </div>

          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
            <div>
              <label htmlFor="admin_login_email">Email</label>
              <input
                id="admin_login_email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAccounts(null);
                  setSelectedOrgId('');
                }}
                placeholder="name@restaurant.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label htmlFor="admin_login_password">Password</label>
              <div className="relative">
                <input
                  id="admin_login_password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAccounts(null);
                    setSelectedOrgId('');
                  }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors text-xs select-none"
                  tabIndex={-1}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'hide' : 'show'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="admin_login_remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
              />
              <label
                htmlFor="admin_login_remember"
                className="auth-plain-label text-sm cursor-pointer select-none normal-case tracking-normal"
              >
                Remember me for 30 days
              </label>
            </div>

            {accounts && (
              <div>
                <label htmlFor="admin_login_organization">Select organisation</label>
                <select
                  id="admin_login_organization"
                  name="organizationId"
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
              <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 tracking-widest text-sm"
            >
              {loading ? 'SIGNING IN…' : 'SIGN IN'}
            </button>

            <div className="flex items-center justify-between text-xs">
              <Link
                to="/forgot-password"
                className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              >
                Forgot password?
              </Link>
              <a href="/signup" className="text-[var(--accent)] hover:underline font-semibold">
                Start free trial
              </a>
            </div>
          </form>

          <p className="text-center text-xs text-[var(--muted)]">
            Access is by invite only. Contact your organisation admin.
          </p>
        </div>
      </div>
    </div>
  );
}
