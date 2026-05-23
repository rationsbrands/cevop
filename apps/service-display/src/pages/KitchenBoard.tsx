import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';

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
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(i);
  }, []);
  const text = elapsed(createdAt);
  const color = text.includes('m') && parseInt(text) > 15 ? 'text-red-400' : 'text-gray-400';
  return <span className={className || color}>{text} ago</span>;
}

export function KitchenBoard() {
  const { user, token, logout, silentRefresh } = useAuth();
  useTheme();

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersCursor, setOrdersCursor] = useState<string | null>(null);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const lastSyncAtRef = useRef(0);

  const applyOrderUpdate = useCallback((order: Order) => {
    setOrders((prev) => {
      if (!KITCHEN_STATUSES.includes(order.status)) return prev.filter((o) => o.id !== order.id);
      const exists = prev.some((o) => o.id === order.id);
      if (exists) return prev.map((o) => (o.id === order.id ? order : o));
      return [order, ...prev];
    });
  }, []);

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

  const loadData = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
    const ordersRes = await fetch(
      `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&limit=50${branchParam}`,
      { headers },
    );
    const ordersData = await ordersRes.json();
    if (ordersData.success) {
      setOrders(ordersData.data);
      setOrdersHasMore(Boolean(ordersData.pagination?.hasMore));
      setOrdersCursor(ordersData.pagination?.nextCursor ?? null);
    }
  }, [token, user]);

  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  const refreshNow = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await silentRefresh();
      await loadDataRef.current();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, silentRefresh]);

  const refreshNowRef = useRef(refreshNow);
  useEffect(() => {
    refreshNowRef.current = refreshNow;
  }, [refreshNow]);

  const loadMoreOrders = useCallback(async () => {
    if (!token) return;
    if (!ordersHasMore || !ordersCursor) return;
    if (ordersLoadingMore) return;
    setOrdersLoadingMore(true);
    try {
      const freshToken = (await silentRefresh()) ?? token;
      if (!freshToken) return;
      const headers = { Authorization: `Bearer ${freshToken}` };
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
      const res = await fetch(
        `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&limit=50&cursor=${ordersCursor}${branchParam}`,
        { headers },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) return;

      const pageOrders: Order[] = Array.isArray(body.data) ? body.data : [];
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => o.id));
        const merged = [...prev];
        for (const o of pageOrders) {
          if (!KITCHEN_STATUSES.includes(o.status)) continue;
          if (!seen.has(o.id)) {
            merged.push(o);
            seen.add(o.id);
          }
        }
        return merged;
      });
      setOrdersHasMore(Boolean(body.pagination?.hasMore));
      setOrdersCursor(body.pagination?.nextCursor ?? null);
    } finally {
      setOrdersLoadingMore(false);
    }
  }, [ordersCursor, ordersHasMore, ordersLoadingMore, silentRefresh, token, user]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      loadData().catch(() => {
        if (!cancelled) void 0;
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [loadData, token]);

  useEffect(() => {
    if (!user) return;

    const SOCKET_URL = API_BASE || window.location.origin;
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        cb({ token: tokenRef.current });
      },
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

    socket.on('ORDER_CREATED', (order: Order) => {
      playAlert();
      setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
    });

    socket.on('ORDER_UPDATED', (order: Order) => applyOrderUpdate(order));

    const handleSyncRequired = () => {
      const now = Date.now();
      if (now - lastSyncAtRef.current < 8000) return;
      lastSyncAtRef.current = now;
      refreshNowRef.current().catch(() => void 0);
    };
    socket.on('SYNC_REQUIRED', handleSyncRequired);

    return () => {
      socket.off('SYNC_REQUIRED', handleSyncRequired);
      socket.disconnect();
    };
  }, [user, playAlert, applyOrderUpdate]);

  async function updateOrderStatus(orderId: string, status: string) {
    if (updatingItems.has(orderId)) return;
    setUpdatingItems((prev) => new Set(prev).add(orderId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (body?.success && body?.data) {
        applyOrderUpdate(body.data);
      }
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(orderId);
        return n;
      });
    }
  }

  async function toggleItemAvailability(menuItemId: string) {
    try {
      const freshToken = (await silentRefresh()) ?? token;
      if (!freshToken) return;
      await fetch(`${API_BASE}/api/menu/items/${menuItemId}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
    } catch {
      void 0;
    }
  }

  async function cancelOrderItem(orderId: string, itemId: string, itemName: string) {
    if (updatingItems.has(itemId)) return;
    const reason = `${itemName} unavailable`;
    setUpdatingItems((prev) => new Set(prev).add(itemId));
    try {
      const freshToken = (await silentRefresh()) ?? token;
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/items/${itemId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => null);
      if (body?.success && body?.data) {
        applyOrderUpdate(body.data);
      }
    } catch {
      void 0;
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(itemId);
        return n;
      });
    }
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
      <div className="text-texture opacity-5" />
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-gray-800 bg-[#0a0a0a] shrink-0 gap-2 relative z-20">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 shrink">
          <h1 className="text-sm sm:text-xl text-[var(--accent)] font-display truncate">
            CEVOP KITCHEN
          </h1>
          <div
            className={`px-1.5 sm:px-2 py-0.5 border text-[8px] sm:text-[10px] shrink-0 font-mono ${socketConnected ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500'}`}
          >
            {socketConnected ? 'LIVE' : 'OFFLINE'}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="text-[10px] font-mono hidden xs:block">
            {new Date().toLocaleTimeString()}
          </div>
          <button
            onClick={() => refreshNow().catch(() => void 0)}
            disabled={refreshing}
            className="text-[10px] sm:text-xs text-gray-400 border border-gray-800 px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display disabled:opacity-50"
          >
            {refreshing ? '...' : 'REFRESH'}
          </button>
          {ordersHasMore && (
            <button
              onClick={() => loadMoreOrders().catch(() => void 0)}
              disabled={ordersLoadingMore}
              className="text-[10px] sm:text-xs text-gray-400 border border-gray-800 px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display disabled:opacity-50"
            >
              {ordersLoadingMore ? '...' : 'OLDER'}
            </button>
          )}
          <button
            onClick={logout}
            className="text-[10px] sm:text-xs text-gray-500 border border-gray-800 px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display"
          >
            OUT
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-x-hidden overflow-y-auto grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-2 p-2 content-start">
        {orders.map((order) => (
          <div
            key={order.id}
            className={`border-2 p-3 space-y-3 bg-[#0a0a0a] flex flex-col justify-between overflow-hidden ${order.status === 'RECEIVED' ? 'border-blue-900' : 'border-yellow-900'}`}
          >
            <div className="space-y-3 min-w-0">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-2xl font-black truncate">{order.table?.label || 'T?'}</div>
                  <div className="text-[10px] text-gray-500 font-mono truncate">
                    {order.id.slice(-6).toUpperCase()}
                  </div>
                </div>
                <TimeElapsed
                  createdAt={order.createdAt}
                  className="text-[10px] sm:text-xs font-bold text-gray-400 shrink-0"
                />
              </div>

              <div className="space-y-2 py-2 border-t border-gray-800 overflow-hidden">
                {order.items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex flex-col min-w-0 ${item.cancelledAt ? 'opacity-30 line-through' : ''}`}
                  >
                    <div className="flex justify-between items-start gap-2 overflow-hidden">
                      <span className="text-base sm:text-lg font-bold leading-tight truncate">
                        <span className="text-[var(--accent)] mr-2 shrink-0">{item.quantity}×</span>
                        {item.menuItem?.name}
                      </span>
                      {!item.cancelledAt && (
                        <div className="flex gap-1 shrink-0 mt-1">
                          <button
                            onClick={() => toggleItemAvailability(item.menuItemId)}
                            className="text-[8px] sm:text-[9px] border border-gray-700 px-1 text-gray-500 hover:text-red-500"
                            title="86 item"
                          >
                            86
                          </button>
                          <button
                            onClick={() =>
                              cancelOrderItem(order.id, item.id, item.menuItem?.name || '')
                            }
                            disabled={updatingItems.has(item.id)}
                            className="text-[8px] sm:text-[9px] border border-gray-700 px-1 text-gray-500 hover:text-red-500 disabled:opacity-50"
                            title="Cancel item"
                          >
                            {updatingItems.has(item.id) ? '...' : '✕'}
                          </button>
                        </div>
                      )}
                    </div>
                    {item.notes && (
                      <div className="text-xs text-yellow-500 italic ml-4 sm:ml-6 leading-tight mt-1 break-words">
                        "{item.notes}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => updateOrderStatus(order.id, NEXT_STATUS[order.status])}
              disabled={updatingItems.has(order.id)}
              className={`w-full py-3 sm:py-4 mt-2 font-black tracking-tighter text-lg sm:text-xl transition-all active:scale-95 ${order.status === 'RECEIVED' ? 'bg-blue-600' : 'bg-yellow-600'} text-black truncate`}
            >
              {updatingItems.has(order.id) ? '...' : NEXT_LABEL[order.status]}
            </button>
          </div>
        ))}
        {orders.length === 0 && (
          <div className="col-span-full h-64 flex items-center justify-center text-gray-600 font-display text-2xl">
            NO ACTIVE ORDERS
          </div>
        )}
      </div>
    </div>
  );
}
