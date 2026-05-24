import React, { useEffect, useState, useCallback } from 'react';
import { useApi, useAuth } from '../context/auth';

export function AuditLogsPage() {
  const api = useApi();
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [openLog, setOpenLog] = useState<any | null>(null);

  function formatAction(action: string): string {
    if (action === 'IMPERSONATE_ORG') return 'SUPPORT_ACCESS';
    return action;
  }

  function formatActor(log: any): { name: string; email?: string } | null {
    if (log?.action === 'IMPERSONATE_ORG') return { name: 'Cevop Support' };
    if (log?.user?.name) return { name: log.user.name, email: log.user.email };
    return null;
  }

  function redactMetadata(log: any): any {
    if (log?.action !== 'IMPERSONATE_ORG') return log?.metadata ?? null;
    const md = log?.metadata ?? null;
    if (!md || typeof md !== 'object') return { accessLevel: 'READ_ONLY' };
    const rest = { ...(md as Record<string, unknown>) };
    delete (rest as any).opsUserId;
    return { ...rest, accessLevel: 'READ_ONLY' };
  }

  function getTitle(log: any): string {
    const action = formatAction(log?.action ?? '');
    const entity = typeof log?.entity === 'string' && log.entity ? log.entity : 'Entity';
    return `${action} • ${entity}`;
  }

  const loadLogs = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await api.get(`/api/orgs/audit?page=${p}&limit=50`);
        if (res.success) {
          setLogs(res.data);
          setTotalPages(res.meta.pages);
        }
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      loadLogs(page).catch(() => {
        if (!cancelled) void 0;
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [page, loadLogs]);

  if (
    !user ||
    !['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'ORG_AUDITOR', 'SUPERADMIN'].includes(user.role)
  ) {
    return (
      <div className="card p-6">
        <p className="text-[var(--danger)]">You do not have permission to view audit logs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">AUDIT LOGS</h1>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => loadLogs(page)}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {openLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setOpenLog(null)}
        >
          <div
            className="card w-full max-w-2xl p-6 space-y-4 animate-in"
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
                    Actor
                  </div>
                  <div className="text-sm text-[var(--text)] mt-1">
                    {formatActor(openLog)?.name ?? 'System / Unknown'}
                  </div>
                  {formatActor(openLog)?.email && (
                    <div className="text-xs text-[var(--muted)]">{formatActor(openLog)!.email}</div>
                  )}
                </div>
                <div className="card p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
                    Action
                  </div>
                  <div className="text-sm text-[var(--text)] mt-1 font-mono">
                    {formatAction(openLog.action)}
                  </div>
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

              <div className="card p-3">
                <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-bold">
                  Details
                </div>
                <pre className="text-xs text-[var(--muted)] font-mono whitespace-pre-wrap break-words mt-2">
                  {redactMetadata(openLog) ? JSON.stringify(redactMetadata(openLog), null, 2) : '—'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading && logs.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">No audit logs found.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {logs.map((log) => (
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
                      {formatActor(log)?.name ?? 'System / Unknown'}
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

      {totalPages > 1 && (
        <div className="flex justify-between items-center px-2">
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
