import { useTheme } from '../context/theme';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  API_BASE as CUSTOMER_API_BASE,
  fetchTableInfo,
  fetchMenu,
  submitOrder,
  callWaiter,
  requestService,
  fetchHelpOptions,
  fetchOrderStatus,
} from '../services/api';
import { db, syncPendingOrders } from '../db';
import { formatPrice } from '../../../../shared/utils/currency';

interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  image?: string;
  isAvailable?: boolean;
  trackStock?: boolean;
  stockCount?: number;
}
interface Category {
  id: string;
  name: string;
  menuItems: MenuItem[];
}
interface HelpOption {
  id: string;
  type: 'WAITER' | 'SERVICE' | 'BILL';
  label: string;
}
interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
}
interface TableInfo {
  id: string;
  label: string;
  number: number;
  organizationId: string;
  branchId: string | null;
  organizationName: string;
  organizationLogo?: string;
  branchName: string | null;
  qrOrderingEnabled?: boolean;
}
interface OrderPreviewItem {
  id: string;
  quantity: number;
  menuItem?: { name: string };
  cancelledAt?: string | null;
}
interface OrderPreview {
  id: string;
  status: string;
  items: OrderPreviewItem[];
}

const ACTIVE_ORDER_STATUSES = new Set(['RECEIVED', 'PREPARING', 'READY']);

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function MenuPage() {
  const { orgId, tableId } = useParams<{ orgId: string; tableId: string }>();
  const navigate = useNavigate();

  const paramOrderHistoryKey = `${orgId || ''}:${tableId || ''}`;
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const tableInfoRef = useRef<TableInfo | null>(null);
  useEffect(() => {
    tableInfoRef.current = tableInfo;
  }, [tableInfo]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [helpOptions, setHelpOptions] = useState<HelpOption[]>([]);
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const savedOrg = localStorage.getItem('cartOrgId');
      if (savedOrg !== orgId) {
        localStorage.removeItem('cart');
        return [];
      }
      const saved = localStorage.getItem('cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [unavailableItems, setUnavailableItems] = useState<Set<string>>(new Set());
  const [cartOpen, setCartOpen] = useState(false);
  const [serviceModal, setServiceModal] = useState(false);
  const [waiterModal, setWaiterModal] = useState(false);
  const [tabModal, setTabModal] = useState(false);
  const [fullBill, setFullBill] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingOrderCount, setPendingOrderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [waiterReason, setWaiterReason] = useState('');
  const [customWaiterReason, setCustomWaiterReason] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [customServiceType, setCustomServiceType] = useState('');
  const { mode, setMode } = useTheme();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeOrderIds, setActiveOrderIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('orderHistoryByTable');
      const parsed = raw ? JSON.parse(raw) : {};
      const ids = Array.isArray(parsed?.[paramOrderHistoryKey]) ? parsed[paramOrderHistoryKey] : [];
      return ids.filter((v: unknown) => typeof v === 'string').slice(0, 20);
    } catch {
      return [];
    }
  });
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [billRequested, setBillRequested] = useState(false);
  const [sessionBill, setSessionBill] = useState<{
    grandTotal: number;
    orderCount: number;
    currency: string;
    isPaid?: boolean;
    balance?: number;
  } | null>(null);
  const [orderPreviews, setOrderPreviews] = useState<Record<string, OrderPreview | null>>({});
  const [ordersPreviewLoading, setOrdersPreviewLoading] = useState(false);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const customWaiterInputRef = useRef<HTMLInputElement | null>(null);
  const customServiceInputRef = useRef<HTMLInputElement | null>(null);
  const cartModalRef = useRef<HTMLDivElement | null>(null);
  const waiterModalRef = useRef<HTMLDivElement | null>(null);
  const serviceModalRef = useRef<HTMLDivElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const pruneRunRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const joinedOrdersRef = useRef<Set<string>>(new Set());
  const activeOrderIdsRef = useRef<string[]>(activeOrderIds);

  useEffect(() => {
    activeOrderIdsRef.current = activeOrderIds;
  }, [activeOrderIds]);

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  const waiterIsOther = waiterReason.trim().toLowerCase() === 'other';
  const waiterReasonToSend = waiterIsOther ? customWaiterReason.trim() : waiterReason;
  const canSendWaiter = waiterReasonToSend.length > 0;

  const serviceIsSpecial = serviceType.trim().toLowerCase() === 'special request';
  const serviceTypeToSend = serviceIsSpecial ? customServiceType.trim() : serviceType;
  const canSendService = serviceTypeToSend.length > 0;

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  async function fetchRunningTab(sessionId: string) {
    try {
      const res = await fetch(`${CUSTOMER_API_BASE}/api/sessions/public/${sessionId}/bill`);
      const data = await res.json();
      if (data.success) {
        if (data.data.closedAt) {
          const currentSessionId = (tableInfoRef.current as any)?.activeSessionId;
          if (currentSessionId === sessionId) {
            setTableInfo((prev) => (prev ? { ...prev, activeSessionId: null } : prev));
            setSessionBill(null);
            setFullBill(null);
            setActiveOrderIds([]);
            setOrderPreviews({});
            setBillRequested(false);
          }
          return;
        }
        // Bill settled — reset the requested state
        if (data.data.isPaid) setBillRequested(false);
        setSessionBill({
          grandTotal: data.data.grandTotal,
          orderCount: data.data.orderCount,
          currency: data.data.currency,
          isPaid: data.data.isPaid,
          balance: data.data.balance,
        });
        setFullBill(data.data);
      }
    } catch {
      void 0;
    }
  }

  const closeWaiter = useCallback(() => {
    setWaiterModal(false);
    setWaiterReason('');
    setCustomWaiterReason('');
  }, []);

  const closeService = useCallback(() => {
    setServiceModal(false);
    setServiceType('');
    setCustomServiceType('');
  }, []);

  const selectWaiterReason = (label: string) => {
    setWaiterReason(label);
    if (label.trim().toLowerCase() !== 'other') setCustomWaiterReason('');
  };

  const selectServiceType = (label: string) => {
    setServiceType(label);
    if (label.trim().toLowerCase() !== 'special request') setCustomServiceType('');
  };

  async function submitBillRequest() {
    if (submitting) return;

    // Check both local active orders and the server-side session bill
    const hasActiveOrders = activeOrderIds.length > 0;
    const hasSessionOrders = (sessionBill?.orderCount ?? 0) > 0;

    if (!hasActiveOrders && !hasSessionOrders) {
      showToast(
        "You haven't made any orders yet. Please call a waiter if you need assistance.",
        'error',
      );
      return;
    }

    setSubmitting(true);

    try {
      let effectiveTableInfo = tableInfo;
      if (!effectiveTableInfo) {
        if (!orgId || !tableId) return;
        try {
          effectiveTableInfo = await fetchTableInfo(orgId, tableId);
          setTableInfo(effectiveTableInfo);
        } catch {
          showToast('Could not request bill. Please try again.', 'error');
          return;
        }
      }

      if (!effectiveTableInfo) return;
      const organizationId = effectiveTableInfo.organizationId;
      const body = {
        organizationId,
        tableId: effectiveTableInfo.id,
        branchId: effectiveTableInfo.branchId,
        serviceType: 'BILL_REQUEST',
        notes: '',
      };

      const res = await fetch(`${CUSTOMER_API_BASE}/api/service-requests/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setBillRequested(true);
        showToast('Bill requested. Your waiter is on the way.', 'success');
      } else {
        showToast('Could not request bill. Please try again.', 'error');
      }
    } catch {
      showToast('Could not request bill. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleHelpOptionClick(option: HelpOption) {
    if (option.type === 'WAITER') {
      selectWaiterReason(option.label);
      setWaiterModal(true);
    } else if (option.type === 'BILL') {
      // Bill request goes through the service request flow
      // Pre-fill the service type as BILL_REQUEST
      setServiceType('BILL_REQUEST');
      // Submit immediately without showing a modal — bill request needs no extra input
      void submitBillRequest();
    } else {
      // SERVICE type
      selectServiceType(option.label);
      setServiceModal(true);
    }
  }

  const removeActiveOrder = useCallback((id: string) => {
    setActiveOrderIds((prev) => prev.filter((x) => x !== id));
    setOrderPreviews((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOrdersExpanded(false);
    // NOTE: We no longer call removeOrderFromHistory(id) here
    // because we want the order to remain in the "Running Tab"
    // until the entire session is closed by the waiter.
    try {
      localStorage.removeItem('lastOrderId');
      localStorage.removeItem('lastOrderOrgId');
      localStorage.removeItem('lastOrderTableId');
    } catch {
      void 0;
    }
  }, []);

  const pruneActiveOrders = useCallback(
    async (canonicalKey: string, ids: string[]) => {
      if (ids.length === 0) return;
      if (!navigator.onLine) return;

      const runId = ++pruneRunRef.current;

      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const data = await fetchOrderStatus(id);
            const preview: OrderPreview = { id: data.id, status: data.status, items: data.items };
            return { id, status: data.status as string, preview, ok: true as const };
          } catch {
            return {
              id,
              status: null as string | null,
              preview: null as OrderPreview | null,
              ok: false as const,
            };
          }
        }),
      );

      if (runId !== pruneRunRef.current) return;

      const nextIds: string[] = [];
      const nextPreviews: Record<string, OrderPreview | null> = {};
      const removed = new Set<string>();

      for (const r of results) {
        if (!r.ok) {
          nextIds.push(r.id);
          nextPreviews[r.id] = null;
          continue;
        }
        nextPreviews[r.id] = r.preview;
        if (ACTIVE_ORDER_STATUSES.has(r.status)) {
          nextIds.push(r.id);
        } else {
          removed.add(r.id);
        }
      }

      if (removed.size > 0) {
        setOrderPreviews((prev) => {
          const next = { ...prev, ...nextPreviews };
          for (const id of removed) delete next[id];
          return next;
        });
      } else if (Object.keys(nextPreviews).length > 0) {
        setOrderPreviews((prev) => ({ ...prev, ...nextPreviews }));
      }

      try {
        const raw = localStorage.getItem('orderHistoryByTable');
        const parsed = raw ? JSON.parse(raw) : {};
        parsed[canonicalKey] = nextIds.slice(0, 20);
        if (canonicalKey !== paramOrderHistoryKey) delete parsed[paramOrderHistoryKey];
        localStorage.setItem('orderHistoryByTable', JSON.stringify(parsed));
      } catch {
        void 0;
      }

      setActiveOrderIds(nextIds.slice(0, 20));
      if (nextIds.length === 0) setOrdersExpanded(false);
    },
    [paramOrderHistoryKey],
  );

  useEffect(() => {
    if (waiterModal && waiterIsOther) {
      setTimeout(() => customWaiterInputRef.current?.focus(), 0);
    }
  }, [waiterModal, waiterIsOther]);

  useEffect(() => {
    if (serviceModal && serviceIsSpecial) {
      setTimeout(() => customServiceInputRef.current?.focus(), 0);
    }
  }, [serviceModal, serviceIsSpecial]);

  useEffect(() => {
    const anyModalOpen = cartOpen || waiterModal || serviceModal;
    if (!anyModalOpen) {
      if (lastFocusRef.current) {
        setTimeout(() => lastFocusRef.current?.focus(), 0);
      }
      lastFocusRef.current = null;
      return;
    }

    if (!lastFocusRef.current) {
      lastFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    const activeRoot = waiterModal
      ? waiterModalRef.current
      : serviceModal
        ? serviceModalRef.current
        : cartOpen
          ? cartModalRef.current
          : null;

    const getFocusable = (root: HTMLElement | null) => {
      if (!root) return [] as HTMLElement[];
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      return nodes.filter((el) => {
        const style = window.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      });
    };

    const focusFirst = () => {
      const focusable = getFocusable(activeRoot);
      if (focusable.length > 0) {
        focusable[0].focus();
        return;
      }
      activeRoot?.focus();
    };

    setTimeout(focusFirst, 0);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (waiterModal) closeWaiter();
        else if (serviceModal) closeService();
        else if (cartOpen) setCartOpen(false);
        return;
      }

      if (e.key !== 'Tab') return;
      if (!activeRoot) return;

      const focusable = getFocusable(activeRoot);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [cartOpen, waiterModal, serviceModal, closeWaiter, closeService]);

  useEffect(() => {
    const refreshOrders = () => {
      try {
        const canonicalKey =
          tableInfo?.organizationId && tableInfo?.id
            ? `${tableInfo.organizationId}:${tableInfo.id}`
            : paramOrderHistoryKey;
        const raw = localStorage.getItem('orderHistoryByTable');
        const parsed = raw ? JSON.parse(raw) : {};
        const canonicalIds = Array.isArray(parsed?.[canonicalKey]) ? parsed[canonicalKey] : [];
        const paramIds = Array.isArray(parsed?.[paramOrderHistoryKey])
          ? parsed[paramOrderHistoryKey]
          : [];

        const merged: string[] = [];
        for (const id of [...canonicalIds, ...paramIds]) {
          if (typeof id !== 'string') continue;
          if (merged.includes(id)) continue;
          merged.push(id);
          if (merged.length >= 20) break;
        }

        if (canonicalKey !== paramOrderHistoryKey && paramIds.length > 0) {
          parsed[canonicalKey] = merged;
          delete parsed[paramOrderHistoryKey];
          localStorage.setItem('orderHistoryByTable', JSON.stringify(parsed));
        }

        setActiveOrderIds(merged);
        setOrdersExpanded(false);
        if (merged.length > 0) {
          window.setTimeout(() => {
            void pruneActiveOrders(canonicalKey, merged);
          }, 0);
        }
      } catch {
        setActiveOrderIds([]);
        setOrdersExpanded(false);
      }
    };

    refreshOrders();
    window.addEventListener('focus', refreshOrders);
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshOrders();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', refreshOrders);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [paramOrderHistoryKey, pruneActiveOrders, tableInfo?.organizationId, tableInfo?.id]);

  useEffect(() => {
    if (!ordersExpanded) return;
    if (activeOrderIds.length === 0) return;

    const missingIds = activeOrderIds.filter((id) => orderPreviews[id] === undefined);
    if (missingIds.length === 0) return;

    const t = window.setTimeout(() => {
      setOrdersPreviewLoading(true);
      void Promise.all(
        missingIds.map(async (id) => {
          try {
            const data = await fetchOrderStatus(id);
            setOrderPreviews((prev) => ({
              ...prev,
              [id]: { id: data.id, status: data.status, items: data.items },
            }));
          } catch {
            setOrderPreviews((prev) => ({ ...prev, [id]: null }));
          }
        }),
      ).finally(() => setOrdersPreviewLoading(false));
    }, 0);

    return () => window.clearTimeout(t);
  }, [activeOrderIds, orderPreviews, ordersExpanded]);

  // Load pending order count from IndexedDB on mount so the banner shows immediately
  useEffect(() => {
    db.pendingOrders
      .count()
      .then(setPendingOrderCount)
      .catch(() => void 0);
  }, []);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      const countBefore = await db.pendingOrders.count().catch(() => 0);
      if (countBefore > 0) {
        await syncPendingOrders(CUSTOMER_API_BASE);
        const countAfter = await db.pendingOrders.count().catch(() => 0);
        setPendingOrderCount(countAfter);
        if (countAfter < countBefore) {
          showToast(
            `Your ${countBefore - countAfter === 1 ? 'order has' : `${countBefore - countAfter} orders have`} been placed successfully.`,
            'success',
          );
        }
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 60-second heartbeat — re-fetches running tab if socket events were missed
  // Matches the same fallback pattern used on all staff boards
  useEffect(() => {
    const interval = setInterval(() => {
      if (!navigator.onLine) return;
      const sessionId = (tableInfoRef.current as any)?.activeSessionId;
      if (sessionId) void fetchRunningTab(sessionId);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (orgId) {
      localStorage.setItem('cartOrgId', orgId);
      localStorage.setItem('cart', JSON.stringify(cart));
    }
  }, [cart, orgId]);

  useEffect(() => {
    async function load() {
      if (!orgId || !tableId) return;
      setLoading(true);
      try {
        const table = await fetchTableInfo(orgId, tableId);
        const [menu, options] = await Promise.all([
          fetchMenu(orgId, table.branchId),
          fetchHelpOptions(table.organizationId, table.branchId),
        ]);
        setTableInfo(table);
        setCategories(menu);
        setHelpOptions(options.filter((o: any) => o.isActive));
        if (menu.length > 0) setActiveCategory(menu[0].id);

        if ((table as any).activeSessionId) {
          void fetchRunningTab((table as any).activeSessionId);
        }

        // Pre-populate unavailableItems from API data
        const unavailable = new Set<string>();
        menu.forEach((cat: any) => {
          (cat.menuItems ?? []).forEach((item: any) => {
            if (!item.isAvailable) unavailable.add(item.id);
          });
        });
        setUnavailableItems(unavailable);

        await db.cachedMenus.put({ organizationId: orgId, data: menu, cachedAt: new Date() });
      } catch {
        const cached = await db.cachedMenus.get(orgId!);
        if (cached) {
          setCategories(cached.data as Category[]);
          const cats = cached.data as Category[];
          if (cats.length > 0) setActiveCategory(cats[0].id);

          // Pre-populate unavailableItems from cached data
          const unavailable = new Set<string>();
          cats.forEach((cat: any) => {
            (cat.menuItems ?? []).forEach((item: any) => {
              if (!item.isAvailable) unavailable.add(item.id);
            });
          });
          setUnavailableItems(unavailable);

          setError('');
        } else {
          setError('Unable to load menu. Please check your connection.');
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [orgId, tableId]);

  useEffect(() => {
    if (!tableInfo?.organizationId) return;

    const SOCKET_URL = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

    const socket = io(SOCKET_URL || window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // Join org room for menu availability updates
      socket.emit('JOIN_ORG_PUBLIC', tableInfo.organizationId);

      // Join branch room for session and order updates
      if (tableInfo.branchId) {
        socket.emit('JOIN_BRANCH_PUBLIC', {
          orgId: tableInfo.organizationId,
          branchId: tableInfo.branchId,
        });
      }

      const ids = activeOrderIdsRef.current ?? [];
      for (const id of ids) {
        if (!id || joinedOrdersRef.current.has(id)) continue;
        socket.emit('JOIN_ORDER', { orderId: id });
        joinedOrdersRef.current.add(id);
      }

      // Re-fetch running tab on every connect (initial + reconnect) to catch missed updates
      const sessionId = (tableInfoRef.current as any)?.activeSessionId;
      if (sessionId) void fetchRunningTab(sessionId);
    });

    socket.on('MENU_ITEM_UNAVAILABLE', ({ menuItemId }: { menuItemId: string }) => {
      setUnavailableItems((prev) => new Set(prev).add(menuItemId));

      // Also remove from cart if present
      setCart((prev) => {
        const updated = prev.filter((item) => item.menuItem.id !== menuItemId);
        if (updated.length !== prev.length) {
          showToast('An item in your cart is not available at this time.', 'error');
        }
        return updated;
      });
    });

    socket.on('MENU_ITEM_AVAILABLE', ({ menuItemId }: { menuItemId: string }) => {
      setUnavailableItems((prev) => {
        const next = new Set(prev);
        next.delete(menuItemId);
        return next;
      });
    });

    socket.on(
      'SESSION_OPENED',
      ({ sessionId, tableId: openedTableId }: { sessionId: string; tableId: string }) => {
        if (openedTableId === tableId) {
          setTableInfo((prev) => (prev ? { ...prev, activeSessionId: sessionId } : prev));
          void fetchRunningTab(sessionId);
        }
      },
    );

    socket.on('SESSION_CLOSED', ({ sessionId: closedSessionId }: { sessionId: string }) => {
      const currentSessionId = (tableInfoRef.current as any)?.activeSessionId;
      // Match on exact sessionId OR when we have no tracked sessionId but have active orders
      // (covers case where customer tab was open before session was tracked client-side,
      //  or where payment was made without a bill request so no SESSION_OPENED was received)
      const isOurSession =
        closedSessionId === currentSessionId ||
        (!currentSessionId && (activeOrderIdsRef.current ?? []).length > 0);

      if (isOurSession) {
        setTableInfo((prev) => (prev ? { ...prev, activeSessionId: null } : prev));
        setSessionBill(null);
        setFullBill(null);
        setActiveOrderIds([]);
        setOrderPreviews({});
        // Clear localStorage order history so old orders don't bleed into the next session
        try {
          const canonicalKey =
            tableInfoRef.current?.organizationId && tableInfoRef.current?.id
              ? `${tableInfoRef.current.organizationId}:${tableInfoRef.current.id}`
              : null;
          if (canonicalKey) {
            const raw = localStorage.getItem('orderHistoryByTable');
            const parsed = raw ? JSON.parse(raw) : {};
            delete parsed[canonicalKey];
            localStorage.setItem('orderHistoryByTable', JSON.stringify(parsed));
          }
        } catch {
          void 0;
        }
        showToast('Your session has been closed. Thank you for visiting!', 'success');
      }
    });

    socket.on('ORDER_CREATED', (order: any) => {
      const sessionId = order?.sessionId || (tableInfoRef.current as any)?.activeSessionId;
      if (sessionId) {
        if (!(tableInfoRef.current as any)?.activeSessionId) {
          setTableInfo((prev) => (prev ? { ...prev, activeSessionId: sessionId } : prev));
        }
        void fetchRunningTab(sessionId);
      }
    });

    // Update running tab when payment is recorded — so customer sees balance reduce in real time
    // without needing to wait for session close
    socket.on('PAYMENT_RECORDED', ({ sessionId: paidSessionId }: { sessionId: string }) => {
      const currentSessionId = (tableInfoRef.current as any)?.activeSessionId;
      if (paidSessionId && (paidSessionId === currentSessionId || currentSessionId)) {
        const sid = paidSessionId || currentSessionId;
        if (sid) void fetchRunningTab(sid);
      }
    });

    socket.on('ORDER_UPDATED', (updated: any) => {
      if (!updated?.id) return;
      const orderId = String(updated.id);
      const status = String(updated.status ?? '');

      const sessionId = updated.sessionId || (tableInfoRef.current as any)?.activeSessionId;
      if (sessionId) {
        if (!(tableInfoRef.current as any)?.activeSessionId) {
          setTableInfo((prev) => (prev ? { ...prev, activeSessionId: sessionId } : prev));
        }
        void fetchRunningTab(sessionId);
      }

      if (!ACTIVE_ORDER_STATUSES.has(status)) {
        if ((activeOrderIdsRef.current ?? []).includes(orderId)) removeActiveOrder(orderId);
        return;
      }

      setOrderPreviews((prev) => {
        const rawItems = Array.isArray(updated.items) ? updated.items : [];
        const items = rawItems
          .filter((it: any) => !it?.cancelledAt)
          .map((it: any) => ({
            id: it.id,
            quantity: it.quantity,
            menuItem: it.menuItem ? { name: it.menuItem.name } : undefined,
            cancelledAt: it.cancelledAt ?? null,
          }));
        return { ...prev, [orderId]: { id: orderId, status, items } };
      });
    });

    socket.on(
      'ORDER_ITEM_CANCELLED',
      ({
        orderId,
        itemId,
        itemName,
        allCancelled,
      }: {
        orderId: string;
        itemId: string;
        itemName: string;
        allCancelled: boolean;
      }) => {
        if (!orderId) return;
        if (allCancelled) {
          removeActiveOrder(orderId);
          // Re-fetch running tab so grand total goes to zero / updates correctly
          const sessionIdAll = (tableInfoRef.current as any)?.activeSessionId;
          if (sessionIdAll) void fetchRunningTab(sessionIdAll);
          showToast(
            'All items in your order are unavailable. Your order has been cancelled.',
            'error',
          );
          return;
        }

        setOrderPreviews((prev) => {
          const current = prev[orderId];
          if (!current || !Array.isArray(current.items)) return prev;
          return {
            ...prev,
            [orderId]: {
              ...current,
              items: current.items.filter((it) => it.id !== itemId),
            },
          };
        });
        // Re-fetch running tab so price deducts immediately in customer's view
        const sessionIdPartial = (tableInfoRef.current as any)?.activeSessionId;
        if (sessionIdPartial) void fetchRunningTab(sessionIdPartial);
        showToast(`${itemName || 'An item'} is not available at this time.`, 'error');
      },
    );

    return () => {
      try {
        for (const id of joinedOrdersRef.current) socket.emit('LEAVE_ORDER', { orderId: id });
      } catch {
        void 0;
      }
      joinedOrdersRef.current = new Set();
      socketRef.current = null;
      socket.disconnect();
    };
  }, [
    removeActiveOrder,
    tableInfo?.organizationId,
    tableId,
    tableInfo?.branchId,
    pruneActiveOrders,
    activeOrderIds,
  ]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    const desired = new Set(activeOrderIds);
    for (const id of desired) {
      if (!id || joinedOrdersRef.current.has(id)) continue;
      socket.emit('JOIN_ORDER', { orderId: id });
      joinedOrdersRef.current.add(id);
    }
    for (const id of Array.from(joinedOrdersRef.current)) {
      if (desired.has(id)) continue;
      socket.emit('LEAVE_ORDER', { orderId: id });
      joinedOrdersRef.current.delete(id);
    }
  }, [activeOrderIds]);

  const addToCart = (menuItem: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItem.id === menuItem.id);
      if (existing) {
        if (
          menuItem.trackStock &&
          menuItem.stockCount !== undefined &&
          existing.quantity >= menuItem.stockCount
        ) {
          showToast(`Only ${menuItem.stockCount} available`, 'error');
          return prev;
        }
        return prev.map((i) =>
          i.menuItem.id === menuItem.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      if (menuItem.trackStock && menuItem.stockCount !== undefined && menuItem.stockCount <= 0) {
        showToast('Item is out of stock', 'error');
        return prev;
      }
      return [...prev, { menuItem, quantity: 1 }];
    });
  };

  const removeFromCart = (menuItemId: string) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItem.id === menuItemId);
      if (existing && existing.quantity > 1)
        return prev.map((i) =>
          i.menuItem.id === menuItemId ? { ...i, quantity: i.quantity - 1 } : i,
        );
      return prev.filter((i) => i.menuItem.id !== menuItemId);
    });
  };

  const updateCartItemNotes = (menuItemId: string, notes: string) => {
    setCart((prev) => prev.map((i) => (i.menuItem.id === menuItemId ? { ...i, notes } : i)));
  };

  const cartTotal = cart.reduce((sum, i) => sum + i.menuItem.price * i.quantity, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  const clearCart = () => {
    setCart([]);
    localStorage.setItem('cart', JSON.stringify([]));
    if (orgId) localStorage.setItem('cartOrgId', orgId);
  };

  const placeOrder = async () => {
    if (cart.length === 0 || !orgId || !tableId) return;
    if (tableInfo?.qrOrderingEnabled === false) {
      showToast('Online ordering is not available. Please ask your server.', 'error');
      return;
    }
    setSubmitting(true);

    const idempotencyKey = generateIdempotencyKey();

    try {
      let effectiveTableInfo = tableInfo;
      if (!effectiveTableInfo) {
        effectiveTableInfo = await fetchTableInfo(orgId, tableId);
        setTableInfo(effectiveTableInfo);
      }
      if (!effectiveTableInfo) {
        throw new Error('Table not found');
      }

      const orderPayload = {
        organizationId: effectiveTableInfo.organizationId,
        tableId: effectiveTableInfo.id,
        branchId: effectiveTableInfo.branchId || undefined,
        idempotencyKey,
        items: cart.map((i) => ({
          menuItemId: i.menuItem.id,
          quantity: i.quantity,
          notes: i.notes,
        })),
      };

      if (isOnline) {
        const { data } = await submitOrder(orderPayload);
        clearCart();
        setCartOpen(false);
        // Save order info so customer can return to status page
        try {
          localStorage.setItem('lastOrderId', data.id);
          localStorage.setItem('lastOrderOrgId', effectiveTableInfo.organizationId);
          localStorage.setItem('lastOrderTableId', effectiveTableInfo.id);
        } catch {
          void 0;
        }
        try {
          const canonicalKey =
            tableInfo?.organizationId && tableInfo?.id
              ? `${tableInfo.organizationId}:${tableInfo.id}`
              : paramOrderHistoryKey;
          const raw = localStorage.getItem('orderHistoryByTable');
          const parsed = raw ? JSON.parse(raw) : {};
          const existing = Array.isArray(parsed?.[canonicalKey]) ? parsed[canonicalKey] : [];
          const next = [
            data.id,
            ...existing.filter((id: unknown) => typeof id === 'string' && id !== data.id),
          ].slice(0, 20);
          parsed[canonicalKey] = next;
          if (canonicalKey !== paramOrderHistoryKey) delete parsed[paramOrderHistoryKey];
          localStorage.setItem('orderHistoryByTable', JSON.stringify(parsed));
          setActiveOrderIds(next);
        } catch {
          setActiveOrderIds((prev) =>
            [data.id, ...prev.filter((id) => id !== data.id)].slice(0, 20),
          );
        }
        navigate(`/order/${data.id}`);
      } else {
        await db.pendingOrders.add({
          ...orderPayload,
          total: cartTotal,
          createdAt: new Date(),
          retryCount: 0,
        });
        clearCart();
        setCartOpen(false);
        const newCount = await db.pendingOrders.count().catch(() => 1);
        setPendingOrderCount(newCount);
        showToast('Order saved — will be placed when you reconnect', 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to place order', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCallWaiter = async () => {
    if (!orgId || !tableId) return;
    if (!isOnline) {
      showToast('You appear to be offline. Please reconnect and try again.', 'error');
      return;
    }
    if (!canSendWaiter) {
      showToast('Please enter your request', 'error');
      return;
    }
    try {
      let effectiveTableInfo = tableInfo;
      if (!effectiveTableInfo) {
        effectiveTableInfo = await fetchTableInfo(orgId, tableId);
        setTableInfo(effectiveTableInfo);
      }
      if (!effectiveTableInfo) throw new Error('Table not found');

      await callWaiter({
        organizationId: effectiveTableInfo.organizationId,
        tableId: effectiveTableInfo.id,
        branchId: effectiveTableInfo.branchId || undefined,
        reason: waiterReasonToSend || undefined,
      });
      closeWaiter();
      showToast('Waiter notified!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to call waiter', 'error');
    }
  };

  const handleServiceRequest = async () => {
    if (!orgId || !tableId) return;
    if (!isOnline) {
      showToast('You appear to be offline. Please reconnect and try again.', 'error');
      return;
    }
    if (!canSendService) {
      showToast('Please enter your request', 'error');
      return;
    }
    try {
      let effectiveTableInfo = tableInfo;
      if (!effectiveTableInfo) {
        effectiveTableInfo = await fetchTableInfo(orgId, tableId);
        setTableInfo(effectiveTableInfo);
      }
      if (!effectiveTableInfo) throw new Error('Table not found');

      await requestService({
        organizationId: effectiveTableInfo.organizationId,
        tableId: effectiveTableInfo.id,
        branchId: effectiveTableInfo.branchId || undefined,
        serviceType: serviceTypeToSend,
      });
      closeService();
      showToast('Request sent!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to send request', 'error');
    }
  };

  const scrollToCategory = (catId: string) => {
    setActiveCategory(catId);
    categoryRefs.current[catId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const formatOrderItems = (o: OrderPreview | null | undefined) => {
    if (!o) return '';
    const items = Array.isArray(o.items) ? o.items : [];
    const parts = items
      .filter((it) => !(it as any)?.cancelledAt)
      .filter((it) => it?.menuItem?.name)
      .map((it) => `${it.quantity}× ${it.menuItem!.name}`);
    if (parts.length === 0) return '';
    const shown = parts.slice(0, 2);
    const remaining = parts.length - shown.length;
    return remaining > 0 ? `${shown.join(', ')} +${remaining} more` : shown.join(', ');
  };

  const displayName = tableInfo?.branchName ?? tableInfo?.organizationName ?? 'Cevop';
  const hasWaiterOptions = helpOptions.some((o) => o.type === 'WAITER');
  const hasServiceOptions = helpOptions.some((o) => o.type === 'SERVICE');

  if (loading)
    return (
      <div className="min-h-dvh bg-[var(--bg)] flex flex-col">
        {/* Header skeleton */}
        <div className="px-4 py-3 border-b border-[var(--border)] safe-top">
          <div className="skeleton h-6 w-40 mb-2" />
          <div className="skeleton h-3 w-24" />
        </div>
        <div className="px-4 pb-3 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="skeleton h-11 rounded-full" />
            <div className="skeleton h-11 rounded-full" />
          </div>
        </div>
        {/* Menu item skeletons */}
        <div className="px-4 pt-4 space-y-3">
          <div className="skeleton h-9 w-48 mb-2" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-5 flex items-start gap-4">
              <div className="flex-1 space-y-2.5">
                <div className="skeleton h-5 w-3/4" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-4 w-20 mt-3" />
              </div>
              <div className="skeleton w-10 h-10 rounded-full shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );

  if (error)
    return (
      <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="text-sm font-semibold text-[var(--warning)]">Unable to load menu</div>
          <p className="text-[var(--text)]">{error}</p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col overflow-x-hidden relative">
      <div className="text-texture" />
      {/* Header */}
      <header className="sticky top-0 z-30 glass-morphism border-b border-[var(--border)] safe-top">
        <div className="px-4 py-3 flex items-center justify-between gap-2 overflow-hidden relative z-20">
          <div className="min-w-0 shrink">
            <h1 className="font-display text-xl sm:text-2xl text-[var(--accent)] leading-none truncate">
              {displayName}
            </h1>
            <p className="text-[var(--text-secondary)] text-[10px] sm:text-xs mt-0.5 truncate mono uppercase tracking-tight">
              {tableInfo?.label || 'Your Table'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {activeOrderIds.length > 0 && (
              <button
                onClick={() => {
                  if (activeOrderIds.length === 1) {
                    navigate(`/order/${activeOrderIds[0]}`);
                    return;
                  }
                  setOrdersExpanded((v) => !v);
                }}
                className="card px-2.5 py-1.5 text-[10px] font-bold text-[var(--text)] hover:border-[var(--accent)] transition-colors flex items-center gap-1.5 rounded-full font-display"
                aria-label={
                  activeOrderIds.length === 1
                    ? 'View active order'
                    : ordersExpanded
                      ? 'Hide active orders'
                      : 'Show active orders'
                }
              >
                <span className="uppercase tracking-tight">Orders</span>
                <span className="mono text-[9px] text-[var(--text-secondary)]">
                  ({activeOrderIds.length})
                </span>
              </button>
            )}

            <button
              onClick={() => setMode(nextThemeMode)}
              className={`card px-2.5 py-1.5 border flex items-center justify-center transition-colors text-[10px] font-black tracking-tight shrink-0 font-display rounded-full ${
                mode === 'system'
                  ? 'bg-[var(--surface2)] border-[var(--border)] text-[var(--text)]'
                  : mode === 'dark'
                    ? 'bg-black border-[var(--border)] text-[var(--text)]'
                    : 'bg-white border-[var(--border)] text-black'
              }`}
              title={`Theme: ${themeLabel} (click → ${nextThemeLabel})`}
              aria-label={`Theme ${themeLabel}. Click to switch to ${nextThemeLabel}.`}
            >
              {themeLabel}
            </button>
          </div>
        </div>

        <div className="px-4 pb-3 relative z-20">
          {(() => {
            // Bill button only shows when there's an unpaid bill to settle
            const showBillButton =
              !!sessionBill && sessionBill.grandTotal > 0 && !sessionBill.isPaid;
            return (
              <div className={`grid ${showBillButton ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                <button
                  onClick={() => {
                    if (!hasWaiterOptions) {
                      showToast('Not available at this time.', 'error');
                      return;
                    }
                    setWaiterModal(true);
                  }}
                  className="min-h-11 px-3 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs sm:text-sm font-semibold hover:border-[var(--accent)] transition-colors font-display"
                  aria-label="Call waiter"
                >
                  Waiter
                </button>

                <button
                  onClick={() => {
                    if (!hasServiceOptions) {
                      showToast('Not available at this time.', 'error');
                      return;
                    }
                    setServiceModal(true);
                  }}
                  className="min-h-11 px-3 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs sm:text-sm font-semibold hover:border-[var(--accent)] transition-colors font-display"
                  aria-label="Request service"
                >
                  Service
                </button>

                {showBillButton && (
                  <button
                    disabled={billRequested}
                    onClick={() => {
                      if (!isOnline) {
                        showToast(
                          'You appear to be offline. Please reconnect and try again.',
                          'error',
                        );
                        return;
                      }
                      const billOpt = helpOptions.find((o) => o.type === 'BILL');
                      if (billOpt) handleHelpOptionClick(billOpt);
                      else void submitBillRequest();
                    }}
                    className={`min-h-11 px-3 py-2 rounded-full text-xs sm:text-sm font-bold transition-all font-display flex flex-col items-center justify-center leading-none ${
                      billRequested
                        ? 'bg-[var(--success)] text-white border border-[var(--success)] cursor-default'
                        : 'bg-[var(--accent)] text-black border border-[var(--accent)] hover:brightness-110 active:scale-95'
                    }`}
                    aria-label="Request bill"
                  >
                    <span>{billRequested ? 'Bill Requested' : 'Request Bill'}</span>
                    <span
                      className={`text-[9px] mt-1 mono ${billRequested ? 'text-white/80' : 'text-black/70'}`}
                    >
                      {billRequested
                        ? 'Waiter on the way'
                        : formatPrice(sessionBill!.grandTotal, sessionBill!.currency)}
                    </span>
                  </button>
                )}
              </div>
            );
          })()}
        </div>

        {/* Persistent offline order banner — stays visible until the queued order is sent */}
        {pendingOrderCount > 0 && (
          <div className="mx-4 mb-2 px-3 py-2 border border-[var(--warning)]/40 bg-[var(--warning)]/8 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse shrink-0" />
            <p className="text-xs text-[var(--warning)] font-medium flex-1">
              {pendingOrderCount === 1
                ? 'Your order is queued and will be placed when you reconnect.'
                : `${pendingOrderCount} orders queued — will be placed when you reconnect.`}
            </p>
          </div>
        )}

        {activeOrderIds.length > 0 && ordersExpanded && (
          <div className="mx-4 mt-3 p-3 border border-[var(--border)] bg-[var(--surface)] rounded-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
                  Active Orders
                </p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Tap an order to view its status
                </p>
              </div>
              <button
                onClick={() => setOrdersExpanded(false)}
                className="text-xs font-bold text-[var(--muted)] hover:text-[var(--text)] whitespace-nowrap"
              >
                Close
              </button>
            </div>

            <div className="mt-3 pt-3 border-t border-[var(--border)] grid gap-2">
              {activeOrderIds.map((id) => (
                <button
                  key={id}
                  onClick={() => navigate(`/order/${id}`)}
                  className="card px-3 py-2 text-left hover:border-[var(--accent)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--muted)] font-semibold">Order</span>
                        {orderPreviews[id]?.status && (
                          <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
                            {orderPreviews[id]!.status}
                          </span>
                        )}
                      </div>
                      {ordersPreviewLoading && orderPreviews[id] === undefined ? (
                        <div className="text-xs text-[var(--muted)] mt-1">Loading items…</div>
                      ) : (
                        <div className="text-xs text-[var(--text)] mt-1 truncate">
                          {formatOrderItems(orderPreviews[id]) || 'View order status'}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-bold text-[var(--accent)] shrink-0">View →</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category tabs */}
        <div className="flex overflow-x-auto no-scrollbar px-4 pt-2 pb-3 gap-2 relative z-20">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollToCategory(cat.id)}
              className={`press shrink-0 px-4 py-1.5 text-sm font-bold transition-all duration-200 border rounded-full font-display ${
                activeCategory === cat.id
                  ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)] scale-105'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text)]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      {/* Menu Content */}
      <main className="flex-1 overflow-y-auto pb-32 relative z-10">
        {sessionBill && sessionBill.orderCount > 0 && (
          <div className="px-4 pt-6">
            <button
              onClick={() => setTabModal(true)}
              className="w-full card p-5 border-[var(--accent)]/30 bg-[var(--surface)] text-left flex items-center justify-between group active:scale-[0.98] transition-all"
            >
              <div>
                <p className="text-[10px] text-[var(--accent)] font-black uppercase tracking-[0.2em] mb-1">
                  Your Running Tab
                </p>
                {sessionBill.isPaid ? (
                  <h3 className="text-2xl font-display text-[var(--success)]">PAID IN FULL</h3>
                ) : (
                  <h3 className="text-2xl font-display text-[var(--text)]">
                    {formatPrice(sessionBill.grandTotal, sessionBill.currency)}
                  </h3>
                )}
                <p className="text-xs text-[var(--muted)] mt-1">
                  {sessionBill.orderCount} {sessionBill.orderCount === 1 ? 'order' : 'orders'} — Tap
                  to view receipt
                </p>
              </div>
              <div className="w-10 h-10 rounded-full bg-[var(--surface2)] flex items-center justify-center text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </button>
          </div>
        )}

        {categories.map((cat) => (
          <div
            key={cat.id}
            ref={(el) => {
              categoryRefs.current[cat.id] = el;
            }}
            className="px-4 pt-6"
          >
            <h2 className="font-display text-4xl text-[var(--text)] mb-4 tracking-tighter">
              {cat.name.toUpperCase()}
            </h2>
            <div className="space-y-3">
              {cat.menuItems.map((item) => {
                const cartItem = cart.find((c) => c.menuItem.id === item.id);
                // Check if item is unavailable — either from API data or live socket update
                const isUnavailable = !item.isAvailable || unavailableItems.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`card p-5 flex items-start gap-4 animate-fade-in ${isUnavailable ? 'opacity-50' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-lg text-[var(--text)] leading-tight font-display">
                          {item.name}
                        </h3>
                        {isUnavailable && (
                          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--danger)] border border-[var(--danger)]/50 px-2 py-0.5 rounded-full mono">
                            Sold Out
                          </span>
                        )}
                        {!isUnavailable &&
                          item.trackStock &&
                          item.stockCount !== undefined &&
                          item.stockCount <= 5 && (
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 border border-amber-500/50 px-2 py-0.5 rounded-full mono">
                              Only {item.stockCount} left
                            </span>
                          )}
                      </div>
                      {item.description && (
                        <p className="text-[var(--text-secondary)] text-sm mt-1 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                      <p className="text-[var(--accent)] font-bold mt-3 mono text-base">
                        {formatPrice(item.price)}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {cartItem ? (
                        <div className="flex items-center gap-2.5 animate-in">
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="qty-btn w-9 h-9 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)] font-bold text-lg"
                            aria-label={`Remove one ${item.name}`}
                          >
                            −
                          </button>
                          <span className="w-5 text-center font-bold text-[var(--text)] tabular-nums">
                            {cartItem.quantity}
                          </span>
                          <button
                            onClick={() => (isUnavailable ? null : addToCart(item))}
                            disabled={isUnavailable}
                            className={`qty-btn w-9 h-9 bg-[var(--accent)] text-black font-bold text-lg shadow-lg shadow-[var(--accent)]/20 ${isUnavailable ? 'opacity-30 cursor-not-allowed' : ''}`}
                            aria-label={`Add one ${item.name}`}
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => (isUnavailable ? null : addToCart(item))}
                          disabled={isUnavailable}
                          className={`qty-btn w-10 h-10 bg-[var(--accent)] text-black font-bold text-xl shadow-lg shadow-[var(--accent)]/20 ${isUnavailable ? 'opacity-30 cursor-not-allowed' : ''}`}
                          aria-label={`Add ${item.name} to order`}
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

        {/* Services */}
        <div className="px-4 pt-6 pb-4">
          <div className="border-t border-[var(--border)] pt-6">
            <h2 className="font-display text-xl text-[var(--muted)] mb-3">NEED HELP?</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setWaiterModal(true)}
                className="card p-4 text-left hover:border-[var(--accent)] transition-colors active:scale-[0.99]"
              >
                <div className="w-10 h-10 border border-[var(--accent)]/40 rounded-xl mx-auto mb-3 flex items-center justify-center bg-[var(--accent-dim)] text-[var(--accent)]">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div className="font-semibold text-sm">Call Waiter</div>
                <div className="text-[var(--muted)] text-xs mt-0.5">We'll be right over</div>
              </button>
              <button
                onClick={() => setServiceModal(true)}
                className="card p-4 text-left hover:border-[var(--accent)] transition-colors active:scale-[0.99]"
              >
                <div className="w-10 h-10 border border-[var(--border)] rounded-xl mx-auto mb-3 flex items-center justify-center bg-[var(--surface2)] text-[var(--text)]">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                </div>
                <div className="font-semibold text-sm">Request Service</div>
                <div className="text-[var(--muted)] text-xs mt-0.5">Refills, extras & more</div>
              </button>

              {/* Dynamic BILL type options */}
              {helpOptions
                .filter((o) => o.type === 'BILL')
                .map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleHelpOptionClick(opt)}
                    className="card p-4 text-left hover:border-[var(--accent)] transition-colors border-[var(--accent)]/30 active:scale-[0.99]"
                  >
                    <div className="w-10 h-10 border border-amber-500/40 rounded-xl mx-auto mb-3 flex items-center justify-center bg-amber-500/10 text-amber-400">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
                        <line x1="2" y1="10" x2="22" y2="10" />
                      </svg>
                    </div>
                    <div className="font-semibold text-sm">{opt.label}</div>
                    <div className="text-[var(--muted)] text-xs mt-0.5">Instant request</div>
                  </button>
                ))}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-[var(--muted)] text-center font-bold tracking-widest opacity-50 uppercase mb-8 flex items-center justify-center gap-2">
          <span>Powered by</span>
          <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-sm" />
        </p>
      </main>

      {/* Staff-only mode banner — shown instead of cart FAB */}
      {tableInfo && tableInfo.qrOrderingEnabled === false && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 safe-bottom pb-4">
          <div className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] text-sm font-medium">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-[var(--accent)]"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Your server will take your order
          </div>
        </div>
      )}

      {/* Cart FAB — only shown when QR ordering is enabled */}
      {cartCount > 0 && tableInfo?.qrOrderingEnabled !== false && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 safe-bottom">
          <button
            onClick={() => setCartOpen(true)}
            className="btn-primary w-full flex items-center justify-between py-4 animate-slide-up animate-pulse-glow"
          >
            <span className="bg-black/20 rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold">
              {cartCount}
            </span>
            <span className="font-semibold tracking-wide">VIEW ORDER</span>
            <span className="font-semibold">{formatPrice(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* Cart Modal */}
      {cartOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={() => setCartOpen(false)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            ref={cartModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer_cart_title"
            tabIndex={-1}
            className="relative bg-[var(--surface)] border-t border-[var(--border)] max-h-[80dvh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <h2 id="customer_cart_title" className="font-display text-2xl">
                YOUR ORDER
              </h2>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="text-[var(--muted)] text-xl hover:text-[var(--text)] p-1"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {cart.map((item) => (
                <div key={item.menuItem.id} className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => removeFromCart(item.menuItem.id)}
                        className="w-7 h-7 border border-[var(--border)] flex items-center justify-center text-[var(--muted)] hover:border-red-500 hover:text-red-400 transition-colors"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => addToCart(item.menuItem)}
                        className="w-7 h-7 border border-[var(--border)] flex items-center justify-center text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <span className="flex-1 text-sm font-medium">{item.menuItem.name}</span>
                    <span className="text-[var(--accent)] text-sm font-semibold shrink-0">
                      {formatPrice(item.menuItem.price * item.quantity)}
                    </span>
                  </div>
                  {/* Per-item notes */}
                  <input
                    type="text"
                    maxLength={200}
                    placeholder="Special instructions (optional)"
                    value={item.notes ?? ''}
                    onChange={(e) => updateCartItemNotes(item.menuItem.id, e.target.value)}
                    className="w-full bg-[var(--surface2)] border border-[var(--border)] text-xs text-[var(--text)] px-3 py-1.5 placeholder-[var(--muted)] focus:border-[var(--accent)] outline-none transition-colors rounded-none"
                  />
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-[var(--border)] space-y-3 safe-bottom">
              <div className="flex items-center justify-between">
                <span className="text-[var(--muted)]">Total</span>
                <span className="font-display text-2xl text-[var(--accent)]">
                  {formatPrice(cartTotal)}
                </span>
              </div>
              <button
                onClick={placeOrder}
                disabled={submitting}
                className="btn-primary w-full py-4 text-center font-bold tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'PLACING ORDER…' : isOnline ? 'PLACE ORDER' : 'QUEUE ORDER (OFFLINE)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiter Modal */}
      {waiterModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
          onClick={closeWaiter}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            ref={waiterModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer_waiter_title"
            tabIndex={-1}
            className="relative w-full sm:max-w-lg bg-[var(--surface)] border-t sm:border border-[var(--border)] p-4 sm:p-5 space-y-4 animate-slide-up safe-bottom sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="customer_waiter_title" className="font-display text-2xl leading-tight">
                  Call Waiter
                </h2>
                <div className="text-xs text-[var(--muted)] mt-1">
                  Pick what you need and we’ll notify staff.
                </div>
              </div>
              <button
                type="button"
                onClick={closeWaiter}
                className="shrink-0 w-10 h-10 rounded-full border border-[var(--border)] bg-[var(--surface2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
                aria-label="Close"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {helpOptions
                .filter((o) => o.type === 'WAITER')
                .map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => selectWaiterReason(opt.label)}
                    className={`group p-3 rounded-2xl border text-left transition-all active:scale-[0.99] ${
                      waiterReason === opt.label
                        ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                        : 'border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--accent)]'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div
                        className={`text-sm font-semibold leading-snug break-words ${
                          waiterReason === opt.label ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                        }`}
                      >
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">Tap to select</div>
                    </div>
                  </button>
                ))}
            </div>
            {helpOptions.filter((o) => o.type === 'WAITER').length === 0 && (
              <div className="text-[var(--muted)] text-sm border border-[var(--border)] bg-[var(--surface2)] px-3 py-2">
                No call-waiter options configured for this branch. Please ask staff to configure
                Help Options in the admin dashboard.
              </div>
            )}
            {waiterIsOther && (
              <div className="space-y-2">
                <label
                  htmlFor="customer_waiter_custom_reason"
                  className="text-xs text-[var(--muted)] font-semibold"
                >
                  Your request
                </label>
                <input
                  id="customer_waiter_custom_reason"
                  name="waiterCustomReason"
                  ref={customWaiterInputRef}
                  value={customWaiterReason}
                  onChange={(e) => setCustomWaiterReason(e.target.value)}
                  placeholder="Type what you need…"
                  autoComplete="off"
                  className="w-full bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)] px-3 py-3 text-sm outline-none focus:border-[var(--accent)] rounded-2xl"
                />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={closeWaiter} className="btn-secondary flex-1 py-3">
                Cancel
              </button>
              <button
                onClick={handleCallWaiter}
                disabled={
                  !canSendWaiter || helpOptions.filter((o) => o.type === 'WAITER').length === 0
                }
                className="btn-primary flex-1 py-3 disabled:opacity-50"
              >
                Call Waiter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Service Modal */}
      {serviceModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
          onClick={closeService}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            ref={serviceModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer_service_title"
            tabIndex={-1}
            className="relative w-full sm:max-w-lg bg-[var(--surface)] border-t sm:border border-[var(--border)] p-4 sm:p-5 space-y-4 animate-slide-up safe-bottom sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="customer_service_title" className="font-display text-2xl leading-tight">
                  Request Service
                </h2>
                <div className="text-xs text-[var(--muted)] mt-1">
                  Choose a request type and we’ll notify staff.
                </div>
              </div>
              <button
                type="button"
                onClick={closeService}
                className="shrink-0 w-10 h-10 rounded-full border border-[var(--border)] bg-[var(--surface2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
                aria-label="Close"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {helpOptions
                .filter((o) => o.type === 'SERVICE')
                .map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => selectServiceType(opt.label)}
                    className={`group p-3 rounded-2xl border text-left transition-all active:scale-[0.99] ${
                      serviceType === opt.label
                        ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                        : 'border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--accent)]'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div
                        className={`text-sm font-semibold leading-snug break-words ${
                          serviceType === opt.label ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                        }`}
                      >
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">Tap to select</div>
                    </div>
                  </button>
                ))}
            </div>
            {helpOptions.filter((o) => o.type === 'SERVICE').length === 0 && (
              <div className="text-[var(--muted)] text-sm border border-[var(--border)] bg-[var(--surface2)] px-3 py-2">
                No service-request options configured for this branch. Please ask staff to configure
                Help Options in the admin dashboard.
              </div>
            )}
            {serviceIsSpecial && (
              <div className="space-y-2">
                <label
                  htmlFor="customer_service_custom_request"
                  className="text-xs text-[var(--muted)] font-semibold"
                >
                  Your request
                </label>
                <input
                  id="customer_service_custom_request"
                  name="serviceCustomRequest"
                  ref={customServiceInputRef}
                  value={customServiceType}
                  onChange={(e) => setCustomServiceType(e.target.value)}
                  placeholder="Type what you need…"
                  autoComplete="off"
                  className="w-full bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)] px-3 py-3 text-sm outline-none focus:border-[var(--accent)] rounded-2xl"
                />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={closeService} className="btn-secondary flex-1 py-3">
                Cancel
              </button>
              <button
                onClick={handleServiceRequest}
                disabled={
                  !canSendService || helpOptions.filter((o) => o.type === 'SERVICE').length === 0
                }
                className="btn-primary flex-1 py-3 disabled:opacity-50"
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Running Tab Modal (Receipt) */}
      {tabModal && fullBill && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
          onClick={() => setTabModal(false)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
          <div
            className="relative w-full sm:max-w-lg bg-[var(--surface)] border-t sm:border border-[var(--border)] max-h-[85dvh] flex flex-col animate-slide-up sm:rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
              <div>
                <h2 className="font-display text-2xl">Current Receipt</h2>
                <p className="text-xs text-[var(--muted)] mt-1 uppercase tracking-widest mono">
                  {tableInfo?.label} —{' '}
                  {new Date(fullBill.openedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <button
                onClick={() => setTabModal(false)}
                className="w-10 h-10 rounded-full bg-[var(--surface2)] flex items-center justify-center text-[var(--muted)]"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {fullBill.orders.map((order: any, idx: number) => (
                <div key={order.id} className="space-y-4">
                  <div className="flex justify-between items-end border-b border-[var(--border)] pb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">
                      Order #{idx + 1}
                    </span>
                    <span className="text-[10px] mono text-[var(--muted)]">
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {order.items.map((item: any, iidx: number) => (
                      <div key={iidx} className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[var(--text)]">
                            {item.quantity}× {item.name}
                          </div>
                          {item.notes && (
                            <p className="text-[10px] text-[var(--muted)] italic mt-0.5">
                              "{item.notes}"
                            </p>
                          )}
                        </div>
                        <div className="text-sm font-bold text-[var(--text)] mono">
                          {formatPrice(item.lineTotal, fullBill.currency)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end text-xs font-black text-[var(--accent)] uppercase tracking-tight">
                    Subtotal: {formatPrice(order.total, fullBill.currency)}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-6 bg-[var(--surface2)] border-t border-[var(--border)] space-y-4 safe-bottom">
              {/* Breakdown — subtotal, VAT, service charge */}
              {!sessionBill?.isPaid && (
                <div className="space-y-1.5 pb-1">
                  <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                    <span>Subtotal</span>
                    <span>{formatPrice(fullBill.grandSubtotal ?? 0, fullBill.currency)}</span>
                  </div>
                  {fullBill.grandTax > 0 && (
                    <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                      <span>VAT / Tax</span>
                      <span>{formatPrice(fullBill.grandTax, fullBill.currency)}</span>
                    </div>
                  )}
                  {fullBill.grandServiceCharge > 0 && (
                    <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                      <span>Service Charge</span>
                      <span>{formatPrice(fullBill.grandServiceCharge, fullBill.currency)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-between items-center pt-1 border-t border-[var(--border)]">
                <span className="text-sm font-bold text-[var(--muted)] uppercase tracking-[0.2em]">
                  {sessionBill?.isPaid ? 'Balance Due' : 'Grand Total'}
                </span>
                <span
                  className={`text-3xl font-display ${sessionBill?.isPaid ? 'text-[var(--success)]' : 'text-[var(--accent)]'}`}
                >
                  {sessionBill?.isPaid
                    ? 'PAID'
                    : formatPrice(fullBill.grandTotal, fullBill.currency)}
                </span>
              </div>
              {!sessionBill?.isPaid && (
                <button
                  onClick={() => {
                    setTabModal(false);
                    void submitBillRequest();
                  }}
                  className="btn-primary w-full py-4 text-center font-bold tracking-widest"
                >
                  REQUEST PAYMENT NOW
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 left-4 right-4 z-[100] p-3 border text-sm font-medium animate-slide-up ${toast.type === 'success' ? 'bg-green-900/80 border-green-700 text-green-200' : 'bg-red-900/80 border-red-700 text-red-200'}`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
