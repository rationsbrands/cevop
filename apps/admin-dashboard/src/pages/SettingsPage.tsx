import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';
import { PasswordStrength } from '../components/PasswordStrength';

export function SettingsPage() {
  const { user, logout, setToken } = useAuth();
  const api = useApi();
  const [form, setForm] = useState({
    name: '',
    slug: '',
    logo: '',
    whatsappNumber: '',
    slackWebhook: '',
    notifyNewOrders: true,
    notifyWaiterCalls: true,
    notifyServiceRequests: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [pwForm, setPwForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwError, setPwError] = useState('');
  const [showPwSection, setShowPwSection] = useState(false);

  const [deleteConfirmOrgName, setDeleteConfirmOrgName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    api.get('/api/orgs/me').then((res) => {
      if (res.success) {
        const o = res.data;
        setForm({
          name: o.name || '',
          slug: o.slug || '',
          logo: o.logo || '',
          whatsappNumber: o.whatsappNumber || '',
          slackWebhook: o.slackWebhook || '',
          notifyNewOrders: o.notifyNewOrders ?? true,
          notifyWaiterCalls: o.notifyWaiterCalls ?? true,
          notifyServiceRequests: o.notifyServiceRequests ?? true,
        });
      }
      setLoading(false);
    });
  }, [api]);

  async function save() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.put('/api/orgs/me', form);
      if (!res.success) {
        if (res.details) {
          throw new Error(
            'Validation error: ' +
              res.details.map((d: any) => `${d.path.join('.')}: ${d.message}`).join(', '),
          );
        }
        throw new Error(res.error);
      }
      setSuccess('Settings saved successfully.');
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function deleteOrg() {
    if (deleteConfirmOrgName !== form.name) return;
    setDeleting(true);
    try {
      const res = await api.delete('/api/orgs/me');
      if (res.success) {
        await logout();
      } else {
        setError(res.error || 'Failed to delete organization');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to delete organization');
    }
    setDeleting(false);
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6 animate-in max-w-lg">
      <h1 className="font-display text-4xl">SETTINGS</h1>

      <div className="card p-6 space-y-5">
        <h2 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider border-b border-[var(--border)] pb-2">
          Organization
        </h2>
        <div>
          <label htmlFor="settings_org_name">Restaurant Name</label>
          <input
            id="settings_org_name"
            name="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="settings_org_slug">Slug (URL identifier)</label>
          <input
            id="settings_org_slug"
            name="slug"
            value={form.slug}
            onChange={(e) =>
              setForm({
                ...form,
                slug: e.target.value
                  .toLowerCase()
                  .replace(/\s+/g, '-')
                  .replace(/[^a-z0-9-]/g, ''),
              })
            }
          />
          <p className="text-xs text-[var(--muted)] mt-1">
            Used for staff login. Lowercase letters, numbers, hyphens only.
          </p>
        </div>
        <div>
          <label htmlFor="settings_org_logo">Logo URL</label>
          <input
            id="settings_org_logo"
            name="logo"
            value={form.logo}
            onChange={(e) => setForm({ ...form, logo: e.target.value })}
            placeholder="e.g. https://..."
          />
        </div>
      </div>

      <div className="card p-6 space-y-5">
        <h2 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider border-b border-[var(--border)] pb-2">
          Notifications
        </h2>
        {(() => {
          const isPaidPlan =
            user?.organization?.plan &&
            ['starter', 'growth', 'enterprise', 'trial'].includes(user.organization.plan);
          return (
            <div className="space-y-4">
              {!isPaidPlan && (
                <div className="bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[var(--accent)]/30 rounded p-4 text-sm mb-4">
                  <p className="font-bold text-[var(--text)] mb-1">
                    Notifications are a Premium Feature
                  </p>
                  <p className="text-[var(--muted)]">
                    Upgrade to Starter or higher to receive order and waiter alerts via WhatsApp.
                  </p>
                  <a
                    href="mailto:hello@cevop.com"
                    className="text-[var(--accent)] font-semibold mt-2 block hover:underline"
                  >
                    Contact us to upgrade →
                  </a>
                </div>
              )}

              <div className={`space-y-5 ${!isPaidPlan ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="grid sm:grid-cols-2 gap-6">
                  {/* WhatsApp field */}
                  <div>
                    <label htmlFor="settings_whatsapp_number">WhatsApp Number</label>
                    <input
                      id="settings_whatsapp_number"
                      name="whatsappNumber"
                      value={form.whatsappNumber}
                      onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
                      placeholder="+234 800 000 0000"
                    />
                    <p className="text-[10px] text-[var(--muted)] mt-1">
                      Required for WhatsApp alerts.
                    </p>
                  </div>

                  {/* Slack field */}
                  <div>
                    <label htmlFor="settings_slack_webhook">Slack Webhook URL</label>
                    <input
                      id="settings_slack_webhook"
                      name="slackWebhook"
                      value={form.slackWebhook}
                      onChange={(e) => setForm({ ...form, slackWebhook: e.target.value })}
                      placeholder="https://hooks.slack.com/services/..."
                    />
                    <p className="text-[10px] text-[var(--muted)] mt-1">
                      Required for Slack alerts. (Growth plan & above)
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    Notification Preferences
                  </h3>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="mt-0.5">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
                        checked={form.notifyNewOrders}
                        onChange={(e) => setForm({ ...form, notifyNewOrders: e.target.checked })}
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                        New Orders
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        Get notified when a new order is placed
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="mt-0.5">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
                        checked={form.notifyWaiterCalls}
                        onChange={(e) => setForm({ ...form, notifyWaiterCalls: e.target.checked })}
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                        Waiter Calls
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        Get notified when a customer requests a waiter
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="mt-0.5">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
                        checked={form.notifyServiceRequests}
                        onChange={(e) =>
                          setForm({ ...form, notifyServiceRequests: e.target.checked })
                        }
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                        Service Requests
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        Get notified for bill requests and table service
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {success && (
        <div className="bg-green-900/20 border border-green-800 text-green-400 px-3 py-2 text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[var(--danger)]/30 text-[var(--danger)] px-3 py-2 text-sm rounded-md">
          {error}
        </div>
      )}

      <button className="btn btn-primary" disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>

      {/* Change Password */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider">
            Change Password
          </h2>
          <button
            onClick={() => {
              setShowPwSection((v) => !v);
              setPwError('');
              setPwSuccess('');
              setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            }}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {showPwSection ? 'Cancel' : 'Change password'}
          </button>
        </div>

        {showPwSection && (
          <div className="space-y-4 pt-2 border-t border-[var(--border)]">
            {pwError && (
              <div className="bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[var(--danger)]/30 text-[var(--danger)] px-3 py-2 text-sm rounded-md">
                {pwError}
              </div>
            )}
            {pwSuccess && (
              <div className="bg-green-900/20 border border-green-800 text-green-400 px-3 py-2 text-sm">
                {pwSuccess}
              </div>
            )}

            <div>
              <label htmlFor="settings_current_password">Current Password</label>
              <input
                id="settings_current_password"
                type="password"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))}
                autoComplete="current-password"
              />
            </div>

            <div>
              <label htmlFor="settings_new_password">New Password</label>
              <input
                id="settings_new_password"
                type="password"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))}
                autoComplete="new-password"
              />
              <PasswordStrength password={pwForm.newPassword} />
            </div>

            <div>
              <label htmlFor="settings_confirm_new_password">Confirm New Password</label>
              <input
                id="settings_confirm_new_password"
                type="password"
                value={pwForm.confirmPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                autoComplete="new-password"
              />
            </div>

            <button
              onClick={async () => {
                setPwError('');
                setPwSuccess('');

                if (pwForm.newPassword !== pwForm.confirmPassword) {
                  setPwError('Passwords do not match');
                  return;
                }
                if (pwForm.newPassword.length < 8) {
                  setPwError('Password must be at least 8 characters');
                  return;
                }
                if (!/(?=.*[A-Z])(?=.*\d)/.test(pwForm.newPassword)) {
                  setPwError('Password must contain at least one uppercase letter and one number');
                  return;
                }

                setPwSaving(true);
                try {
                  const res = await api.post('/api/orgs/me/change-password', {
                    currentPassword: pwForm.currentPassword,
                    newPassword: pwForm.newPassword,
                  });

                  if (!res.success) {
                    setPwError(res.error || 'Failed to change password');
                    return;
                  }

                  if (res.data?.accessToken) {
                    setToken(res.data.accessToken);
                  }

                  setPwSuccess('Password changed. All other devices have been signed out.');
                  setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                  setShowPwSection(false);
                } catch {
                  setPwError('Something went wrong. Please try again.');
                } finally {
                  setPwSaving(false);
                }
              }}
              disabled={
                pwSaving ||
                !pwForm.currentPassword ||
                !pwForm.newPassword ||
                !pwForm.confirmPassword
              }
              className="btn btn-primary disabled:opacity-50"
            >
              {pwSaving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        )}

        {pwSuccess && !showPwSection && <p className="text-sm text-green-400">{pwSuccess}</p>}
      </div>

      {/* Danger Zone */}
      <div className="card border-[var(--danger)] mt-12 p-6 space-y-4">
        <h2 className="font-semibold text-sm text-[var(--danger)] uppercase tracking-wider border-b border-[var(--danger)]/20 pb-2">
          Danger Zone
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Deleting your organization is irreversible. All branches, menus, orders, and staff
          accounts will be permanently deleted.
        </p>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="btn bg-[var(--danger)] text-white border-transparent hover:brightness-110 px-4 py-2 text-sm"
        >
          Delete Organization
        </button>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--danger)] p-6 rounded-lg w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <h3 className="font-display text-2xl text-[var(--danger)]">Delete Organization</h3>
            <p className="text-sm text-[var(--text)]">
              This action <strong>cannot</strong> be undone. Please type{' '}
              <strong>{form.name}</strong> to confirm.
            </p>
            <label htmlFor="settings_delete_confirm_org" className="text-xs text-[var(--muted)]">
              Confirmation
            </label>
            <input
              id="settings_delete_confirm_org"
              name="deleteConfirmOrgName"
              className="w-full"
              placeholder={form.name}
              value={deleteConfirmOrgName}
              onChange={(e) => setDeleteConfirmOrgName(e.target.value)}
            />
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmOrgName('');
                }}
                className="btn btn-secondary px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={deleteOrg}
                disabled={deleting || deleteConfirmOrgName !== form.name}
                className="btn bg-[var(--danger)] text-white border-transparent hover:brightness-110 px-4 py-2 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
