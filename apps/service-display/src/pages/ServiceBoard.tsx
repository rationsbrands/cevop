import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';
import { formatPrice } from '../../../../shared/utils/currency';

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
}
interface WaiterCall {
  id: string;
  status: string;
  reason?: string;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string } | null;
  table?: { label: string };
  createdAt: string;
  tableId: string;
}
interface ServiceRequest {
  id: string;
  status: string;
  serviceType: string;
  notes?: string;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string } | null;
  table?: { label: string };
  createdAt: string;
  tableId: string;
}

type ServiceSnapshot = {
  ts: number;
  orders: Order[];
  ordersHasMore: boolean;
  ordersCursor: string | null;
  waiterCalls: WaiterCall[];
  serviceRequests: ServiceRequest[];
  tables: any[];
};

function readServiceSnapshot(key: string): ServiceSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ServiceSnapshot;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeServiceSnapshot(key: string, snapshot: ServiceSnapshot): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    void 0;
  }
}

function serviceSnapshotKey(
  user: { organizationId: string; branchId?: string | null } | null,
): string | null {
  if (!user?.organizationId) return null;
  const scope = user.branchId ? `branch:${user.branchId}` : 'org';
  return `cevop_service_snapshot:service:${user.organizationId}:${scope}`;
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
  const { user, token, logout, silentRefresh, pushStatus, enablePush } = useAuth();
  const { mode, setMode } = useTheme();
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersCursor, setOrdersCursor] = useState<string | null>(null);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineSnapshotTs, setOfflineSnapshotTs] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'calls' | 'tables'>('orders');
  const [tables, setTables] = useState<any[]>([]);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const lastSyncAtRef = useRef(0);
  const [onlineWaiters, setOnlineWaiters] = useState<
    { id: string; name: string; online: boolean }[]
  >([]);
  const [assigningItems, setAssigningItems] = useState<Set<string>>(new Set());

  // Track items currently being updated to prevent double-clicks
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());

  const applyOrderUpdate = useCallback((order: Order) => {
    setOrders((prev) => {
      if (!ACTIVE_STATUSES.includes(order.status)) return prev.filter((o) => o.id !== order.id);
      const exists = prev.some((o) => o.id === order.id);
      if (exists) return prev.map((o) => (o.id === order.id ? order : o));
      return [order, ...prev];
    });
  }, []);

  // Mutable ref for token so socket reconnects use the latest token without tearing down the connection
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

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
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      void 0;
    }
  }, []);

  const loadOnlineWaiters = useCallback(async () => {
    const freshToken = await silentRefresh();
    if (!freshToken) return;
    const res = await fetch(`${API_BASE}/api/waiter-calls/waiters/online`, {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!res.ok) return;
    const body = await res.json();
    if (body?.success) setOnlineWaiters(body.data ?? []);
  }, [silentRefresh]);

  const loadData = useCallback(async () => {
    if (!token) return;
    const cacheKey = serviceSnapshotKey(user ?? null);
    if (!navigator.onLine && cacheKey) {
      const snap = readServiceSnapshot(cacheKey);
      if (snap) {
        setOrders(snap.orders);
        setOrdersHasMore(snap.ordersHasMore);
        setOrdersCursor(snap.ordersCursor);
        setWaiterCalls(snap.waiterCalls);
        setServiceRequests(snap.serviceRequests);
        setTables(snap.tables);
        setOfflineSnapshotTs(snap.ts);
      }
      return;
    }

    try {
      const freshToken = (await silentRefresh()) ?? token;
      if (!freshToken) return;
      const headers = { Authorization: `Bearer ${freshToken}` };
      const branchParam = user?.branchId ? `&branchId=${user.branchId}` : '';
      const [ordersRes, callsRes, serviceRes, tablesRes] = await Promise.all([
        fetch(
          `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&status=READY&limit=50${branchParam}`,
          { headers },
        ),
        fetch(`${API_BASE}/api/waiter-calls?status=PENDING${branchParam}`, { headers }),
        fetch(`${API_BASE}/api/service-requests?status=PENDING${branchParam}`, { headers }),
        fetch(`${API_BASE}/api/tables?_=${Date.now()}`, { headers }),
      ]);

      if (!ordersRes.ok || !callsRes.ok || !serviceRes.ok || !tablesRes.ok) {
        throw new Error('Network error');
      }

      const [ordersData, callsData, serviceData, tablesData] = await Promise.all([
        ordersRes.json(),
        callsRes.json(),
        serviceRes.json(),
        tablesRes.json(),
      ]);

      const nextOrders: Order[] = ordersData?.success
        ? ordersData.data.filter((o: Order) => ACTIVE_STATUSES.includes(o.status))
        : orders;
      const nextOrdersHasMore = ordersData?.success
        ? Boolean(ordersData.pagination?.hasMore)
        : ordersHasMore;
      const nextOrdersCursor = ordersData?.success
        ? (ordersData.pagination?.nextCursor ?? null)
        : ordersCursor;
      const nextCalls: WaiterCall[] = callsData?.success ? callsData.data : waiterCalls;
      const nextReqs: ServiceRequest[] = serviceData?.success ? serviceData.data : serviceRequests;
      const nextTables: any[] = tablesData?.success ? tablesData.data : tables;

      setOrders(nextOrders);
      setOrdersHasMore(nextOrdersHasMore);
      setOrdersCursor(nextOrdersCursor);
      setWaiterCalls(nextCalls);
      setServiceRequests(nextReqs);
      setTables(nextTables);
      setOfflineSnapshotTs(null);

      if (cacheKey) {
        writeServiceSnapshot(cacheKey, {
          ts: Date.now(),
          orders: nextOrders,
          ordersHasMore: nextOrdersHasMore,
          ordersCursor: nextOrdersCursor,
          waiterCalls: nextCalls,
          serviceRequests: nextReqs,
          tables: nextTables,
        });
      }
    } catch {
      if (cacheKey) {
        const snap = readServiceSnapshot(cacheKey);
        if (snap) {
          setOrders(snap.orders);
          setOrdersHasMore(snap.ordersHasMore);
          setOrdersCursor(snap.ordersCursor);
          setWaiterCalls(snap.waiterCalls);
          setServiceRequests(snap.serviceRequests);
          setTables(snap.tables);
          setOfflineSnapshotTs(snap.ts);
        }
      }
    }
  }, [
    orders,
    ordersCursor,
    ordersHasMore,
    serviceRequests,
    silentRefresh,
    tables,
    token,
    user,
    waiterCalls,
  ]);

  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  const loadOnlineWaitersRef = useRef(loadOnlineWaiters);
  useEffect(() => {
    loadOnlineWaitersRef.current = loadOnlineWaiters;
  }, [loadOnlineWaiters]);

  const refreshNow = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await silentRefresh();
      await Promise.all([loadDataRef.current(), loadOnlineWaitersRef.current()]);
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
        `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&status=READY&limit=50&cursor=${ordersCursor}${branchParam}`,
        { headers },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) return;

      const pageOrders: Order[] = Array.isArray(body.data) ? body.data : [];
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => o.id));
        const merged = [...prev];
        for (const o of pageOrders) {
          if (!ACTIVE_STATUSES.includes(o.status)) continue;
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
    const t = setTimeout(() => {
      loadData().catch(() => void 0);
    }, 0);
    return () => clearTimeout(t);
  }, [loadData, token]);

  // Socket setup
  useEffect(() => {
    if (!user) return; // Wait until user is fully loaded

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

    socket.on('ORDER_CREATED', (order: Order) => {
      playAlert();
      setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
    });

    socket.on('ORDER_UPDATED', (order: Order) => applyOrderUpdate(order));

    const handleWaiterOnline = () => {
      loadOnlineWaiters().catch(() => void 0);
    };
    const handleWaiterOffline = () => {
      loadOnlineWaiters().catch(() => void 0);
    };
    socket.on('WAITER_ONLINE', handleWaiterOnline);
    socket.on('WAITER_OFFLINE', handleWaiterOffline);

    socket.on('WAITER_CALLED', (call: WaiterCall) => {
      playAlert();
      setWaiterCalls((prev) => [call, ...prev.filter((c) => c.id !== call.id)]);
    });

    socket.on('WAITER_CALL_UPDATED', (call: WaiterCall) => {
      setWaiterCalls((prev) => {
        if (call.status !== 'PENDING') return prev.filter((c) => c.id !== call.id);
        const exists = prev.some((c) => c.id === call.id);
        if (exists) return prev.map((c) => (c.id === call.id ? call : c));
        return [call, ...prev];
      });
    });

    socket.on('SERVICE_REQUESTED', (req: ServiceRequest) => {
      playAlert();
      setServiceRequests((prev) => [req, ...prev.filter((r) => r.id !== req.id)]);
    });

    socket.on('SERVICE_REQUEST_UPDATED', (req: ServiceRequest) => {
      setServiceRequests((prev) => {
        if (req.status !== 'PENDING') return prev.filter((r) => r.id !== req.id);
        const exists = prev.some((r) => r.id === req.id);
        if (exists) return prev.map((r) => (r.id === req.id ? req : r));
        return [req, ...prev];
      });
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
      socket.off('WAITER_ONLINE', handleWaiterOnline);
      socket.off('WAITER_OFFLINE', handleWaiterOffline);
      socket.off('SYNC_REQUIRED', handleSyncRequired);
      socket.disconnect();
    };
  }, [user, playAlert, applyOrderUpdate, loadOnlineWaiters]); // Omitted `token` intentionally so it doesn't reconnect on token refresh

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

  useEffect(() => {
    if (isOnline) {
      refreshNowRef.current().catch(() => void 0);
    }
  }, [isOnline]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;

      // Reconnect socket immediately if it dropped while screen was off
      // Mobile browsers (especially iOS) aggressively kill connections
      const socket = socketRef.current;
      if (socket && !socket.connected) {
        socket.connect();
      }

      // Reload data to catch anything missed while screen was off
      refreshNowRef.current().catch(() => void 0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

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
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok || !body?.success) {
        await loadData();
        return;
      }
      if (body?.data) applyOrderUpdate(body.data);
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
      // Socket event will update other clients — no need to reload locally
    } catch {
      void 0;
    }
  }

  async function cancelOrderItem(orderId: string, itemId: string, itemName: string) {
    const reason = `${itemName} unavailable`;
    try {
      const freshToken = (await silentRefresh()) ?? token;
      if (!freshToken) return;

      const res = await fetch(`${API_BASE}/api/orders/${orderId}/items/${itemId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ reason }),
      });

      if (!res.ok) {
        // Handle error quietly
      }
      // ORDER_UPDATED socket event will refresh the board automatically
    } catch {
      void 0;
    }
  }

  async function acknowledgeWaiterCall(callId: string) {
    if (updatingItems.has(callId)) return;
    setUpdatingItems((prev) => new Set(prev).add(callId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/waiter-calls/${callId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ status: 'RESOLVED' }),
      });
      if (!res.ok) await loadData();
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(callId);
        return n;
      });
    }
  }

  async function acknowledgeService(reqId: string) {
    if (updatingItems.has(reqId)) return;
    setUpdatingItems((prev) => new Set(prev).add(reqId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/service-requests/${reqId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ status: 'RESOLVED' }),
      });
      if (!res.ok) await loadData();
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(reqId);
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
      if (!res.ok) await loadData();
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
      if (!res.ok) await loadData();
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(tableId);
        return n;
      });
    }
  }

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      loadOnlineWaiters().catch(() => void 0);
    }, 0);
    return () => clearTimeout(t);
  }, [user, activeTab, loadOnlineWaiters]);

  async function assignWaiterCall(callId: string, waiterId: string | null) {
    if (assigningItems.has(callId)) return;
    setAssigningItems((prev) => new Set(prev).add(callId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/waiter-calls/${callId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ waiterId }),
      });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.success && body?.data) {
        setWaiterCalls((prev) => prev.map((c) => (c.id === callId ? body.data : c)));
      }
    } finally {
      setAssigningItems((prev) => {
        const n = new Set(prev);
        n.delete(callId);
        return n;
      });
    }
  }

  async function assignServiceRequest(reqId: string, waiterId: string | null) {
    if (assigningItems.has(reqId)) return;
    setAssigningItems((prev) => new Set(prev).add(reqId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/service-requests/${reqId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ waiterId }),
      });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.success && body?.data) {
        setServiceRequests((prev) => prev.map((r) => (r.id === reqId ? body.data : r)));
      }
    } finally {
      setAssigningItems((prev) => {
        const n = new Set(prev);
        n.delete(reqId);
        return n;
      });
    }
  }

  async function assignOrder(orderId: string, waiterId: string | null) {
    if (assigningItems.has(orderId)) return;
    setAssigningItems((prev) => new Set(prev).add(orderId));
    try {
      const freshToken = await silentRefresh();
      if (!freshToken) return;
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/assign-waiter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
        body: JSON.stringify({ waiterId }),
      });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.success && body?.data) {
        applyOrderUpdate(body.data);
      }
    } finally {
      setAssigningItems((prev) => {
        const n = new Set(prev);
        n.delete(orderId);
        return n;
      });
    }
  }

  const pendingCallsCount = waiterCalls.length + serviceRequests.length;
  const activeOrdersByStatus = {
    RECEIVED: orders.filter((o) => o.status === 'RECEIVED'),
    PREPARING: orders.filter((o) => o.status === 'PREPARING'),
    READY: orders.filter((o) => o.status === 'READY'),
  };

  const unlockAudio = () => {
    try {
      const ctx = new AudioContext();
      ctx.resume().then(() => setAudioUnlocked(true));
    } catch {
      setAudioUnlocked(true);
    }
  };

  if (!audioUnlocked) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)] space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-display text-4xl text-[var(--accent)]">SERVICE DISPLAY</h1>
          <p className="text-[var(--muted)]">Audio alerts must be enabled to start.</p>
        </div>
        <button
          onClick={unlockAudio}
          className="px-8 py-4 bg-[var(--accent)] text-black font-bold tracking-widest text-lg transition-transform active:scale-95 hover:brightness-110"
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
      {/* Header */}
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-4 shrink-0 min-w-0">
          <h1 className="text-base sm:text-2xl flex items-center gap-2 shrink-0">
            <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-md" />
            <span className="font-display hidden xs:inline text-[var(--accent)]">SERVICE</span>
          </h1>
          <div
            className={`flex items-center gap-1 sm:gap-1.5 text-[9px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 border shrink-0 ${
              isOnline && socketConnected
                ? 'border-[var(--ready)] text-[var(--ready)] bg-[var(--surface2)]'
                : 'border-[var(--danger)] text-[var(--danger)] bg-[var(--surface2)]'
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

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <span className="text-[var(--muted)] text-[10px] sm:text-xs hidden md:block max-w-[150px] truncate">
            {user?.organization?.name}
            {user?.branch ? ` — ${user.branch.name}` : ''}
          </span>
          <div className="text-[var(--muted)] text-[10px] sm:text-xs font-mono hidden sm:block">
            {new Date().toLocaleTimeString()}
          </div>
          <button
            onClick={() => refreshNow().catch(() => void 0)}
            disabled={refreshing}
            className="text-[10px] sm:text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-1.5 sm:px-2 py-1 transition-colors shrink-0 disabled:opacity-50"
          >
            {refreshing ? 'REFRESHING…' : 'REFRESH'}
          </button>
          {pushStatus !== 'unsupported' && pushStatus !== 'on' && (
            <button
              onClick={() => enablePush().catch(() => void 0)}
              disabled={pushStatus === 'loading' || pushStatus === 'blocked'}
              className="text-[10px] sm:text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-1.5 sm:px-2 py-1 transition-colors shrink-0 disabled:opacity-50"
            >
              {pushStatus === 'loading'
                ? 'ENABLING…'
                : pushStatus === 'blocked'
                  ? 'ALERTS BLOCKED'
                  : 'ENABLE ALERTS'}
            </button>
          )}
          {showInstallButton && (
            <button
              onClick={() => handleInstall().catch(() => void 0)}
              className="text-[10px] sm:text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-1.5 sm:px-2 py-1 transition-colors shrink-0"
            >
              INSTALL
            </button>
          )}
          <button
            onClick={() => setMode(nextThemeMode)}
            className={`w-7 h-7 sm:w-10 sm:h-10 rounded-full border flex items-center justify-center transition-colors text-[9px] sm:text-[10px] font-bold tracking-widest shrink-0 ${
              mode === 'system'
                ? 'bg-[var(--surface2)] border-[var(--border)] text-[var(--text)] shadow-sm'
                : mode === 'dark'
                  ? 'bg-black border-[var(--border)] text-[var(--text)] shadow-sm'
                  : 'bg-white border-[var(--border)] text-black shadow-sm'
            }`}
            title={`Theme: ${themeLabel} (click → ${nextThemeLabel})`}
            aria-label={`Theme ${themeLabel}. Click to switch to ${nextThemeLabel}.`}
          >
            {themeLabel}
          </button>
          <button
            onClick={logout}
            className="text-[10px] sm:text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-1.5 sm:px-2 py-1 transition-colors shrink-0"
          >
            LOGOUT
          </button>
        </div>
      </header>
      {(!isOnline || !socketConnected) && offlineSnapshotTs && (
        <div className="px-3 sm:px-4 py-1 text-[10px] sm:text-xs text-[var(--muted)] border-b border-[var(--border)] bg-[var(--surface)]">
          Showing last saved snapshot — {new Date(offlineSnapshotTs).toLocaleString()}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-bold tracking-wider transition-all ${activeTab === 'orders' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          ORDERS ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('calls')}
          className={`px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-bold tracking-wider transition-all relative ${activeTab === 'calls' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          <span className="sm:hidden">CALLS</span>
          <span className="hidden sm:inline">CALLS & REQUESTS</span>
          {pendingCallsCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-bold">
              {pendingCallsCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('tables')}
          className={`px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-bold tracking-wider transition-all ${activeTab === 'tables' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          TABLES
        </button>
      </div>

      {/* Content */}
      {activeTab === 'orders' ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 gap-2">
            <div className="text-xs text-[var(--muted)]">
              Loaded {orders.length} active orders{ordersHasMore ? ' · older available' : ''}
            </div>
            {ordersHasMore && (
              <button
                className="px-3 py-1.5 text-xs font-bold tracking-wider border border-[var(--border)] bg-[var(--surface2)] hover:brightness-110 disabled:opacity-50"
                onClick={() => loadMoreOrders().catch(() => void 0)}
                disabled={ordersLoadingMore}
              >
                {ordersLoadingMore ? 'Loading…' : 'Load Older'}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border)] overflow-y-auto lg:overflow-hidden">
            {(['RECEIVED', 'PREPARING', 'READY'] as const).map((status) => (
              <div
                key={status}
                className="flex flex-col lg:overflow-hidden min-h-[400px] lg:min-h-0 border-b lg:border-b-0 border-[var(--border)]"
              >
                <div
                  className={`px-3 py-2 border-b border-[var(--border)] shrink-0 ${STATUS_TEXT[status]} sticky top-0 bg-[var(--surface)] z-10`}
                >
                  <span className="font-bold text-xs tracking-widest">{status}</span>
                  <span className="ml-2 text-[var(--muted)] text-xs">
                    ({activeOrdersByStatus[status].length})
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {activeOrdersByStatus[status].length === 0 && (
                    <div className="text-center text-[var(--muted)] text-xs pt-8">— Empty —</div>
                  )}
                  {activeOrdersByStatus[status].map((order) => (
                    <div
                      key={order.id}
                      className={`border p-3 space-y-2 animate-slide-in ${STATUS_COLOR[order.status]}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold text-sm text-[var(--text)]">
                            {order.table?.label || `Table ${order.tableId.slice(-4)}`}
                          </div>
                          <div className="text-[var(--muted)] text-xs font-mono">
                            {order.id.slice(-6).toUpperCase()}
                          </div>
                        </div>
                        <div className="text-right">
                          <TimeElapsed createdAt={order.createdAt} className="text-xs font-bold" />
                          <div className="text-[var(--muted)] text-xs">
                            {formatPrice(order.total)}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1 border-t border-[var(--border)] pt-2">
                        {order.items.map((item) => (
                          <React.Fragment key={item.id}>
                            <div
                              className={`flex items-start gap-2 text-xs ${item.cancelledAt ? 'opacity-40 line-through' : ''}`}
                            >
                              <span className="font-bold text-[var(--accent)] shrink-0">
                                {item.quantity}×
                              </span>
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-1">
                                <span className="text-[var(--text)] truncate">
                                  {item.menuItem?.name || '—'}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {/* Per-item 86 button — only shown to SERVICE role */}
                                  {user?.role === 'SERVICE' && item.menuItemId && (
                                    <button
                                      onClick={() => toggleItemAvailability(item.menuItemId)}
                                      title="Mark this item as unavailable (86'd)"
                                      className="text-[9px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--danger)] transition-colors ml-1 shrink-0"
                                    >
                                      86
                                    </button>
                                  )}
                                  {!item.cancelledAt &&
                                    order.status !== 'READY' &&
                                    order.status !== 'SERVED' && (
                                      <button
                                        onClick={() =>
                                          cancelOrderItem(
                                            order.id,
                                            item.id,
                                            item.menuItem?.name ?? 'Item',
                                          )
                                        }
                                        className="text-[9px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--danger)] transition-colors shrink-0 border border-transparent hover:border-[var(--danger)]/40 px-1 py-0.5"
                                        title="Mark this item as unable to fulfil"
                                      >
                                        ✕ can't fulfil
                                      </button>
                                    )}
                                  {item.cancelledAt && (
                                    <span className="text-[9px] uppercase text-[var(--danger)]">
                                      Cancelled
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {item.notes && (
                              <div className="text-[var(--muted)] italic text-[10px] pl-6">
                                "{item.notes}"
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                      {status === 'READY' && onlineWaiters.length > 0 && (
                        <div className="pt-2 border-t border-[var(--border)] space-y-2">
                          <div className="text-xs text-[var(--muted)]">
                            Assigned:{' '}
                            <span className="text-[var(--text)] font-medium">
                              {order.assignedWaiter
                                ? onlineWaiters.find((w) => w.id === order.assignedWaiter)?.name ||
                                  'Waiter'
                                : '—'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <select
                              id={`service_order_assign_${order.id}`}
                              name="assignedWaiter"
                              className="flex-1 text-xs"
                              value={order.assignedWaiter ?? ''}
                              onChange={(e) =>
                                assignOrder(order.id, e.target.value ? e.target.value : null)
                              }
                              disabled={assigningItems.has(order.id)}
                              autoComplete="off"
                              aria-label="Assign order to waiter"
                            >
                              <option value="">— Unassigned —</option>
                              {onlineWaiters.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                  {w.online ? ' (online)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                      {NEXT_STATUS[order.status] && (
                        <button
                          onClick={() => updateOrderStatus(order.id, NEXT_STATUS[order.status])}
                          disabled={updatingItems.has(order.id)}
                          className="w-full text-xs py-1.5 font-bold tracking-wider border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black hover:border-[var(--accent)] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {updatingItems.has(order.id) ? 'UPDATING...' : NEXT_LABEL[order.status]}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : activeTab === 'calls' ? (
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
          {/* Waiter Calls */}
          <div>
            <h2 className="font-bold text-xs tracking-widest text-[var(--muted)] mb-3">
              WAITER CALLS ({waiterCalls.length})
            </h2>
            <div className="space-y-3">
              {waiterCalls.length === 0 && (
                <div className="text-[var(--muted)] text-xs">No pending calls</div>
              )}
              {waiterCalls.map((call) => (
                <div
                  key={call.id}
                  className="border border-[var(--preparing)] bg-[var(--surface2)] p-3 space-y-2 animate-slide-in"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[var(--preparing)]">
                      {call.table?.label || call.tableId}
                    </span>
                    <TimeElapsed
                      createdAt={call.createdAt}
                      className="text-[var(--muted)] text-xs"
                    />
                  </div>
                  {call.reason && <p className="text-xs text-[var(--text)]">"{call.reason}"</p>}
                  {onlineWaiters.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        id={`service_waiter_call_assign_${call.id}`}
                        name="assignedTo"
                        className="flex-1 text-xs"
                        value={call.assignedTo ?? ''}
                        onChange={(e) =>
                          assignWaiterCall(call.id, e.target.value ? e.target.value : null)
                        }
                        disabled={assigningItems.has(call.id)}
                        autoComplete="off"
                        aria-label="Assign waiter call to waiter"
                      >
                        <option value="">— Unassigned —</option>
                        {onlineWaiters.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                            {w.online ? ' (online)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={() => acknowledgeWaiterCall(call.id)}
                    disabled={updatingItems.has(call.id)}
                    className="w-full text-xs py-1.5 font-bold border border-[var(--preparing)] hover:bg-[var(--preparing)] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updatingItems.has(call.id) ? 'RESOLVING...' : 'RESOLVE'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Service Requests */}
          <div>
            <h2 className="font-bold text-xs tracking-widest text-[var(--muted)] mb-3">
              SERVICE REQUESTS ({serviceRequests.length})
            </h2>
            <div className="space-y-3">
              {serviceRequests.length === 0 && (
                <div className="text-[var(--muted)] text-xs">No pending requests</div>
              )}
              {serviceRequests.map((req) => (
                <div
                  key={req.id}
                  className="border border-[var(--accent)] bg-[var(--surface2)] p-3 space-y-2 animate-slide-in"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[var(--accent)]">
                      {req.table?.label || req.tableId}
                    </span>
                    <TimeElapsed
                      createdAt={req.createdAt}
                      className="text-[var(--muted)] text-xs"
                    />
                  </div>
                  <p className="text-xs text-[var(--text)] font-bold">{req.serviceType}</p>
                  {req.notes && <p className="text-xs text-[var(--muted)]">"{req.notes}"</p>}
                  {onlineWaiters.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        id={`service_request_assign_${req.id}`}
                        name="assignedTo"
                        className="flex-1 text-xs"
                        value={req.assignedTo ?? ''}
                        onChange={(e) =>
                          assignServiceRequest(req.id, e.target.value ? e.target.value : null)
                        }
                        disabled={assigningItems.has(req.id)}
                        autoComplete="off"
                        aria-label="Assign service request to waiter"
                      >
                        <option value="">— Unassigned —</option>
                        {onlineWaiters.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                            {w.online ? ' (online)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={() => acknowledgeService(req.id)}
                    disabled={updatingItems.has(req.id)}
                    className="w-full text-xs py-1.5 font-bold border border-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updatingItems.has(req.id) ? 'RESOLVING...' : 'RESOLVE'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 content-start">
          {tables
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
          {tables.filter((t) => t.isActive).length === 0 && (
            <div className="col-span-full text-center text-[var(--muted)] text-sm pt-8">
              No tables found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
