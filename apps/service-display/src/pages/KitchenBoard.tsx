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

const KITCHEN_STATUSES = ['RECEIVED', 'PREPARING'];
const NEXT_STATUS: Record<string, string> = {
  RECEIVED: 'PREPARING',
  PREPARING: 'READY',
};
const NEXT_LABEL: Record<string, string> = {
  RECEIVED: '→ START PREPARING',
  PREPARING: '→ MARK AS READY',
};

function elapsed(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function TimeElapsed({ createdAt, className }: { createdAt: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(i);
  }, []);
  const diffMinutes = Math.floor((now - new Date(createdAt).getTime()) / 60000);
  const text = elapsed(createdAt);

  let color = 'text-gray-400';
  if (diffMinutes >= 20) color = 'text-red-500 font-bold animate-pulse';
  else if (diffMinutes >= 10) color = 'text-orange-400 font-bold';
  else if (diffMinutes >= 5) color = 'text-yellow-400';

  return <span className={className || color}>{text} ago</span>;
}

export function KitchenBoard() {
  const { user, token, logout } = useAuth() as any;
  useTheme();

  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [refreshing, setRefreshing] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);
  const [isOnShift, setIsOnShift] = useState<boolean>(!!user?.isOnShift);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const selectedStationIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedStationIdRef.current = selectedStationId;
  }, [selectedStationId]);
  const socketRef = useRef<Socket | null>(null);
  const lastSyncAtRef = useRef(0);

  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

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

  const queryClient = useQueryClient();

  // Queries
  const { data: ordersData, refetch: refetchOrders } = useQuery({
    queryKey: ['kitchen-orders', user?.organizationId, user?.branchId, selectedStationId],
    queryFn: async () => {
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
      const stationParam = selectedStationId ? `&stationId=${selectedStationId}` : '';
      const res = await fetch(
        `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&limit=50${branchParam}${stationParam}`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      if (!res.ok) throw new Error('Failed to fetch kitchen orders');
      const json = await res.json();
      return json;
    },
    enabled: !!token && !!user,
    staleTime: 30000,
    refetchInterval: 15_000, // 15s fallback — keeps board live if socket drops
    refetchIntervalInBackground: false,
  });

  const orders = useMemo(() => {
    if (!ordersData?.success) return [];
    return ordersData.data
      .filter((o: any) => KITCHEN_STATUSES.includes(o.status))
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [ordersData]);

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
      if (!res.ok) throw new Error('Failed to update order status');
      return res.json();
    },
    onMutate: async ({ orderId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['kitchen-orders'] });
      const previous = queryClient.getQueryData(['kitchen-orders']);
      queryClient.setQueryData(['kitchen-orders'], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((o: any) => (o.id === orderId ? { ...o, status } : o)),
        };
      });
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['kitchen-orders'], context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] }),
  });

  const refreshNow = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refetchOrders();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, refetchOrders]);

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

  const { data: stationsData } = useQuery({
    queryKey: ['stations', user?.organizationId, user?.branchId],
    queryFn: async () => {
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
      const res = await fetch(`${API_BASE}/api/stations?${branchParam}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) throw new Error('Failed to fetch stations');
      const json = await res.json();
      return json.data;
    },
    enabled: !!token && !!user,
  });

  const stations = stationsData || [];

  useEffect(() => {
    if (!token) return;
    refetchOrders();
  }, [token, refetchOrders]);

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
      // Use ref so this handler always writes to the currently-selected station's cache key,
      // not the stale value captured when the socket was first created.
      queryClient.setQueryData(
        ['kitchen-orders', user?.organizationId, user?.branchId, selectedStationIdRef.current],
        (prev: any) => {
          if (!prev || !prev.success) return prev;
          if (prev.data.some((o: any) => o.id === order.id)) return prev;
          return { ...prev, data: [order, ...prev.data] };
        },
      );
    });

    socket.on('ORDER_UPDATED', (order: any) => {
      queryClient.setQueryData(
        ['kitchen-orders', user?.organizationId, user?.branchId, selectedStationIdRef.current],
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

    return () => {
      socket.disconnect();
    };
  }, [user, playAlert, queryClient]);

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
      await queryClient.cancelQueries({ queryKey: ['kitchen-orders'] });
      const previous = queryClient.getQueryData(['kitchen-orders']);
      queryClient.setQueryData(['kitchen-orders'], (old: any) => {
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
      if (context?.previous) {
        queryClient.setQueryData(['kitchen-orders'], context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] }),
  });

  async function updateOrderStatus(orderId: string, status: string) {
    updateOrderStatusMutation.mutate({ orderId, status });
  }

  async function cancelOrderItem(orderId: string, itemId: string, itemName: string) {
    cancelItemMutation.mutate({ orderId, itemId, reason: `${itemName} unavailable` });
  }

  if (!audioUnlocked) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-black text-white space-y-6">
        <h1 className="font-display text-4xl text-[var(--accent)] text-center px-4">
          KITCHEN DISPLAY (KDS)
        </h1>
        <button
          onClick={() => setAudioUnlocked(true)}
          className="px-8 py-4 bg-[var(--accent)] text-black font-bold tracking-widest text-lg transition-transform active:scale-95"
        >
          START KITCHEN DISPLAY
        </button>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-black overflow-hidden text-white relative">
      <header className="flex flex-col sm:flex-row items-center justify-between px-2 sm:px-4 py-2 border-b border-gray-800 bg-[#0a0a0a] shrink-0 gap-1.5 overflow-hidden relative z-20">
        <div className="flex items-center justify-between w-full sm:w-auto gap-1.5 sm:gap-4 min-w-0 shrink">
          <h1 className="text-sm sm:text-xl text-[var(--accent)] font-display truncate flex items-center gap-2">
            <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-md" />
            <span className="opacity-80 hidden xxs:inline">KITCHEN</span>
          </h1>
          <div
            className={`px-2 py-0.5 border text-[10px] font-mono ${socketConnected ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500'}`}
          >
            {isOnline && socketConnected ? 'LIVE' : 'OFFLINE'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stations.length > 0 && (
            <select
              className="text-[10px] bg-black border border-gray-800 px-2 py-1"
              onChange={(e) => setSelectedStationId(e.target.value || null)}
              value={selectedStationId || ''}
            >
              <option value="">ALL STATIONS</option>
              {stations.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name.toUpperCase()}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => refreshNow().catch(() => void 0)}
            className="text-xs border border-gray-800 px-3 py-1 uppercase font-bold"
          >
            REFRESH
          </button>
          <button
            onClick={toggleShift}
            disabled={shiftBusy}
            className={`text-xs border px-3 py-1 uppercase font-bold disabled:opacity-50 transition-colors ${
              isOnShift
                ? 'border-red-700 text-red-400 hover:bg-red-900/20'
                : 'border-green-700 text-green-400 hover:bg-green-900/20'
            }`}
          >
            {shiftBusy ? '...' : isOnShift ? 'CLOCK OUT' : 'CLOCK IN'}
          </button>
          <button
            onClick={logout}
            className="text-xs border border-gray-800 px-3 py-1 uppercase font-bold"
          >
            OUT
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-x-hidden overflow-y-auto grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 p-2 content-start">
        {orders.map((order: any) => (
          <div
            key={order.id}
            className={`border-2 p-3 space-y-3 bg-[#0a0a0a] flex flex-col justify-between overflow-hidden ${order.status === 'RECEIVED' ? 'border-blue-900' : 'border-yellow-900'}`}
          >
            <div className="min-w-0">
              <div className="flex justify-between items-start gap-2">
                <AutoFitText className="font-black" maxFontSize="1.5rem" minFontSize="1.125rem">
                  {order.orderType === 'TAKEAWAY'
                    ? `Takeaway #${String(order.orderNumber ?? 0).padStart(3, '0')}`
                    : order.table?.label || 'T?'}
                </AutoFitText>
                <TimeElapsed
                  createdAt={order.createdAt}
                  className="text-[10px] font-bold text-gray-400"
                />
              </div>
              <div className="space-y-2 py-2 border-t border-gray-800 mt-2">
                {order.items.map((item: any) => (
                  <div
                    key={item.id}
                    className={`flex justify-between ${item.cancelledAt ? 'opacity-30 line-through' : ''}`}
                  >
                    <span className="text-sm font-bold">
                      <span className="text-[var(--accent)] mr-1.5">{item.quantity}×</span>
                      {item.menuItem?.name}
                    </span>
                    {!item.cancelledAt && (
                      <button
                        onClick={() =>
                          cancelOrderItem(order.id, item.id, item.menuItem?.name || '')
                        }
                        className="text-[9px] border border-gray-700 px-1"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => updateOrderStatus(order.id, NEXT_STATUS[order.status])}
              className={`w-full py-3 mt-1 font-black text-lg ${order.status === 'RECEIVED' ? 'bg-blue-600' : 'bg-yellow-600'} text-black rounded-sm`}
            >
              {NEXT_LABEL[order.status]}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
