import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';

export function SettingsPage() {
  const { user } = useAuth();
  const api = useApi();
  const [form, setForm] = useState({ name: '', slug: '', logo: '', whatsappNumber: '', slackWebhook: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/orgs/me').then((res) => {
      if (res.success) {
        const o = res.data;
        setForm({ name: o.name || '', slug: o.slug || '', logo: o.logo || '', whatsappNumber: o.whatsappNumber || '', slackWebhook: o.slackWebhook || '' });
      }
      setLoading(false);
    });
  }, []);

  async function save() {
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await api.put('/api/orgs/me', form);
      if (!res.success) {
        if (res.details) {
          throw new Error('Validation error: ' + res.details.map((d: any) => `${d.path.join('.')}: ${d.message}`).join(', '));
        }
        throw new Error(res.error);
      }
      setSuccess('Settings saved successfully.');
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  if (loading) return <div className="flex items-center justify-center h-48"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-in max-w-lg">
      <h1 className="font-display text-4xl">SETTINGS</h1>

      <div className="card p-6 space-y-5">
        <h2 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider border-b border-[var(--border)] pb-2">Organization</h2>
        <div><label>Restaurant Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label>Slug (URL identifier)</label><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })} /><p className="text-xs text-[var(--muted)] mt-1">Used for staff login. Lowercase letters, numbers, hyphens only.</p></div>
        <div><label>Logo URL</label><input value={form.logo} onChange={(e) => setForm({ ...form, logo: e.target.value })} placeholder="https://..." /></div>
      </div>

      <div className="card p-6 space-y-5">
        <h2 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider border-b border-[var(--border)] pb-2">Notifications</h2>
        {user?.plan === 'free' ? (
          <div className="p-4 border border-yellow-800 bg-yellow-900/20 text-yellow-400 text-sm">
            <p className="font-semibold">Not available on Free plan</p>
            <p className="mt-1">WhatsApp and Slack notifications require a paid plan. Please contact Cevop support to upgrade.</p>
          </div>
        ) : (
          <>
            <div>
              <label>WhatsApp Number</label>
              <input value={form.whatsappNumber} onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })} placeholder="+1234567890" />
              <p className="text-xs text-[var(--muted)] mt-1">Receive new orders and waiter call alerts via WhatsApp.</p>
            </div>
            <div>
              <label>Slack Webhook URL</label>
              <input value={form.slackWebhook} onChange={(e) => setForm({ ...form, slackWebhook: e.target.value })} placeholder="https://hooks.slack.com/services/..." />
              <p className="text-xs text-[var(--muted)] mt-1">Post order and alert notifications to your Slack channel.</p>
            </div>
          </>
        )}
      </div>

      {success && <div className="bg-green-900/20 border border-green-800 text-green-400 px-3 py-2 text-sm">{success}</div>}
      {error && <div className="bg-red-900/20 border border-red-800 text-red-400 px-3 py-2 text-sm">{error}</div>}

      <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Settings'}</button>
    </div>
  );
}
