import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrderStatus } from '../services/api';
import { formatPrice } from '../../../../shared/utils/currency';

interface OrderItem { id: string; quantity: number; unitPrice: number; notes?: string; menuItem?: { name: string }; }
interface Order { id: string; status: string; total: number; items: OrderItem[]; table?: { label: string }; createdAt: string; organizationId: string; tableId: string; }

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
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      if (!orderId) return;
      try {
        const data = await fetchOrderStatus(orderId);
        setOrder(data);
      } catch {
        setError('Order not found');
      } finally {
        setLoading(false);
      }
    }
    load();

    // Poll every 10 seconds
    const interval = setInterval(async () => {
      if (!orderId) return;
      try {
        const data = await fetchOrderStatus(orderId);
        setOrder(data);
      } catch {}
    }, 10000);

    return () => clearInterval(interval);
  }, [orderId]);

  const currentStepIndex = order ? STATUS_STEPS.indexOf(order.status) : -1;

  if (loading) return (
    <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error || !order) return (
    <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center p-6 text-center">
      <div className="space-y-4">
        <p className="text-[var(--text)]">{error || 'Order not found'}</p>
        <button onClick={() => navigate(-1)} className="btn-secondary">Go Back</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col">
      <header className="px-4 pt-6 pb-4 border-b border-[var(--border)] safe-top">
        <button onClick={() => navigate(`/menu/${order.organizationId}/${order.tableId}`)} className="text-[var(--muted)] text-sm mb-3 flex items-center gap-1 hover:text-[var(--text)]">
          ← Back to menu
        </button>
        <h1 className="font-display text-3xl text-[var(--text)]">ORDER STATUS</h1>
        <p className="text-[var(--muted)] text-sm">#{order.id.slice(-8).toUpperCase()} · {order.table?.label}</p>
      </header>

      <main className="flex-1 p-4 space-y-6">
        {/* Status hero */}
        <div className="card p-6 text-center space-y-2">
          <div className="w-12 h-12 rounded-full mx-auto mb-1" style={{ background: STATUS_COLORS[order.status] ?? STATUS_COLORS.RECEIVED, opacity: 0.9 }} />
          <h2 className="font-display text-3xl text-[var(--accent)]">{STATUS_LABELS[order.status] || order.status}</h2>
          {order.status === 'PREPARING' && <p className="text-[var(--muted)] text-sm">Our service is working on your order</p>}
          {order.status === 'READY' && <p className="text-green-400 text-sm font-medium">Your order is ready! A waiter will bring it shortly.</p>}
          {order.status === 'SERVED' && <p className="text-[var(--muted)] text-sm">Enjoy your meal!</p>}
        </div>

        {/* Progress bar */}
        {order.status !== 'CANCELLED' && (
          <div className="space-y-3">
            <div className="flex justify-between">
              {STATUS_STEPS.map((step, i) => (
                <div key={step} className={`flex flex-col items-center flex-1 ${i < STATUS_STEPS.length - 1 ? 'relative' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition-all duration-500 ${
                    i <= currentStepIndex ? 'bg-[var(--accent)] border-[var(--accent)] text-black' : 'border-[var(--border)] text-[var(--muted)]'
                  }`}>
                    {i < currentStepIndex ? <span>&#10003;</span> : <>{i + 1}</>}
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className={`absolute top-4 left-1/2 w-full h-0.5 transition-all duration-500 ${i < currentStepIndex ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
                  )}
                  <span className={`text-xs mt-1 text-center leading-tight ${i <= currentStepIndex ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{STATUS_STEPS[i].charAt(0) + STATUS_STEPS[i].slice(1).toLowerCase()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Order items */}
        <div className="card">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider">Items Ordered</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {order.items.map((item) => (
              <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{item.quantity}× {item.menuItem?.name || '—'}</span>
                  {item.notes && <p className="text-[var(--muted)] text-xs mt-0.5">{item.notes}</p>}
                </div>
                <span className="text-[var(--accent)] text-sm font-semibold">{formatPrice(item.unitPrice * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between">
            <span className="font-semibold">Total</span>
            <span className="font-display text-2xl text-[var(--accent)]">{formatPrice(order.total)}</span>
          </div>
        </div>

        <p className="text-center text-[var(--muted)] text-xs">Page refreshes automatically every 10 seconds</p>
      </main>
    </div>
  );
}
