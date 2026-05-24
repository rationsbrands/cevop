import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApi, usePermission } from '../context/auth';

export function AuditLogsPage() {
  const api = useApi();
  const can = usePermission();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, total: 0, pages: 1 });
  const [openLog, setOpenLog] = useState<any | null>(null);

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

  function getTitle(log: any): string {
    const action = typeof log?.action === 'string' && log.action ? log.action : 'ACTION';
    const entity = typeof log?.entity === 'string' && log.entity ? log.entity : 'Entity';
    return `${action} • ${entity}`;
  }

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

      {openLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setOpenLog(null)}
        >
          <div
            className="card w-full max-w-3xl p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-display text-2xl truncate">{getTitle(openLog)}</h2>
                <div className="text-xs text-[var(--muted)] mt-1">
                  {new Date(openLog.createdAt).toLocaleString()}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpenLog(null)}>
                Close
              </button>
            </div>

            <div className="grid gap-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="card p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
                    Tenant
                  </div>
                  <div className="text-sm text-[var(--text)] mt-1">
                    {openLog.organization?.name ?? 'System'}
                  </div>
                  {openLog.organization?.slug && (
                    <div className="text-xs text-[var(--muted)] font-mono">
                      {openLog.organization.slug}
                    </div>
                  )}
                </div>
                <div className="card p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
                    User
                  </div>
                  <div className="text-sm text-[var(--text)] mt-1">
                    {openLog.user?.name ?? 'System / Anonymous'}
                  </div>
                  {openLog.user?.email && (
                    <div className="text-xs text-[var(--muted)]">{openLog.user.email}</div>
                  )}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="card p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
                    Action
                  </div>
                  <div className="text-sm text-[var(--text)] mt-1 font-mono">
                    {openLog.action ?? '—'}
                  </div>
                </div>
                <div className="card p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
                    Entity
                  </div>
                  <div className="text-sm text-[var(--text)] mt-1">{openLog.entity ?? '—'}</div>
                  <div className="text-xs text-[var(--muted)] font-mono break-all">
                    {openLog.entityId ?? '—'}
                  </div>
                </div>
              </div>

              <div className="card p-3">
                <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
                  Details
                </div>
                <pre className="text-xs text-[var(--muted)] font-mono whitespace-pre-wrap break-words mt-2">
                  {openLog.metadata ? JSON.stringify(openLog.metadata, null, 2) : '—'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="p-8 text-center text-[var(--muted)]">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">No logs found.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {logs.map((log: any) => (
              <button
                key={log.id}
                type="button"
                className="w-full text-left px-4 py-4 hover:bg-[var(--surface2)] transition-colors"
                onClick={() => setOpenLog(log)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text)] truncate">
                      {getTitle(log)}
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-1 truncate">
                      {log.organization?.name
                        ? `${log.organization.name}${log.user?.email ? ` • ${log.user.email}` : ''}`
                        : (log.user?.email ?? 'System')}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--muted)] whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </div>
                </div>
              </button>
            ))}
          </div>
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
