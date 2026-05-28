import { useQuery } from '@tanstack/react-query';
import { useApi, useAuth } from '../context/auth';

interface StaffShift {
  id: string;
  userId: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  durationMinutes: number | null;
  user: {
    name: string;
    role: string;
  };
}

export function TimesheetsPage() {
  const api = useApi();
  const { user } = useAuth();

  const {
    data: shifts,
    isLoading,
    error,
  } = useQuery<StaffShift[]>({
    queryKey: ['timesheets', user?.organizationId, user?.branchId],
    queryFn: async () => {
      const res = await api.get('/api/timesheets');
      if (!res.success) throw new Error(res.error || 'Failed to fetch timesheets');
      return res.data;
    },
    enabled: !!user?.organizationId,
  });

  if (isLoading) return <div className="text-[var(--muted)] text-sm">Loading timesheets...</div>;
  if (error) return <div className="text-red-400 text-sm">{(error as Error).message}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl uppercase">Timesheets & Payroll</h1>
        <p className="text-[var(--muted)] text-sm mt-0.5">
          Immutable ledger of staff shifts. Used for accurate payroll calculation.
        </p>
      </div>

      {!shifts || shifts.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)]">No timesheet records found.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface2)] text-[var(--muted)]">
                <th className="px-4 py-3 font-semibold">Staff Name</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Clocked In</th>
                <th className="px-4 py-3 font-semibold">Clocked Out</th>
                <th className="px-4 py-3 font-semibold">Duration</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {shifts.map((shift) => (
                <tr key={shift.id} className="hover:bg-[var(--surface2)] transition-colors">
                  <td className="px-4 py-3 font-medium">{shift.user.name}</td>
                  <td className="px-4 py-3 uppercase text-xs tracking-wider text-[var(--muted)]">
                    {shift.user.role}
                  </td>
                  <td className="px-4 py-3">
                    {new Date(shift.clockedInAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    {shift.clockedOutAt
                      ? new Date(shift.clockedOutAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {shift.durationMinutes !== null
                      ? `${Math.floor(shift.durationMinutes / 60)}h ${shift.durationMinutes % 60}m`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {!shift.clockedOutAt ? (
                      <span className="text-xs px-2 py-0.5 rounded uppercase font-bold tracking-wider text-green-400 border border-green-800 bg-green-900/20">
                        Active
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded uppercase font-bold tracking-wider text-[var(--muted)] border border-[var(--border)] bg-[var(--surface2)]">
                        Closed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
