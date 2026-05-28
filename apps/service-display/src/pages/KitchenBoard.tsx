import React, { useEffect, useState, useRef, useCallback } from 'react';
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
}

type KitchenSnapshot = {
  ts: number;
  orders: Order[];
  ordersHasMore: boolean;
  ordersCursor: string | null;
};

function readKitchenSnapshot(key: string): KitchenSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KitchenSnapshot;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeKitchenSnapshot(key: string, snapshot: KitchenSnapshot): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    void 0;
  }
}

function kitchenSnapshotKey(
  user: { organizationId: string; branchId?: string | null } | null,
): string | null {
  if (!user?.organizationId) return null;
  const scope = user.branchId ? `branch:${user.branchId}` : 'org';
  return `cevop_service_snapshot:kitchen:${user.organizationId}:${scope}`;
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
  const { user, token, logout, silentRefresh, pushStatus, enablePush } = useAuth();
  useTheme();
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

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

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersCursor, setOrdersCursor] = useState<string | null>(null);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [refreshing, setRefreshing] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);
  const [offlineSnapshotTs, setOfflineSnapshotTs] = useState<number | null>(null);
  const [stations, setStations] = useState<{ id: string; name: string }[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const lastSyncAtRef = useRef(0);

  const applyOrderUpdate = useCallback(
    (order: Order) => {
      setOrders((prev) => {
        // Filter by station if selected
        if (selectedStationId) {
          const hasStationItem = order.items.some((i: any) => i.stationId === selectedStationId);
          if (!hasStationItem) return prev.filter((o) => o.id !== order.id);
        }

        if (!KITCHEN_STATUSES.includes(order.status)) return prev.filter((o) => o.id !== order.id);
        const exists = prev.some((o) => o.id === order.id);
        if (exists) return prev.map((o) => (o.id === order.id ? order : o));
        return [...prev, order];
      });
    },
    [selectedStationId],
  );

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
    const cacheKey = kitchenSnapshotKey(user ?? null);
    if (!navigator.onLine && cacheKey) {
      const snap = readKitchenSnapshot(cacheKey);
      if (snap) {
        setOrders(snap.orders);
        setOrdersHasMore(snap.ordersHasMore);
        setOrdersCursor(snap.ordersCursor);
        setOfflineSnapshotTs(snap.ts);
      }
      return;
    }

    try {
      const freshToken = (await silentRefresh()) ?? token;
      if (!freshToken) return;
      const headers = { Authorization: `Bearer ${freshToken}` };
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';

      // Fetch stations
      const stationsRes = await fetch(`${API_BASE}/api/stations?${branchParam}`, { headers });
      if (stationsRes.ok) {
        const stationsData = await stationsRes.json();
        if (stationsData.success) setStations(stationsData.data);
      }

      const stationFilter = selectedStationId ? `&stationId=${selectedStationId}` : '';
      const ordersRes = await fetch(
        `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&limit=50${branchParam}${stationFilter}`,
        { headers },
      );
      if (!ordersRes.ok) throw new Error('Network error');
      const ordersData = await ordersRes.json().catch(() => null);
      if (!ordersData?.success) throw new Error('Bad response');

      const nextOrders = ordersData.data;
      const nextOrdersHasMore = Boolean(ordersData.pagination?.hasMore);
      const nextOrdersCursor = ordersData.pagination?.nextCursor ?? null;

      setOrders(nextOrders);
      setOrdersHasMore(nextOrdersHasMore);
      setOrdersCursor(nextOrdersCursor);
      setOfflineSnapshotTs(null);

      if (cacheKey) {
        writeKitchenSnapshot(cacheKey, {
          ts: Date.now(),
          orders: nextOrders,
          ordersHasMore: nextOrdersHasMore,
          ordersCursor: nextOrdersCursor,
        });
      }
    } catch {
      if (cacheKey) {
        const snap = readKitchenSnapshot(cacheKey);
        if (snap) {
          setOrders(snap.orders);
          setOrdersHasMore(snap.ordersHasMore);
          setOrdersCursor(snap.ordersCursor);
          setOfflineSnapshotTs(snap.ts);
        }
      }
    }
  }, [selectedStationId, silentRefresh, token, user]);

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
      // Re-fetch immediately on every connect (initial + reconnect) to catch missed events
      refreshNowRef.current().catch(() => void 0);
    });
    socket.on('disconnect', () => setSocketConnected(false));

    socket.on('ORDER_CREATED', (order: Order) => {
      playAlert();
      setOrders((prev) => {
        // Filter by station if selected
        if (selectedStationId) {
          const hasStationItem = order.items.some((i: any) => i.stationId === selectedStationId);
          if (!hasStationItem) return prev;
        }
        return [...prev.filter((o) => o.id !== order.id), order];
      });
    });

    socket.on('ORDER_UPDATED', (order: Order) => applyOrderUpdate(order));

    const handleSyncRequired = () => {
      const now = Date.now();
      // Throttle syncs to prevent "refresh loops"
      if (now - lastSyncAtRef.current < 2000) return; // 2s throttle — tight enough to not swallow rapid mutations
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
  }, [user, playAlert, applyOrderUpdate, selectedStationId]);

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

      // Reconnect socket immediately if it dropped while screen was off
      const socket = socketRef.current;
      if (socket && !socket.connected) {
        socket.connect();
      }

      // Reload data to catch anything missed
      refreshNowRef.current().catch(() => void 0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Background Heartbeat Sync
  useEffect(() => {
    if (!token) return;

    // Periodic refresh every 60 seconds as a fallback for missed socket events
    const interval = setInterval(() => {
      if (navigator.onLine) {
        refreshNowRef.current().catch(() => void 0);
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [token]);

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
      {installHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm border border-gray-800 bg-[#0a0a0a] p-4">
            <div className="text-sm font-bold tracking-wider text-white">Install on iPhone</div>
            <div className="mt-2 text-xs text-gray-300 leading-relaxed">
              Tap Share, then Add to Home Screen. Open Cevop from the Home Screen to receive alerts
              while the phone is asleep.
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setInstallHelpOpen(false)}
                className="text-xs border border-gray-800 px-3 py-1.5 text-gray-300 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="text-texture opacity-5" />
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-center justify-between px-2 sm:px-4 py-2 border-b border-gray-800 bg-[#0a0a0a] shrink-0 gap-1.5 overflow-hidden relative z-20">
        <div className="flex items-center justify-between w-full sm:w-auto gap-1.5 sm:gap-4 min-w-0 shrink">
          <h1 className="text-sm sm:text-xl text-[var(--accent)] font-display truncate flex items-center gap-2">
            <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-md" />
            <span className="opacity-80 hidden xxs:inline">KITCHEN</span>
          </h1>
          <div className="flex items-center gap-1.5">
            <div
              className={`px-1.5 sm:px-2 py-0.5 border text-[8px] sm:text-[10px] shrink-0 font-mono ${socketConnected ? 'border-green-500 text-green-500' : 'border-red-500 text-red-500'}`}
            >
              {isOnline && socketConnected ? 'LIVE' : 'OFFLINE'}
            </div>
            {/* Mobile-only Logout button */}
            <button
              onClick={logout}
              className="sm:hidden text-[9px] text-gray-500 border border-gray-800 px-2 py-1 shrink-0 uppercase rounded-full font-bold font-display"
            >
              OUT
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-1 sm:gap-3 shrink-0">
          <div className="hidden lg:flex flex-col items-end">
            <span className="text-gray-200 text-[10px] sm:text-xs font-bold truncate max-w-[150px]">
              {user?.name}
            </span>
            <span className="text-gray-500 text-[9px] sm:text-[10px] truncate max-w-[150px]">
              {user?.organization?.name}
              {user?.branch ? ` — ${user.branch.name}` : ''}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {stations.length > 0 && (
              <select
                className="text-[9px] sm:text-xs bg-black text-gray-400 border border-gray-800 px-2 py-1 shrink-0 rounded-full font-bold font-display outline-none"
                onChange={(e) => setSelectedStationId(e.target.value || null)}
                value={selectedStationId || ''}
              >
                <option value="">ALL STATIONS</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => refreshNow().catch(() => void 0)}
              disabled={refreshing}
              className="text-[9px] sm:text-xs text-gray-400 border border-gray-800 px-2 sm:px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display disabled:opacity-50"
            >
              {refreshing ? '...' : '⟳'}
            </button>

            {pushStatus !== 'unsupported' && pushStatus !== 'on' && (
              <button
                onClick={() => enablePush().catch(() => void 0)}
                disabled={pushStatus === 'loading' || pushStatus === 'blocked'}
                className="text-[9px] sm:text-xs text-gray-400 border border-gray-800 px-2 sm:px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display disabled:opacity-50"
              >
                {pushStatus === 'loading' ? '...' : pushStatus === 'blocked' ? 'BLOCKED' : 'ALERTS'}
              </button>
            )}

            {showInstallButton && (
              <button
                onClick={() => handleInstall().catch(() => void 0)}
                className="hidden xxs:block text-[9px] sm:text-xs text-gray-400 border border-gray-800 px-2 sm:px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display"
              >
                INSTALL
              </button>
            )}

            {ordersHasMore && (
              <button
                onClick={() => loadMoreOrders().catch(() => void 0)}
                disabled={ordersLoadingMore}
                className="text-[9px] sm:text-xs text-gray-400 border border-gray-800 px-2 sm:px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display disabled:opacity-50"
              >
                {ordersLoadingMore ? '...' : 'OLDER'}
              </button>
            )}

            <button
              onClick={logout}
              className="hidden sm:block text-[9px] sm:text-xs text-gray-500 border border-gray-800 px-2 sm:px-3 py-1 shrink-0 uppercase rounded-full font-bold font-display"
            >
              OUT
            </button>
          </div>
        </div>
      </header>
      {(!isOnline || !socketConnected) && offlineSnapshotTs && (
        <div className="px-2 sm:px-4 py-1 text-[10px] sm:text-xs text-gray-400 border-b border-gray-800 bg-[#0a0a0a]">
          Showing last saved snapshot — {new Date(offlineSnapshotTs).toLocaleString()}
        </div>
      )}

      <div className="flex-1 overflow-x-hidden overflow-y-auto grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 p-2 content-start">
        {orders.map((order) => (
          <div
            key={order.id}
            className={`border-2 p-2.5 sm:p-3 space-y-2.5 sm:space-y-3 bg-[#0a0a0a] flex flex-col justify-between overflow-hidden ${order.status === 'RECEIVED' ? 'border-blue-900' : 'border-yellow-900'}`}
          >
            <div className="space-y-2.5 sm:space-y-3 min-w-0">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0 flex-1">
                  <AutoFitText className="font-black" maxFontSize="1.5rem" minFontSize="1.125rem">
                    {order.table?.label || 'T?'}
                  </AutoFitText>
                  <div className="text-[9px] sm:text-[10px] text-gray-500 font-mono truncate">
                    {order.id.slice(-6).toUpperCase()}
                  </div>
                </div>
                <TimeElapsed
                  createdAt={order.createdAt}
                  className="text-[9px] sm:text-xs font-bold text-gray-400 shrink-0 mt-1"
                />
              </div>

              <div className="space-y-2 py-2 border-t border-gray-800 overflow-hidden">
                {order.items
                  .filter((i: any) => !selectedStationId || i.stationId === selectedStationId)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`flex flex-col min-w-0 ${item.cancelledAt ? 'opacity-30 line-through' : ''}`}
                    >
                      <div className="flex justify-between items-start gap-2 overflow-hidden">
                        <span className="text-sm sm:text-base font-bold leading-tight">
                          <span className="text-[var(--accent)] mr-1.5 shrink-0">
                            {item.quantity}×
                          </span>
                          {item.menuItem?.name}
                        </span>
                        {!item.cancelledAt && (
                          <div className="flex gap-1 shrink-0 mt-0.5">
                            <button
                              onClick={() => toggleItemAvailability(item.menuItemId)}
                              className="text-[8px] sm:text-[9px] border border-gray-700 px-1 text-gray-500 hover:text-red-500 transition-colors"
                              title="86 item"
                            >
                              86
                            </button>
                            <button
                              onClick={() =>
                                cancelOrderItem(order.id, item.id, item.menuItem?.name || '')
                              }
                              disabled={updatingItems.has(item.id)}
                              className="text-[8px] sm:text-[9px] border border-gray-700 px-1 text-gray-500 hover:text-red-500 disabled:opacity-50 transition-colors"
                              title="Cancel item"
                            >
                              {updatingItems.has(item.id) ? '...' : '✕'}
                            </button>
                          </div>
                        )}
                      </div>
                      {item.notes && (
                        <div className="text-[10px] sm:text-xs text-yellow-500 italic ml-4 sm:ml-5 leading-tight mt-0.5 break-words">
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
              className={`w-full py-2.5 sm:py-3.5 mt-1 font-black tracking-tighter text-base sm:text-lg transition-all active:scale-95 ${order.status === 'RECEIVED' ? 'bg-blue-600' : 'bg-yellow-600'} text-black truncate rounded-sm`}
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
