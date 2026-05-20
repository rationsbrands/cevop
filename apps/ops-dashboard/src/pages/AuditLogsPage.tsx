import React, { useEffect, useState } from 'react';
import { useApi } from '../context/auth';

export function AuditLogsPage() {
  const api = useApi();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, total: 0, pages: 1 });

  const [filterOrg, setFilterOrg] = useState('');
  const [filterAction, setFilterAction] = useState('');

  async function load(page = 1) {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: page.toString(), limit: '50' });
      if (filterOrg) q.set('orgId', filterOrg);
      if (filterAction) q.set('action', filterAction);

      const res = await api.get(`/api/ops/audit?${q.toString()}`);
      if (res.success) {
        setLogs(res.data);
        setMeta(res.meta);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1);
  }, [filterOrg, filterAction]);

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-[var(--text)]">Audit Logs</h1>
          <p className="text-[var(--muted)] text-sm mt-1">System-wide platform activity logs.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Filter by Organization ID..."
          value={filterOrg}
          onChange={(e) => setFilterOrg(e.target.value)}
          className="flex-1 max-w-sm"
        />
        <input
          type="text"
          placeholder="Filter by Action (e.g. login, create_order)..."
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="flex-1 max-w-sm"
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[var(--muted)]">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">No logs found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table>
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
