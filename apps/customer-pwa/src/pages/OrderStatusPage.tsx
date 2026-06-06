import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { fetchOrderStatus, API_BASE } from '../services/api';
import { formatPrice } from '../../../../shared/utils/currency';
import { AutoFitText } from '../components/AutoFitText';

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
  menuItem?: { name: string };
  cancelledAt?: string | null;
  cancelReason?: string;
}
interface Order {
  id: string;
  status: string;
  subtotal?: number;
  taxAmount?: number;
  serviceChargeAmount?: number;
  total: number;
  items: OrderItem[];
  table?: { label: string };
  createdAt: string;
  organizationId: string;
  tableId: string;
  branchId?: string | null;
  cancellationReason?: string;
}

const STATUS_STEPS = ['RECEIVED', 'PREPARING', 'READY', 'SERVED'];
const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Order Received',
  PREPARING: 'Being Prepared',
  READY: 'Ready for Collection',
  SERVED: 'Served',
  CANCELLED: 'Cancelled',
};
// Status indicator colors — no emoji
const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'var(--info)',
  PREPARING: 'var(--warning)',
  READY: 'var(--success)',
  SERVED: 'var(--muted)',
  CANCELLED: 'var(--danger)',
};

export function OrderStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelledItemAlert, setCancelledItemAlert] = useState<string | null>(null);

  const {
    data: order,
    isLoading: loading,
    error: queryError,
  } = useQuery<Order>({
    queryKey: ['order-status', orderId],
    queryFn: async () => {
      if (!orderId) throw new Error('No order ID');
      const data = await fetchOrderStatus(orderId);

      // If order is already complete, clear it from localStorage
      if (data.status === 'SERVED' || data.status === 'CANCELLED') {
        try {
          localStorage.removeItem('lastOrderId');
          localStorage.removeItem('lastOrderOrgId');
          localStorage.removeItem('lastOrderTableId');
          removeOrderFromHistory(orderId);
        } catch {
          /* ignore */
        }
      }
      return data;
    },
    enabled: !!orderId,
    // Poll every 10s as socket fallback — catches missed updates when socket drops on mobile
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'SERVED' || status === 'CANCELLED') return false;
      return 10_000;
    },
    refetchIntervalInBackground: false,
    // Override global refetchOnWindowFocus:false — customer coming back to tab/app must see latest state
    refetchOnWindowFocus: true,
  });

  const error = queryError ? 'Order not found' : '';

  function removeOrderFromHistory(id: string) {
    try {
      const raw = localStorage.getItem('orderHistoryByTable');
      const parsed = raw ? JSON.parse(raw) : {};
      let changed = false;
      for (const k of Object.keys(parsed)) {
        if (!Array.isArray(parsed[k])) continue;
        const next = (parsed[k] as unknown[]).filter((v) => typeof v === 'string' && v !== id);
        if (next.length !== (parsed[k] as unknown[]).length) {
          parsed[k] = next;
          changed = true;
        }
      }
      if (changed) localStorage.setItem('orderHistoryByTable', JSON.stringify(parsed));
    } catch {
      void 0;
    }
  }

  useEffect(() => {
    if (!orderId) return;

    const SOCKET_URL = API_BASE || window.location.origin;
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      socket.emit('JOIN_ORDER', { orderId });
      // Re-fetch on every (re)connect — catches any status changes that happened while disconnected
      queryClient.invalidateQueries({ queryKey: ['order-status', orderId] });
    });

    socket.on('ORDER_UPDATED', (updated: Order) => {
      if (updated.id === orderId) {
        queryClient.setQueryData(['order-status', orderId], updated);
        // Clear saved order when it's done — no need to show banner anymore
        if (updated.status === 'SERVED' || updated.status === 'CANCELLED') {
          try {
            localStorage.removeItem('lastOrderId');
            localStorage.removeItem('lastOrderOrgId');
            localStorage.removeItem('lastOrderTableId');
            removeOrderFromHistory(orderId);
          } catch {
            /* ignore */
          }
        }
      }
    });

    socket.on(
      'ORDER_ITEM_CANCELLED',
      ({
        itemName,
        allCancelled,
      }: {
        itemName: string;
        reason: string;
        newTotal: number;
        allCancelled: boolean;
      }) => {
        setCancelledItemAlert(
          allCancelled
            ? 'All items in your order are unavailable. Your order has been cancelled.'
            : `${itemName} is not available at this time.`,
        );
        // Refresh the order to get updated total and items
        if (orderId) {
          queryClient.invalidateQueries({ queryKey: ['order-status', orderId] });
        }
        // Auto-dismiss after 8 seconds
        setTimeout(() => setCancelledItemAlert(null), 8000);
      },
    );

    socket.on('disconnect', () => {
      // Will reconnect automatically — the 'connect' handler above re-syncs state
    });

    return () => {
      socket.disconnect();
    };
  }, [orderId]);

  const currentStepIndex = order ? STATUS_STEPS.indexOf(order.status) : -1;

  function goBack() {
    // Use browser history if available
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    // Fallback: reconstruct the menu URL from localStorage
    try {
      const orgId = localStorage.getItem('lastOrderOrgId');
      const tableId = localStorage.getItem('lastOrderTableId');
      if (orgId && tableId) {
        navigate(`/menu/${orgId}/${tableId}`, { replace: true });
        return;
      }
    } catch {
      void 0;
    }
    // Last resort: go to app root
    navigate('/', { replace: true });
  }

  if (loading)
    return (
      <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (error || !order)
    return (
      <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center p-6 text-center">
        <div className="space-y-4">
          <p className="text-[var(--text)]">{error || 'Order not found'}</p>
          <button onClick={goBack} className="btn-secondary">
            Go Back
          </button>
        </div>
      </div>
    );

  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col">
      <header className="px-4 pt-6 pb-4 border-b border-[var(--border)] safe-top">
        <button
          onClick={goBack}
          className="text-[var(--muted)] text-sm mb-3 flex items-center gap-1 hover:text-[var(--text)]"
        >
          ← Back to menu
        </button>
        <h1 className="font-display text-3xl text-[var(--text)]">ORDER STATUS</h1>
        <p className="text-[var(--muted)] text-sm">{order.table?.label || 'Table'}</p>
      </header>

      <main className="flex-1 p-4 space-y-6">
        {cancelledItemAlert && (
          <div className="p-3 border border-[var(--danger)]/40 bg-[var(--danger)]/5 animate-fade-in">
            <p className="text-sm text-[var(--danger)]">{cancelledItemAlert}</p>
          </div>
        )}
        {/* Status hero */}
        <div className="card p-6 text-center space-y-2">
          <div
            className="w-12 h-12 rounded-full mx-auto mb-1"
            style={{
              background: STATUS_COLORS[order.status] ?? STATUS_COLORS.RECEIVED,
              opacity: 0.9,
            }}
          />
          <h2 className="font-display text-3xl text-[var(--accent)]">
            {STATUS_LABELS[order.status] || order.status}
          </h2>
          {order.status === 'PREPARING' && (
            <p className="text-[var(--muted)] text-sm">Our service is working on your order</p>
          )}
          {order.status === 'READY' && (
            <p className="text-green-400 text-sm font-medium">
              Your order is ready! A waiter will bring it shortly.
            </p>
          )}
          {order.status === 'SERVED' && (
            <p className="text-[var(--muted)] text-sm">Enjoy your meal!</p>
          )}
          {order.status === 'CANCELLED' && (
            <div className="mt-3 p-3 border border-[var(--danger)]/30 bg-[var(--danger)]/5">
              <p className="text-xs font-bold text-[var(--danger)] uppercase tracking-wider mb-1">
                Order Cancelled
              </p>
              <p className="text-sm text-[var(--muted)]">
                {order.cancellationReason || 'This order was cancelled by the restaurant.'}
              </p>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {order.status !== 'CANCELLED' && (
          <div className="space-y-3">
            <div className="flex justify-between">
              {STATUS_STEPS.map((step, i) => (
                <div
                  key={step}
                  className={`flex flex-col items-center flex-1 ${i < STATUS_STEPS.length - 1 ? 'relative' : ''}`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition-all duration-500 ${
                      i <= currentStepIndex
                        ? 'bg-[var(--accent)] border-[var(--accent)] text-black'
                        : 'border-[var(--border)] text-[var(--muted)]'
                    }`}
                  >
                    {i < currentStepIndex ? <span>&#10003;</span> : <>{i + 1}</>}
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div
                      className={`absolute top-4 left-1/2 w-full h-0.5 transition-all duration-500 ${i < currentStepIndex ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
                    />
                  )}
                  <span
                    className={`text-xs mt-1 text-center leading-tight ${i <= currentStepIndex ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}
                  >
                    {STATUS_STEPS[i].charAt(0) + STATUS_STEPS[i].slice(1).toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Order items */}
        <div className="card">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider">
              Items Ordered
            </h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {order.items.map((item) => (
              <div
                key={item.id}
                className={`px-4 py-3 flex items-center justify-between ${item.cancelledAt ? 'opacity-50' : ''}`}
              >
                <div className="min-w-0">
                  <span
                    className={`font-medium text-sm truncate block ${item.cancelledAt ? 'line-through' : ''}`}
                  >
                    {item.quantity}× {item.menuItem?.name || '—'}
                  </span>
                  {item.notes && !item.cancelledAt && (
                    <p className="text-[var(--muted)] text-xs mt-0.5 truncate">{item.notes}</p>
                  )}
                  {item.cancelledAt && (
                    <p className="text-[var(--danger)] text-[10px] font-bold uppercase tracking-wider mt-0.5">
                      Not available at this time
                    </p>
                  )}
                </div>
                <span
                  className={`text-[var(--accent)] text-sm font-semibold shrink-0 ${item.cancelledAt ? 'invisible' : ''}`}
                >
                  {formatPrice(item.unitPrice * item.quantity)}
                </span>
              </div>
            ))}
          </div>
          {/* Breakdown */}
          {(order.taxAmount || order.serviceChargeAmount) && order.subtotal != null ? (
            <div className="px-4 pt-3 space-y-1.5">
              <div className="flex justify-between text-sm text-[var(--muted)]">
                <span>Subtotal</span>
                <span>{formatPrice(order.subtotal)}</span>
              </div>
              {order.taxAmount ? (
                <div className="flex justify-between text-sm text-[var(--muted)]">
                  <span>VAT / Tax</span>
                  <span>{formatPrice(order.taxAmount)}</span>
                </div>
              ) : null}
              {order.serviceChargeAmount ? (
                <div className="flex justify-between text-sm text-[var(--muted)]">
                  <span>Service Charge</span>
                  <span>{formatPrice(order.serviceChargeAmount)}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between gap-4 mt-1">
            <span className="font-semibold shrink-0">Total</span>
            <div className="flex-1 text-right max-w-[200px]">
              <AutoFitText className="font-display text-[var(--accent)]" maxFontSize="1.5rem">
                {formatPrice(order.total)}
              </AutoFitText>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
