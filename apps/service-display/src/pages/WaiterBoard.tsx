import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';
import { formatPrice } from '../../../../shared/utils/currency';
import { AutoFitText } from '../components/AutoFitText';
import { WaiterPOS } from '../components/WaiterPOS';
import { syncManager } from '../services/sync';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

interface TaskItem {
  id: string;
  type: 'WAITER_CALL' | 'SERVICE_REQUEST' | 'ORDER_READY';
  tableLabel: string;
  section?: { name: string; colour: string | null } | null;
  details: string;
  notes?: string;
  createdAt: string;
  assignedTo: string | null;
  status: string;
  originalData: any;
}

function TimeElapsed({ createdAt, className }: { createdAt: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(i);
  }, []);
  const diff = Math.floor((now - new Date(createdAt).getTime()) / 1000);
  const text =
    diff < 60
      ? `${diff}s`
      : diff < 3600
        ? `${Math.floor(diff / 60)}m`
        : `${Math.floor(diff / 3600)}h`;
  const isUrgent = text.includes('m') && parseInt(text) > 10;
  return (
    <span
      className={`text-[10px] sm:text-xs font-mono ${isUrgent ? 'text-red-400 font-bold' : 'text-[var(--muted)]'} ${className || ''}`}
    >
      {text} ago
    </span>
  );
}

export function WaiterBoard() {
  const { user, token, logout, silentRefresh, updateUser } = useAuth() as any;
  const { mode, setMode } = useTheme();
  const [showPOS, setShowPOS] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'tables'>('tasks');
  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline] = useState(navigator.onLine);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const refreshLockRef = useRef<Promise<void> | null>(null);
  const lastActionAtRef = useRef<number>(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [billModal, setBillModal] = useState<{
    sessionId: string;
    tableLabel: string;
    data: any | null;
    loading: boolean;
  } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [orderModal, setOrderModal] = useState<any>(null);

  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const onShiftRef = useRef<boolean>(!!user?.isOnShift);
  useEffect(() => {
    onShiftRef.current = !!user?.isOnShift;
  }, [user?.isOnShift]);

  const userId = user?.id ?? null;
  const userBranchId = user?.branchId ?? null;
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

  const normaliseTask = useCallback(
    (type: TaskItem['type'], data: any, tables: any[]): TaskItem => {
      const details =
        type === 'WAITER_CALL'
          ? data.reason || 'Customer needs assistance'
          : type === 'SERVICE_REQUEST'
            ? data.serviceType
            : data.items?.map((i: any) => `${i.quantity}× ${i.menuItem?.name || '?'}`).join(', ') ||
              'Order ready';

      const notes = type === 'WAITER_CALL' || type === 'SERVICE_REQUEST' ? data.notes || '' : '';

      const tableId = data.table?.id ?? data.tableId;
      const section = data.table?.section ?? tables.find((t) => t.id === tableId)?.section ?? null;
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
    },
    [],
  );

  const queryClient = useQueryClient();

  const {
    data: tasksData,
    refetch: refetchTasks,
    isLoading: tasksLoading,
  } = useQuery({
    queryKey: ['waiter-tasks', user?.organizationId, userBranchId],
    queryFn: async () => {
      if (!token || (user?.role === 'WAITER' && !user?.isOnShift))
        return { mine: [], unassigned: [] };
      const freshToken = (await silentRefresh()) ?? token;
      const bq = userBranchId ? `?branchId=${userBranchId}` : '';
      const res = await fetch(`${API_BASE}/api/waiter-tasks${bq}`, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const json = await res.json();
      return json.data;
    },
    enabled: !!token && !!user,
    staleTime: 30000,
  });

  const {
    data: tablesData,
    refetch: refetchTables,
    isLoading: tablesLoading,
  } = useQuery({
    queryKey: ['tables', user?.organizationId, userBranchId],
    queryFn: async () => {
      if (!token) return [];
      const freshToken = (await silentRefresh()) ?? token;
      const bq = userBranchId ? `?branchId=${userBranchId}` : '';
      const res = await fetch(`${API_BASE}/api/tables?_=${Date.now()}${bq}`, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch tables');
      const json = await res.json();
      return json.data;
    },
    enabled: !!token && !!user,
    staleTime: 30000,
  });

  const allTasks = useMemo(() => {
    if (!tasksData || !tablesData) return [];
    const { mine, unassigned } = tasksData;
    const tasks: TaskItem[] = [];
    mine.waiterCalls?.forEach((c: any) => tasks.push(normaliseTask('WAITER_CALL', c, tablesData)));
    mine.serviceRequests?.forEach((s: any) =>
      tasks.push(normaliseTask('SERVICE_REQUEST', s, tablesData)),
    );
    mine.readyOrders?.forEach((o: any) => tasks.push(normaliseTask('ORDER_READY', o, tablesData)));
    unassigned.waiterCalls?.forEach((c: any) =>
      tasks.push(normaliseTask('WAITER_CALL', c, tablesData)),
    );
    unassigned.serviceRequests?.forEach((s: any) =>
      tasks.push(normaliseTask('SERVICE_REQUEST', s, tablesData)),
    );
    unassigned.readyOrders?.forEach((o: any) =>
      tasks.push(normaliseTask('ORDER_READY', o, tablesData)),
    );
    return Array.from(new Map(tasks.map((t) => [t.id, t])).values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [tasksData, tablesData, normaliseTask]);

  const myTasks = useMemo(
    () => allTasks.filter((t) => t.assignedTo === userId),
    [allTasks, userId],
  );
  const unassignedTasks = useMemo(() => allTasks.filter((t) => t.assignedTo === null), [allTasks]);
  const tables = tablesData || [];

  const refreshNow = useCallback(async () => {
    if (refreshing || refreshLockRef.current) return;
    const promise = (async () => {
      setRefreshing(true);
      try {
        const freshToken = (await silentRefresh()) ?? token;
        if (freshToken) {
          const meRes = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${freshToken}` },
          }).catch(() => null);
          if (meRes?.ok) {
            const meData = await meRes.json();
            if (meData?.data) updateUser(meData.data);
          }
        }
        await Promise.all([refetchTasks(), refetchTables()]);
      } finally {
        setRefreshing(false);
        refreshLockRef.current = null;
      }
    })();
    refreshLockRef.current = promise;
    return promise;
  }, [refreshing, silentRefresh, token, updateUser, refetchTasks, refetchTables]);

  const refreshNowRef = useRef(refreshNow);
  useEffect(() => {
    refreshNowRef.current = refreshNow;
  }, [refreshNow]);

  useEffect(() => {
    if (!token) return;
    refetchTasks();
    refetchTables();
  }, [token, refetchTasks, refetchTables]);

  useEffect(() => {
    if (!user) return;
    const SOCKET_URL = API_BASE || window.location.origin;
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: tokenRef.current }),
    });
    socketRef.current = socket;

    const debouncedRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => refreshNowRef.current().catch(() => void 0), 1000);
    };

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit(
        user.branchId ? 'JOIN_BRANCH' : 'JOIN_ORG',
        user.branchId
          ? { orgId: user.organizationId, branchId: user.branchId }
          : user.organizationId,
      );
      debouncedRefresh();
    });
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('TASK_ASSIGNED', ({ type, task }: any) => {
      if (user?.role === 'WAITER' && !onShiftRef.current) return;
      playAlert();
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
      socket.emit('ACKNOWLEDGE_TASK', { taskId: task.id, type });
    });
    socket.on('TASK_UNASSIGNED', () => {
      if (user?.role === 'WAITER' && !onShiftRef.current) return;
      playAlert();
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    });
    socket.on('TASK_CLAIMED', () => queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] }));
    socket.on(
      'WAITER_CALL_UPDATED',
      (call: any) =>
        call.status === 'RESOLVED' && queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] }),
    );
    socket.on(
      'SERVICE_REQUEST_UPDATED',
      (req: any) =>
        req.status === 'RESOLVED' && queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] }),
    );
    socket.on(
      'ORDER_UPDATED',
      (order: any) =>
        (order.status === 'SERVED' || order.status === 'CANCELLED') &&
        queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] }),
    );
    socket.on('TABLE_STATUS_CHANGED', () =>
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
    );
    socket.on('SESSION_OPENED', () => queryClient.invalidateQueries({ queryKey: ['tables'] }));
    socket.on('SESSION_CLOSED', () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    });
    socket.on('SYNC_REQUIRED', () => refreshNowRef.current().catch(() => void 0));

    return () => {
      socket.disconnect();
    };
  }, [user, playAlert, queryClient]);

  const resolveMutation = useMutation({
    mutationFn: async (task: TaskItem) => {
      const url = `${API_BASE}/api/${task.type === 'WAITER_CALL' ? 'waiter-calls' : task.type === 'SERVICE_REQUEST' ? 'service-requests' : 'orders'}/${task.id}/status`;
      const body = { status: task.type === 'ORDER_READY' ? 'SERVED' : 'RESOLVED' };
      if (!navigator.onLine) {
        await syncManager.addToQueue(url, 'PATCH', body, {});
        return { offline: true };
      }
      const freshToken = await silentRefresh();
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onMutate: async (task) => {
      setUpdatingItems((prev) => new Set(prev).add(task.id));
      await queryClient.cancelQueries({ queryKey: ['waiter-tasks'] });
      const previousTasks = queryClient.getQueryData([
        'waiter-tasks',
        user?.organizationId,
        userBranchId,
      ]);
      return { previousTasks };
    },
    onError: (_err, _task, context: any) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(
          ['waiter-tasks', user?.organizationId, userBranchId],
          context.previousTasks,
        );
      }
    },
    onSettled: (_data, _err, task) => {
      setUpdatingItems((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (task: TaskItem) => {
      const url = `${API_BASE}/api/${task.type === 'WAITER_CALL' ? 'waiter-calls' : task.type === 'SERVICE_REQUEST' ? 'service-requests' : 'orders'}/${task.id}/claim`;
      if (!navigator.onLine) {
        await syncManager.addToQueue(url, 'PATCH', {}, {});
        return { offline: true };
      }
      const freshToken = await silentRefresh();
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onMutate: async (task) => {
      setUpdatingItems((prev) => new Set(prev).add(task.id));
      await queryClient.cancelQueries({ queryKey: ['waiter-tasks'] });
      const previousTasks = queryClient.getQueryData([
        'waiter-tasks',
        user?.organizationId,
        userBranchId,
      ]);
      return { previousTasks };
    },
    onError: (_err, _task, context: any) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(
          ['waiter-tasks', user?.organizationId, userBranchId],
          context.previousTasks,
        );
      }
    },
    onSettled: (_data, _err, task) => {
      setUpdatingItems((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    },
  });

  async function resolveTask(task: TaskItem) {
    if (!updatingItems.has(task.id)) resolveMutation.mutate(task);
  }

  async function claimTask(task: TaskItem) {
    if (!updatingItems.has(task.id)) claimMutation.mutate(task);
  }

  async function clearTable(sessionId: string) {
    try {
      const freshToken = (await silentRefresh()) ?? token;
      await fetch(`${API_BASE}/api/sessions/${sessionId}/close`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ nextStatus: 'CLEANING' }),
      });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    } catch {
      void 0;
    }
  }

  async function fetchBill(sessionId: string, tableLabel: string) {
    setBillModal({ sessionId, tableLabel, data: null, loading: true });
    try {
      const freshToken = (await silentRefresh()) ?? token;
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/bill`, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      const data = await res.json();
      if (data.success) setBillModal({ sessionId, tableLabel, data: data.data, loading: false });
      else setBillModal(null);
    } catch {
      setBillModal(null);
    }
  }

  async function submitPayment() {
    if (!billModal?.data || paymentSubmitting) return;
    setPaymentSubmitting(true);
    try {
      const freshToken = (await silentRefresh()) ?? token;
      const res = await fetch(`${API_BASE}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({
          sessionId: billModal.sessionId,
          amount: billModal.data.balance,
          method: paymentMethod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBillModal(null);
        refreshNowRef.current().catch(() => void 0);
      } else setPaymentError(data.error || 'Failed');
    } catch {
      setPaymentError('Error');
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function startShift() {
    if (shiftBusy || !socketConnected) return;
    setShiftBusy(true);
    lastActionAtRef.current = Date.now();
    socketRef.current?.emit('SHIFT_START', null, (res: any) => {
      if (res?.success) {
        updateUser({ isOnShift: true });
        refreshNowRef.current().catch(() => void 0);
      }
      setShiftBusy(false);
    });
  }

  async function endShift() {
    if (shiftBusy || !socketConnected) return;
    setShiftBusy(true);
    lastActionAtRef.current = Date.now();
    socketRef.current?.emit('SHIFT_END', null, (res: any) => {
      if (res?.success) {
        updateUser({ isOnShift: false });
        queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
      }
      setShiftBusy(false);
    });
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--background)] text-[var(--foreground)] overflow-hidden font-sans select-none">
      <header className="flex items-center justify-between px-2 sm:px-4 py-1.5 sm:py-2 bg-[var(--surface)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 overflow-hidden">
          <h1 className="text-sm sm:text-lg font-black tracking-tighter text-[var(--accent)] shrink-0">
            CEVOP
          </h1>
          <div className="flex items-center gap-1 sm:gap-2 px-1.5 sm:px-3 py-0.5 sm:py-1 rounded-full bg-[var(--background)] border border-[var(--border)]">
            <span className="text-[10px] sm:text-xs font-bold truncate max-w-[80px]">
              {user?.name}
            </span>
            <span className="px-1 py-0.5 text-[8px] font-black bg-[var(--accent)] text-black rounded leading-none shrink-0">
              {user?.role}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {user?.role === 'WAITER' && user?.isOnShift && (
            <button
              onClick={endShift}
              disabled={shiftBusy}
              className="px-3 py-1 bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger)] text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50"
            >
              {shiftBusy ? 'ENDING...' : 'END SHIFT'}
            </button>
          )}
          <div
            className={`flex items-center gap-1.5 text-[8px] sm:text-xs px-2 py-1 border font-mono ${isOnline && socketConnected ? 'border-[var(--ready)] text-[var(--ready)]' : 'border-[var(--danger)] text-[var(--danger)]'}`}
          >
            {(tasksLoading || tablesLoading || refreshing) && (
              <div className="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
            )}
            {isOnline && socketConnected ? 'LIVE' : 'OFFLINE'}
          </div>
          <button
            onClick={() => setMode(nextThemeMode)}
            className="w-8 h-8 border border-[var(--border)] flex items-center justify-center text-[10px] font-black"
          >
            {themeLabel}
          </button>
          <button
            onClick={logout}
            className="px-3 py-1 bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger)] text-[10px] font-black"
          >
            LOGOUT
          </button>
        </div>
      </header>

      <div className="flex border-b border-[var(--border)] bg-[var(--surface)] shrink-0 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex-1 px-4 py-3 text-[10px] sm:text-xs font-black tracking-widest ${activeTab === 'tasks' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
        >
          TASKS ({allTasks.length})
        </button>
        <button
          onClick={() => setActiveTab('tables')}
          className={`flex-1 px-4 py-3 text-[10px] sm:text-xs font-black tracking-widest ${activeTab === 'tables' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
        >
          TABLES
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col p-2 sm:p-4 gap-2 sm:gap-4">
        {user?.role === 'WAITER' && !user?.isOnShift ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-4 border-[var(--border)] flex items-center justify-center opacity-20">
              <span className="text-3xl sm:text-4xl">💤</span>
            </div>
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">YOU ARE OFF SHIFT</h2>
              <p className="text-[var(--muted)] text-xs sm:text-sm">
                Start your shift to see calls and orders.
              </p>
            </div>
            <button
              onClick={startShift}
              disabled={shiftBusy}
              className="w-full max-w-xs py-4 sm:py-5 bg-[var(--accent)] text-black font-black text-base sm:text-lg tracking-widest active:scale-95 transition-transform disabled:opacity-50"
            >
              {shiftBusy ? 'STARTING...' : 'START SHIFT'}
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'tasks' && (
              <div className="flex-1 overflow-hidden flex flex-col gap-4">
                <div className="flex justify-between items-center shrink-0">
                  <h3 className="text-[10px] sm:text-xs font-black tracking-[0.2em] text-[var(--muted)] uppercase">
                    Your Active Tasks ({myTasks.length})
                  </h3>
                  <button
                    onClick={() => setShowPOS(true)}
                    className="px-3 py-1.5 bg-[var(--accent)] text-black text-[10px] font-black rounded-full active:scale-95 transition-transform"
                  >
                    + NEW ORDER
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {myTasks.map((task) => (
                    <div
                      key={task.id}
                      className="bg-[var(--surface)] border border-[var(--border)] p-3 flex flex-col gap-3"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <AutoFitText className="font-black text-lg">
                              {task.tableLabel}
                            </AutoFitText>
                          </div>
                          <div className="text-[10px] font-bold text-[var(--accent)] uppercase">
                            {task.type.replace('_', ' ')}
                          </div>
                        </div>
                        <TimeElapsed createdAt={task.createdAt} />
                      </div>
                      <div className="text-sm font-medium leading-tight text-[var(--foreground)]">
                        {task.details}
                      </div>
                      <button
                        onClick={() => resolveTask(task)}
                        className="w-full py-2.5 bg-[var(--foreground)] text-[var(--background)] font-black text-xs tracking-widest uppercase active:scale-95 transition-transform"
                      >
                        RESOLVE
                      </button>
                    </div>
                  ))}
                  {myTasks.length === 0 && (
                    <div className="py-8 text-center border-2 border-dashed border-[var(--border)] rounded-xl opacity-30 text-xs font-bold uppercase tracking-widest">
                      No tasks assigned to you
                    </div>
                  )}
                </div>
                <div className="shrink-0 h-px bg-[var(--border)] my-2" />
                <h3 className="text-[10px] sm:text-xs font-black tracking-[0.2em] text-[var(--muted)] uppercase">
                  Unassigned Pool ({unassignedTasks.length})
                </h3>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {unassignedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="bg-[var(--surface)] border border-[var(--border)] p-3 flex flex-col gap-3 opacity-80"
                    >
                      <div className="flex justify-between items-start">
                        <AutoFitText className="font-black text-lg">{task.tableLabel}</AutoFitText>
                        <TimeElapsed createdAt={task.createdAt} />
                      </div>
                      <div className="text-sm font-medium leading-tight text-[var(--foreground)]">
                        {task.details}
                      </div>
                      <button
                        onClick={() => claimTask(task)}
                        className="w-full py-2.5 border border-[var(--foreground)] text-[var(--foreground)] font-black text-xs tracking-widest uppercase active:scale-95 transition-transform"
                      >
                        CLAIM TASK
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeTab === 'tables' && (
              <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pr-1 custom-scrollbar">
                {tables.map((table: any) => (
                  <div
                    key={table.id}
                    className={`border-2 p-3 space-y-3 bg-[#0a0a0a] flex flex-col justify-between overflow-hidden transition-all active:scale-95 ${table.status === 'EMPTY' ? 'border-gray-800 opacity-60' : 'border-[var(--accent)]'}`}
                  >
                    <div className="min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <AutoFitText
                          className="font-black"
                          maxFontSize="1.5rem"
                          minFontSize="1.125rem"
                        >
                          {table.label}
                        </AutoFitText>
                        <div className="text-[9px] font-black tracking-widest uppercase opacity-60">
                          {table.status}
                        </div>
                      </div>
                      <div className="py-2 border-t border-gray-800 mt-2">
                        {/* Session details could go here if needed */}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {table.activeSessionId ? (
                        <>
                          <button
                            onClick={() => fetchBill(table.activeSessionId!, table.label)}
                            className="w-full py-3 bg-[var(--foreground)] text-[var(--background)] text-xs font-black uppercase tracking-widest rounded-sm"
                          >
                            BILL
                          </button>
                          <button
                            onClick={() => clearTable(table.activeSessionId!)}
                            className="w-full py-3 border border-[var(--foreground)] text-[var(--foreground)] text-xs font-black uppercase tracking-widest rounded-sm"
                          >
                            CLEAR
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() =>
                            setOrderModal({ tableId: table.id, tableLabel: table.label })
                          }
                          className="w-full py-3 bg-[var(--accent)] text-black text-xs font-black uppercase tracking-widest rounded-sm"
                        >
                          OPEN
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showPOS && (
        <WaiterPOS
          onClose={() => setShowPOS(false)}
          onOrderSuccess={() => {
            setShowPOS(false);
            refetchTasks();
          }}
        />
      )}
      {orderModal && (
        <WaiterPOS
          initialTableId={orderModal.tableId}
          onClose={() => setOrderModal(null)}
          onOrderSuccess={() => {
            setOrderModal(null);
            refetchTasks();
          }}
        />
      )}

      {billModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--background)]">
              <h3 className="font-black tracking-tight text-lg">BILL — {billModal.tableLabel}</h3>
              <button onClick={() => setBillModal(null)} className="text-2xl font-light opacity-50">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {billModal.loading ? (
                <div className="py-8 text-center animate-pulse font-black text-xs tracking-widest uppercase opacity-50">
                  Calculating Bill...
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {billModal.data?.items.map((item: any) => (
                      <div key={item.id} className="flex justify-between text-xs font-medium">
                        <span>
                          {item.quantity}× {item.menuItem?.name}
                        </span>
                        <span className="font-mono">
                          {formatPrice(item.unitPrice * item.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-4 border-t border-[var(--border)] flex justify-between items-end">
                    <span className="text-[10px] font-black tracking-widest uppercase opacity-50">
                      Total Balance
                    </span>
                    <span className="text-2xl font-black text-[var(--accent)] font-mono">
                      {formatPrice(billModal.data?.balance || 0)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['CASH', 'CARD', 'TRANSFER'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setPaymentMethod(m)}
                        className={`py-3 text-[10px] font-black border transition-all ${paymentMethod === m ? 'bg-[var(--accent)] text-black border-[var(--accent)]' : 'border-[var(--border)] opacity-50'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {paymentError && (
                    <div className="p-3 bg-red-900/20 border border-red-900/50 text-red-400 text-[10px] font-bold text-center uppercase tracking-wider">
                      {paymentError}
                    </div>
                  )}
                  <button
                    onClick={submitPayment}
                    disabled={paymentSubmitting}
                    className="w-full py-4 bg-[var(--foreground)] text-[var(--background)] font-black tracking-widest uppercase active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {paymentSubmitting ? 'PROCESSING...' : 'RECORD PAYMENT'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
