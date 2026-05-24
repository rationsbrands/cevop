import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PasswordStrength } from '../components/PasswordStrength';
import { useTheme } from '../context/theme';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. The link might be expired.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
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
            <p className="text-sm text-[var(--muted)] max-w-sm">Secure access for your team.</p>
          </div>
          <div className="text-xs text-[var(--muted)] font-medium flex items-center gap-2">
            <span>Powered by</span>
            <div role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-sm" />
          </div>
        </div>

        <div className="flex items-center justify-center p-6">
          <div className="w-full max-w-md space-y-6 animate-in text-center">
            <div className="flex justify-center lg:hidden">
              <div role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-lg" />
            </div>

            <div className="card p-6 space-y-4">
              <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <h1 className="font-display text-2xl text-[var(--text)]">Password Reset</h1>
              <p className="text-sm text-[var(--muted)]">
                Your password has been successfully updated.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="btn btn-primary w-full py-3 tracking-widest text-sm"
              >
                Return to Login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
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
            Reset access and keep your team moving.
          </p>
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
            <h1 className="font-display text-3xl text-[var(--text)]">Set new password</h1>
            <p className="text-sm text-[var(--muted)]">Please enter your new password.</p>
          </div>

          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
            <div>
              <label htmlFor="admin_reset_new_password">New Password</label>
              <input
                id="admin_reset_new_password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              <PasswordStrength password={password} />
            </div>
            <div>
              <label htmlFor="admin_reset_confirm_password">Confirm Password</label>
              <input
                id="admin_reset_confirm_password"
                name="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[var(--danger)]/30 text-[var(--danger)] px-3 py-2 text-sm rounded-md">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary w-full py-3 tracking-widest text-sm disabled:opacity-50"
            >
              {submitting ? 'UPDATING...' : 'UPDATE PASSWORD'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
