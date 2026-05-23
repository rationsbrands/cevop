import React, { useCallback, useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';
import { useSocket } from '../context/socket';
import { formatPrice } from '../../../../shared/utils/currency';

const STATUS_OPTS = ['', 'RECEIVED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
const SC: Record<string, string> = {
  RECEIVED: 'text-[var(--info)]',
  PREPARING: 'text-[var(--warning)]',
  READY: 'text-[var(--success)]',
  SERVED: 'text-[var(--muted)]',
  CANCELLED: 'text-[var(--danger)]',
};
const NEXT: Record<string, string> = { RECEIVED: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };

interface WaiterCall {
  id: string;
  status: string;
  reason?: string;
  notes?: string;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string } | null;
  table?: { label: string };
  createdAt: string;
}
interface ServiceRequest {
  id: string;
  status: string;
  serviceType: string;
  notes?: string;
  adminNotes?: string;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string } | null;
  table?: { label: string };
  createdAt: string;
}

export function OrdersPage() {
  const { activeBranchFilter, user } = useAuth();
  const api = useApi();
  const { socket } = useSocket();
  const canEdit =
    user && ['SUPERADMIN', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'WAITER'].includes(user.role);
  const canReconcile =
    user && ['SUPERADMIN', 'ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'].includes(user.role);
  const currency = user?.organization?.currency ?? 'NGN';
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersCursor, setOrdersCursor] = useState<string | null>(null);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'calls' | 'service'>('orders');

  // Edit modal for waiter calls / service requests
  const [editingCall, setEditingCall] = useState<WaiterCall | null>(null);
  const [editingService, setEditingService] = useState<ServiceRequest | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editWaiterId, setEditWaiterId] = useState<string>('');
  const [editSaving, setEditSaving] = useState(false);
  const [orderAssigningId, setOrderAssigningId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');

  const [staleOpen, setStaleOpen] = useState(false);
  const [staleMinAgeMinutes, setStaleMinAgeMinutes] = useState(120);
  const [staleOrders, setStaleOrders] = useState<any[]>([]);
  const [staleHasMore, setStaleHasMore] = useState(false);
  const [staleCursor, setStaleCursor] = useState<string | null>(null);
  const [staleLoading, setStaleLoading] = useState(false);
  const [staleSelected, setStaleSelected] = useState<Set<string>>(new Set());
  const [staleActionLoading, setStaleActionLoading] = useState(false);
  const [staleCancelReason, setStaleCancelReason] = useState('Backlog cleanup');

  const [refreshing, setRefreshing] = useState(false);
  const [forceSyncing, setForceSyncing] = useState(false);
  const [onlineWaiters, setOnlineWaiters] = useState<
    { id: string; name: string; online: boolean }[]
  >([]);

  // Fetch online waiters
  useEffect(() => {
    if (!api.effectiveBranchId) return;
    api
      .get('/api/waiter-calls/waiters/online')
      .then((res) => {
        if (res.success) setOnlineWaiters(res.data);
      })
      .catch(() => void 0);
  }, [api, activeBranchFilter]);

  // Update on socket events
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: any) => {
      setOnlineWaiters((prev) =>
        prev.map((w) => ({
          ...w,
          online: payload.onlineWaiters.includes(w.id),
        })),
      );
    };
    socket.on('WAITER_ONLINE', handler);
    socket.on('WAITER_OFFLINE', handler);
    return () => {
      socket.off('WAITER_ONLINE', handler);
      socket.off('WAITER_OFFLINE', handler);
    };
  }, [socket]);

  const load = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    try {
      if (!api.effectiveBranchId) {
        setOrders([]);
        setOrdersHasMore(false);
        setOrdersCursor(null);
        setWaiterCalls([]);
        setServiceRequests([]);
        return;
      }
      const qs = statusFilter ? `?status=${statusFilter}&limit=100` : '?limit=100';
      const [ordersRes, callsRes, serviceRes] = await Promise.all([
        api.get(`/api/orders${qs}`),
        api.get('/api/waiter-calls'),
        api.get('/api/service-requests'),
      ]);
      if (ordersRes.success) {
        setOrders(ordersRes.data);
        setOrdersHasMore(Boolean(ordersRes.pagination?.hasMore));
        setOrdersCursor(ordersRes.pagination?.nextCursor ?? null);
      }
      if (callsRes.success) setWaiterCalls(callsRes.data);
      if (serviceRes.success) setServiceRequests(serviceRes.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, statusFilter]);

  const loadMoreOrders = useCallback(async () => {
    if (!api.effectiveBranchId) return;
    if (!ordersHasMore || !ordersCursor) return;
    if (ordersLoadingMore) return;
    setOrdersLoadingMore(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}&limit=100` : '?limit=100';
      const res = await api.get(`/api/orders${qs}&cursor=${ordersCursor}`);
      if (!res?.success) return;

      const newOrders: any[] = Array.isArray(res.data) ? res.data : [];
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => o.id));
        const merged = [...prev];
        for (const o of newOrders) {
          if (o?.id && !seen.has(o.id)) {
            merged.push(o);
            seen.add(o.id);
          }
        }
        return merged;
      });
      setOrdersHasMore(Boolean(res.pagination?.hasMore));
      setOrdersCursor(res.pagination?.nextCursor ?? null);
    } finally {
      setOrdersLoadingMore(false);
    }
  }, [api, ordersCursor, ordersHasMore, ordersLoadingMore, statusFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(t);
  }, [activeBranchFilter, load]);

  useEffect(() => {
    if (!socket) return;

    function handleOrderCreated(order: any) {
      setOrders((prev) => {
        if (statusFilter && order.status !== statusFilter) return prev;
        if (prev.some((o) => o.id === order.id)) return prev;
        return [order, ...prev];
      });
    }

    function handleOrderUpdated(order: any) {
      setOrders((prev) => {
        if (statusFilter && order.status !== statusFilter) {
          return prev.filter((o) => o.id !== order.id);
        }
        const exists = prev.some((o) => o.id === order.id);
        if (exists) return prev.map((o) => (o.id === order.id ? order : o));
        return [order, ...prev];
      });
    }

    function handleWaiterCalled(call: any) {
      setWaiterCalls((prev) => {
        if (prev.some((c) => c.id === call.id)) return prev;
        return [call, ...prev];
      });
    }

    function handleWaiterCallUpdated(call: WaiterCall) {
      setWaiterCalls((prev) => {
        if (call.status === 'RESOLVED') return prev.filter((c) => c.id !== call.id);
        const exists = prev.some((c) => c.id === call.id);
        if (exists) return prev.map((c) => (c.id === call.id ? call : c));
        return [call, ...prev];
      });
    }

    function handleServiceRequested(req: any) {
      setServiceRequests((prev) => {
        if (prev.some((r) => r.id === req.id)) return prev;
        return [req, ...prev];
      });
    }

    function handleServiceRequestUpdated(req: ServiceRequest) {
      setServiceRequests((prev) => {
        if (req.status === 'RESOLVED') return prev.filter((r) => r.id !== req.id);
        const exists = prev.some((r) => r.id === req.id);
        if (exists) return prev.map((r) => (r.id === req.id ? req : r));
        return [req, ...prev];
      });
    }

    socket.on('ORDER_CREATED', handleOrderCreated);
    socket.on('ORDER_UPDATED', handleOrderUpdated);
    socket.on('WAITER_CALLED', handleWaiterCalled);
    socket.on('WAITER_CALL_UPDATED', handleWaiterCallUpdated);
    socket.on('SERVICE_REQUESTED', handleServiceRequested);
    socket.on('SERVICE_REQUEST_UPDATED', handleServiceRequestUpdated);

    return () => {
      socket.off('ORDER_CREATED', handleOrderCreated);
      socket.off('ORDER_UPDATED', handleOrderUpdated);
      socket.off('WAITER_CALLED', handleWaiterCalled);
      socket.off('WAITER_CALL_UPDATED', handleWaiterCallUpdated);
      socket.off('SERVICE_REQUESTED', handleServiceRequested);
      socket.off('SERVICE_REQUEST_UPDATED', handleServiceRequestUpdated);
    };
  }, [socket, statusFilter]);

  async function updateOrderStatus(id: string, status: string, cancellationReason?: string) {
    await api.patch(`/api/orders/${id}/status`, {
      status,
      ...(cancellationReason ? { cancellationReason } : {}),
    });
    load();
  }

  async function assignOrderWaiter(orderId: string, waiterId: string | null) {
    if (orderAssigningId === orderId) return;
    setOrderAssigningId(orderId);
    try {
      await api.patch(`/api/orders/${orderId}/assign-waiter`, { waiterId });
      load();
    } finally {
      setOrderAssigningId((v) => (v === orderId ? null : v));
    }
  }

  const loadStale = useCallback(
    async (opts?: { reset?: boolean }) => {
      if (!api.effectiveBranchId) return;
      const reset = opts?.reset ?? false;
      if (staleLoading) return;
      setStaleLoading(true);
      try {
        const cursor = reset ? null : staleCursor;
        const base = `/api/orders/stale?minAgeMinutes=${staleMinAgeMinutes}&limit=50`;
        const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
        const res = await api.get(url);
        if (!res?.success) return;

        const data: any[] = Array.isArray(res.data) ? res.data : [];
        if (reset) {
          setStaleOrders(data);
          setStaleSelected(new Set());
        } else {
          setStaleOrders((prev) => {
            const seen = new Set(prev.map((o) => o.id));
            const merged = [...prev];
            for (const o of data) {
              if (o?.id && !seen.has(o.id)) {
                merged.push(o);
                seen.add(o.id);
              }
            }
            return merged;
          });
        }
        setStaleHasMore(Boolean(res.pagination?.hasMore));
        setStaleCursor(res.pagination?.nextCursor ?? null);
      } finally {
        setStaleLoading(false);
      }
    },
    [api, staleCursor, staleLoading, staleMinAgeMinutes],
  );

  const reconcileSelected = useCallback(
    async (action: 'SERVE' | 'CANCEL') => {
      if (!canReconcile) return;
      if (staleActionLoading) return;
      const orderIds = Array.from(staleSelected);
      if (orderIds.length === 0) return;
      setStaleActionLoading(true);
      try {
        const payload =
          action === 'CANCEL'
            ? { orderIds, action, reason: staleCancelReason.trim() || 'Backlog cleanup' }
            : { orderIds, action };
        const res = await api.post('/api/orders/reconcile', payload);
        if (!res?.success) return;
        await Promise.all([loadStale({ reset: true }), load()]);
      } finally {
        setStaleActionLoading(false);
      }
    },
    [api, canReconcile, load, loadStale, staleActionLoading, staleCancelReason, staleSelected],
  );

  const forceSync = useCallback(async () => {
    if (!canReconcile) return;
    if (forceSyncing) return;
    setForceSyncing(true);
    try {
      await api.post('/api/orders/force-sync', { reason: 'Admin requested resync' });
    } finally {
      setForceSyncing(false);
    }
  }, [api, canReconcile, forceSyncing]);

  async function saveCallEdit() {
    if (!editingCall) return;
    setEditSaving(true);
    await api.patch(`/api/waiter-calls/${editingCall.id}/assign`, {
      waiterId: editWaiterId || null,
    });
    await api.patch(`/api/waiter-calls/${editingCall.id}/status`, {
      status: editStatus,
      notes: editNotes,
    });
    setEditingCall(null);
    setEditSaving(false);
    load();
  }

  async function saveServiceEdit() {
    if (!editingService) return;
    setEditSaving(true);
    await api.patch(`/api/service-requests/${editingService.id}/assign`, {
      waiterId: editWaiterId || null,
    });
    await api.patch(`/api/service-requests/${editingService.id}/status`, {
      status: editStatus,
      adminNotes: editNotes,
    });
    setEditingService(null);
    setEditSaving(false);
    load();
  }

  const pendingCalls = waiterCalls.filter((c) => c.status === 'PENDING').length;
  const pendingService = serviceRequests.filter((s) => s.status === 'PENDING').length;

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="font-display text-3xl mb-2">ORDERS</h1>
        <p className="text-[var(--muted)] text-sm">
          Select a branch to view orders, waiter calls, and service requests for that branch.
        </p>
      </div>
    );

  return (
    <div className="space-y-6 animate-in">
      {onlineWaiters.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface2)] overflow-x-auto">
          <span className="text-[10px] font-bold tracking-widest text-[var(--muted)] uppercase shrink-0">
            Waiters
          </span>
          {onlineWaiters.map((w) => (
            <div
              key={w.id}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs border shrink-0 ${
                w.online
                  ? 'border-[var(--success)] text-[var(--success)] bg-[var(--surface2)]'
                  : 'border-[var(--border)] text-[var(--muted)]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${w.online ? 'bg-[var(--success)]' : 'bg-[var(--muted)]'}`}
              />
              {w.name}
            </div>
          ))}
        </div>
      )}
      {/* Tabs */}
      <div className="flex flex-col gap-4">
        <div className="flex border-b border-[var(--border)] overflow-x-auto scrollbar-hide shrink-0">
          {[
            { key: 'orders', label: `Orders`, badge: null },
            { key: 'calls', label: 'Waiter Calls', badge: pendingCalls },
            { key: 'service', label: 'Service Requests', badge: pendingService },
          ].map(({ key, label, badge }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`px-4 py-2.5 text-sm font-bold tracking-wider transition-all relative shrink-0 ${activeTab === key ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              {label}
              {badge !== null && badge > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {activeTab === 'orders' && (
              <>
                <label
                  htmlFor="admin_orders_status_filter"
                  className="mb-0 normal-case text-sm shrink-0"
                >
                  Filter:
                </label>
                <select
                  id="admin_orders_status_filter"
                  name="status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full sm:w-auto text-sm"
                  autoComplete="off"
                >
                  {STATUS_OPTS.map((s) => (
                    <option key={s} value={s}>
                      {s || 'All'}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {activeTab === 'orders' && canReconcile && (
              <button
                className="btn btn-secondary btn-sm disabled:opacity-50 w-full sm:w-auto"
                onClick={() => {
                  setStaleOpen(true);
                  void loadStale({ reset: true });
                }}
                disabled={staleLoading}
              >
                {staleLoading ? 'Loading…' : 'Stale Orders'}
              </button>
            )}
            {activeTab === 'orders' && canReconcile && (
              <button
                className="btn btn-secondary btn-sm disabled:opacity-50 w-full sm:w-auto"
                onClick={() => forceSync().catch(() => void 0)}
                disabled={forceSyncing}
              >
                {forceSyncing ? 'Syncing…' : 'Force Resync'}
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm disabled:opacity-50 w-full sm:w-auto"
              onClick={load}
              disabled={refreshing}
            >
              <span className={refreshing ? 'animate-spin inline-block mr-1' : 'mr-1'}>↻</span>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activeTab === 'orders' ? (
        <div className="card overflow-x-auto">
          <table className="min-w-[800px]">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Table</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[var(--muted)] py-10">
                    No orders found
                  </td>
                </tr>
              )}
              {orders.map((o) => (
                <React.Fragment key={o.id}>
                  <tr
                    className="cursor-pointer"
                    onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                  >
                    <td className="font-mono text-xs text-[var(--muted)]">
                      {o.id.slice(-6).toUpperCase()}
                    </td>
                    <td className="font-medium">{o.table?.label || '—'}</td>
                    <td className="text-[var(--muted)]">{o.items?.length ?? 0}</td>
                    <td className="text-[var(--accent)] font-semibold">
                      {formatPrice(o.total, currency)}
                    </td>
                    <td>
                      <span className={'text-xs font-bold ' + (SC[o.status] || '')}>
                        {o.status}
                      </span>
                    </td>
                    <td className="text-[var(--muted)] text-xs">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit && NEXT[o.status] && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => updateOrderStatus(o.id, NEXT[o.status])}
                        >
                          → {NEXT[o.status]}
                        </button>
                      )}
                      {canEdit && o.status !== 'CANCELLED' && o.status !== 'SERVED' && (
                        <button
                          className="btn btn-sm border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white text-xs px-3 py-1 ml-1"
                          onClick={() => {
                            setCancellingOrderId(o.id);
                            setCancellationReason('');
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr>
                      <td colSpan={7} className="bg-[var(--surface2)] p-4">
                        <div className="space-y-1">
                          {(o.items ?? []).map((item: any) => (
                            <div
                              key={item.id}
                              className={`flex items-center gap-3 text-sm ${item.cancelledAt ? 'opacity-40' : ''}`}
                            >
                              <span className="text-[var(--accent)] font-bold w-6">
                                {item.quantity}×
                              </span>
                              <span
                                className={`font-medium ${item.cancelledAt ? 'line-through text-[var(--muted)]' : ''}`}
                              >
                                {item.menuItem?.name || item.menuItemId}
                                {item.cancelledAt && (
                                  <span className="text-xs text-[var(--danger)] ml-2">
                                    ({item.cancelReason ?? 'Cancelled'})
                                  </span>
                                )}
                              </span>
                              {item.notes && !item.cancelledAt && (
                                <span className="text-[var(--muted)] italic">"{item.notes}"</span>
                              )}
                              <span className="ml-auto text-[var(--muted)]">
                                {item.cancelledAt
                                  ? '—'
                                  : formatPrice(Number(item.unitPrice) * item.quantity, currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                        {o.notes && (
                          <p className="text-xs text-[var(--muted)] mt-2 border-t border-[var(--border)] pt-2">
                            Note: {o.notes}
                          </p>
                        )}

                        {o.status === 'READY' && (
                          <div className="mt-3 pt-3 border-t border-[var(--border)]">
                            <div className="text-xs font-bold tracking-widest text-[var(--muted)] uppercase">
                              Assign to Waiter
                            </div>
                            {onlineWaiters.length > 0 ? (
                              <div className="mt-2 flex items-center gap-2">
                                <select
                                  className="text-sm"
                                  value={o.assignedWaiter ?? ''}
                                  onChange={(e) =>
                                    assignOrderWaiter(o.id, e.target.value ? e.target.value : null)
                                  }
                                  disabled={orderAssigningId === o.id}
                                >
                                  <option value="">— Unassigned —</option>
                                  {onlineWaiters.map((w) => (
                                    <option key={w.id} value={w.id}>
                                      {w.name}
                                      {w.online ? ' (online)' : ''}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-xs text-[var(--muted)]">
                                  {orderAssigningId === o.id ? 'Assigning…' : ''}
                                </span>
                              </div>
                            ) : (
                              <div className="mt-2 text-sm text-[var(--muted)]">
                                No waiters found for this branch.
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {ordersHasMore && (
            <div className="flex items-center justify-center p-3 border-t border-[var(--border)]">
              <button
                className="btn btn-secondary btn-sm disabled:opacity-50"
                onClick={loadMoreOrders}
                disabled={ordersLoadingMore}
              >
                {ordersLoadingMore ? 'Loading…' : 'Load Older'}
              </button>
            </div>
          )}
        </div>
      ) : activeTab === 'calls' ? (
        <div className="card overflow-x-auto">
          <table className="min-w-[700px]">
            <thead>
              <tr>
                <th>Table</th>
                <th>Reason</th>
                <th>Notes</th>
                <th>Status</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {waiterCalls.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-[var(--muted)] py-10">
                    No waiter calls
                  </td>
                </tr>
              )}
              {waiterCalls.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.table?.label || '—'}</td>
                  <td className="text-[var(--muted)]">{c.reason || '—'}</td>
                  <td className="text-[var(--muted)] text-xs max-w-xs truncate">
                    {c.notes || '—'}
                  </td>
                  <td>
                    <span
                      className={`text-xs font-bold ${
                        c.status === 'PENDING'
                          ? 'text-[var(--warning)]'
                          : c.status === 'RESOLVED'
                            ? 'text-[var(--success)]'
                            : 'text-[var(--info)]'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="text-[var(--muted)] text-xs">
                    {new Date(c.createdAt).toLocaleString()}
                  </td>
                  <td>
                    {canEdit && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingCall(c);
                          setEditNotes(c.notes || '');
                          setEditStatus(c.status);
                          setEditWaiterId(c.assignedTo || '');
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-[800px]">
            <thead>
              <tr>
                <th>Table</th>
                <th>Type</th>
                <th>Customer Notes</th>
                <th>Admin Notes</th>
                <th>Status</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {serviceRequests.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[var(--muted)] py-10">
                    No service requests
                  </td>
                </tr>
              )}
              {serviceRequests.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.table?.label || '—'}</td>
                  <td>
                    {s.serviceType === 'BILL_REQUEST' ? (
                      <span className="text-xs font-bold text-amber-400 border border-amber-800/50 px-1.5 py-0.5 bg-amber-900/10">
                        Bill Request
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">{s.serviceType}</span>
                    )}
                  </td>
                  <td className="text-[var(--muted)] text-xs max-w-xs truncate">
                    {s.notes || '—'}
                  </td>
                  <td className="text-[var(--muted)] text-xs max-w-xs truncate">
                    {s.adminNotes || '—'}
                  </td>
                  <td>
                    <span
                      className={`text-xs font-bold ${
                        s.status === 'PENDING'
                          ? 'text-[var(--warning)]'
                          : s.status === 'RESOLVED'
                            ? 'text-[var(--success)]'
                            : 'text-[var(--info)]'
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="text-[var(--muted)] text-xs">
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  <td>
                    {canEdit && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingService(s);
                          setEditNotes(s.adminNotes || '');
                          setEditStatus(s.status);
                          setEditWaiterId(s.assignedTo || '');
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Waiter Call Modal */}
      {editingCall && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setEditingCall(null)}
        >
          <div
            className="card w-full max-w-md p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-2xl">EDIT WAITER CALL</h2>
            <div>
              <p className="text-sm text-[var(--muted)]">
                Table:{' '}
                <span className="text-[var(--text)] font-medium">{editingCall.table?.label}</span>
              </p>
              <p className="text-sm text-[var(--muted)]">
                Reason: <span className="text-[var(--text)]">{editingCall.reason || '—'}</span>
              </p>
            </div>
            <div>
              <label htmlFor="admin_edit_call_waiter">Assign to Waiter</label>
              <select
                id="admin_edit_call_waiter"
                name="waiterId"
                value={editWaiterId}
                onChange={(e) => setEditWaiterId(e.target.value)}
                autoComplete="off"
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
            <div>
              <label htmlFor="admin_edit_call_status">Status</label>
              <select
                id="admin_edit_call_status"
                name="status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                autoComplete="off"
              >
                <option value="PENDING">PENDING</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="RESOLVED">RESOLVED</option>
              </select>
            </div>
            <div>
              <label htmlFor="admin_edit_call_notes">Notes (visible to staff only)</label>
              <textarea
                id="admin_edit_call_notes"
                name="adminNotes"
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="resize-none"
                placeholder="Add resolution notes…"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingCall(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={saveCallEdit}
                disabled={editSaving}
                className="btn btn-primary flex-1 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Service Request Modal */}
      {editingService && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setEditingService(null)}
        >
          <div
            className="card w-full max-w-md p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-2xl">EDIT SERVICE REQUEST</h2>
            <div>
              <p className="text-sm text-[var(--muted)]">
                Table:{' '}
                <span className="text-[var(--text)] font-medium">
                  {editingService.table?.label}
                </span>
              </p>
              <p className="text-sm text-[var(--muted)]">
                Type:{' '}
                <span className="text-[var(--text)] font-semibold">
                  {editingService.serviceType}
                </span>
              </p>
              {editingService.notes && (
                <p className="text-sm text-[var(--muted)]">
                  Customer note: "{editingService.notes}"
                </p>
              )}
            </div>
            <div>
              <label htmlFor="admin_edit_service_waiter">Assign to Waiter</label>
              <select
                id="admin_edit_service_waiter"
                name="waiterId"
                value={editWaiterId}
                onChange={(e) => setEditWaiterId(e.target.value)}
                autoComplete="off"
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
            <div>
              <label htmlFor="admin_edit_service_status">Status</label>
              <select
                id="admin_edit_service_status"
                name="status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                autoComplete="off"
              >
                <option value="PENDING">PENDING</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="RESOLVED">RESOLVED</option>
              </select>
            </div>
            <div>
              <label htmlFor="admin_edit_service_notes">Admin Notes (staff only)</label>
              <textarea
                id="admin_edit_service_notes"
                name="adminNotes"
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="resize-none"
                placeholder="Resolution or action taken…"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingService(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={saveServiceEdit}
                disabled={editSaving}
                className="btn btn-primary flex-1 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {staleOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setStaleOpen(false)}
        >
          <div className="card w-full max-w-4xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">STALE ORDERS</h2>
                <p className="text-sm text-[var(--muted)]">
                  Orders older than the threshold based on last update time.
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setStaleOpen(false)}>
                Close
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="admin_stale_min_age" className="mb-0 text-sm">
                    Min age (minutes)
                  </label>
                  <input
                    id="admin_stale_min_age"
                    name="minAgeMinutes"
                    type="number"
                    min={5}
                    max={43200}
                    value={staleMinAgeMinutes}
                    onChange={(e) => setStaleMinAgeMinutes(Number(e.target.value))}
                    className="w-28 text-sm"
                  />
                  <button
                    className="btn btn-secondary btn-sm disabled:opacity-50"
                    onClick={() => loadStale({ reset: true })}
                    disabled={staleLoading}
                  >
                    {staleLoading ? 'Loading…' : 'Reload'}
                  </button>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    className="btn btn-secondary btn-sm disabled:opacity-50"
                    onClick={() =>
                      setStaleSelected((prev) => {
                        if (prev.size === staleOrders.length) return new Set();
                        return new Set(staleOrders.map((o) => o.id));
                      })
                    }
                    disabled={staleOrders.length === 0}
                  >
                    {staleSelected.size === staleOrders.length && staleOrders.length > 0
                      ? 'Clear'
                      : 'Select All'}
                  </button>
                  <button
                    className="btn btn-primary btn-sm disabled:opacity-50"
                    onClick={() => reconcileSelected('SERVE')}
                    disabled={staleSelected.size === 0 || staleActionLoading}
                  >
                    {staleActionLoading ? 'Working…' : 'Serve Selected'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
                <div className="flex-1">
                  <label htmlFor="admin_stale_cancel_reason" className="text-sm">
                    Cancel reason (required for cancel)
                  </label>
                  <input
                    id="admin_stale_cancel_reason"
                    name="cancelReason"
                    value={staleCancelReason}
                    onChange={(e) => setStaleCancelReason(e.target.value)}
                    className="w-full text-sm"
                    placeholder="Backlog cleanup"
                  />
                </div>
                <button
                  className="btn btn-sm border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white disabled:opacity-50"
                  onClick={() => reconcileSelected('CANCEL')}
                  disabled={staleSelected.size === 0 || staleActionLoading}
                >
                  {staleActionLoading ? 'Working…' : 'Cancel Selected'}
                </button>
              </div>
            </div>

            <div className="card overflow-x-auto">
              <table className="min-w-[900px]">
                <thead>
                  <tr>
                    <th />
                    <th>Order</th>
                    <th>Table</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {staleOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-[var(--muted)] py-10">
                        No stale orders found
                      </td>
                    </tr>
                  )}
                  {staleOrders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={staleSelected.has(o.id)}
                          onChange={() =>
                            setStaleSelected((prev) => {
                              const n = new Set(prev);
                              if (n.has(o.id)) n.delete(o.id);
                              else n.add(o.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="font-mono text-xs text-[var(--muted)]">
                        {String(o.id).slice(-6).toUpperCase()}
                      </td>
                      <td className="font-medium">{o.table?.label || '—'}</td>
                      <td>
                        <span className={'text-xs font-bold ' + (SC[o.status] || '')}>
                          {o.status}
                        </span>
                      </td>
                      <td className="text-[var(--muted)] text-xs">
                        {o.updatedAt ? new Date(o.updatedAt).toLocaleString() : '—'}
                      </td>
                      <td className="text-[var(--muted)] text-xs">
                        {o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {staleHasMore && (
                <div className="flex items-center justify-center p-3 border-t border-[var(--border)]">
                  <button
                    className="btn btn-secondary btn-sm disabled:opacity-50"
                    onClick={() => loadStale({ reset: false })}
                    disabled={staleLoading}
                  >
                    {staleLoading ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {cancellingOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-[var(--text)]">Cancel Order</h3>
            <p className="text-sm text-[var(--muted)]">
              Provide a reason for cancellation. This will be visible to the customer.
            </p>
            <textarea
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="e.g. Item no longer available, kitchen closing soon…"
              rows={3}
              className="w-full bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--text)] px-3 py-2 focus:outline-none focus:border-[var(--accent)] resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setCancellingOrderId(null)}
                className="btn btn-sm border border-[var(--border)] text-[var(--muted)] px-4 py-1.5 text-sm"
              >
                Keep Order
              </button>
              <button
                onClick={async () => {
                  await updateOrderStatus(
                    cancellingOrderId,
                    'CANCELLED',
                    cancellationReason || undefined,
                  );
                  setCancellingOrderId(null);
                }}
                className="btn btn-sm bg-[var(--danger)] text-white border-transparent px-4 py-1.5 text-sm"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
