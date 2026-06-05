import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../services/auth';
import { useTheme } from '../context/theme';
import { formatPrice } from '../../../../shared/utils/currency';
import { WaiterPOS } from '../components/WaiterPOS';

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
  const { user, token, logout, updateUser, _pushStatus, _enablePush } = useAuth() as any;
  const { mode, setMode } = useTheme();
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [showPOS, setShowPOS] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'tables'>('tasks');
  const queryClient = useQueryClient();
  const tablesRef = useRef<any[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineSnapshotTs, setOfflineSnapshotTs] = useState<number | null>(null);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [billModal, setBillModal] = useState<{
    sessionId: string;
    tableLabel: string;
    data: any | null;
    loading: boolean;
  } | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Manual order entry
  const [orderModal, setOrderModal] = useState<{
    tableId: string;
    tableLabel: string;
    organizationId: string;
    branchId: string;
  } | null>(null);

  const [menu, setMenu] = useState<{
    categories: {
      id: string;
      name: string;
      items: {
        id: string;
        name: string;
        price: number;
        description?: string;
      }[];
    }[];
  }>({ categories: [] });

  const [menuLoading, setMenuLoading] = useState(false);

  const [cart, setCart] = useState<
    Record<string, { name: string; price: number; quantity: number }>
  >({});

  const [orderNotes, setOrderNotes] = useState('');
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState('');

  // Add-items-to-existing-order modal
  const [addItemsModal, setAddItemsModal] = useState<{
    orderId: string;
    tableLabel: string;
  } | null>(null);
  const [addItemsCart, setAddItemsCart] = useState<
    Record<string, { name: string; price: number; quantity: number; notes: string }>
  >({});
  const [addItemsSubmitting, setAddItemsSubmitting] = useState(false);
  const [addItemsError, setAddItemsError] = useState('');

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'scan' | 'pick'>('scan');
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [sectionOnly, setSectionOnly] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [attachingTable, setAttachingTable] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [pendingAttach, setPendingAttach] = useState<{ orgId: string; tableId: string } | null>(
    null,
  );
  const [handoverConfirm, setHandoverConfirm] = useState<{
    orgId: string;
    tableId: string;
    waiterName: string;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

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
      data.table?.section ?? tablesRef.current.find((t: any) => t.id === tableId)?.section ?? null;
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

  const { data: tablesData } = useQuery({
    queryKey: ['waiter-tables', user?.organizationId, userBranchId],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cacheKey = waiterSnapshotKey({
          organizationId: user?.organizationId,
          branchId: userBranchId,
          userId,
        });
        if (cacheKey) {
          const snap = readWaiterSnapshot(cacheKey);
          if (snap) return snap.tables;
        }
      }
      const h = { Authorization: `Bearer ${tokenRef.current}` };
      const bq = userBranchId ? `?branchId=${userBranchId}` : '';
      const res = await fetch(`${API_BASE}/api/tables?_=${Date.now()}${bq}`, { headers: h });
      if (!res.ok) throw new Error('Network error');
      const json = await res.json();
      const tables = json.success ? json.data : [];

      const cacheKey = waiterSnapshotKey({
        organizationId: user?.organizationId,
        branchId: userBranchId,
        userId,
      });
      if (cacheKey) {
        const snap = readWaiterSnapshot(cacheKey);
        writeWaiterSnapshot(cacheKey, { ts: Date.now(), tables, tasks: snap?.tasks || [] });
      }

      return tables;
    },
    enabled: !!token,
    staleTime: 5000,
  });

  const { data: tasksData, refetch: refetchTasks } = useQuery({
    queryKey: ['waiter-tasks', user?.organizationId, userBranchId, userId],
    queryFn: async () => {
      if (isWaiter && !isOnShift) {
        setOfflineSnapshotTs(null);
        return { myTasks: [], unassignedTasks: [] };
      }

      if (!navigator.onLine) {
        const cacheKey = waiterSnapshotKey({
          organizationId: user?.organizationId,
          branchId: userBranchId,
          userId,
        });
        if (cacheKey) {
          const snap = readWaiterSnapshot(cacheKey);
          if (snap) {
            setOfflineSnapshotTs(snap.ts);
            return {
              myTasks: snap.tasks.filter((t) => t.assignedTo === userId),
              unassignedTasks: snap.tasks.filter((t) => t.assignedTo === null),
            };
          }
        }
      }

      const h = { Authorization: `Bearer ${tokenRef.current}` };
      const bq = userBranchId ? `?branchId=${userBranchId}` : '';
      const res = await fetch(`${API_BASE}/api/waiter-tasks${bq}`, { headers: h });
      if (!res.ok) throw new Error('Network error');
      const json = await res.json();

      const allTasks: TaskItem[] = [];
      if (json.success) {
        const { mine, unassigned } = json.data;
        mine.waiterCalls.forEach((c: any) => allTasks.push(normaliseTask('WAITER_CALL', c)));
        mine.serviceRequests.forEach((s: any) =>
          allTasks.push(normaliseTask('SERVICE_REQUEST', s)),
        );
        mine.readyOrders.forEach((o: any) => allTasks.push(normaliseTask('ORDER_READY', o)));

        unassigned.waiterCalls.forEach((c: any) => allTasks.push(normaliseTask('WAITER_CALL', c)));
        unassigned.serviceRequests.forEach((s: any) =>
          allTasks.push(normaliseTask('SERVICE_REQUEST', s)),
        );
        unassigned.readyOrders.forEach((o: any) => allTasks.push(normaliseTask('ORDER_READY', o)));
      }

      const uniqueTasks = Array.from(new Map(allTasks.map((t) => [t.id, t])).values());
      const cacheKey = waiterSnapshotKey({
        organizationId: user?.organizationId,
        branchId: userBranchId,
        userId,
      });
      if (cacheKey) {
        const snap = readWaiterSnapshot(cacheKey);
        writeWaiterSnapshot(cacheKey, {
          ts: Date.now(),
          tables: snap?.tables || [],
          tasks: uniqueTasks,
        });
      }
      setOfflineSnapshotTs(null);

      return {
        myTasks: uniqueTasks.filter((t) => t.assignedTo === userId),
        unassignedTasks: uniqueTasks.filter((t) => t.assignedTo === null),
      };
    },
    enabled: !!token,
    staleTime: 5000,
  });

  const tables = tablesData || [];
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);
  const myTasks = tasksData?.myTasks || [];
  const unassignedTasks = tasksData?.unassignedTasks || [];

  const refreshNow = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['waiter-tables'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, queryClient]);

  const refreshNowRef = useRef(refreshNow);
  useEffect(() => {
    refreshNowRef.current = refreshNow;
  }, [refreshNow]);

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
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    });

    // Task available for anyone to claim
    socket.on('TASK_UNASSIGNED', ({ type, task }: { type: TaskItem['type']; task: any }) => {
      if (isWaiter && !onShiftRef.current) return;
      playAlert();
      const normalised = normaliseTask(type, task);
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    });

    // Another waiter claimed a task — remove from unassigned pool
    socket.on('TASK_CLAIMED', ({ task }: { task: any }) => {
      if (isWaiter && !onShiftRef.current) return;
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    });

    // Task resolved (by anyone) — remove from all lists
    socket.on('WAITER_CALL_UPDATED', (call: any) => {
      if (isWaiter && !onShiftRef.current) return;
      if (call.status === 'RESOLVED') {
        queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
      }
    });
    socket.on('SERVICE_REQUEST_UPDATED', (req: any) => {
      if (isWaiter && !onShiftRef.current) return;
      if (req.status === 'RESOLVED') {
        queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
      }
    });
    socket.on('ORDER_UPDATED', (order: any) => {
      if (isWaiter && !onShiftRef.current) return;
      if (order.status === 'SERVED' || order.status === 'CANCELLED') {
        queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
      }
    });

    socket.on('TABLE_STATUS_CHANGED', ({ tableId, status }) => {
      queryClient.invalidateQueries({ queryKey: ['waiter-tables'] });
    });

    socket.on('SESSION_OPENED', ({ tableId, sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['waiter-tables'] });
    });

    socket.on('SESSION_CLOSED', ({ tableId }) => {
      queryClient.invalidateQueries({ queryKey: ['waiter-tables'] });
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    });

    const handleSyncRequired = () => {
      const now = Date.now();
      // Throttle syncs to prevent "refresh loops"
      if (now - lastSyncAtRef.current < 5000) return;
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
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
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
      queryClient.setQueryData(['waiter-tasks', user?.organizationId, user?.branchId, userId], {
        myTasks: [],
        unassignedTasks: [],
      });
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

  // Reset modal state on open; stop camera on close
  /* eslint-disable */
  useEffect(() => {
    if (scannerOpen) {
      setScanMode('scan');
      setScanResult(null);
      setTableSearch('');
      setAttachError('');
      setCameraError('');
      setPendingAttach(null);
    } else {
      stopCamera();
    }
  }, [scannerOpen]);
  /* eslint-enable */

  useEffect(() => {
    return () => stopCamera();
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

  // Background Heartbeat Sync
  useEffect(() => {
    if (!token || !isOnShift) return;

    // Periodic refresh every 60 seconds as a fallback for missed socket events
    const interval = setInterval(() => {
      if (navigator.onLine) {
        refreshNowRef.current().catch(() => void 0);
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [token, isOnShift]);

  async function fetchMenu(organizationId: string, branchId: string) {
    setMenuLoading(true);
    setMenu({ categories: [] });
    try {
      const url = new URL(`${API_BASE}/api/menu/public/${organizationId}`, window.location.origin);
      url.searchParams.set('branchId', branchId);
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.success) {
        // data.data is an array of categories each with menuItems
        setMenu({
          categories: (data.data ?? [])
            .map((cat: any) => ({
              id: cat.id,
              name: cat.name,
              items: (cat.menuItems ?? [])
                .filter((item: any) => item.isAvailable)
                .map((item: any) => ({
                  id: item.id,
                  name: item.name,
                  price: Number(item.price),
                  description: item.description,
                })),
            }))
            .filter((cat: any) => cat.items.length > 0),
        });
      }
    } catch {
      void 0;
    } finally {
      setMenuLoading(false);
    }
  }

  function openOrderModal(table: { id: string; label: string }) {
    if (!user?.organizationId || !user?.branchId) return;
    setCart({});
    setOrderNotes('');
    setOrderError('');
    setOrderModal({
      tableId: table.id,
      tableLabel: table.label,
      organizationId: user.organizationId,
      branchId: user.branchId,
    });
    void fetchMenu(user.organizationId, user.branchId);
  }

  function addToCart(item: { id: string; name: string; price: number }) {
    setCart((prev) => ({
      ...prev,
      [item.id]: {
        name: item.name,
        price: item.price,
        quantity: (prev[item.id]?.quantity ?? 0) + 1,
      },
    }));
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const next = { ...prev };
      if (next[itemId] && next[itemId].quantity > 1) {
        next[itemId] = { ...next[itemId], quantity: next[itemId].quantity - 1 };
      } else {
        delete next[itemId];
      }
      return next;
    });
  }

  const cartTotal = Object.values(cart).reduce((sum, item) => sum + item.price * item.quantity, 0);

  const cartItemCount = Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);

  async function submitOrder() {
    if (!orderModal) return;
    if (cartItemCount === 0) {
      setOrderError('Add at least one item');
      return;
    }
    setOrderSubmitting(true);
    setOrderError('');

    try {
      const idempotencyKey = `waiter-${user?.id}-${orderModal.tableId}-${Date.now()}`;

      const body = {
        organizationId: orderModal.organizationId,
        tableId: orderModal.tableId,
        branchId: orderModal.branchId,
        idempotencyKey,
        notes: orderNotes || undefined,
        items: Object.entries(cart).map(([menuItemId, item]) => ({
          menuItemId,
          quantity: item.quantity,
        })),
      };

      const res = await fetch(`${API_BASE}/api/orders/public`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass waiter auth so the order is tagged as staff-entered
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        setOrderModal(null);
        setCart({});
        setOrderNotes('');
        // Refresh tasks to pick up the new order
        refreshNowRef.current().catch(() => void 0);
      } else {
        setOrderError(data.error ?? 'Failed to place order');
      }
    } catch {
      setOrderError('Network error. Please try again.');
    } finally {
      setOrderSubmitting(false);
    }
  }

  async function openAddItemsForTable(table: { id: string; label: string }) {
    if (!user?.organizationId || !user?.branchId) return;
    // Fetch the most recent RECEIVED/PREPARING order for this table
    try {
      const res = await fetch(
        `${API_BASE}/api/orders?status=RECEIVED&status=PREPARING&tableId=${table.id}&limit=1`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const data = await res.json();
      const orders = data?.data ?? [];
      if (orders.length === 0) {
        // No active order — fall back to new order modal
        openOrderModal({ id: table.id, label: table.label });
        return;
      }
      setAddItemsCart({});
      setAddItemsError('');
      setAddItemsModal({ orderId: orders[0].id, tableLabel: table.label });
      void fetchMenu(user.organizationId, user.branchId);
    } catch {
      openOrderModal({ id: table.id, label: table.label });
    }
  }

  async function submitAddItems() {
    if (!addItemsModal) return;
    const items = Object.entries(addItemsCart)
      .filter(([, v]) => v.quantity > 0)
      .map(([menuItemId, v]) => ({
        menuItemId,
        quantity: v.quantity,
        notes: v.notes || undefined,
      }));
    if (items.length === 0) {
      setAddItemsError('Add at least one item');
      return;
    }
    setAddItemsSubmitting(true);
    setAddItemsError('');
    try {
      const res = await fetch(`${API_BASE}/api/orders/${addItemsModal.orderId}/add-items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.success) {
        setAddItemsModal(null);
        setAddItemsCart({});
        refreshNowRef.current().catch(() => void 0);
      } else {
        setAddItemsError(data.error ?? 'Failed to add items');
      }
    } catch {
      setAddItemsError('Network error. Please try again.');
    } finally {
      setAddItemsSubmitting(false);
    }
  }

  function stopCamera() {
    if (scanFrameRef.current) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
  }

  async function startCamera() {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      // Start QR detection loop — uses BarcodeDetector if available
      if (!('BarcodeDetector' in window)) {
        setCameraError('no-detector');
        return;
      }
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!videoRef.current || !cameraStreamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            stopCamera();
            await attachToTableByQR(codes[0].rawValue);
            return;
          }
        } catch {
          // frame decode error — keep going
        }
        scanFrameRef.current = requestAnimationFrame(scan);
      };
      scanFrameRef.current = requestAnimationFrame(scan);
    } catch (err: any) {
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access and try again.'
          : err?.name === 'NotFoundError'
            ? 'No camera found on this device.'
            : 'Could not start camera.';
      setCameraError(msg);
    }
  }

  async function attachToTableById(orgId: string, tableId: string, force = false) {
    setAttachingTable(true);
    setAttachError('');
    try {
      const res = await fetch(
        `${API_BASE}/api/tables/public/${orgId}/${tableId}/attach-waiter${force ? '?force=true' : ''}`,
        { method: 'POST', headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const data = await res.json();
      setAttachingTable(false);
      if (data.success) {
        refreshNowRef.current().catch(() => void 0);
        setHandoverConfirm(null);
        setPendingAttach(null);
        setScannerOpen(false);
        setScanResult(null);
        return { success: true };
      }
      if (data.error === 'ALREADY_CLAIMED') {
        setHandoverConfirm({ orgId, tableId, waiterName: data.currentWaiter });
        return { success: false, error: 'ALREADY_CLAIMED' };
      }
      setAttachError(data.error ?? 'Failed to claim table');
      return { success: false, error: data.error ?? 'Failed to attach' };
    } catch {
      setAttachingTable(false);
      setAttachError('Network error. Please try again.');
      return { success: false, error: 'Network error' };
    }
  }

  async function attachToTableByQR(qrUrl: string, force = false) {
    try {
      const url = new URL(qrUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'menu' || parts.length < 3) {
        setAttachError('Not a valid Cevop QR code');
        return { success: false, error: 'Not a valid Cevop QR code' };
      }
      const [, orgId, tableId] = parts;
      setPendingAttach({ orgId, tableId });
      return await attachToTableById(orgId, tableId, force);
    } catch {
      setAttachError('Invalid QR code');
      return { success: false, error: 'Invalid QR code' };
    }
  }

  async function resolveTask(task: TaskItem) {
    if (updatingItems.has(task.id)) return;
    setUpdatingItems((prev) => new Set(prev).add(task.id));

    await queryClient.cancelQueries({ queryKey: ['waiter-tasks'] });
    const previous = queryClient.getQueryData(['waiter-tasks']);
    queryClient.setQueryData(['waiter-tasks'], (old: any) => {
      if (!old?.data) return old;
      return {
        ...old,
        data: old.data.map((t: any) =>
          t.id === task.id
            ? { ...t, status: task.type === 'ORDER_READY' ? 'SERVED' : 'RESOLVED' }
            : t,
        ),
      };
    });

    try {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` };

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
      if (!res.ok && previous) {
        queryClient.setQueryData(['waiter-tasks'], previous);
      }
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    } catch {
      if (previous) queryClient.setQueryData(['waiter-tasks'], previous);
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(task.id);
        return n;
      });
    }
  }

  async function fetchBill(sessionId: string, tableLabel: string) {
    setBillModal({ sessionId, tableLabel, data: null, loading: true });
    setPaymentMethod('CASH');
    setPaymentError('');
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/bill`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      const data = await res.json();
      if (data.success) {
        setBillModal({ sessionId, tableLabel, data: data.data, loading: false });
      } else {
        setBillModal(null);
      }
    } catch {
      setBillModal(null);
    }
  }

  async function submitPayment() {
    if (!billModal?.data || paymentSubmitting) return;
    setPaymentSubmitting(true);
    setPaymentError('');

    try {
      const res = await fetch(`${API_BASE}/api/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({
          sessionId: billModal.sessionId,
          amount: billModal.data.balance,
          method: paymentMethod,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setBillModal(null);
        // Refresh everything to reflect closed table
        refreshNowRef.current().catch(() => void 0);
      } else {
        setPaymentError(data.error || 'Failed to record payment');
      }
    } catch {
      setPaymentError('Network error. Please try again.');
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function claimTask(task: TaskItem) {
    if (updatingItems.has(task.id)) return;
    setUpdatingItems((prev) => new Set(prev).add(task.id));

    await queryClient.cancelQueries({ queryKey: ['waiter-tasks'] });
    const previous = queryClient.getQueryData(['waiter-tasks']);
    queryClient.setQueryData(['waiter-tasks'], (old: any) => {
      if (!old?.data) return old;
      return {
        ...old,
        data: old.data.map((t: any) => (t.id === task.id ? { ...t, assignedTo: user?.id } : t)),
      };
    });

    try {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` };

      const url =
        task.type === 'WAITER_CALL'
          ? `${API_BASE}/api/waiter-calls/${task.id}/claim`
          : task.type === 'SERVICE_REQUEST'
            ? `${API_BASE}/api/service-requests/${task.id}/claim`
            : `${API_BASE}/api/orders/${task.id}/claim`;

      const res = await fetch(url, { method: 'PATCH', headers: h });
      if (!res.ok) {
        if (previous) queryClient.setQueryData(['waiter-tasks'], previous);
        if (res.status === 404) {
          queryClient.invalidateQueries({ queryKey: ['waiter-tables'] });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    } catch {
      if (previous) queryClient.setQueryData(['waiter-tasks'], previous);
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

    await queryClient.cancelQueries({ queryKey: ['waiter-tables'] });
    const previous = queryClient.getQueryData(['waiter-tables']);
    queryClient.setQueryData(['waiter-tables'], (old: any) => {
      if (!old?.data) return old;
      return {
        ...old,
        data: old.data.map((t: any) =>
          t.activeSession?.id === sessionId ? { ...t, status: 'CLEANING', activeSession: null } : t,
        ),
      };
    });

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/close`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ nextStatus: 'CLEANING' }),
      });
      if (!res.ok && previous) {
        queryClient.setQueryData(['waiter-tables'], previous);
      }
      queryClient.invalidateQueries({ queryKey: ['waiter-tables'] });
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
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

    await queryClient.cancelQueries({ queryKey: ['waiter-tables'] });
    const previous = queryClient.getQueryData(['waiter-tables']);
    queryClient.setQueryData(['waiter-tables'], (old: any) => {
      if (!old?.data) return old;
      return {
        ...old,
        data: old.data.map((t: any) => (t.id === tableId ? { ...t, status: 'EMPTY' } : t)),
      };
    });

    try {
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ status: 'EMPTY' }),
      });
      if (!res.ok && previous) {
        queryClient.setQueryData(['waiter-tables'], previous);
      }
      queryClient.invalidateQueries({ queryKey: ['waiter-tables'] });
      queryClient.invalidateQueries({ queryKey: ['waiter-tasks'] });
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(tableId);
        return n;
      });
    }
  }

  async function openTable(tableId: string) {
    if (!user?.organizationId) return;
    if (updatingItems.has(tableId)) return;
    setUpdatingItems((prev) => new Set(prev).add(tableId));
    try {
      const res = await fetch(
        `${API_BASE}/api/tables/public/${user.organizationId}/${tableId}/attach-waiter`,
        { method: 'POST', headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const data = await res.json();
      if (data.success) {
        refreshNowRef.current().catch(() => void 0);
      } else if (data.error === 'ALREADY_CLAIMED') {
        setHandoverConfirm({ orgId: user.organizationId, tableId, waiterName: data.currentWaiter });
      }
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(tableId);
        return n;
      });
    }
  }

  async function claimTable(sessionId: string) {
    if (updatingItems.has(sessionId)) return;
    setUpdatingItems((prev) => new Set(prev).add(sessionId));
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/claim`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (res.ok) {
        refreshNowRef.current().catch(() => void 0);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to claim table');
      }
    } finally {
      setUpdatingItems((prev) => {
        const n = new Set(prev);
        n.delete(sessionId);
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

        {task.details === 'BILL_REQUEST' && task.originalData?.sessionId ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              fetchBill(task.originalData.sessionId, task.tableLabel);
            }}
            disabled={isUpdating}
            className="w-full text-xs py-3 font-bold tracking-widest border border-amber-500/50 text-amber-500 hover:bg-amber-500/10 transition-all uppercase font-display mt-2"
          >
            {isUpdating ? 'UPDATING...' : 'View Bill'}
          </button>
        ) : (
          <button
            onClick={action}
            disabled={isUpdating}
            className="w-full text-xs py-2 font-bold tracking-wider border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black hover:border-[var(--accent)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUpdating ? 'UPDATING...' : actionLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-[var(--bg)] overflow-hidden relative">
      {showPOS && (
        <WaiterPOS
          onClose={() => setShowPOS(false)}
          onOrderSuccess={() => {
            setShowPOS(false);
            refreshNow().catch(() => void 0);
          }}
        />
      )}
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
      <header className="flex flex-col sm:flex-row items-center justify-between px-2 sm:px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 gap-1.5 overflow-hidden relative z-20">
        <div className="flex items-center justify-between w-full sm:w-auto gap-1.5 sm:gap-3 min-w-0 shrink">
          <h1 className="text-sm sm:text-2xl flex items-center gap-2 shrink-0">
            <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-md" />
            <span className="font-display hidden xxs:inline text-[var(--accent)]">WAITER</span>
          </h1>
          <div className="flex items-center gap-1.5">
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
            <button
              onClick={logout}
              className="sm:hidden text-[9px] text-[var(--muted)] border border-[var(--border)] px-2 py-1 rounded-full font-bold"
            >
              OUT
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-1 sm:gap-3 shrink-0">
          <div className="flex flex-col items-end hidden lg:flex">
            <span className="text-[var(--text)] text-[10px] sm:text-xs font-bold truncate max-w-[150px]">
              {user?.name}
            </span>
            <span className="text-[var(--muted)] text-[9px] sm:text-[10px] truncate max-w-[150px]">
              {user?.organization?.name}
              {user?.branch ? ` — ${user.branch.name}` : ''}
            </span>
          </div>

          <button
            onClick={() => setShowPOS(true)}
            className="text-[9px] sm:text-xs bg-[var(--accent)] text-black px-2.5 sm:px-5 py-1.5 sm:py-2 font-bold tracking-tight rounded-full font-display hover:brightness-110 transition-all shadow-lg shadow-[var(--accent)]/10 flex items-center gap-1"
          >
            <span className="text-xs">+</span>
            ORDER
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => refreshNow().catch(() => void 0)}
              disabled={refreshing}
              className="text-[9px] sm:text-xs border border-[var(--border)] px-2 sm:px-3 py-1 font-bold tracking-tight disabled:opacity-50 whitespace-nowrap rounded-full font-display text-[var(--muted)] hover:text-[var(--text)]"
            >
              {refreshing ? '...' : '⟳'}
            </button>

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
              className="hidden sm:block text-[9px] sm:text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-2 sm:px-3 py-1 shrink-0 rounded-full font-bold font-display"
            >
              OUT
            </button>
          </div>
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
        <div className="flex-1 flex flex-col min-h-0">
          {/* Tables tab header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
            <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
              Your Tables
            </p>
            <button
              disabled={attachingTable}
              onClick={() => setScannerOpen(true)}
              className="text-[10px] sm:text-xs border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] px-3 py-1.5 cursor-pointer transition-colors font-bold uppercase tracking-widest rounded-sm"
            >
              {attachingTable ? 'Attaching…' : 'Scan QR'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 content-start">
            {isWaiter && !isOnShift && (
              <div className="col-span-full text-center text-[var(--muted)] text-sm pt-8">
                Start shift to manage tables
              </div>
            )}
            {(!isWaiter || isOnShift) &&
              tables
                .filter((t: any) => t.isActive)
                .map((t: any) => (
                  <div
                    key={t.id}
                    className={`border p-3 space-y-3 flex flex-col justify-between transition-all ${
                      t.isMine
                        ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]'
                        : ''
                    } ${
                      t.status === 'EMPTY'
                        ? 'border-[var(--border)] bg-[var(--surface2)]'
                        : t.status === 'OCCUPIED'
                          ? 'border-[var(--preparing)] bg-[var(--surface2)]'
                          : 'border-[var(--accent)] bg-[var(--surface2)]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <div className="font-bold text-lg text-[var(--text)] truncate">
                          {t.label}
                        </div>
                        {t.isMine && (
                          <span className="text-[10px] bg-[var(--accent)] text-black px-1.5 py-0.5 font-bold uppercase tracking-widest rounded-sm shrink-0">
                            MINE
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-[10px] font-bold tracking-widest uppercase mt-1 ${
                          t.status === 'EMPTY'
                            ? 'text-[var(--muted)]'
                            : t.status === 'OCCUPIED'
                              ? 'text-[var(--preparing)]'
                              : 'text-[var(--accent)]'
                        }`}
                      >
                        {t.status}
                        {t.activeSession?.assignedWaiter && (
                          <span className="ml-2 px-1.5 py-0.5 bg-[var(--surface3)] text-[var(--muted)] rounded-sm lowercase text-[9px] border border-[var(--border)]">
                            👤{' '}
                            {t.activeSession.assignedWaiter.name?.split(' ')[0] ||
                              t.activeSession.assignedWaiter.staffCode}
                          </span>
                        )}
                      </div>
                    </div>
                    {t.activeSessionId ? (
                      <div className="space-y-2">
                        {(!t.activeSession?.assignedWaiter ||
                          t.activeSession?.assignedWaiter?.id !== user?.id) && (
                          <button
                            onClick={() => claimTable(t.activeSessionId!)}
                            disabled={updatingItems.has(t.activeSessionId!)}
                            className="w-full text-[10px] py-1.5 font-bold tracking-wider bg-[var(--accent)] text-black hover:brightness-110 transition-all uppercase"
                          >
                            {updatingItems.has(t.activeSessionId!) ? 'CLAIMING...' : 'Claim Table'}
                          </button>
                        )}
                        <button
                          onClick={() => fetchBill(t.activeSessionId!, t.label)}
                          className="w-full text-[10px] py-1.5 font-bold tracking-wider border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 transition-all uppercase"
                        >
                          View Bill
                        </button>
                        <button
                          onClick={() => clearTable(t.activeSessionId!)}
                          disabled={updatingItems.has(t.activeSessionId!)}
                          className="w-full text-[10px] py-1.5 font-bold tracking-wider border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-50 uppercase"
                        >
                          {updatingItems.has(t.activeSessionId!) ? 'CLEARING...' : 'CLEAR TABLE'}
                        </button>
                      </div>
                    ) : t.status === 'CLEANING' ? (
                      <button
                        onClick={() => markTableEmpty(t.id)}
                        disabled={updatingItems.has(t.id)}
                        className="w-full text-xs py-2 font-bold tracking-wider border border-[var(--border)] hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-50"
                      >
                        {updatingItems.has(t.id) ? 'UPDATING...' : 'MARK CLEAN'}
                      </button>
                    ) : null}
                    {t.status === 'OCCUPIED' && (
                      <div className="mt-2 space-y-1.5">
                        <button
                          onClick={() => openAddItemsForTable({ id: t.id, label: t.label })}
                          className="w-full text-[10px] py-1.5 font-bold tracking-wider border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-all uppercase"
                        >
                          + Add to Order
                        </button>
                        <button
                          onClick={() => openOrderModal({ id: t.id, label: t.label })}
                          className="w-full text-[10px] py-1.5 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
                        >
                          + New Round
                        </button>
                      </div>
                    )}
                    {t.status === 'EMPTY' && (
                      <div className="mt-2 space-y-1.5">
                        <button
                          onClick={() => openTable(t.id)}
                          disabled={updatingItems.has(t.id)}
                          className="w-full text-[10px] py-2 font-bold tracking-wider bg-[var(--accent)] text-black hover:brightness-110 transition-all uppercase disabled:opacity-50"
                        >
                          {updatingItems.has(t.id) ? 'Opening…' : 'Open Table'}
                        </button>
                        <button
                          onClick={() => openOrderModal({ id: t.id, label: t.label })}
                          className="w-full text-xs border border-[var(--border)] text-[var(--muted)] py-1.5 hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
                        >
                          + Start Order
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            {(!isWaiter || isOnShift) && tables.filter((t: any) => t.isActive).length === 0 && (
              <div className="col-span-full text-center text-[var(--muted)] text-sm pt-8">
                No tables found
              </div>
            )}
          </div>
        </div>
      )}

      {scannerOpen &&
        (() => {
          // Derive section IDs the waiter belongs to (tables marked isMine with a section,
          // where the session isn't claimed by someone — i.e. the isMine comes from section assignment)
          const waiterSectionIds = new Set<string>(
            tables
              .filter((t: any) => t.isMine && t.section && !t.activeSession?.assignedWaiter)
              .map((t: any) => t.section.id as string),
          );
          const hasSection = waiterSectionIds.size > 0;

          const activeTables = tables.filter((t: any) => t.isActive);
          const sectionTables = hasSection
            ? activeTables.filter((t: any) => t.section && waiterSectionIds.has(t.section.id))
            : activeTables;

          const displayTables = (sectionOnly && hasSection ? sectionTables : activeTables).filter(
            (t: any) => {
              if (!tableSearch.trim()) return true;
              const q = tableSearch.toLowerCase();
              return t.label?.toLowerCase().includes(q) || String(t.number ?? '').includes(q);
            },
          );

          return (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center">
              <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-sm shadow-2xl flex flex-col max-h-[90dvh] sm:max-h-[80dvh] rounded-t-2xl sm:rounded-none">
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                  <p className="font-display font-bold text-lg text-[var(--text)] tracking-tight">
                    CLAIM TABLE
                  </p>
                  <button
                    onClick={() => {
                      stopCamera();
                      setScannerOpen(false);
                      setScanResult(null);
                      setScanMode('scan');
                      setTableSearch('');
                      setAttachError('');
                      setCameraError('');
                    }}
                    className="text-[var(--muted)] text-2xl leading-none hover:text-[var(--text)] transition-colors w-8 h-8 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>

                {/* Mode tabs */}
                <div className="flex border-b border-[var(--border)] mx-5 shrink-0">
                  {(['scan', 'pick'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        if (m !== scanMode) {
                          if (m !== 'scan') stopCamera();
                          setScanMode(m);
                          setAttachError('');
                          setCameraError('');
                        }
                      }}
                      className={`flex-1 py-2.5 text-xs font-bold tracking-widest uppercase transition-all ${
                        scanMode === m
                          ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {m === 'scan' ? 'Scan QR' : 'Pick Table'}
                    </button>
                  ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
                  {scanMode === 'scan' ? (
                    <div className="space-y-4">
                      {/* Camera viewfinder */}
                      {!cameraActive && !cameraError && (
                        <button
                          onClick={startCamera}
                          className="w-full aspect-square border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] flex flex-col items-center justify-center gap-3 transition-colors group"
                        >
                          <div className="w-14 h-14 border-2 border-[var(--muted)] group-hover:border-[var(--accent)] flex items-center justify-center transition-colors">
                            <svg
                              width="28"
                              height="28"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              className="text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors"
                            >
                              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                              <circle cx="12" cy="13" r="4" />
                            </svg>
                          </div>
                          <span className="text-xs font-bold text-[var(--muted)] group-hover:text-[var(--accent)] uppercase tracking-widest transition-colors">
                            Tap to open camera
                          </span>
                        </button>
                      )}

                      {cameraActive && (
                        <div className="relative w-full aspect-square bg-black overflow-hidden">
                          <video
                            ref={videoRef}
                            muted
                            playsInline
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          {/* Scan frame overlay */}
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="relative w-3/5 aspect-square">
                              <span className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-[var(--accent)]" />
                              <span className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-[var(--accent)]" />
                              <span className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-[var(--accent)]" />
                              <span className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-[var(--accent)]" />
                            </div>
                          </div>
                          <p className="absolute bottom-3 left-0 right-0 text-center text-[10px] text-white/70 font-bold tracking-widest uppercase">
                            Point at table QR code
                          </p>
                        </div>
                      )}

                      {/* BarcodeDetector not available — show file capture fallback */}
                      {cameraError === 'no-detector' && (
                        <div className="space-y-3">
                          <p className="text-xs text-[var(--muted)]">
                            Live scan isn't supported on this browser. Take a photo of the QR code
                            instead.
                          </p>
                          <label className="w-full py-3 border border-[var(--border)] text-[var(--muted)] text-xs font-bold uppercase tracking-widest flex items-center justify-center cursor-pointer hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
                            Take Photo
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="sr-only"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                // Read as image and try BarcodeDetector
                                const img = new Image();
                                img.src = URL.createObjectURL(file);
                                img.onload = async () => {
                                  if (!('BarcodeDetector' in window)) {
                                    setAttachError(
                                      'QR scanning not supported. Use "Pick Table" instead.',
                                    );
                                    return;
                                  }
                                  try {
                                    const detector = new (window as any).BarcodeDetector({
                                      formats: ['qr_code'],
                                    });
                                    const codes = await detector.detect(img);
                                    if (codes.length > 0) {
                                      await attachToTableByQR(codes[0].rawValue);
                                    } else {
                                      setAttachError(
                                        'No QR code found in photo. Try again or use Pick Table.',
                                      );
                                    }
                                  } catch {
                                    setAttachError(
                                      'Could not read QR code. Try Pick Table instead.',
                                    );
                                  }
                                };
                              }}
                            />
                          </label>
                        </div>
                      )}

                      {/* Camera permission / other errors */}
                      {cameraError && cameraError !== 'no-detector' && (
                        <div className="space-y-3">
                          <p className="text-xs text-[var(--danger)]">{cameraError}</p>
                          <button
                            onClick={() => {
                              setCameraError('');
                              setScanMode('pick');
                            }}
                            className="text-xs text-[var(--accent)] underline"
                          >
                            Pick table manually instead
                          </button>
                        </div>
                      )}

                      {/* Paste URL fallback (always shown below camera) */}
                      <div className="space-y-2">
                        <p className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-bold">
                          Or paste QR link
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            className="flex-1 bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--text)] px-3 py-2 placeholder-[var(--muted)] focus:border-[var(--accent)] outline-none transition-colors min-w-0"
                            placeholder="https://order.cevop.com/menu/..."
                            value={scanResult ?? ''}
                            onChange={(e) => {
                              setScanResult(e.target.value);
                              setAttachError('');
                            }}
                          />
                          <button
                            className="px-4 py-2 bg-[var(--accent)] text-black font-bold text-xs disabled:opacity-50 shrink-0"
                            disabled={!scanResult || attachingTable}
                            onClick={() => {
                              if (scanResult) attachToTableByQR(scanResult);
                            }}
                          >
                            {attachingTable ? '...' : 'GO'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Pick Table mode */
                    <div className="space-y-3">
                      {/* Search */}
                      <input
                        type="search"
                        autoFocus
                        className="w-full bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--text)] px-3 py-2.5 placeholder-[var(--muted)] focus:border-[var(--accent)] outline-none transition-colors"
                        placeholder="Search table name or number…"
                        value={tableSearch}
                        onChange={(e) => setTableSearch(e.target.value)}
                      />

                      {/* Section filter toggle */}
                      {hasSection && (
                        <button
                          onClick={() => setSectionOnly((v) => !v)}
                          className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                            sectionOnly ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 border flex items-center justify-center transition-colors ${
                              sectionOnly
                                ? 'border-[var(--accent)] bg-[var(--accent)]/20'
                                : 'border-[var(--border)]'
                            }`}
                          >
                            {sectionOnly && <span className="w-1.5 h-1.5 bg-[var(--accent)]" />}
                          </span>
                          My section only
                        </button>
                      )}

                      {/* Table list */}
                      <div className="space-y-1.5">
                        {displayTables.length === 0 && (
                          <p className="text-center text-[var(--muted)] text-xs py-6">
                            {tableSearch ? 'No tables match your search' : 'No tables available'}
                          </p>
                        )}
                        {displayTables.map((t: any) => (
                          <button
                            key={t.id}
                            disabled={attachingTable}
                            onClick={() => {
                              if (!user?.organizationId) return;
                              // eslint-disable-next-line
                              attachToTableById(user.organizationId, t.id);
                            }}
                            className="w-full flex items-center justify-between px-3 py-3 border border-[var(--border)] hover:border-[var(--accent)] bg-[var(--surface2)] hover:bg-[var(--surface2)] transition-all text-left group disabled:opacity-50"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-[var(--text)]">
                                  {t.label}
                                </span>
                                {t.isMine && (
                                  <span className="text-[9px] bg-[var(--accent)] text-black px-1.5 py-0.5 font-bold uppercase rounded-sm">
                                    Mine
                                  </span>
                                )}
                              </div>
                              {t.section && (
                                <span
                                  className="text-[10px] font-bold"
                                  style={{ color: t.section.colour ?? 'var(--muted)' }}
                                >
                                  {t.section.name}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`text-[10px] font-bold uppercase tracking-wider ${
                                  t.status === 'OCCUPIED'
                                    ? 'text-[var(--warning)]'
                                    : t.status === 'EMPTY'
                                      ? 'text-[var(--muted)]'
                                      : 'text-[var(--accent)]'
                                }`}
                              >
                                {t.status}
                              </span>
                              {attachingTable && pendingAttach?.tableId === t.id ? (
                                <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <span className="text-[var(--muted)] group-hover:text-[var(--accent)] text-xs transition-colors">
                                  →
                                </span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {attachError && (
                    <p className="text-xs text-[var(--danger)] font-medium">{attachError}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {handoverConfirm && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] p-6 w-full max-w-sm space-y-5 shadow-2xl">
            <div className="space-y-2">
              <h3 className="font-display text-xl font-bold text-[var(--text)]">Table Occupied</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                This table is currently assigned to{' '}
                <span className="text-[var(--text)] font-bold">{handoverConfirm.waiterName}</span>.
                Do you want to transfer this table to your name?
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setHandoverConfirm(null)}
                className="py-3 border border-[var(--border)] text-[var(--muted)] font-bold text-xs uppercase tracking-widest hover:bg-[var(--surface2)] transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={attachingTable}
                onClick={async () => {
                  if (!handoverConfirm) return;
                  await attachToTableById(handoverConfirm.orgId, handoverConfirm.tableId, true);
                }}
                className="py-3 bg-[var(--accent)] text-black font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-colors disabled:opacity-50"
              >
                {attachingTable ? '...' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {billModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-sm max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <div>
                <p className="font-bold text-[var(--text)]">{billModal.tableLabel}</p>
                <p className="text-xs text-[var(--muted)]">Running Tab</p>
              </div>
              <button
                onClick={() => setBillModal(null)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-lg"
              >
                ×
              </button>
            </div>

            {billModal.loading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : billModal.data ? (
              <div className="p-4 space-y-4">
                {/* Orders */}
                {billModal.data.orders.map((order: any, i: number) => (
                  <div key={order.id}>
                    <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-1">
                      Round {i + 1} —{' '}
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {order.items.map((item: any) => (
                      <div
                        key={item.name + item.quantity}
                        className="flex justify-between text-sm py-0.5"
                      >
                        <span className="text-[var(--muted)]">
                          {item.quantity}× {item.name}
                        </span>
                        <span className="text-[var(--text)]">
                          {formatPrice(item.lineTotal, billModal.data.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Divider */}
                <div className="border-t border-[var(--border)] pt-3 space-y-4">
                  <div className="flex justify-between font-bold">
                    <span className="text-[var(--text)]">Total</span>
                    <span className="text-[var(--accent)] text-lg">
                      {formatPrice(billModal.data.grandTotal, billModal.data.currency)}
                    </span>
                  </div>

                  {billModal.data.amountPaid > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--muted)]">Paid</span>
                      <span className="text-[var(--success)]">
                        {formatPrice(billModal.data.amountPaid, billModal.data.currency)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between font-bold border-t border-[var(--border)] pt-2">
                    <span className="text-[var(--text)]">Balance</span>
                    <span className="text-[var(--accent)]">
                      {formatPrice(billModal.data.balance, billModal.data.currency)}
                    </span>
                  </div>

                  {billModal.data.balance > 0 && (
                    <div className="space-y-3 pt-2">
                      <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                        Payment Method
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['CASH', 'TRANSFER', 'CARD'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setPaymentMethod(m)}
                            className={`py-2 text-[10px] font-bold border transition-all ${
                              paymentMethod === m
                                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>

                      {paymentError && (
                        <p className="text-[10px] text-[var(--danger)] font-bold">{paymentError}</p>
                      )}

                      <button
                        onClick={submitPayment}
                        disabled={paymentSubmitting}
                        className="w-full bg-[var(--accent)] text-black font-bold py-3 text-xs tracking-widest uppercase hover:brightness-110 transition-all disabled:opacity-50"
                      >
                        {paymentSubmitting
                          ? 'PROCESSING...'
                          : `PAY ${formatPrice(billModal.data.balance, billModal.data.currency)}`}
                      </button>
                    </div>
                  )}

                  {!billModal.data.balance && (
                    <p className="text-center text-[var(--success)] font-bold text-xs py-2">
                      BILL FULLY PAID
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-center text-[var(--muted)] py-8 text-sm">Failed to load bill</p>
            )}
          </div>
        </div>
      )}

      {orderModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
            <div>
              <p className="font-bold text-[var(--text)]">{orderModal.tableLabel}</p>
              <p className="text-xs text-[var(--muted)]">Add order manually</p>
            </div>
            <button
              onClick={() => setOrderModal(null)}
              className="text-[var(--muted)] hover:text-[var(--text)] text-lg px-2"
            >
              ×
            </button>
          </div>

          {/* Body — scrollable menu */}
          <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
            {menuLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : menu.categories.length === 0 ? (
              <div className="text-center text-[var(--muted)] py-12 text-sm">
                No menu items available
              </div>
            ) : (
              <div className="p-4 space-y-6">
                {menu.categories.map((cat) => (
                  <div key={cat.id}>
                    <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-2">
                      {cat.name}
                    </p>
                    <div className="space-y-1">
                      {cat.items.map((item) => {
                        const inCart = cart[item.id];
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between py-2 border-b border-[var(--border)]/50"
                          >
                            <div className="flex-1 min-w-0 pr-3">
                              <p className="text-sm font-medium text-[var(--text)] truncate">
                                {item.name}
                              </p>
                              <p className="text-xs text-[var(--accent)]">
                                {formatPrice(
                                  item.price,
                                  (user?.organization as any)?.currency || 'NGN',
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {inCart ? (
                                <>
                                  <button
                                    onClick={() => removeFromCart(item.id)}
                                    className="w-7 h-7 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)] flex items-center justify-center text-lg leading-none"
                                  >
                                    −
                                  </button>
                                  <span className="text-sm font-bold w-4 text-center text-[var(--text)]">
                                    {inCart.quantity}
                                  </span>
                                  <button
                                    onClick={() => addToCart(item)}
                                    className="w-7 h-7 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 flex items-center justify-center text-lg leading-none"
                                  >
                                    +
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => addToCart(item)}
                                  className="w-7 h-7 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] flex items-center justify-center text-lg leading-none"
                                >
                                  +
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer — cart summary and submit */}
          {cartItemCount > 0 && (
            <div className="border-t border-[var(--border)] bg-[var(--surface)] p-4 flex-shrink-0 space-y-3">
              {/* Cart summary */}
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {Object.entries(cart).map(([, item]) => (
                  <div key={item.name} className="flex justify-between text-xs text-[var(--muted)]">
                    <span>
                      {item.quantity}× {item.name}
                    </span>
                    <span>
                      {formatPrice(
                        item.price * item.quantity,
                        (user?.organization as any)?.currency || 'NGN',
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Notes */}
              <input
                type="text"
                className="bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--text)] px-3 py-2 w-full placeholder-[var(--muted)]"
                placeholder="Order notes (optional)"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
              />

              {orderError && <p className="text-xs text-[var(--danger)]">{orderError}</p>}

              <div className="flex items-center gap-3">
                <div>
                  <p className="text-xs text-[var(--muted)]">Total</p>
                  <p className="font-bold text-[var(--accent)]">
                    {formatPrice(cartTotal, (user?.organization as any)?.currency || 'NGN')}
                  </p>
                </div>
                <button
                  className="flex-1 py-3 bg-[var(--accent)] text-black font-bold text-sm disabled:opacity-50"
                  onClick={() => void submitOrder()}
                  disabled={orderSubmitting}
                >
                  {orderSubmitting
                    ? 'Placing…'
                    : `Place Order — ${cartItemCount} item${cartItemCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Add Items to Existing Order Modal */}
      {addItemsModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
            <div>
              <p className="font-bold text-[var(--text)]">{addItemsModal.tableLabel}</p>
              <p className="text-xs text-[var(--muted)]">Add to current order</p>
            </div>
            <button
              onClick={() => setAddItemsModal(null)}
              className="text-[var(--muted)] hover:text-[var(--text)] text-lg px-2"
            >
              ×
            </button>
          </div>

          {/* Menu */}
          <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
            {menuLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : menu.categories.length === 0 ? (
              <div className="text-center text-[var(--muted)] py-12 text-sm">
                No menu items available
              </div>
            ) : (
              <div className="p-4 space-y-6">
                {menu.categories.map((cat) => (
                  <div key={cat.id}>
                    <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-2">
                      {cat.name}
                    </p>
                    <div className="space-y-1">
                      {cat.items.map((item) => {
                        const inCart = addItemsCart[item.id];
                        return (
                          <div key={item.id} className="space-y-1">
                            <div className="flex items-center justify-between py-2 border-b border-[var(--border)]/50">
                              <div className="flex-1 min-w-0 pr-3">
                                <p className="text-sm font-medium text-[var(--text)] truncate">
                                  {item.name}
                                </p>
                                <p className="text-xs text-[var(--accent)]">
                                  {formatPrice(
                                    item.price,
                                    (user?.organization as any)?.currency || 'NGN',
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {inCart ? (
                                  <>
                                    <button
                                      onClick={() =>
                                        setAddItemsCart((p) => {
                                          const n = { ...p };
                                          if (n[item.id].quantity > 1)
                                            n[item.id] = {
                                              ...n[item.id],
                                              quantity: n[item.id].quantity - 1,
                                            };
                                          else delete n[item.id];
                                          return n;
                                        })
                                      }
                                      className="w-7 h-7 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)] flex items-center justify-center text-lg leading-none"
                                    >
                                      −
                                    </button>
                                    <span className="text-sm font-bold w-4 text-center text-[var(--text)]">
                                      {inCart.quantity}
                                    </span>
                                    <button
                                      onClick={() =>
                                        setAddItemsCart((p) => ({
                                          ...p,
                                          [item.id]: {
                                            ...(p[item.id] || {
                                              name: item.name,
                                              price: item.price,
                                              notes: '',
                                            }),
                                            quantity: (p[item.id]?.quantity || 0) + 1,
                                          },
                                        }))
                                      }
                                      className="w-7 h-7 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 flex items-center justify-center text-lg leading-none"
                                    >
                                      +
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() =>
                                      setAddItemsCart((p) => ({
                                        ...p,
                                        [item.id]: {
                                          name: item.name,
                                          price: item.price,
                                          quantity: 1,
                                          notes: '',
                                        },
                                      }))
                                    }
                                    className="w-7 h-7 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] flex items-center justify-center text-lg leading-none"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </div>
                            {inCart && (
                              <input
                                type="text"
                                maxLength={200}
                                placeholder="Special instructions…"
                                value={inCart.notes}
                                onChange={(e) =>
                                  setAddItemsCart((p) => ({
                                    ...p,
                                    [item.id]: { ...p[item.id], notes: e.target.value },
                                  }))
                                }
                                className="w-full text-xs bg-[var(--surface2)] border border-[var(--border)] px-2 py-1.5 focus:border-[var(--accent)] outline-none"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {Object.keys(addItemsCart).length > 0 && (
            <div className="border-t border-[var(--border)] bg-[var(--surface)] p-4 flex-shrink-0 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">Adding</span>
                <span className="font-bold text-[var(--accent)]">
                  {formatPrice(
                    Object.values(addItemsCart).reduce((s, i) => s + i.price * i.quantity, 0),
                    (user?.organization as any)?.currency || 'NGN',
                  )}
                </span>
              </div>
              {addItemsError && <p className="text-xs text-[var(--danger)]">{addItemsError}</p>}
              <button
                className="w-full py-3 bg-[var(--accent)] text-black font-bold text-sm disabled:opacity-50"
                onClick={() => void submitAddItems()}
                disabled={addItemsSubmitting}
              >
                {addItemsSubmitting
                  ? 'Adding…'
                  : `Add ${Object.values(addItemsCart).reduce((s, i) => s + i.quantity, 0)} item(s) to Order`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
