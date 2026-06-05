import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, useApi } from '../context/auth';
import { useSocket } from '../context/socket';
import { ConfirmDialog, showToast } from '../components/Popup';

interface Table {
  id: string;
  label: string;
  number: number;
}

interface AssignedUser {
  id: string;
  name: string;
}

interface ServiceTask {
  id: string;
  type: 'WAITER_CALL' | 'SERVICE_REQUEST';
  status: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt: string;
  table?: Table | null;
  assignedUser?: AssignedUser | null;
  // Specific to WaiterCall
  reason?: string | null;
  // Specific to ServiceRequest
  serviceType?: string;
  notes?: string | null;
}

export function ServiceDeskPage() {
  const { user, activeBranchFilter } = useAuth();
  const api = useApi();
  const { socket } = useSocket();

  const [tasks, setTasks] = useState<ServiceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    if (!api.effectiveBranchId) {
      setLoading(false);
      return;
    }

    try {
      const [waiterRes, serviceRes] = await Promise.all([
        api.get('/api/waiter-calls?status=PENDING&status=ACKNOWLEDGED'),
        api.get('/api/service-requests?status=PENDING&status=ACKNOWLEDGED'),
      ]);

      if (!waiterRes.success || !serviceRes.success) {
        throw new Error('Failed to fetch tasks');
      }

      const mergedTasks: ServiceTask[] = [
        ...(waiterRes.data || []).map((c: any) => ({ ...c, type: 'WAITER_CALL' })),
        ...(serviceRes.data || []).map((c: any) => ({ ...c, type: 'SERVICE_REQUEST' })),
      ];

      // Sort oldest first (highest priority)
      mergedTasks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      setTasks(mergedTasks);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [api, activeBranchFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const interval = setInterval(load, 15000); // poll every 15s
    return () => clearInterval(interval);
  }, [load]);

  // Real-time socket updates — remove resolved tasks instantly
  useEffect(() => {
    if (!socket) return;

    const handleServiceRequestUpdated = (req: any) => {
      if (req.status === 'RESOLVED') {
        setTasks((prev) => prev.filter((t) => !(t.type === 'SERVICE_REQUEST' && t.id === req.id)));
      } else {
        // Status changed to ACKNOWLEDGED — update in place
        setTasks((prev) =>
          prev.map((t) =>
            t.type === 'SERVICE_REQUEST' && t.id === req.id ? { ...t, status: req.status } : t,
          ),
        );
      }
    };

    const handleWaiterCallUpdated = (call: any) => {
      if (call.status === 'RESOLVED') {
        setTasks((prev) => prev.filter((t) => !(t.type === 'WAITER_CALL' && t.id === call.id)));
      } else {
        setTasks((prev) =>
          prev.map((t) =>
            t.type === 'WAITER_CALL' && t.id === call.id ? { ...t, status: call.status } : t,
          ),
        );
      }
    };

    // Payment recorded = any pending BILL_REQUEST for that session is now resolved
    const handlePaymentRecorded = ({ sessionId }: { sessionId: string }) => {
      setTasks((prev) =>
        prev.filter(
          (t) =>
            !(
              t.type === 'SERVICE_REQUEST' &&
              (t as any).sessionId === sessionId &&
              (t as any).serviceType === 'BILL_REQUEST'
            ),
        ),
      );
    };

    socket.on('SERVICE_REQUEST_UPDATED', handleServiceRequestUpdated);
    socket.on('WAITER_CALL_UPDATED', handleWaiterCallUpdated);
    socket.on('PAYMENT_RECORDED', handlePaymentRecorded);
    return () => {
      socket.off('SERVICE_REQUEST_UPDATED', handleServiceRequestUpdated);
      socket.off('WAITER_CALL_UPDATED', handleWaiterCallUpdated);
      socket.off('PAYMENT_RECORDED', handlePaymentRecorded);
    };
  }, [socket]);

  async function updateStatus(task: ServiceTask, newStatus: 'ACKNOWLEDGED' | 'RESOLVED') {
    try {
      const endpoint = task.type === 'WAITER_CALL' ? '/api/waiter-calls' : '/api/service-requests';
      const res = await api.patch(`${endpoint}/${task.id}/status`, { status: newStatus });
      if (!res.success) throw new Error(res.error || 'Failed to update task');

      showToast(`Task ${newStatus.toLowerCase()}`, 'success');
      load();
    } catch (err: any) {
      showToast(err.message || 'Error updating task', 'error');
    }
  }

  function handleResolve(task: ServiceTask) {
    setConfirmTitle('Resolve Task');
    setConfirmMessage(
      `Are you sure you want to mark this request for Table ${task.table?.label || 'Unknown'} as resolved?`,
    );
    setConfirmAction(() => async () => {
      await updateStatus(task, 'RESOLVED');
      setConfirmOpen(false);
    });
    setConfirmOpen(true);
  }

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!api.effectiveBranchId) {
    return (
      <div className="card p-6">
        <h1 className="font-display text-3xl mb-2 uppercase">Service Desk</h1>
        <p className="text-[var(--muted)] text-sm">
          Select a branch to view incoming FOH requests.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel="Resolve"
        variant="default"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => confirmAction?.()}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl uppercase">Service Desk</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            Real-time Front-of-House dispatch board.
          </p>
        </div>
        <button onClick={load} className="btn btn-secondary text-xs tracking-wider">
          ⟳ REFRESH
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="card p-12 text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-[var(--surface2)] rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">✨</span>
          </div>
          <p className="font-bold text-lg text-[var(--text)]">All Caught Up!</p>
          <p className="text-[var(--muted)] text-sm mt-1">
            There are currently no pending waiter or service requests.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task) => {
            const isAcknowledged = task.status === 'ACKNOWLEDGED';
            const elapsedMins = Math.floor((now - new Date(task.createdAt).getTime()) / 60000);

            let timeColor = 'text-[var(--muted)]';
            if (elapsedMins >= 10) timeColor = 'text-red-400 font-bold';
            else if (elapsedMins >= 5) timeColor = 'text-yellow-400';

            return (
              <div
                key={`${task.type}-${task.id}`}
                className={`card p-5 border-l-4 transition-all ${
                  isAcknowledged
                    ? 'border-l-[var(--accent)] opacity-80'
                    : 'border-l-yellow-400 animate-pulse'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="bg-[var(--surface2)] px-3 py-1 rounded border border-[var(--border)]">
                    <span className="font-bold text-lg text-[var(--text)]">
                      {task.table?.label || 'Unknown Table'}
                    </span>
                  </div>
                  <div className={`text-xs ${timeColor} flex items-center gap-1`}>
                    ⏱ {elapsedMins}m ago
                  </div>
                </div>

                <div className="mb-4">
                  <div className="text-xs uppercase tracking-widest font-bold text-[var(--muted)] mb-1">
                    Request
                  </div>
                  <div className="text-base font-semibold">
                    {task.type === 'WAITER_CALL' ? (
                      <span className="text-blue-400">CALL WAITER</span>
                    ) : (
                      <span className="text-yellow-400">{task.serviceType || 'SERVICE'}</span>
                    )}
                  </div>
                  {(task.reason || task.notes) && (
                    <div className="text-sm mt-1 text-[var(--text)] italic bg-[var(--surface2)] p-2 rounded">
                      "{task.reason || task.notes}"
                    </div>
                  )}
                </div>

                {task.assignedUser && (
                  <div className="text-xs text-[var(--muted)] mb-4 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    Assigned:{' '}
                    <span className="font-bold text-[var(--text)]">{task.assignedUser.name}</span>
                  </div>
                )}

                <div className="flex gap-2 mt-auto">
                  {!isAcknowledged && (
                    <button
                      onClick={() => updateStatus(task, 'ACKNOWLEDGED')}
                      className="flex-1 py-2 bg-yellow-400/10 text-yellow-400 border border-yellow-400/30 rounded font-bold text-xs hover:bg-yellow-400/20 uppercase tracking-wider"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => handleResolve(task)}
                    className="flex-1 py-2 bg-[var(--accent)] text-[var(--bg)] rounded font-bold text-xs hover:opacity-90 uppercase tracking-wider"
                  >
                    Resolve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
