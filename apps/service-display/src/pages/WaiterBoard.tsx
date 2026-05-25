import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

interface TaskItem {
  id: string;
  type: 'WAITER_CALL' | 'SERVICE_REQUEST' | 'ORDER_READY';
  tableLabel: string;
  section?: { name: string; colour: string | null } | null;
  details: string; // reason, serviceType, or item summary
  notes?: string;
  createdAt: string;
  assignedTo: string | null;
  status: string;
  originalData: any;
}

type WaiterSnapshot = {
  ts: number;
  tables: any[];
  tasks: TaskItem[];
};

function readWaiterSnapshot(key: string): WaiterSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WaiterSnapshot;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (!Array.isArray(parsed.tables) || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeWaiterSnapshot(key: string, snapshot: WaiterSnapshot): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    void 0;
  }
}

function waiterSnapshotKey(params: {
  organizationId?: string;
  branchId?: string | null;
  userId?: string | null;
}): string | null {
  if (!params.organizationId) return null;
  const scope = params.branchId ? `branch:${params.branchId}` : 'org';
  const who = params.userId ? `user:${params.userId}` : 'user:unknown';
  return `cevop_service_snapshot:waiter:${params.organizationId}:${scope}:${who}`;
}

function elapsed(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function TimeElapsed({ createdAt, className }: { createdAt: string; className?: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(i);
  }, []);
  const text = elapsed(createdAt);
  const isUrgent = text.includes('m') && parseInt(text) > 10;
  return (
    <span
      className={`text-[10px] sm:text-xs font-mono ${isUrgent ? 'text-red-400 font-bold' : 'text-[var(--muted)]'} ${className || ''}`}
    >
      {text} ago
    </span>
  );
}

function getServiceTypeLabel(serviceType: string): string {
  if (serviceType === 'BILL_REQUEST') return 'BILL REQUEST';
  return serviceType.toUpperCase();
}

function getServiceTypeColor(serviceType: string): string {
  if (serviceType === 'BILL_REQUEST') return 'text-amber-400 border-amber-800';
  return 'text-purple-400 border-purple-800';
}

export function WaiterBoard() {
  const { user, token, logout, silentRefresh, updateUser, pushStatus, enablePush } = useAuth();
  const { mode, setMode } = useTheme();
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'tables'>('tasks');
  const [tables, setTables] = useState<any[]>([]);
  const tablesRef = useRef<any[]>([]);
  const [myTasks, setMyTasks] = useState<TaskItem[]>([]);
  const [unassignedTasks, setUnassignedTasks] = useState<TaskItem[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineSnapshotTs, setOfflineSnapshotTs] = useState<number | null>(null);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef(token);
  const onShiftRef = useRef<boolean>(!!user?.isOnShift);
  const lastSyncAtRef = useRef(0);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    onShiftRef.current = !!user?.isOnShift;
  }, [user?.isOnShift]);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  const isWaiter = user?.role === 'WAITER';
  const isOnShift = !!user?.isOnShift;
  const userId = user?.id ?? null;
  const userBranchId = user?.branchId ?? null;

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)')?.matches || (navigator as any)?.standalone);
  const isIos =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as any).MSStream;
  const showInstallButton = !isStandalone && (installAvailable || isIos);

  useEffect(() => {
    const update = () => setInstallAvailable(!!(window as any).__cevopDeferredInstallPrompt);
    update();
    window.addEventListener('cevop-install-available', update as any);
    return () => window.removeEventListener('cevop-install-available', update as any);
  }, []);

  const handleInstall = useCallback(async () => {
    const deferred = (window as any).__cevopDeferredInstallPrompt;
    if (deferred && typeof deferred.prompt === 'function') {
      try {
        await deferred.prompt();
        await deferred.userChoice.catch(() => void 0);
      } finally {
        (window as any).__cevopDeferredInstallPrompt = null;
        window.dispatchEvent(new Event('cevop-install-available'));
      }
      return;
    }
    if (isIos) setInstallHelpOpen(true);
  }, [isIos]);

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

  const normaliseTask = useCallback((type: TaskItem['type'], data: any): TaskItem => {
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
    const tableId = data.table?.id ?? data.tableId;
    const section =
      data.table?.section ?? tablesRef.current.find((t) => t.id === tableId)?.section ?? null;
    return {
      id: data.id,
      type,
      tableLabel: data.table?.label || data.tableId,
      section,
      details,
      notes,
      createdAt: data.createdAt,
      assignedTo: data.assignedTo ?? data.assignedWaiter ?? null,
      status: data.status,
      originalData: data,
    };
  }, []);

  const loadTasks = useCallback(async () => {
    if (isWaiter && !isOnShift) {
      setMyTasks([]);
      setUnassignedTasks([]);
      setOfflineSnapshotTs(null);
      return;
    }
    if (!token) return;
    const cacheKey = waiterSnapshotKey({
      organizationId: user?.organizationId,
      branchId: userBranchId,
      userId,
    });

    if (!navigator.onLine && cacheKey) {
      const snap = readWaiterSnapshot(cacheKey);
      if (snap) {
        tablesRef.current = snap.tables;
        setTables(snap.tables);
        setMyTasks(snap.tasks.filter((t) => t.assignedTo === userId));
        setUnassignedTasks(snap.tasks.filter((t) => t.assignedTo === null));
        setOfflineSnapshotTs(snap.ts);
      }
      return;
    }

    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const h = { Authorization: `Bearer ${freshToken}` };
      const bq = userBranchId ? `&branchId=${userBranchId}` : '';

      const [callsRes, serviceRes, ordersRes, tablesRes] = await Promise.all([
        fetch(`${API_BASE}/api/waiter-calls?status=PENDING${bq}`, { headers: h }),
        fetch(`${API_BASE}/api/service-requests?status=PENDING${bq}`, { headers: h }),
        fetch(`${API_BASE}/api/orders?status=READY&limit=50${bq}`, { headers: h }),
        fetch(`${API_BASE}/api/tables?_=${Date.now()}`, { headers: h }),
      ]);

      if (!callsRes.ok || !serviceRes.ok || !ordersRes.ok || !tablesRes.ok) {
        throw new Error('Network error');
      }

      const [callsData, serviceData, ordersData, tablesData] = await Promise.all([
        callsRes.json(),
        serviceRes.json(),
        ordersRes.json(),
        tablesRes.json(),
      ]);

      const nextTables = tablesData?.success ? tablesData.data : tablesRef.current;
      if (tablesData?.success) {
        tablesRef.current = nextTables;
        setTables(nextTables);
      }

      const allTasks: TaskItem[] = [];
      if (callsData?.success) {
        callsData.data.forEach((c: any) => allTasks.push(normaliseTask('WAITER_CALL', c)));
      }
      if (serviceData?.success) {
        serviceData.data.forEach((s: any) => allTasks.push(normaliseTask('SERVICE_REQUEST', s)));
      }
      if (ordersData?.success) {
        ordersData.data
          .filter((o: any) => o.status === 'READY')
          .forEach((o: any) => allTasks.push(normaliseTask('ORDER_READY', o)));
      }

      const uniqueTasks = Array.from(new Map(allTasks.map((t) => [t.id, t])).values());
      setMyTasks(uniqueTasks.filter((t) => t.assignedTo === userId));
      setUnassignedTasks(uniqueTasks.filter((t) => t.assignedTo === null));
      setOfflineSnapshotTs(null);

      if (cacheKey) {
        writeWaiterSnapshot(cacheKey, { ts: Date.now(), tables: nextTables, tasks: uniqueTasks });
      }
    } catch {
      if (cacheKey) {
        const snap = readWaiterSnapshot(cacheKey);
        if (snap) {
          tablesRef.current = snap.tables;
          setTables(snap.tables);
          setMyTasks(snap.tasks.filter((t) => t.assignedTo === userId));
          setUnassignedTasks(snap.tasks.filter((t) => t.assignedTo === null));
          setOfflineSnapshotTs(snap.ts);
        }
      }
    }
  }, [isOnShift, isWaiter, normaliseTask, silentRefresh, token, user, userBranchId, userId]);

  const loadTasksRef = useRef(loadTasks);
  useEffect(() => {
    loadTasksRef.current = loadTasks;
  }, [loadTasks]);

  const refreshNow = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await silentRefresh();
      await loadTasksRef.current();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, silentRefresh]);

  const refreshNowRef = useRef(refreshNow);
  useEffect(() => {
    refreshNowRef.current = refreshNow;
  }, [refreshNow]);

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
    const SOCKET_URL = API_BASE || window.location.origin;
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
      if (isWaiter && !onShiftRef.current) return;
      playAlert();
      const normalised = normaliseTask(type, task);
      setMyTasks((prev) => [...prev.filter((t) => t.id !== normalised.id), normalised]);
      setUnassignedTasks((prev) => prev.filter((t) => t.id !== normalised.id));
    });

    // Task available for anyone to claim
    socket.on('TASK_UNASSIGNED', ({ type, task }: { type: TaskItem['type']; task: any }) => {
      if (isWaiter && !onShiftRef.current) return;
      playAlert();
      const normalised = normaliseTask(type, task);
      setUnassignedTasks((prev) => [...prev.filter((t) => t.id !== normalised.id), normalised]);
    });

    // Another waiter claimed a task — remove from unassigned pool
    socket.on('TASK_CLAIMED', ({ task }: { task: any }) => {
      if (isWaiter && !onShiftRef.current) return;
      setUnassignedTasks((prev) => prev.filter((t) => t.id !== task.id));
      // If claimed by me, move to my tasks
      if (task.assignedTo === user.id || task.assignedWaiter === user.id) {
        const type: TaskItem['type'] = task.items
          ? 'ORDER_READY'
          : task.serviceType
            ? 'SERVICE_REQUEST'
            : 'WAITER_CALL';
        setMyTasks((prev) => [...prev.filter((t) => t.id !== task.id), normaliseTask(type, task)]);
      }
    });

    // Task resolved (by anyone) — remove from all lists
    socket.on('WAITER_CALL_UPDATED', (call: any) => {
      if (isWaiter && !onShiftRef.current) return;
      if (call.status === 'RESOLVED') {
        setMyTasks((prev) => prev.filter((t) => t.id !== call.id));
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== call.id));
      }
    });
    socket.on('SERVICE_REQUEST_UPDATED', (req: any) => {
      if (isWaiter && !onShiftRef.current) return;
      if (req.status === 'RESOLVED') {
        setMyTasks((prev) => prev.filter((t) => t.id !== req.id));
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== req.id));
      }
    });
    socket.on('ORDER_UPDATED', (order: any) => {
      if (isWaiter && !onShiftRef.current) return;
      if (order.status === 'SERVED' || order.status === 'CANCELLED') {
        setMyTasks((prev) => prev.filter((t) => t.id !== order.id));
        setUnassignedTasks((prev) => prev.filter((t) => t.id !== order.id));
      }
    });

    socket.on('TABLE_STATUS_CHANGED', ({ tableId, status }) => {
      setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, status } : t)));
    });

    socket.on('SESSION_OPENED', ({ tableId, sessionId }) => {
      setTables((prev) =>
        prev.map((t) => (t.id === tableId ? { ...t, activeSessionId: sessionId } : t)),
      );
    });

    socket.on('SESSION_CLOSED', ({ tableId }) => {
      setTables((prev) =>
        prev.map((t) => (t.id === tableId ? { ...t, activeSessionId: null } : t)),
      );
    });

    const handleSyncRequired = () => {
      const now = Date.now();
      if (now - lastSyncAtRef.current < 8000) return;
      lastSyncAtRef.current = now;
      refreshNowRef.current().catch(() => void 0);
    };
    socket.on('SYNC_REQUIRED', handleSyncRequired);

    // Keepalive ping every 25 seconds
    // Prevents iOS and Android from killing idle WebSocket connections
    const keepAlive = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping');
      }
    }, 25000);

    return () => {
      clearInterval(keepAlive);
      socket.off('SYNC_REQUIRED', handleSyncRequired);
      socket.disconnect();
    };
  }, [isWaiter, normaliseTask, user, playAlert]);

  async function startShift() {
    if (!isWaiter) return;
    if (shiftBusy) return;
    setShiftError('');
    if (!socketRef.current || !socketConnected) {
      setShiftError('Not connected. Check your internet connection and try again.');
      return;
    }
    setShiftBusy(true);
    socketRef.current.emit('SHIFT_START', null, (res: any) => {
      if (!res?.success) {
        setShiftError(res?.error || 'Failed to start shift');
        setShiftBusy(false);
        return;
      }
      updateUser({ isOnShift: true });
      setShiftBusy(false);
      loadTasks().catch(() => void 0);
    });
  }

  async function endShift() {
    if (!isWaiter) return;
    if (shiftBusy) return;
    setShiftError('');
    if (!socketRef.current || !socketConnected) {
      setShiftError('Not connected. Check your internet connection and try again.');
      return;
    }
    setShiftBusy(true);
    socketRef.current.emit('SHIFT_END', null, (res: any) => {
      if (!res?.success) {
        setShiftError(res?.error || 'Failed to end shift');
        setShiftBusy(false);
        return;
      }
      updateUser({ isOnShift: false });
      setMyTasks([]);
      setUnassignedTasks([]);
      setShiftBusy(false);
    });
  }

  // Online/offline
  useEffect(() => {
    const up = () => {
      setIsOnline(true);
      refreshNowRef.current().catch(() => void 0);
    };
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;

      // Reconnect socket immediately if it dropped
      const socket = socketRef.current;
      if (socket && !socket.connected) {
        socket.connect();
      }

      refreshNowRef.current().catch(() => void 0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
        setMyTasks((prev) => [
          { ...task, assignedTo: user?.id ?? null },
          ...prev.filter((t) => t.id !== task.id),
        ]);
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

  async function clearTable(sessionId: string) {
    if (updatingItems.has(sessionId)) return;
    setUpdatingItems((prev) => new Set(prev).add(sessionId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/close`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ nextStatus: 'CLEANING' }),
      });
      if (!res.ok) await loadTasks();
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(sessionId);
        return n;
      });
    }
  }

  async function markTableEmpty(tableId: string) {
    if (updatingItems.has(tableId)) return;
    setUpdatingItems((prev) => new Set(prev).add(tableId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ status: 'EMPTY' }),
      });
      if (!res.ok) await loadTasks();
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(tableId);
        return n;
      });
    }
  }

  const TYPE_CONFIG = {
    WAITER_CALL: {
      label: 'WAITER CALL',
      color: 'border-[var(--preparing)] bg-[var(--surface2)]',
      badge: 'text-[var(--preparing)]',
    },
    SERVICE_REQUEST: {
      label: 'SERVICE REQUEST',
      color: 'border-[var(--accent)] bg-[var(--surface2)]',
      badge: 'text-[var(--accent)]',
    },
    ORDER_READY: {
      label: 'ORDER READY',
      color: 'border-[var(--ready)] bg-[var(--surface2)]',
      badge: 'text-[var(--ready)]',
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
          <div className="min-w-0">
            <p className={`text-[10px] font-bold tracking-widest uppercase ${cfg.badge}`}>
              {cfg.label}
            </p>
            <p className="font-bold text-lg text-[var(--text)] leading-tight mt-0.5">
              {task.tableLabel}
            </p>
            {task.section && (
              <span
                className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border inline-block mt-1"
                style={{
                  borderColor: task.section.colour ?? 'var(--border)',
                  color: task.section.colour ?? 'var(--muted)',
                }}
              >
                {task.section.name}
              </span>
            )}
          </div>
          <TimeElapsed createdAt={task.createdAt} className="shrink-0" />
        </div>
        {task.type === 'SERVICE_REQUEST' ? (
          <p
            className={`text-[10px] font-bold tracking-widest px-1.5 py-0.5 border inline-block ${getServiceTypeColor(task.details)}`}
          >
            {getServiceTypeLabel(task.details)}
          </p>
        ) : (
          <p className="text-sm text-[var(--text)]">{task.details}</p>
        )}
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
    <div className="h-dvh flex flex-col bg-[var(--bg)] overflow-hidden relative">
      {installHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-sm font-bold tracking-wider text-[var(--text)]">
              Install on iPhone
            </div>
            <div className="mt-2 text-xs text-[var(--muted)] leading-relaxed">
              Tap Share, then Add to Home Screen. Open Cevop from the Home Screen to receive alerts
              while the phone is asleep.
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setInstallHelpOpen(false)}
                className="text-xs border border-[var(--border)] px-3 py-1.5 text-[var(--muted)] hover:text-[var(--text)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="text-texture" />
      {/* Header */}
      <header className="flex items-center justify-between px-2 sm:px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 gap-1.5 overflow-hidden relative z-20">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 shrink">
          <h1 className="text-sm sm:text-2xl flex items-center gap-2 shrink-0">
            <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-md" />
            <span className="font-display hidden xs:inline text-[var(--accent)]">WAITER</span>
          </h1>
          <div
            className={`flex items-center gap-1 sm:gap-1.5 text-[8px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 border shrink-0 font-mono ${
              isOnline && socketConnected
                ? 'border-[var(--ready)] text-[var(--ready)]'
                : 'border-[var(--danger)] text-[var(--danger)]'
            }`}
          >
            <span
              className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${
                isOnline && socketConnected ? 'bg-[var(--ready)]' : 'bg-[var(--danger)]'
              }`}
            />
            {isOnline && socketConnected ? 'LIVE' : 'OFFLINE'}
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-3 shrink-0 ml-auto">
          {user?.staffCode && (
            <span className="font-mono text-[9px] sm:text-[10px] border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)] hidden xxs:inline-block rounded-sm">
              {user.staffCode}
            </span>
          )}
          <button
            onClick={() => refreshNow().catch(() => void 0)}
            disabled={refreshing}
            className="text-[9px] sm:text-xs border border-[var(--border)] px-2 sm:px-3 py-1 font-bold tracking-tight disabled:opacity-50 whitespace-nowrap rounded-full font-display text-[var(--muted)] hover:text-[var(--text)]"
          >
            {refreshing ? '...' : 'REFRESH'}
          </button>
          {pushStatus !== 'unsupported' && pushStatus !== 'on' && (
            <button
              onClick={() => enablePush().catch(() => void 0)}
              disabled={pushStatus === 'loading' || pushStatus === 'blocked'}
              className="text-[9px] sm:text-xs border border-[var(--border)] px-2 sm:px-3 py-1 font-bold tracking-tight disabled:opacity-50 whitespace-nowrap rounded-full font-display text-[var(--muted)] hover:text-[var(--text)]"
            >
              {pushStatus === 'loading'
                ? '...'
                : pushStatus === 'blocked'
                  ? 'ALERTS BLOCKED'
                  : 'ENABLE ALERTS'}
            </button>
          )}
          {showInstallButton && (
            <button
              onClick={() => handleInstall().catch(() => void 0)}
              className="text-[9px] sm:text-xs border border-[var(--border)] px-2 sm:px-3 py-1 font-bold tracking-tight whitespace-nowrap rounded-full font-display text-[var(--muted)] hover:text-[var(--text)]"
            >
              INSTALL
            </button>
          )}
          {isWaiter && (
            <button
              onClick={isOnShift ? endShift : startShift}
              disabled={shiftBusy || !socketConnected}
              className={`text-[9px] sm:text-xs border px-2 sm:px-3 py-1 font-bold tracking-tight disabled:opacity-50 whitespace-nowrap rounded-full font-display ${
                isOnShift
                  ? 'border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white'
                  : 'border-[var(--ready)] text-[var(--ready)] hover:bg-[var(--ready)] hover:text-black'
              }`}
            >
              {shiftBusy ? '...' : isOnShift ? 'END' : 'START'}
            </button>
          )}
          <button
            onClick={() => setMode(nextThemeMode)}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-[var(--border)] flex items-center justify-center text-[9px] sm:text-[10px] font-black shrink-0 font-display"
            title={`Theme: ${themeLabel}`}
          >
            {themeLabel}
          </button>
          <button
            onClick={logout}
            className="text-[9px] sm:text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-2 sm:px-3 py-1 shrink-0 rounded-full font-bold font-display"
          >
            OUT
          </button>
        </div>
      </header>
      {(!isOnline || !socketConnected) && offlineSnapshotTs && (
        <div className="px-2 sm:px-4 py-1 text-[10px] sm:text-xs text-[var(--muted)] border-b border-[var(--border)] bg-[var(--surface)]">
          Showing last saved snapshot — {new Date(offlineSnapshotTs).toLocaleString()}
        </div>
      )}

      {shiftError && (
        <div className="px-4 py-2 bg-red-900/20 border-b border-red-800 text-red-400 text-xs">
          {shiftError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-bold tracking-wider transition-all ${activeTab === 'tasks' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          TASKS
        </button>
        <button
          onClick={() => setActiveTab('tables')}
          className={`px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-bold tracking-wider transition-all ${activeTab === 'tables' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          TABLES
        </button>
      </div>

      {/* Content */}
      {activeTab === 'tasks' ? (
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--border)] overflow-y-auto md:overflow-hidden">
          {/* My Tasks */}
          <div className="flex flex-col min-h-[400px] md:min-h-0">
            <div className="px-3 py-2 border-b border-[var(--border)] shrink-0 sticky top-0 bg-[var(--surface)] z-10">
              <span className="font-bold text-xs tracking-widest text-[var(--accent)] uppercase">
                My Tasks
              </span>
              <span className="ml-2 text-[var(--muted)] text-xs">({myTasks.length})</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {isWaiter && !isOnShift && (
                <div className="text-center text-[var(--muted)] text-xs pt-12">
                  <p>Start shift to begin receiving tasks</p>
                </div>
              )}
              {(!isWaiter || isOnShift) && myTasks.length === 0 && (
                <div className="text-center text-[var(--muted)] text-xs pt-12">
                  <p className="text-2xl mb-2">✓</p>
                  <p>No active tasks</p>
                </div>
              )}
              {(!isWaiter || isOnShift) &&
                myTasks.map((task) => (
                  <TaskCard
                    key={`${task.type}-${task.id}`}
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
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {isWaiter && !isOnShift && (
                <div className="text-center text-[var(--muted)] text-xs pt-12">
                  <p>No tasks while off shift</p>
                </div>
              )}
              {(!isWaiter || isOnShift) && unassignedTasks.length === 0 && (
                <div className="text-center text-[var(--muted)] text-xs pt-12">
                  <p>No unassigned tasks</p>
                </div>
              )}
              {(!isWaiter || isOnShift) &&
                unassignedTasks.map((task) => (
                  <TaskCard
                    key={`${task.type}-${task.id}`}
                    task={task}
                    action={() => claimTask(task)}
                    actionLabel="CLAIM"
                  />
                ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 content-start">
          {isWaiter && !isOnShift && (
            <div className="col-span-full text-center text-[var(--muted)] text-sm pt-8">
              Start shift to manage tables
            </div>
          )}
          {(!isWaiter || isOnShift) &&
            tables
              .filter((t) => t.isActive)
              .map((t) => (
                <div
                  key={t.id}
                  className={`border p-3 space-y-3 flex flex-col justify-between ${
                    t.status === 'EMPTY'
                      ? 'border-[var(--border)] bg-[var(--surface2)]'
                      : t.status === 'OCCUPIED'
                        ? 'border-[var(--preparing)] bg-[var(--surface2)]'
                        : 'border-[var(--accent)] bg-[var(--surface2)]'
                  }`}
                >
                  <div>
                    <div className="font-bold text-lg text-[var(--text)]">{t.label}</div>
                    <div
                      className={`text-xs font-bold tracking-widest uppercase mt-1 ${
                        t.status === 'EMPTY'
                          ? 'text-[var(--muted)]'
                          : t.status === 'OCCUPIED'
                            ? 'text-[var(--preparing)]'
                            : 'text-[var(--accent)]'
                      }`}
                    >
                      {t.status}
                    </div>
                  </div>
                  {t.activeSessionId ? (
                    <button
                      onClick={() => clearTable(t.activeSessionId)}
                      disabled={updatingItems.has(t.activeSessionId)}
                      className="w-full text-xs py-2 font-bold tracking-wider border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-50"
                    >
                      {updatingItems.has(t.activeSessionId) ? 'CLEARING...' : 'CLEAR TABLE'}
                    </button>
                  ) : t.status === 'CLEANING' ? (
                    <button
                      onClick={() => markTableEmpty(t.id)}
                      disabled={updatingItems.has(t.id)}
                      className="w-full text-xs py-2 font-bold tracking-wider border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-50"
                    >
                      {updatingItems.has(t.id) ? 'UPDATING...' : 'MARK CLEAN'}
                    </button>
                  ) : null}
                </div>
              ))}
          {(!isWaiter || isOnShift) && tables.filter((t) => t.isActive).length === 0 && (
            <div className="col-span-full text-center text-[var(--muted)] text-sm pt-8">
              No tables found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
