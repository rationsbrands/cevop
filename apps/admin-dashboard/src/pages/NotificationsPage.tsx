import { useQuery } from '@tanstack/react-query';
import { useApi, useAuth } from '../context/auth';

interface NotificationLog {
  id: string;
  type: string;
  recipient: string;
  event: string;
  status: string;
  error: string | null;
  sentAt: string;
}

export function NotificationsPage() {
  const api = useApi();
  const { user } = useAuth();

  const {
    data: logs,
    isLoading,
    error,
  } = useQuery<NotificationLog[]>({
    queryKey: ['notifications', user?.organizationId],
    queryFn: async () => {
      const res = await api.get('/api/notifications');
      if (!res.success) throw new Error(res.error || 'Failed to fetch logs');
      return res.data;
    },
    enabled: !!user?.organizationId,
  });

  if (isLoading) return <div className="text-[var(--muted)] text-sm">Loading logs...</div>;
  if (error) return <div className="text-red-400 text-sm">{(error as Error).message}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl uppercase">Communication Logs</h1>
        <p className="text-[var(--muted)] text-sm mt-0.5">
          Audit trail of system notifications (WhatsApp, Push, Email).
        </p>
      </div>

      {!logs || logs.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)]">No communication logs found.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)] text-[var(--muted)]">
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Recipient</th>
                <th className="px-4 py-3 font-semibold">Event</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-4 py-3">
                    {new Date(log.sentAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 uppercase text-xs tracking-wider font-bold">
                    {log.type}
                  </td>
                  <td className="px-4 py-3 font-medium">{log.recipient}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{log.event}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
                        log.status === 'sent' || log.status === 'delivered'
                          ? 'text-green-400 border border-green-800 bg-green-900/20'
                          : log.status === 'failed'
                            ? 'text-red-400 border border-red-800 bg-red-900/20'
                            : 'text-yellow-400 border border-yellow-800 bg-yellow-900/20'
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-red-400 text-xs">{log.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
