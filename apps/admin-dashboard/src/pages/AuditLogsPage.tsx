import React, { useEffect, useState, useCallback } from 'react';
import { useApi, useAuth } from '../context/auth';

export function AuditLogsPage() {
  const api = useApi();
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

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

      <div className="card overflow-x-auto">
        <table className="min-w-[800px]">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-[var(--muted)]">
                  No audit logs found.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="text-xs text-[var(--muted)] whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="font-medium">
                    {log.user ? (
                      <div>
                        <div>{log.user.name}</div>
                        <div className="text-[10px] text-[var(--muted)]">{log.user.email}</div>
                      </div>
                    ) : (
                      <span className="text-[var(--muted)] italic">System / Unknown</span>
                    )}
                  </td>
                  <td>
                    <span className="badge border border-[var(--border)]">{log.action}</span>
                  </td>
                  <td className="text-sm">
                    <span className="font-semibold text-[var(--text)]">{log.entity}</span>
                    <span className="text-[var(--muted)] block text-xs">{log.entityId}</span>
                  </td>
                  <td
                    className="text-xs font-mono text-[var(--muted)] max-w-xs truncate"
                    title={log.metadata ? JSON.stringify(log.metadata) : ''}
                  >
                    {log.metadata ? JSON.stringify(log.metadata) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
