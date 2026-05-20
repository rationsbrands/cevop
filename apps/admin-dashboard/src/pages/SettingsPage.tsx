import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';

export function SettingsPage() {
  const { user, logout } = useAuth();
  const api = useApi();
  const [form, setForm] = useState({
    name: '',
    slug: '',
    logo: '',
    whatsappNumber: '',
    slackWebhook: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

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
        });
      }
      setLoading(false);
    });
  }, []);

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
          <label>Restaurant Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label>Slug (URL identifier)</label>
          <input
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
          <label>Logo URL</label>
          <input
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
        {user?.organization?.plan === 'free' ? (
          <div className="p-4 border border-yellow-800 bg-yellow-900/20 text-yellow-400 text-sm">
            <p className="font-semibold">Not available on Free plan</p>
            <p className="mt-1">
              WhatsApp and Slack notifications require a paid plan. Please contact Cevop support to
              upgrade.
            </p>
          </div>
        ) : (
          <>
            <div>
              <label>WhatsApp Number</label>
              <input
                value={form.whatsappNumber}
                onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
                placeholder="e.g. +1234567890"
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                Receive new orders and waiter call alerts via WhatsApp.
              </p>
            </div>
            <div>
              <label>Slack Webhook URL</label>
              <input
                value={form.slackWebhook}
                onChange={(e) => setForm({ ...form, slackWebhook: e.target.value })}
                placeholder="e.g. https://hooks.slack.com/services/..."
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                Post order and alert notifications to your Slack channel.
              </p>
            </div>
          </>
        )}
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
            <input
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
