import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi, useAuth } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';
import { printReceipt } from '../utils/printReceipt';
import { showToast } from '../components/Popup';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  categoryId: string;
}
interface Category {
  id: string;
  name: string;
  menuItems: MenuItem[];
}
interface CartLine {
  item: MenuItem;
  quantity: number;
}

const METHODS = ['CASH', 'CARD', 'TRANSFER'] as const;
type Method = (typeof METHODS)[number];

export function RegisterPage() {
  const api = useApi();
  const { user } = useAuth();
  const currency = (user as any)?.organization?.currency ?? 'NGN';

  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [activeCat, setActiveCat] = useState<string>('');
  const [search, setSearch] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [chargeOpen, setChargeOpen] = useState(false);
  const [method, setMethod] = useState<Method>('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [lastSale, setLastSale] = useState<{ orderNumber: number; total: number } | null>(null);

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ['register-menu', api.effectiveBranchId],
    queryFn: async () => {
      const res = await api.get('/api/menu');
      return res.success ? res.data : [];
    },
    enabled: !!api.effectiveBranchId,
  });

  // Tax + service charge rates — branch overrides org. Fetched once on load so the
  // ticket can show a live breakdown that matches what the server will charge.
  const { data: rates = { taxRate: 0, serviceRate: 0 } } = useQuery({
    queryKey: ['register-rates', api.effectiveBranchId],
    queryFn: async () => {
      const [branchRes, orgRes] = await Promise.all([
        api.get('/api/branches/' + api.effectiveBranchId),
        api.get('/api/orgs/me'),
      ]);
      const b = branchRes.success ? branchRes.data : null;
      const o = orgRes.success ? orgRes.data : null;
      return {
        taxRate: Number(b?.taxRate ?? o?.taxRate ?? 0),
        serviceRate: Number(b?.serviceChargeRate ?? o?.serviceChargeRate ?? 0),
      };
    },
    enabled: !!api.effectiveBranchId,
  });

  const lines = Object.values(cart);
  const subtotal = lines.reduce((s, l) => s + Number(l.item.price) * l.quantity, 0);
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  // Live breakdown — mirrors the server's calculation exactly
  const taxAmount = Number(((subtotal * rates.taxRate) / 100).toFixed(2));
  const serviceAmount = Number(((subtotal * rates.serviceRate) / 100).toFixed(2));
  const total = Number((subtotal + taxAmount + serviceAmount).toFixed(2));

  const visibleItems = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (q) {
      return categories
        .flatMap((c) => c.menuItems)
        .filter((i) => i.isAvailable && i.name.toLowerCase().includes(q));
    }
    const cat = activeCat ? categories.find((c) => c.id === activeCat) : categories[0];
    return (cat?.menuItems ?? []).filter((i) => i.isAvailable);
  }, [categories, activeCat, search]);

  function addItem(item: MenuItem) {
    setCart((prev) => ({
      ...prev,
      [item.id]: { item, quantity: (prev[item.id]?.quantity ?? 0) + 1 },
    }));
  }
  function decItem(id: string) {
    setCart((prev) => {
      const next = { ...prev };
      if (!next[id]) return prev;
      if (next[id].quantity > 1) next[id] = { ...next[id], quantity: next[id].quantity - 1 };
      else delete next[id];
      return next;
    });
  }
  function clearCart() {
    setCart({});
    setCustomerName('');
  }

  async function charge() {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post('/api/orders/counter', {
        method,
        customerName: customerName || undefined,
        items: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity })),
      });
      if (!res.success) {
        showToast(res.error || 'Failed to charge', 'error');
        return;
      }
      const d = res.data;
      // Print receipt
      printReceipt({
        organization: { name: (user as any)?.organization?.name || 'Cevop', currency },
        branch: { name: (user as any)?.branch?.name || '' },
        session: {
          id: d.order.id,
          table: undefined,
          assignedWaiter: { name: (user as any)?.name || '' },
          openedAt: new Date().toISOString(),
          closedAt: new Date().toISOString(),
        },
        items: d.order.items.map((i: any) => ({
          name: i.menuItem?.name ?? 'Item',
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          lineTotal: Number(i.unitPrice) * i.quantity,
        })),
        totals: {
          subtotal: d.totals.subtotal,
          taxAmount: d.totals.taxAmount,
          serviceChargeAmount: d.totals.serviceChargeAmount,
          grandTotal: d.totals.total,
          amountPaid: d.totals.total,
          balance: 0,
        },
      });
      setLastSale({ orderNumber: d.orderNumber, total: d.totals.total });
      setChargeOpen(false);
      clearCart();
      setTimeout(() => setLastSale(null), 6000);
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!api.effectiveBranchId) {
    return (
      <div className="card p-6">
        <h1 className="font-display text-3xl mb-2 uppercase">Register</h1>
        <p className="text-[var(--muted)] text-sm">Select a branch to open the counter register.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100dvh-7rem)]">
      {/* Menu side */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h1 className="font-display text-3xl uppercase">Register</h1>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="text-sm w-44"
          />
        </div>

        {/* Category tabs */}
        {!search && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 shrink-0">
            {categories.map((c, i) => {
              const active = activeCat ? activeCat === c.id : i === 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCat(c.id)}
                  className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-bold border transition-all ${
                    active
                      ? 'bg-[var(--accent)] text-black border-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Item grid */}
        <div className="flex-1 overflow-y-auto mt-2 min-h-0">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="skeleton h-20 rounded-xl" />
              ))}
            </div>
          ) : visibleItems.length === 0 ? (
            <p className="text-[var(--muted)] text-sm text-center py-10">No items</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addItem(item)}
                  className="press text-left p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] transition-colors flex flex-col justify-between min-h-20"
                >
                  <span className="font-semibold text-sm text-[var(--text)] leading-tight line-clamp-2">
                    {item.name}
                  </span>
                  <span className="text-[var(--accent)] font-bold text-sm mt-2">
                    {formatPrice(Number(item.price), currency)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ticket side */}
      <div className="w-full lg:w-80 shrink-0 card flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <span className="font-display text-lg uppercase">Ticket</span>
          {itemCount > 0 && (
            <button onClick={clearCart} className="text-xs text-[var(--danger)] font-bold">
              Clear
            </button>
          )}
        </div>

        {/* Last sale confirmation */}
        {lastSale && (
          <div className="m-3 p-3 border border-[var(--ready)] bg-[var(--ready)]/10 text-center">
            <p className="font-bold text-[var(--ready)]">
              Takeaway #{String(lastSale.orderNumber).padStart(3, '0')} paid
            </p>
            <p className="text-xs text-[var(--muted)]">{formatPrice(lastSale.total, currency)}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {lines.length === 0 ? (
            <p className="text-[var(--muted)] text-sm text-center py-8">
              Tap items to add them to the ticket
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.item.id} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => decItem(l.item.id)}
                    className="qty-btn w-7 h-7 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)] text-lg leading-none"
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-bold text-sm tabular-nums">
                    {l.quantity}
                  </span>
                  <button
                    onClick={() => addItem(l.item)}
                    className="qty-btn w-7 h-7 bg-[var(--accent)] text-black text-lg leading-none"
                  >
                    +
                  </button>
                </div>
                <span className="flex-1 text-sm font-medium truncate">{l.item.name}</span>
                <span className="text-sm font-semibold text-[var(--accent)]">
                  {formatPrice(Number(l.item.price) * l.quantity, currency)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] space-y-3">
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer name (optional)"
            className="text-sm w-full"
          />
          {/* Live breakdown — shown before charging so the cashier can read the total to the customer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm text-[var(--muted)]">
              <span>Subtotal</span>
              <span>{formatPrice(subtotal, currency)}</span>
            </div>
            {rates.taxRate > 0 && (
              <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                <span>VAT ({rates.taxRate}%)</span>
                <span>{formatPrice(taxAmount, currency)}</span>
              </div>
            )}
            {rates.serviceRate > 0 && (
              <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                <span>Service ({rates.serviceRate}%)</span>
                <span>{formatPrice(serviceAmount, currency)}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1.5 border-t border-[var(--border)]">
              <span className="font-bold text-sm uppercase tracking-wider">Total</span>
              <span className="font-display text-2xl text-[var(--accent)]">
                {formatPrice(total, currency)}
              </span>
            </div>
          </div>
          <button
            onClick={() => setChargeOpen(true)}
            disabled={lines.length === 0}
            className="btn btn-primary w-full py-3 font-bold tracking-widest disabled:opacity-40"
          >
            CHARGE {itemCount > 0 ? `(${itemCount})` : ''}
          </button>
        </div>
      </div>

      {/* Charge modal */}
      {chargeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !submitting && setChargeOpen(false)}
        >
          <div className="card w-full max-w-sm p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <p className="text-sm text-[var(--muted)] uppercase tracking-widest">Amount Due</p>
              <p className="font-display text-4xl text-[var(--accent)] mt-1">
                {formatPrice(total, currency)}
              </p>
            </div>

            {/* Breakdown so the cashier and customer see exactly what makes up the total */}
            <div className="space-y-1.5 border-y border-[var(--border)] py-3">
              <div className="flex justify-between text-sm text-[var(--muted)]">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal, currency)}</span>
              </div>
              {rates.taxRate > 0 && (
                <div className="flex justify-between text-sm text-[var(--muted)]">
                  <span>VAT ({rates.taxRate}%)</span>
                  <span>{formatPrice(taxAmount, currency)}</span>
                </div>
              )}
              {rates.serviceRate > 0 && (
                <div className="flex justify-between text-sm text-[var(--muted)]">
                  <span>Service ({rates.serviceRate}%)</span>
                  <span>{formatPrice(serviceAmount, currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold pt-1 border-t border-[var(--border)]">
                <span>Total</span>
                <span className="text-[var(--accent)]">{formatPrice(total, currency)}</span>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-2">
                Payment Method
              </p>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`py-3 text-xs font-bold border transition-all ${
                      method === m
                        ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setChargeOpen(false)}
                disabled={submitting}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={charge}
                disabled={submitting}
                className="btn btn-primary flex-1 disabled:opacity-50"
              >
                {submitting ? 'Charging…' : 'Charge & Print'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
