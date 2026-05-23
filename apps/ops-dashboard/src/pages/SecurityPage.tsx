import React, { useState } from 'react';
import { useAuth, useApi } from '../context/auth';

export function SecurityPage() {
  const { mustChangePassword, clearMustChange, setToken } = useAuth();
  const api = useApi();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (form.newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/(?=.*[A-Z])(?=.*\d)/.test(form.newPassword)) {
      setError('Password must contain at least one uppercase letter and one number');
      return;
    }

    setSaving(true);
    try {
      const res = await api.post('/api/ops/team/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });

      if (!res.success) {
        setError(res.error || 'Failed to change password');
        return;
      }

      // Update the access token in memory — keeps this session alive
      // The server has already revoked all other sessions
      if (res.data?.accessToken) {
        setToken(res.data.accessToken);
      }

      // Clear the mustChangePassword flag if it was set
      clearMustChange();
      setSuccess('Password changed. All other devices have been signed out.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="font-display text-2xl text-[var(--text)]">Security</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          {mustChangePassword
            ? 'You must change your password before continuing.'
            : 'Change your account password.'}
        </p>
      </div>

      {mustChangePassword && (
        <div className="bg-amber-900/20 border border-amber-800 text-amber-300 px-4 py-3 text-sm">
          Your account requires a password change. Please set a new password to continue.
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {success && (
          <div className="bg-green-900/20 border border-green-800 text-green-400 px-3 py-2 text-sm">
            {success}
          </div>
        )}
        <div>
          <label htmlFor="ops_security_current_password">Current Password</label>
          <div className="relative">
            <input
              id="ops_security_current_password"
              name="currentPassword"
              type={showPw ? 'text' : 'password'}
              value={form.currentPassword}
              onChange={(e) => setForm((v) => ({ ...v, currentPassword: e.target.value }))}
              required
              autoComplete="current-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs"
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="ops_security_new_password">New Password</label>
          <input
            id="ops_security_new_password"
            name="newPassword"
            type={showPw ? 'text' : 'password'}
            value={form.newPassword}
            onChange={(e) => setForm((v) => ({ ...v, newPassword: e.target.value }))}
            required
            autoComplete="new-password"
          />
          <p className="text-xs text-[var(--muted)] mt-1">
            Min 8 characters, at least one uppercase letter and one number.
          </p>
        </div>
        <div>
          <label htmlFor="ops_security_confirm_password">Confirm New Password</label>
          <input
            id="ops_security_confirm_password"
            name="confirmPassword"
            type={showPw ? 'text' : 'password'}
            value={form.confirmPassword}
            onChange={(e) => setForm((v) => ({ ...v, confirmPassword: e.target.value }))}
            required
            autoComplete="new-password"
          />
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !form.currentPassword || !form.newPassword || !form.confirmPassword}
          className="btn btn-primary w-full py-3 tracking-widest text-sm disabled:opacity-50"
        >
          {saving ? 'CHANGING PASSWORD…' : 'CHANGE PASSWORD'}
        </button>
      </form>

      <p className="text-xs text-[var(--muted)] text-center">
        After changing your password, all other devices will be signed out.
      </p>
    </div>
  );
}
