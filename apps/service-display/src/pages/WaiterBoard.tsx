import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';
const DEV_SOCKET_URL = 'http://127.0.0.1:4000';

interface TaskItem {
  id: string;
  type: 'WAITER_CALL' | 'SERVICE_REQUEST' | 'ORDER_READY';
  tableLabel: string;
  details: string; // reason, serviceType, or item summary
  notes?: string;
  createdAt: string;
  assignedTo: string | null;
  status: string;
  originalData: any;
}

function elapsed(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function TimeElapsed({ createdAt }: { createdAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(i);
  }, []);
  const text = elapsed(createdAt);
  const isUrgent = text.includes('m') && parseInt(text) > 10;
  return (
    <span
      className={`text-xs font-mono ${isUrgent ? 'text-red-400 font-bold' : 'text-[var(--muted)]'}`}
    >
      {text} ago
    </span>
  );
}

export function WaiterBoard() {
  const { user, token, logout, silentRefresh } = useAuth();
  const { mode, setMode } = useTheme();
  const [myTasks, setMyTasks] = useState<TaskItem[]>([]);
  const [unassignedTasks, setUnassignedTasks] = useState<TaskItem[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';

  const playAlert = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      void 0;
    }
  }, []);

  function normaliseTask(type: TaskItem['type'], data: any): TaskItem {
    let details: string;
    let notes: string;
    if (type === 'WAITER_CALL') {
      details = data.reason || 'Customer needs assistance';
      notes = data.notes || '';
    } else if (type === 'SERVICE_REQUEST') {
      details = data.serviceType;
      notes = data.notes || '';
    } else {
      details =
        data.items?.map((i: any) => `${i.quantity}× ${i.menuItem?.name || '?'}`).join(', ') ||
        'Order ready';
      notes = '';
    }
    return {
      id: data.id,
      type,
      tableLabel: data.table?.label || data.tableId,
      details,
      notes,
      createdAt: data.createdAt,
      assignedTo: data.assignedTo ?? data.assignedWaiter ?? null,
      status: data.status,
      originalData: data,
    };
  }

  const loadTasks = useCallback(async () => {
    if (!token) return;
    const freshToken = await silentRefresh();
    if (!freshToken) return;
    const h = { Authorization: `Bearer ${freshToken}` };
    const bq = user?.branchId ? `&branchId=${user.branchId}` : '';

    const [callsRes, serviceRes, ordersRes] = await Promise.all([
      fetch(`${API_BASE}/api/waiter-calls?status=PENDING${bq}`, { headers: h }),
      fetch(`${API_BASE}/api/service-requests?status=PENDING${bq}`, { headers: h }),
      fetch(`${API_BASE}/api/orders?status=READY&limit=50${bq}`, { headers: h }),
    ]);

    const [callsData, serviceData, ordersData] = await Promise.all([
      callsRes.json(),
      serviceRes.json(),
      ordersRes.json(),
    ]);

    const allTasks: TaskItem[] = [];
    if (callsData.success) {
      callsData.data.forEach((c: any) => allTasks.push(normaliseTask('WAITER_CALL', c)));
    }
    if (serviceData.success) {
      serviceData.data.forEach((s: any) => allTasks.push(normaliseTask('SERVICE_REQUEST', s)));
    }
    if (ordersData.success) {
      ordersData.data
        .filter((o: any) => o.status === 'READY')
        .forEach((o: any) => allTasks.push(normaliseTask('ORDER_READY', o)));
    }

    setMyTasks(allTasks.filter((t) => t.assignedTo === user?.id));
    setUnassignedTasks(allTasks.filter((t) => t.assignedTo === null));
  }, [token, user, silentRefresh]);

  useEffect(() => {
    if (!token) return;
    const t = setTimeout(() => {
      loadTasks().catch(() => void 0);
    }, 0);
    return () => clearTimeout(t);
  }, [token, loadTasks]);

  // Socket setup
  useEffect(() => {
    if (!user) return;
    const SOCKET_URL = import.meta.env.DEV ? DEV_SOCKET_URL : API_BASE || window.location.origin;
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        cb({ token: tokenRef.current });
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      if (user.branchId) {
        socket.emit('JOIN_BRANCH', { orgId: user.organizationId, branchId: user.branchId });
      } else {
        socket.emit('JOIN_ORG', user.organizationId);
      }
    });
    socket.on('disconnect', () => setSocketConnected(false));

    // New task assigned directly to this waiter
    socket.on('TASK_ASSIGNED', ({ type, task }: { type: TaskItem['type']; task: any }) => {
      playAlert();
      const normalised = normaliseTask(type, task);
      setMyTasks((prev) => [normalised, ...prev.filter((t) => t.id !== normalised.id)]);
      setUnassignedTasks((prev) => prev.filter((t) => t.id !== normalised.id));
    });

    // Task available for anyone to claim
    socket.on('TASK_UNASSIGNED', ({ type, task }: { type: TaskItem['type']; task: any }) => {
      playAlert();
      const normalised = normaliseTask(type, task);
      setUnassignedTasks((prev) => [normalised, ...prev.filter((t) => t.id !== normalised.id)]);
    });

    // Another waiter claimed a task — remove from unassigned pool
    socket.on('TASK_CLAIMED', ({ task }: { task: any }) => {
      setUnassignedTasks((prev) => prev.filter((t) => t.id !== task.id));
      // If claimed by me, move to my tasks
      if (task.assignedTo === user.id || task.assignedWaiter === user.id) {
        const type: TaskItem['type'] = task.items
          ? 'ORDER_READY'
          : task.serviceType
            ? 'SERVICE_REQUEST'
            : 'WAITER_CALL';
        setMyTasks((prev) => [normaliseTask(type, task), ...prev.filter((t) => t.id !== task.id)]);
      }
    });

    // Task resolved (by anyone) — remove from all lists
    socket.on('WAITER_CALL_UPDATED', (call: any) => {
      if (call.status === 'RESOLVED') {
        setMyTasks((prev) => prev.filter((t) => t.id !== call.id));
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== call.id));
      }
    });
    socket.on('SERVICE_REQUEST_UPDATED', (req: any) => {
      if (req.status === 'RESOLVED') {
        setMyTasks((prev) => prev.filter((t) => t.id !== req.id));
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== req.id));
      }
    });
    socket.on('ORDER_UPDATED', (order: any) => {
      if (order.status === 'SERVED' || order.status === 'CANCELLED') {
        setMyTasks((prev) => prev.filter((t) => t.id !== order.id));
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== order.id));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [user, playAlert]);

  // Online/offline
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  async function resolveTask(task: TaskItem) {
    if (updatingItems.has(task.id)) return;
    setUpdatingItems((prev) => new Set(prev).add(task.id));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` };

      let url = '';
      let body = {};

      if (task.type === 'WAITER_CALL') {
        url = `${API_BASE}/api/waiter-calls/${task.id}/status`;
        body = { status: 'RESOLVED' };
      } else if (task.type === 'SERVICE_REQUEST') {
        url = `${API_BASE}/api/service-requests/${task.id}/status`;
        body = { status: 'RESOLVED' };
      } else {
        // ORDER_READY — mark as SERVED
        url = `${API_BASE}/api/orders/${task.id}/status`;
        body = { status: 'SERVED' };
      }

      const res = await fetch(url, { method: 'PATCH', headers: h, body: JSON.stringify(body) });
      if (res.ok) {
        setMyTasks((prev) => prev.filter((t) => t.id !== task.id));
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== task.id));
      } else if (res.status === 404) {
        await loadTasks();
      }
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(task.id);
        return n;
      });
    }
  }

  async function claimTask(task: TaskItem) {
    if (updatingItems.has(task.id)) return;
    setUpdatingItems((prev) => new Set(prev).add(task.id));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` };

      const url =
        task.type === 'WAITER_CALL'
          ? `${API_BASE}/api/waiter-calls/${task.id}/claim`
          : task.type === 'SERVICE_REQUEST'
            ? `${API_BASE}/api/service-requests/${task.id}/claim`
            : `${API_BASE}/api/orders/${task.id}/claim`;

      const res = await fetch(url, { method: 'PATCH', headers: h });
      if (res.ok) {
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== task.id));
        setMyTasks((prev) => [{ ...task, assignedTo: user?.id ?? null }, ...prev]);
      } else if (res.status === 404) {
        await loadTasks();
      }
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(task.id);
        return n;
      });
    }
  }

  const TYPE_CONFIG = {
    WAITER_CALL: {
      label: 'WAITER CALL',
      color: 'border-yellow-600 bg-yellow-900/10',
      badge: 'text-amber-600',
    },
    SERVICE_REQUEST: {
      label: 'SERVICE REQUEST',
      color: 'border-purple-600 bg-purple-900/10',
      badge: 'text-purple-300',
    },
    ORDER_READY: {
      label: 'ORDER READY',
      color: 'border-green-600 bg-green-900/10',
      badge: 'text-emerald-600',
    },
  };

  if (!audioUnlocked) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)] space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-display text-4xl text-[var(--accent)]">WAITER</h1>
          <p className="text-[var(--muted)]">Tap to enable task alerts.</p>
        </div>
        <button
          onClick={() => {
            try {
              const ctx = new AudioContext();
              ctx.resume().then(() => setAudioUnlocked(true));
            } catch {
              setAudioUnlocked(true);
            }
          }}
          className="px-8 py-4 bg-[var(--accent)] text-black font-bold tracking-widest text-lg active:scale-95 hover:brightness-110 transition-transform"
        >
          START SHIFT
        </button>
      </div>
    );
  }

  function TaskCard({
    task,
    action,
    actionLabel,
  }: {
    task: TaskItem;
    action: () => void;
    actionLabel: string;
  }) {
    const cfg = TYPE_CONFIG[task.type];
    const isUpdating = updatingItems.has(task.id);
    return (
      <div className={`border p-3 space-y-2 ${cfg.color}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-[10px] font-bold tracking-widest uppercase ${cfg.badge}`}>
              {cfg.label}
            </p>
            <p className="font-bold text-lg text-[var(--text)] leading-tight mt-0.5">
              {task.tableLabel}
            </p>
          </div>
          <TimeElapsed createdAt={task.createdAt} />
        </div>
        <p className="text-sm text-[var(--text)]">{task.details}</p>
        {task.notes && <p className="text-xs text-[var(--muted)] italic">"{task.notes}"</p>}
        <button
          onClick={action}
          disabled={isUpdating}
          className="w-full text-xs py-2 font-bold tracking-wider border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black hover:border-[var(--accent)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUpdating ? 'UPDATING...' : actionLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-[var(--bg)] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg sm:text-2xl text-[var(--accent)] flex items-baseline gap-2 shrink-0">
            <span className="brand-mark">CEVOP</span>
            <span className="font-display">WAITER</span>
          </h1>
          <div
            className={`flex items-center gap-1.5 text-[10px] sm:text-xs px-2 py-1 border shrink-0 ${isOnline && socketConnected ? 'border-green-800 text-green-400 bg-green-900/20' : 'border-red-800 text-red-400 bg-red-900/20'}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isOnline && socketConnected ? 'bg-green-400' : 'bg-red-400'}`}
            />
            {isOnline && socketConnected ? 'LIVE' : 'OFFLINE'}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="text-[var(--muted)] text-xs max-w-[110px] sm:max-w-none truncate">
            {user?.name}
          </span>
          <button
            onClick={() => setMode(nextThemeMode)}
            className="w-8 h-8 rounded-full border border-[var(--border)] flex items-center justify-center text-[10px] font-bold"
            title={`Theme: ${themeLabel}`}
          >
            {themeLabel}
          </button>
          <button
            onClick={logout}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-2 py-1"
          >
            LOGOUT
          </button>
        </div>
      </header>

      {/* Content — two columns */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-x divide-[var(--border)] overflow-y-auto md:overflow-hidden">
        {/* My Tasks */}
        <div className="flex flex-col min-h-[400px] md:min-h-0">
          <div className="px-3 py-2 border-b border-[var(--border)] shrink-0 sticky top-0 bg-[var(--surface)] z-10">
            <span className="font-bold text-xs tracking-widest text-[var(--accent)] uppercase">
              My Tasks
            </span>
            <span className="ml-2 text-[var(--muted)] text-xs">({myTasks.length})</span>
          </div>
          <div className="flex-1 overflow-y-visible md:overflow-y-auto p-3 space-y-3">
            {myTasks.length === 0 && (
              <div className="text-center text-[var(--muted)] text-xs pt-12">
                <p className="text-2xl mb-2">✓</p>
                <p>No active tasks</p>
              </div>
            )}
            {myTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                action={() => resolveTask(task)}
                actionLabel={task.type === 'ORDER_READY' ? '✓ DELIVERED' : '✓ DONE'}
              />
            ))}
          </div>
        </div>

        {/* Unassigned Tasks */}
        <div className="flex flex-col min-h-[400px] md:min-h-0">
          <div className="px-3 py-2 border-b border-[var(--border)] shrink-0 sticky top-0 bg-[var(--surface)] z-10">
            <span className="font-bold text-xs tracking-widest text-[var(--muted)] uppercase">
              Available
            </span>
            <span className="ml-2 text-[var(--muted)] text-xs">({unassignedTasks.length})</span>
          </div>
          <div className="flex-1 overflow-y-visible md:overflow-y-auto p-3 space-y-3">
            {unassignedTasks.length === 0 && (
              <div className="text-center text-[var(--muted)] text-xs pt-12">
                <p>No unassigned tasks</p>
              </div>
            )}
            {unassignedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                action={() => claimTask(task)}
                actionLabel="CLAIM"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
