import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';
import { formatPrice } from '../../../../shared/utils/currency';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';
const DEV_SOCKET_URL = 'http://127.0.0.1:4000';

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
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
interface WaiterCall {
  id: string;
  status: string;
  reason?: string;
  table?: { label: string };
  createdAt: string;
  tableId: string;
}
interface ServiceRequest {
  id: string;
  status: string;
  serviceType: string;
  notes?: string;
  table?: { label: string };
  createdAt: string;
  tableId: string;
}

const ACTIVE_STATUSES = ['RECEIVED', 'PREPARING', 'READY'];
const STATUS_COLOR: Record<string, string> = {
  RECEIVED: 'border-[var(--received)]',
  PREPARING: 'border-[var(--preparing)]',
  READY: 'border-[var(--ready)]',
  SERVED: 'border-[var(--served)]',
};
const STATUS_TEXT: Record<string, string> = {
  RECEIVED: 'text-blue-400',
  PREPARING: 'text-yellow-400',
  READY: 'text-green-400',
  SERVED: 'text-gray-500',
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
  const { user, token, logout, silentRefresh } = useAuth();
  const { mode, setMode } = useTheme();

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'calls'>('orders');
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const socketRef = useRef<Socket | null>(null);

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
    const [ordersRes, callsRes, serviceRes] = await Promise.all([
      fetch(
        `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&status=READY&limit=50${branchParam}`,
        { headers },
      ),
      fetch(`${API_BASE}/api/waiter-calls?status=PENDING${branchParam}`, { headers }),
      fetch(`${API_BASE}/api/service-requests?status=PENDING${branchParam}`, { headers }),
    ]);
    const [ordersData, callsData, serviceData] = await Promise.all([
      ordersRes.json(),
      callsRes.json(),
      serviceRes.json(),
    ]);
    if (ordersData.success)
      setOrders(ordersData.data.filter((o: Order) => ACTIVE_STATUSES.includes(o.status)));
    if (callsData.success) setWaiterCalls(callsData.data);
    if (serviceData.success) setServiceRequests(serviceData.data);
  }, [token, user]);

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

    socket.on('ORDER_CREATED', (order: Order) => {
      playAlert();
      setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
    });

    socket.on('ORDER_UPDATED', (order: Order) => applyOrderUpdate(order));

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

    return () => {
      socket.disconnect();
    };
  }, [user, playAlert, applyOrderUpdate]); // Omitted `token` intentionally so it doesn't reconnect on token refresh

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

  async function updateOrderStatus(orderId: string, status: string) {
    if (updatingItems.has(orderId)) return;
    setUpdatingItems((prev) => new Set(prev).add(orderId));
    try {
      const freshToken = (await silentRefresh()) ?? token;
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

  async function acknowledgeWaiterCall(callId: string) {
    if (updatingItems.has(callId)) return;
    setUpdatingItems((prev) => new Set(prev).add(callId));
    try {
      const freshToken = (await silentRefresh()) ?? token;
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
      const freshToken = (await silentRefresh()) ?? token;
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
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl text-[var(--accent)] flex items-baseline gap-2">
            <span className="brand-mark">CEVOP</span>
            <span className="font-display">SERVICE</span>
          </h1>
          <div
            className={`flex items-center gap-1.5 text-xs px-2 py-1 border ${isOnline && socketConnected ? 'border-green-800 text-green-400 bg-green-900/20' : 'border-red-800 text-red-400 bg-red-900/20'}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isOnline && socketConnected ? 'bg-green-400' : 'bg-red-400'}`}
            />
            {isOnline && socketConnected ? 'LIVE' : 'OFFLINE'}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[var(--muted)] text-xs">
            {user?.organization?.name}
            {user?.branch ? ` — ${user.branch.name}` : ''}
          </span>
          <div className="text-[var(--muted)] text-xs font-mono">
            {new Date().toLocaleTimeString()}
          </div>
          <button
            onClick={() => setMode(nextThemeMode)}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
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
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-2 py-1 transition-colors"
          >
            LOGOUT
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-6 py-2.5 text-sm font-bold tracking-wider transition-all ${activeTab === 'orders' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          ORDERS ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('calls')}
          className={`px-6 py-2.5 text-sm font-bold tracking-wider transition-all relative ${activeTab === 'calls' ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
        >
          CALLS & REQUESTS
          {pendingCallsCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-bold">
              {pendingCallsCount}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === 'orders' ? (
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 lg:divide-x divide-[var(--border)] overflow-y-auto lg:overflow-hidden">
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
                          #{order.id.slice(-6).toUpperCase()}
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
                        <div key={item.id} className="flex items-start gap-2 text-xs">
                          <span className="font-bold text-[var(--accent)] shrink-0">
                            {item.quantity}×
                          </span>
                          <div>
                            <span className="text-[var(--text)]">{item.menuItem?.name || '—'}</span>
                            {item.notes && (
                              <div className="text-[var(--muted)] italic">"{item.notes}"</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
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
      ) : (
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
                  className="border border-yellow-800 bg-yellow-900/10 p-3 space-y-2 animate-slide-in"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-yellow-300">
                      {call.table?.label || call.tableId}
                    </span>
                    <TimeElapsed
                      createdAt={call.createdAt}
                      className="text-[var(--muted)] text-xs"
                    />
                  </div>
                  {call.reason && <p className="text-xs text-[var(--text)]">"{call.reason}"</p>}
                  <button
                    onClick={() => acknowledgeWaiterCall(call.id)}
                    disabled={updatingItems.has(call.id)}
                    className="w-full text-xs py-1.5 font-bold border border-yellow-800 hover:bg-yellow-500 hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="border border-purple-800 bg-purple-900/10 p-3 space-y-2 animate-slide-in"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-purple-300">
                      {req.table?.label || req.tableId}
                    </span>
                    <TimeElapsed
                      createdAt={req.createdAt}
                      className="text-[var(--muted)] text-xs"
                    />
                  </div>
                  <p className="text-xs text-[var(--text)] font-bold">{req.serviceType}</p>
                  {req.notes && <p className="text-xs text-[var(--muted)]">"{req.notes}"</p>}
                  <button
                    onClick={() => acknowledgeService(req.id)}
                    disabled={updatingItems.has(req.id)}
                    className="w-full text-xs py-1.5 font-bold border border-purple-800 hover:bg-purple-500 hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updatingItems.has(req.id) ? 'RESOLVING...' : 'RESOLVE'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
