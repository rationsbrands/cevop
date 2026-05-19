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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try { await login(email, password); navigate('/'); }
    catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
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
          <div className="flex items-center gap-3">
            <div className="brand-mark text-4xl text-[var(--accent)] leading-none">CEVOP</div>
            <span className="text-[10px] border border-[var(--danger)] text-[var(--danger)] px-2 py-1 font-bold tracking-widest uppercase">Ops</span>
          </div>
          <p className="text-sm text-[var(--muted)] max-w-sm">
            Internal operations portal.
          </p>
        </div>
        <div className="text-xs text-[var(--muted)] font-medium">
          Powered by <span className="brand-mark text-[var(--text)]">CEVOP</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8 animate-in">
          <div className="space-y-2">
            <div className="brand-mark text-5xl text-[var(--accent)] leading-none lg:hidden">CEVOP</div>
            <h1 className="font-display text-3xl text-[var(--text)]">Ops sign in</h1>
            <p className="text-sm text-[var(--muted)]">Cevop internal only.</p>
          </div>
          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
          <div>
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="ops@cevop.io" />
          </div>
          <div>
            <label>Password</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required className="pr-10" />
              <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">{showPw ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}</button>
            </div>
          </div>
          {error && <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">{error}</div>}
          <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 tracking-widest text-sm disabled:opacity-50">
            {loading ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}
