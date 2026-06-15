import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';
import { AutoFitText } from '../components/AutoFitText';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
  menuItemId: string;
  cancelledAt?: string | null;
  menuItem?: { name: string };
}
interface Order {
  id: string;
  status: string;
  total: number;
  items: OrderItem[];
  table?: { label: string; number: number };
  createdAt: string;
  tableId: string;
  assignedWaiter?: string | null;
  branchId: string;
}

const ACTIVE_STATUSES = ['RECEIVED', 'PREPARING', 'READY'];
const STATUS_COLOR: Record<string, string> = {
  RECEIVED: 'border-[var(--received)]',
  PREPARING: 'border-[var(--preparing)]',
  READY: 'border-[var(--ready)]',
  SERVED: 'border-[var(--served)]',
};
const STATUS_TEXT: Record<string, string> = {
  RECEIVED: 'text-[var(--received)]',
  PREPARING: 'text-[var(--preparing)]',
  READY: 'text-[var(--ready)]',
  SERVED: 'text-[var(--served)]',
};
const NEXT_STATUS: Record<string, string> = {
  RECEIVED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'SERVED',
};
const NEXT_LABEL: Record<string, string> = {
  RECEIVED: '→ START',
  PREPARING: '→ READY',
  READY: '→ SERVED',
};

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
  const color = text.includes('m') && parseInt(text) > 15 ? 'text-red-400' : 'text-[var(--muted)]';
  return <span className={className || color}>{text} ago</span>;
}

export function ServiceBoard() {
  const { user, token, logout } = useAuth() as any;
  const { mode, setMode } = useTheme();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const [isOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'calls' | 'tables'>('orders');
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [isOnShift, setIsOnShift] = useState<boolean>(!!user?.isOnShift);
  const [shiftBusy, setShiftBusy] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const lastSyncAtRef = useRef(0);

  // Mutable ref for token so socket reconnects use the latest token
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const queryClient = useQueryClient();

  // Queries
  const { data: ordersData, refetch: refetchOrders } = useQuery({
    queryKey: ['service-orders', user?.organizationId, user?.branchId],
    queryFn: async () => {
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
      const res = await fetch(
        `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&status=READY&limit=50${branchParam}`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      if (!res.ok) throw new Error('Failed to fetch orders');
      const json = await res.json();
      return json;
    },
    enabled: !!token && !!user,
    staleTime: 15000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  const { data: callsData, refetch: refetchCalls } = useQuery({
    queryKey: ['service-calls', user?.organizationId, user?.branchId],
    queryFn: async () => {
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
      const res = await fetch(`${API_BASE}/api/waiter-calls?status=PENDING${branchParam}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) throw new Error('Failed to fetch calls');
      const json = await res.json();
      return json.data;
    },
    enabled: !!token && !!user,
    staleTime: 15000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  const { data: serviceRequestsData, refetch: refetchRequests } = useQuery({
    queryKey: ['service-requests', user?.organizationId, user?.branchId],
    queryFn: async () => {
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
      const res = await fetch(`${API_BASE}/api/service-requests?status=PENDING${branchParam}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) throw new Error('Failed to fetch service requests');
      const json = await res.json();
      return json.data;
    },
    enabled: !!token && !!user,
    staleTime: 15000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  const { data: tablesData, refetch: refetchTables } = useQuery({
    queryKey: ['tables', user?.organizationId, user?.branchId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/tables?_=${Date.now()}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) throw new Error('Failed to fetch tables');
      const json = await res.json();
      return json.data;
    },
    enabled: !!token && !!user,
    staleTime: 15000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const orders = useMemo(() => {
    if (!ordersData?.success) return [];
    return ordersData.data
      .filter((o: Order) => ACTIVE_STATUSES.includes(o.status))
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [ordersData]);

  const waiterCalls = callsData || [];
  const serviceRequests = serviceRequestsData || [];
  const tables = tablesData || [];

  const updateOrderStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update order');
      return res.json();
    },
    onMutate: async ({ orderId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['service-orders'] });
      const previous = queryClient.getQueryData(['service-orders']);
      queryClient.setQueryData(['service-orders'], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((o: any) => (o.id === orderId ? { ...o, status } : o)),
        };
      });
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) queryClient.setQueryData(['service-orders'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['service-orders'] });
    },
  });

  const updateCallStatusMutation = useMutation({
    mutationFn: async ({ callId, status }: { callId: string; status: string }) => {
      const res = await fetch(`${API_BASE}/api/waiter-calls/${callId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update call');
      return res.json();
    },
    onMutate: async ({ callId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['service-calls'] });
      const previous = queryClient.getQueryData(['service-calls']);
      queryClient.setQueryData(['service-calls'], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((c: any) => (c.id === callId ? { ...c, status } : c)),
        };
      });
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) queryClient.setQueryData(['service-calls'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['service-calls'] });
    },
  });

  const updateRequestStatusMutation = useMutation({
    mutationFn: async ({ requestId, status }: { requestId: string; status: string }) => {
      const res = await fetch(`${API_BASE}/api/service-requests/${requestId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update request');
      return res.json();
    },
    onMutate: async ({ requestId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['service-requests'] });
      const previous = queryClient.getQueryData(['service-requests']);
      queryClient.setQueryData(['service-requests'], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((r: any) => (r.id === requestId ? { ...r, status } : r)),
        };
      });
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) queryClient.setQueryData(['service-requests'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    },
  });

  const refreshNow = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refetchOrders(), refetchCalls(), refetchRequests(), refetchTables()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, refetchOrders, refetchCalls, refetchRequests, refetchTables]);

  const refreshNowRef = useRef(refreshNow);
  useEffect(() => {
    refreshNowRef.current = refreshNow;
  }, [refreshNow]);

  async function toggleShift() {
    if (shiftBusy) return;
    setShiftBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/shifts/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      const data = await res.json();
      if (data.success) setIsOnShift(data.data.isOnShift);
    } catch {
      void 0;
    } finally {
      setShiftBusy(false);
    }
  }

  const playAlert = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      void 0;
    }
  }, []);

  // Socket setup
  useEffect(() => {
    if (!user) return;
    const SOCKET_URL = API_BASE || window.location.origin;
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: tokenRef.current }),
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      if (user.branchId) {
        socket.emit('JOIN_BRANCH', { orgId: user.organizationId, branchId: user.branchId });
      } else {
        socket.emit('JOIN_ORG', user.organizationId);
      }
      refreshNowRef.current().catch(() => void 0);
    });
    socket.on('disconnect', () => setSocketConnected(false));

    socket.on('ORDER_CREATED', (order: any) => {
      playAlert();
      queryClient.setQueryData(
        ['service-orders', user?.organizationId, user?.branchId],
        (prev: any) => {
          if (!prev || !prev.success) return prev;
          if (prev.data.some((o: any) => o.id === order.id)) return prev;
          return { ...prev, data: [order, ...prev.data] };
        },
      );
    });

    socket.on('ORDER_UPDATED', (order: any) => {
      queryClient.setQueryData(
        ['service-orders', user?.organizationId, user?.branchId],
        (prev: any) => {
          if (!prev || !prev.success) return prev;
          const exists = prev.data.some((o: any) => o.id === order.id);
          if (exists) {
            return { ...prev, data: prev.data.map((o: any) => (o.id === order.id ? order : o)) };
          }
          return { ...prev, data: [order, ...prev.data] };
        },
      );
    });

    socket.on('WAITER_ONLINE', () =>
      queryClient.invalidateQueries({ queryKey: ['online-waiters'] }),
    );
    socket.on('WAITER_OFFLINE', () =>
      queryClient.invalidateQueries({ queryKey: ['online-waiters'] }),
    );

    socket.on('WAITER_CALLED', (call: any) => {
      playAlert();
      queryClient.setQueryData(
        ['service-calls', user?.organizationId, user?.branchId],
        (prev: any[]) => {
          if (!prev) return prev;
          if (prev.some((c: any) => c.id === call.id)) return prev;
          return [call, ...prev];
        },
      );
    });

    socket.on('WAITER_CALL_UPDATED', (call: any) => {
      queryClient.setQueryData(
        ['service-calls', user?.organizationId, user?.branchId],
        (prev: any[]) => {
          if (!prev) return prev;
          const exists = prev.some((c: any) => c.id === call.id);
          if (exists) return prev.map((c: any) => (c.id === call.id ? call : c));
          return [call, ...prev];
        },
      );
    });

    socket.on('SERVICE_REQUESTED', (req: any) => {
      playAlert();
      queryClient.setQueryData(
        ['service-requests', user?.organizationId, user?.branchId],
        (prev: any[]) => {
          if (!prev) return prev;
          if (prev.some((r: any) => r.id === req.id)) return prev;
          return [req, ...prev];
        },
      );
    });

    socket.on('SERVICE_REQUEST_UPDATED', (req: any) => {
      queryClient.setQueryData(
        ['service-requests', user?.organizationId, user?.branchId],
        (prev: any[]) => {
          if (!prev) return prev;
          const exists = prev.some((r: any) => r.id === req.id);
          if (exists) return prev.map((r: any) => (r.id === req.id ? req : r));
          return [req, ...prev];
        },
      );
    });

    socket.on('TABLE_STATUS_CHANGED', () =>
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
    );
    socket.on('SESSION_OPENED', () => queryClient.invalidateQueries({ queryKey: ['tables'] }));
    socket.on('SESSION_CLOSED', () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['service-calls'] });
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    });

    // Re-connect and re-fetch when app comes back from sleep/background
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (!socket.connected) socket.connect();
        refreshNowRef.current().catch(() => void 0);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
    };
  }, [user, playAlert, queryClient]);

  const closeSessionMutation = useMutation({
    mutationFn: async ({ sessionId, nextStatus }: { sessionId: string; nextStatus: string }) => {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/close`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ nextStatus }),
      });
      if (!res.ok) throw new Error('Failed to close session');
      return res.json();
    },
    onMutate: async ({ sessionId, nextStatus }) => {
      await queryClient.cancelQueries({ queryKey: ['tables'] });
      const previous = queryClient.getQueryData(['tables']);
      queryClient.setQueryData(['tables'], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((t: any) =>
            t.activeSession?.id === sessionId
              ? { ...t, status: nextStatus, activeSession: null }
              : t,
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) queryClient.setQueryData(['tables'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tables'] }),
  });

  const updateTableStatusMutation = useMutation({
    mutationFn: async ({ tableId, status }: { tableId: string; status: string }) => {
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update table status');
      return res.json();
    },
    onMutate: async ({ tableId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tables'] });
      const previous = queryClient.getQueryData(['tables']);
      queryClient.setQueryData(['tables'], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((t: any) => (t.id === tableId ? { ...t, status } : t)),
        };
      });
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) queryClient.setQueryData(['tables'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tables'] }),
  });

  const assignWaiterMutation = useMutation({
    mutationFn: async ({
      type,
      id,
      waiterId,
    }: {
      type: 'ORDER' | 'CALL' | 'REQUEST';
      id: string;
      waiterId: string | null;
    }) => {
      const url =
        type === 'CALL'
          ? `${API_BASE}/api/waiter-calls/${id}/assign`
          : type === 'REQUEST'
            ? `${API_BASE}/api/service-requests/${id}/assign`
            : `${API_BASE}/api/orders/${id}/assign-waiter`;

      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ waiterId }),
      });
      if (!res.ok) throw new Error('Failed to assign waiter');
      return res.json();
    },
    onSettled: (data, err, variables) => {
      if (variables.type === 'ORDER')
        queryClient.invalidateQueries({ queryKey: ['service-orders'] });
      else if (variables.type === 'CALL')
        queryClient.invalidateQueries({ queryKey: ['service-calls'] });
      else queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    },
  });

  const cancelItemMutation = useMutation({
    mutationFn: async ({
      orderId,
      itemId,
      reason,
    }: {
      orderId: string;
      itemId: string;
      reason: string;
    }) => {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/items/${itemId}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error('Failed to cancel item');
      return res.json();
    },
    onMutate: async ({ orderId, itemId }) => {
      await queryClient.cancelQueries({ queryKey: ['service-orders'] });
      const previous = queryClient.getQueryData(['service-orders']);
      queryClient.setQueryData(['service-orders'], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((o: any) => {
            if (o.id !== orderId) return o;
            return {
              ...o,
              items: o.items.map((i: any) => (i.id === itemId ? { ...i, status: 'CANCELLED' } : i)),
            };
          }),
        };
      });
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) queryClient.setQueryData(['service-orders'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['service-orders'] }),
  });

  async function updateOrderStatus(orderId: string, status: string) {
    updateOrderStatusMutation.mutate({ orderId, status });
  }

  async function acknowledgeWaiterCall(callId: string) {
    updateCallStatusMutation.mutate({ callId, status: 'RESOLVED' });
  }

  const pendingCallsCount = waiterCalls.length + serviceRequests.length;
  const activeOrdersByStatus = {
    RECEIVED: orders.filter((o: any) => o.status === 'RECEIVED'),
    PREPARING: orders.filter((o: any) => o.status === 'PREPARING'),
    READY: orders.filter((o: any) => o.status === 'READY'),
  };

  if (!audioUnlocked) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)] space-y-6">
        <h1 className="font-display text-4xl text-[var(--accent)]">SERVICE DISPLAY</h1>
        <button
          onClick={() => setAudioUnlocked(true)}
          className="px-8 py-4 bg-[var(--accent)] text-black font-bold tracking-widest text-lg transition-transform active:scale-95"
        >
          START DISPLAY
        </button>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-[var(--bg)] overflow-hidden">
      {installHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-sm font-bold tracking-wider text-[var(--text)]">
              Install on iPhone
            </div>
            <div className="mt-2 text-xs text-[var(--muted)] leading-relaxed">
              Tap Share, then Add to Home Screen.
            </div>
            <button
              onClick={() => setInstallHelpOpen(false)}
              className="mt-4 text-xs border border-[var(--border)] px-3 py-1.5"
            >
              Close
            </button>
          </div>
        </div>
      )}
      <header className="flex flex-col sm:flex-row items-center justify-between px-2 sm:px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 gap-1.5 overflow-hidden relative z-20">
        <div className="flex items-center justify-between w-full sm:w-auto gap-1.5 sm:gap-4 shrink-0 min-w-0">
          <h1 className="text-sm sm:text-xl flex items-center gap-2 shrink-0">
            <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-md" />
            <span className="font-display hidden xxs:inline text-[var(--accent)] uppercase">
              SERVICE
            </span>
          </h1>
          <div className="flex items-center gap-1.5">
            <div
              className={`flex items-center gap-1 sm:gap-1.5 text-[8px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 border shrink-0 font-mono ${isOnline && socketConnected ? 'border-[var(--ready)] text-[var(--ready)]' : 'border-[var(--danger)] text-[var(--danger)]'}`}
            >
              <span
                className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${isOnline && socketConnected ? 'bg-[var(--ready)]' : 'bg-[var(--danger)]'}`}
              />
              {isOnline && socketConnected ? 'LIVE' : 'OFFLINE'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode(nextThemeMode)}
            className="w-8 h-8 rounded-full border border-[var(--border)] flex items-center justify-center text-[10px] font-black"
          >
            {themeLabel}
          </button>
          <button
            onClick={toggleShift}
            disabled={shiftBusy}
            className={`px-3 py-1 border text-xs font-bold uppercase rounded-full disabled:opacity-50 transition-colors ${
              isOnShift
                ? 'border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)]/10'
                : 'border-[var(--ready)] text-[var(--ready)] hover:bg-[var(--ready)]/10'
            }`}
          >
            {shiftBusy ? '...' : isOnShift ? 'Clock Out' : 'Clock In'}
          </button>
          <button
            onClick={logout}
            className="px-3 py-1 border border-[var(--border)] text-xs font-bold uppercase rounded-full"
          >
            OUT
          </button>
        </div>
      </header>
      <div className="flex border-b border-[var(--border)] bg-[var(--surface)] shrink-0 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 sm:px-6 py-2.5 text-[10px] sm:text-xs font-bold tracking-wider transition-all whitespace-nowrap ${activeTab === 'orders' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          ORDERS ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('calls')}
          className={`px-4 sm:px-6 py-2.5 text-[10px] sm:text-xs font-bold tracking-wider transition-all relative whitespace-nowrap ${activeTab === 'calls' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          CALLS & REQUESTS{' '}
          {pendingCallsCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold">
              {pendingCallsCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('tables')}
          className={`px-4 sm:px-6 py-2.5 text-[10px] sm:text-xs font-bold tracking-wider transition-all whitespace-nowrap ${activeTab === 'tables' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          TABLES
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === 'orders' && (
          <div className="h-full overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto md:overflow-hidden grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--border)]">
              {(['RECEIVED', 'PREPARING', 'READY'] as const).map((status) => (
                <div key={status} className="flex flex-col min-h-[400px] md:min-h-0">
                  <div
                    className={`px-3 py-2 border-b border-[var(--border)] shrink-0 ${STATUS_TEXT[status]} sticky top-0 bg-[var(--surface)] z-10 flex justify-between items-center`}
                  >
                    <span className="font-bold text-[10px] tracking-widest uppercase">
                      {status}
                    </span>
                    <span className="text-[var(--muted)] text-[10px] font-mono">
                      ({activeOrdersByStatus[status].length})
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-3">
                    {activeOrdersByStatus[status].map((order: any) => (
                      <div
                        key={order.id}
                        className={`border p-3 space-y-3 shadow-sm ${STATUS_COLOR[order.status]}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <AutoFitText
                              className="font-bold"
                              maxFontSize="1.125rem"
                              minFontSize="0.875rem"
                            >
                              {(order as any).orderType === 'TAKEAWAY'
                                ? `Takeaway #${String((order as any).orderNumber ?? 0).padStart(3, '0')}`
                                : order.table?.label ||
                                  (order.tableId ? `T-${order.tableId.slice(-4)}` : 'Order')}
                            </AutoFitText>
                            <div className="text-[9px] text-[var(--muted)] font-mono truncate">
                              {order.id.slice(-6).toUpperCase()}
                            </div>
                          </div>
                          <TimeElapsed
                            createdAt={order.createdAt}
                            className="text-[10px] font-bold"
                          />
                        </div>
                        <div className="space-y-1.5 border-t border-[var(--border)] pt-2.5">
                          {order.items.map((item: any) => (
                            <div
                              key={item.id}
                              className={`flex items-start gap-2 ${item.cancelledAt ? 'opacity-40 line-through text-[10px]' : 'text-xs sm:text-sm'}`}
                            >
                              <span className="font-bold text-[var(--accent)] shrink-0">
                                {item.quantity}×
                              </span>
                              <span className="text-[var(--text)] font-medium leading-tight">
                                {item.menuItem?.name || '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                        {NEXT_STATUS[order.status] && (
                          <button
                            onClick={() => updateOrderStatus(order.id, NEXT_STATUS[order.status])}
                            className="w-full text-[10px] py-2 font-bold tracking-widest uppercase border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black transition-all rounded-sm"
                          >
                            {NEXT_LABEL[order.status]}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'calls' && (
          <div className="h-full overflow-y-auto p-4 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {waiterCalls.map((call: any) => (
                <div key={call.id} className="border border-[var(--preparing)] p-3 space-y-3">
                  <div className="flex justify-between items-start">
                    <AutoFitText className="font-bold text-[var(--preparing)]">
                      {call.table?.label || call.tableId}
                    </AutoFitText>
                    <TimeElapsed
                      createdAt={call.createdAt}
                      className="text-[var(--muted)] text-[9px] font-bold"
                    />
                  </div>
                  <button
                    onClick={() => acknowledgeWaiterCall(call.id)}
                    className="w-full text-[10px] py-2 font-bold uppercase border border-[var(--preparing)]"
                  >
                    RESOLVE
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'tables' && (
          <div className="h-full overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
            {tables
              .filter((t: any) => t.isActive)
              .map((t: any) => (
                <div
                  key={t.id}
                  className={`border p-3 flex flex-col justify-between gap-3 ${t.status === 'EMPTY' ? 'border-[var(--border)]' : 'border-[var(--accent)]'}`}
                >
                  <AutoFitText className="font-bold">{t.label}</AutoFitText>
                  <div className="text-[9px] font-bold uppercase">{t.status}</div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
