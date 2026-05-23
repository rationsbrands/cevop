import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApi, usePermission } from '../context/auth';

export function AuditLogsPage() {
  const api = useApi();
  const can = usePermission();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, total: 0, pages: 1 });

  const [filterOrgId, setFilterOrgId] = useState('');
  const [orgQuery, setOrgQuery] = useState('');
  const [orgOptions, setOrgOptions] = useState<any[]>([]);
  const [orgOptionsOpen, setOrgOptionsOpen] = useState(false);
  const [orgOptionsLoading, setOrgOptionsLoading] = useState(false);
  const [filterAction, setFilterAction] = useState('');
  const orgBlurTimerRef = useRef<number | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ page: page.toString(), limit: '50' });
        if (filterOrgId) q.set('orgId', filterOrgId);
        if (filterAction) q.set('action', filterAction);

        const res = await api.get(`/api/ops/audit?${q.toString()}`);
        if (res.success) {
          setLogs(res.data);
          setMeta(res.meta);
        }
      } finally {
        setLoading(false);
      }
    },
    [api, filterAction, filterOrgId],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void load(1), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const searchOrgs = useCallback(
    async (q: string) => {
      const next = q.trim();
      if (next.length < 2) {
        setOrgOptions([]);
        setOrgOptionsOpen(false);
        setOrgOptionsLoading(false);
        return;
      }
      setOrgOptionsLoading(true);
      try {
        const qs = new URLSearchParams({ search: next, page: '1', limit: '10' });
        const res = await api.get(`/api/ops/orgs?${qs.toString()}`);
        if (res.success && Array.isArray(res.data)) {
          setOrgOptions(res.data);
          setOrgOptionsOpen(true);
        } else {
          setOrgOptions([]);
          setOrgOptionsOpen(false);
        }
      } finally {
        setOrgOptionsLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void searchOrgs(orgQuery), 250);
    return () => window.clearTimeout(t);
  }, [orgQuery, searchOrgs]);

  useEffect(() => {
    return () => {
      if (orgBlurTimerRef.current) window.clearTimeout(orgBlurTimerRef.current);
    };
  }, []);

  if (!can('view_audit')) return <div className="text-red-400 p-8">Permission denied</div>;

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-[var(--text)]">Audit Logs</h1>
          <p className="text-[var(--muted)] text-sm mt-1">System-wide platform activity logs.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 max-w-sm relative">
          <label htmlFor="ops_audit_filter_org" className="sr-only">
            Filter by organisation
          </label>
          <div className="flex gap-2">
            <input
              id="ops_audit_filter_org"
              name="organization"
              type="text"
              placeholder="Filter by organisation name or slug…"
              value={orgQuery}
              onChange={(e) => {
                const next = e.target.value;
                setOrgQuery(next);
                if (filterOrgId) setFilterOrgId('');
              }}
              onFocus={() => {
                if (orgBlurTimerRef.current) window.clearTimeout(orgBlurTimerRef.current);
                if (orgOptions.length > 0) setOrgOptionsOpen(true);
              }}
              onBlur={() => {
                if (orgBlurTimerRef.current) window.clearTimeout(orgBlurTimerRef.current);
                orgBlurTimerRef.current = window.setTimeout(() => setOrgOptionsOpen(false), 150);
              }}
              className="flex-1"
              autoComplete="off"
            />
            {(orgQuery || filterOrgId) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setOrgQuery('');
                  setFilterOrgId('');
                  setOrgOptions([]);
                  setOrgOptionsOpen(false);
                }}
              >
                Clear
              </button>
            )}
          </div>

          {(orgOptionsOpen || orgOptionsLoading) && (
            <div className="absolute z-20 mt-2 w-full card p-2 max-h-64 overflow-auto">
              {orgOptionsLoading ? (
                <div className="text-xs text-[var(--muted)] px-2 py-2">Searching…</div>
              ) : orgOptions.length === 0 ? (
                <div className="text-xs text-[var(--muted)] px-2 py-2">No matches</div>
              ) : (
                <div className="space-y-1">
                  {orgOptions.map((o: any) => (
                    <button
                      key={o.id}
                      type="button"
                      className="w-full text-left px-2 py-2 rounded-sm hover:bg-[var(--surface2)] transition-colors"
                      onClick={() => {
                        setFilterOrgId(o.id);
                        setOrgQuery(`${o.name}${o.slug ? ` (${o.slug})` : ''}`);
                        setOrgOptionsOpen(false);
                      }}
                    >
                      <div className="text-sm text-[var(--text)] font-medium">{o.name}</div>
                      <div className="text-xs text-[var(--muted)] font-mono">{o.slug}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <label htmlFor="ops_audit_filter_action" className="sr-only">
          Filter by action
        </label>
        <input
          id="ops_audit_filter_action"
          name="action"
          type="text"
          placeholder="Filter by Action (e.g. login, create_order)..."
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="flex-1 max-w-sm"
          autoComplete="off"
        />
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-[var(--muted)]">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">No logs found.</div>
        ) : (
          <table className="min-w-[900px]">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Tenant</th>
                <th>User</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id}>
                  <td className="text-xs text-[var(--muted)] whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <span className="text-xs font-mono bg-[var(--background)] border border-[var(--border)] px-1.5 py-0.5 rounded">
                      {log.action}
                    </span>
                  </td>
                  <td>
                    {log.organization ? (
                      <div className="text-sm">
                        <span className="font-medium">{log.organization.name}</span>
                        <span className="text-[var(--muted)] text-xs ml-2">
                          {log.organization.slug}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[var(--muted)] text-xs">System</span>
                    )}
                  </td>
                  <td>
                    {log.user ? (
                      <div className="text-sm">
                        <span className="font-medium text-[var(--text)]">{log.user.name}</span>
                        <span className="text-[var(--muted)] text-xs ml-2">{log.user.email}</span>
                      </div>
                    ) : (
                      <span className="text-[var(--muted)] text-xs">System / Anonymous</span>
                    )}
                  </td>
                  <td>
                    <div className="text-xs text-[var(--muted)]">
                      <span className="font-mono">{log.entity}</span>: {log.entityId}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {meta.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--muted)]">
            Showing {(meta.page - 1) * 50 + 1} to {Math.min(meta.page * 50, meta.total)} of{' '}
            {meta.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={meta.page <= 1}
              onClick={() => load(meta.page - 1)}
              className="btn btn-secondary btn-sm"
            >
              Previous
            </button>
            <button
              disabled={meta.page >= meta.pages}
              onClick={() => load(meta.page + 1)}
              className="btn btn-secondary btn-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
