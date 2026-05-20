import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/theme';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { mode, setMode } = useTheme();

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true); // Always show success to prevent email enumeration
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent)
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
              Reset access and keep your team moving.
            </p>
          </div>
          <div className="text-xs text-[var(--muted)] font-medium">
            Powered by <span className="brand-mark text-[var(--text)]">CEVOP</span>
          </div>
        </div>

        <div className="flex items-center justify-center p-6">
          <div className="w-full max-w-md space-y-6 animate-in">
            <div className="space-y-2">
              <div className="brand-mark text-5xl text-[var(--accent)] leading-none lg:hidden">
                CEVOP
              </div>
              <h1 className="font-display text-3xl text-[var(--text)]">Check your email</h1>
              <p className="text-sm text-[var(--muted)]">
                If that email is registered, a reset link has been sent.
              </p>
            </div>
            <div className="card p-6 space-y-4">
              <p className="text-sm text-[var(--text)]">
                Check your inbox and follow the link to set a new password.
              </p>
              <Link to="/login" className="btn btn-secondary w-full py-3 tracking-widest text-sm">
                Back to login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );

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
          <p className="text-sm text-[var(--muted)] max-w-sm">Get back in quickly. No friction.</p>
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
            <h1 className="font-display text-3xl text-[var(--text)]">Reset password</h1>
            <p className="text-sm text-[var(--muted)]">We’ll email you a secure reset link.</p>
          </div>
          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
            <div>
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="e.g. name@restaurant.com"
              />
            </div>
            {error && (
              <div className="bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[var(--danger)]/30 text-[var(--danger)] px-3 py-2 text-sm rounded-md">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 tracking-widest text-sm disabled:opacity-50"
            >
              {loading ? 'SENDING…' : 'SEND RESET LINK'}
            </button>
            <div className="text-center">
              <Link
                to="/login"
                className="text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              >
                Back to login
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
