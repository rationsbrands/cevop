import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { useTheme } from '../context/theme';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<any[] | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

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
      setError(err.message);
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
          <div className="flex items-center gap-3">
            <div role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-lg" />
            <span className="text-[10px] border border-[var(--danger)] text-[var(--danger)] px-2 py-1 font-bold tracking-widest uppercase">
              Ops
            </span>
          </div>
          <p className="text-sm text-[var(--muted)] max-w-sm">Internal operations portal.</p>
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
            <h1 className="font-display text-3xl text-[var(--text)]">Ops sign in</h1>
            <p className="text-sm text-[var(--muted)]">Cevop internal only.</p>
          </div>
          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
            <div>
              <label htmlFor="ops_login_email">Email</label>
              <input
                id="ops_login_email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAccounts(null);
                  setSelectedOrgId('');
                }}
                required
                autoComplete="email"
                placeholder="name@cevop.com"
              />
            </div>
            <div>
              <label htmlFor="ops_login_password">Password</label>
              <div className="relative">
                <input
                  id="ops_login_password"
                  name="password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAccounts(null);
                    setSelectedOrgId('');
                  }}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] text-xs select-none"
                >
                  {showPw ? 'hide' : 'show'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ops_login_remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
              />
              <label
                htmlFor="ops_login_remember"
                className="auth-plain-label text-sm cursor-pointer select-none normal-case tracking-normal"
              >
                Remember me for 30 days
              </label>
            </div>

            {accounts && (
              <div>
                <label htmlFor="ops_login_organization">Select organisation</label>
                <select
                  id="ops_login_organization"
                  name="organizationId"
                  value={selectedOrgId}
                  onChange={(e) => {
                    setSelectedOrgId(e.target.value);
                    localStorage.setItem(`cevop_last_org:${email.toLowerCase()}`, e.target.value);
                  }}
                  required
                  autoComplete="off"
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
              className="btn btn-primary w-full py-3 tracking-widest text-sm disabled:opacity-50"
            >
              {loading ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
