import { useTheme } from '../context/theme';
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchTableInfo, fetchMenu, submitOrder, callWaiter, requestService, fetchHelpOptions } from '../services/api';
import { db, syncPendingOrders } from '../db';
import { formatPrice } from '../../../../shared/utils/currency';

interface MenuItem {
  id: string; name: string; description?: string; price: number; image?: string;
}
interface Category { id: string; name: string; menuItems: MenuItem[]; }
interface HelpOption { id: string; type: 'WAITER' | 'SERVICE'; label: string; icon?: string; }
interface CartItem { menuItem: MenuItem; quantity: number; notes?: string; }
interface TableInfo {
  id: string; label: string; number: number;
  organizationId: string; branchId: string | null;
  organizationName: string; organizationLogo?: string;
  branchName: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function MenuPage() {
  const { orgId, tableId } = useParams<{ orgId: string; tableId: string }>();
  const navigate = useNavigate();

  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
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
  const [cartOpen, setCartOpen] = useState(false);
  const [serviceModal, setServiceModal] = useState(false);
  const [waiterModal, setWaiterModal] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [waiterReason, setWaiterReason] = useState('');
  const [customWaiterReason, setCustomWaiterReason] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [customServiceType, setCustomServiceType] = useState('');
  const { mode, setMode } = useTheme();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const customWaiterInputRef = useRef<HTMLInputElement | null>(null);
  const customServiceInputRef = useRef<HTMLInputElement | null>(null);

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

  const closeWaiter = () => {
    setWaiterModal(false);
    setWaiterReason('');
    setCustomWaiterReason('');
  };

  const closeService = () => {
    setServiceModal(false);
    setServiceType('');
    setCustomServiceType('');
  };

  const selectWaiterReason = (label: string) => {
    setWaiterReason(label);
    if (label.trim().toLowerCase() !== 'other') setCustomWaiterReason('');
  };

  const selectServiceType = (label: string) => {
    setServiceType(label);
    if (label.trim().toLowerCase() !== 'special request') setCustomServiceType('');
  };

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
    const handleOnline = () => { setIsOnline(true); syncPendingOrders(API_BASE); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
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
          fetchHelpOptions(orgId, table.branchId)
        ]);
        setTableInfo(table);
        setCategories(menu);
        setHelpOptions(options.filter((o: any) => o.isActive));
        if (menu.length > 0) setActiveCategory(menu[0].id);

        await db.cachedMenus.put({ organizationId: orgId, data: menu, cachedAt: new Date() });
      } catch {
        const cached = await db.cachedMenus.get(orgId!);
        if (cached) {
          setCategories(cached.data as Category[]);
          const cats = cached.data as Category[];
          if (cats.length > 0) setActiveCategory(cats[0].id);
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

  const addToCart = (menuItem: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItem.id === menuItem.id);
      if (existing) return prev.map((i) => i.menuItem.id === menuItem.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { menuItem, quantity: 1 }];
    });
  };

  const removeFromCart = (menuItemId: string) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItem.id === menuItemId);
      if (existing && existing.quantity > 1) return prev.map((i) => i.menuItem.id === menuItemId ? { ...i, quantity: i.quantity - 1 } : i);
      return prev.filter((i) => i.menuItem.id !== menuItemId);
    });
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
    setSubmitting(true);

    const idempotencyKey = generateIdempotencyKey();
    const orderPayload = {
      organizationId: orgId,
      tableId,
      branchId: tableInfo?.branchId || undefined,
      idempotencyKey,
      items: cart.map((i) => ({ menuItemId: i.menuItem.id, quantity: i.quantity, notes: i.notes })),
    };

    try {
      if (isOnline) {
        const { data } = await submitOrder(orderPayload);
        clearCart();
        setCartOpen(false);
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
        showToast('Order queued — will be sent when you reconnect', 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to place order', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCallWaiter = async () => {
    if (!orgId || !tableId) return;
    if (!tableInfo) {
      showToast('Table info not loaded yet, please refresh', 'error');
      return;
    }
    if (!canSendWaiter) {
      showToast('Please enter your request', 'error');
      return;
    }
    try {
      await callWaiter({
        organizationId: orgId,
        tableId,
        branchId: tableInfo?.branchId || undefined,
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
    if (!tableInfo) {
      showToast('Table info not loaded yet, please refresh', 'error');
      return;
    }
    if (!canSendService) {
      showToast('Please enter your request', 'error');
      return;
    }
    try {
      await requestService({
        organizationId: orgId,
        tableId,
        branchId: tableInfo?.branchId || undefined,
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

  const displayName = tableInfo?.branchName ?? tableInfo?.organizationName ?? 'Cevop';

  if (loading) return (
    <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[var(--muted)] text-sm">Loading menu…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div className="text-sm font-semibold text-[var(--warning)]">Unable to load menu</div>
        <p className="text-[var(--text)]">{error}</p>
        <button className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg)] border-b border-[var(--border)] safe-top">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl text-[var(--accent)] leading-none">{displayName}</h1>
            <p className="text-[var(--muted)] text-xs mt-0.5">{tableInfo?.label || 'Your Table'}</p>
          </div>
          <div className="flex items-center gap-2">
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
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-red-400'}`} title={isOnline ? 'Online' : 'Offline'} />
            <button
              onClick={() => setWaiterModal(true)}
              className="card px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--accent)] transition-colors"
            >
              Call Waiter
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex overflow-x-auto scrollbar-none px-4 pb-3 gap-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollToCategory(cat.id)}
              className={`shrink-0 px-4 py-1.5 text-sm font-medium transition-all duration-150 border ${
                activeCategory === cat.id
                  ? 'bg-[var(--accent)] text-black border-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      {/* Menu Content */}
      <main className="flex-1 overflow-y-auto pb-32">
        {categories.map((cat) => (
          <div key={cat.id} ref={(el) => { categoryRefs.current[cat.id] = el; }} className="px-4 pt-6">
            <h2 className="font-display text-3xl text-[var(--text)] mb-3">{cat.name.toUpperCase()}</h2>
            <div className="space-y-3">
              {cat.menuItems.map((item) => {
                const cartItem = cart.find((c) => c.menuItem.id === item.id);
                return (
                  <div key={item.id} className="card p-4 flex items-start gap-4 animate-fade-in">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-[var(--text)] leading-tight">{item.name}</h3>
                      {item.description && <p className="text-[var(--muted)] text-sm mt-0.5 line-clamp-2">{item.description}</p>}
                      <p className="text-[var(--accent)] font-semibold mt-2">{formatPrice(item.price)}</p>
                    </div>
                    <div className="shrink-0">
                      {cartItem ? (
                        <div className="flex items-center gap-3">
                          <button onClick={() => removeFromCart(item.id)} className="w-8 h-8 border border-[var(--border)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors font-bold text-lg">−</button>
                          <span className="w-5 text-center font-semibold text-[var(--text)]">{cartItem.quantity}</span>
                          <button onClick={() => addToCart(item)} className="w-8 h-8 bg-[var(--accent)] text-black flex items-center justify-center font-bold text-lg transition-transform active:scale-90">+</button>
                        </div>
                      ) : (
                        <button onClick={() => addToCart(item)} className="w-8 h-8 bg-[var(--accent)] text-black flex items-center justify-center font-bold text-xl transition-transform active:scale-90">+</button>
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
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setWaiterModal(true)} className="card p-4 text-left hover:border-[var(--accent)] transition-colors">
                <div className="w-8 h-8 border border-[var(--accent)] rounded-sm mx-auto mb-2 flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
                <div className="font-semibold text-sm">Call Waiter</div>
                <div className="text-[var(--muted)] text-xs mt-0.5">We'll be right over</div>
              </button>
              <button onClick={() => setServiceModal(true)} className="card p-4 text-left hover:border-[var(--accent)] transition-colors">
                <div className="w-8 h-8 border border-[var(--border)] rounded-sm mx-auto mb-2 flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
                <div className="font-semibold text-sm">Request Service</div>
                <div className="text-[var(--muted)] text-xs mt-0.5">Refills, extras & more</div>
              </button>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-[var(--muted)] text-center font-bold tracking-widest opacity-50 uppercase mb-8">
          Powered by <span className="brand-mark text-[var(--text)]">CEVOP</span>
        </p>
      </main>

      {/* Cart FAB */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 safe-bottom">
          <button
            onClick={() => setCartOpen(true)}
            className="btn-primary w-full flex items-center justify-between py-4 animate-slide-up animate-pulse-glow"
          >
            <span className="bg-black/20 rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold">{cartCount}</span>
            <span className="font-semibold tracking-wide">VIEW ORDER</span>
            <span className="font-semibold">{formatPrice(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* Cart Modal */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setCartOpen(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative bg-[var(--surface)] border-t border-[var(--border)] max-h-[80dvh] flex flex-col animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <h2 className="font-display text-2xl">YOUR ORDER</h2>
              <button onClick={() => setCartOpen(false)} className="text-[var(--muted)] text-xl hover:text-[var(--text)] p-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {cart.map((item) => (
                <div key={item.menuItem.id} className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => removeFromCart(item.menuItem.id)} className="w-7 h-7 border border-[var(--border)] flex items-center justify-center text-[var(--muted)] hover:border-red-500 hover:text-red-400 transition-colors">−</button>
                    <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                    <button onClick={() => addToCart(item.menuItem)} className="w-7 h-7 border border-[var(--border)] flex items-center justify-center text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">+</button>
                  </div>
                  <span className="flex-1 text-sm font-medium">{item.menuItem.name}</span>
                  <span className="text-[var(--accent)] text-sm font-semibold">{formatPrice(item.menuItem.price * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-[var(--border)] space-y-3 safe-bottom">
              <div className="flex items-center justify-between">
                <span className="text-[var(--muted)]">Total</span>
                <span className="font-display text-2xl text-[var(--accent)]">{formatPrice(cartTotal)}</span>
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
        <div className="fixed inset-0 z-50 flex items-end" onClick={closeWaiter}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full bg-[var(--surface)] border-t border-[var(--border)] p-4 space-y-4 animate-slide-up safe-bottom" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl">CALL WAITER</h2>
            <div className="grid grid-cols-2 gap-2">
              {helpOptions.filter(o => o.type === 'WAITER').length > 0 ? (
                helpOptions.filter(o => o.type === 'WAITER').map((opt) => (
                  <button key={opt.id} onClick={() => selectWaiterReason(opt.label)} className={`py-2 px-3 text-sm border transition-all ${waiterReason === opt.label ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'}`}>
                    {opt.icon && <span className="mr-2">{opt.icon}</span>}
                    {opt.label}
                  </button>
                ))
              ) : (
                ['Need help', 'Extra napkins', 'Bill please', 'Refill drinks', 'Another round', 'Other'].map((r) => (
                  <button key={r} onClick={() => selectWaiterReason(r)} className={`py-2 px-3 text-sm border transition-all ${waiterReason === r ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'}`}>{r}</button>
                ))
              )}
            </div>
            {waiterIsOther && (
              <div className="space-y-2">
                <label className="text-xs text-[var(--muted)] font-semibold">Your request</label>
                <input
                  ref={customWaiterInputRef}
                  value={customWaiterReason}
                  onChange={(e) => setCustomWaiterReason(e.target.value)}
                  placeholder="Type what you need…"
                  className="w-full bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={closeWaiter} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCallWaiter} disabled={!canSendWaiter} className="btn-primary flex-1 disabled:opacity-50">Call Waiter</button>
            </div>
          </div>
        </div>
      )}

      {/* Service Modal */}
      {serviceModal && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={closeService}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full bg-[var(--surface)] border-t border-[var(--border)] p-4 space-y-4 animate-slide-up safe-bottom" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl">REQUEST SERVICE</h2>
            <div className="grid grid-cols-2 gap-2">
              {helpOptions.filter(o => o.type === 'SERVICE').length > 0 ? (
                helpOptions.filter(o => o.type === 'SERVICE').map((opt) => (
                  <button key={opt.id} onClick={() => selectServiceType(opt.label)} className={`py-2 px-3 text-sm border transition-all ${serviceType === opt.label ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'}`}>
                    {opt.icon && <span className="mr-2">{opt.icon}</span>}
                    {opt.label}
                  </button>
                ))
              ) : (
                ['Refill water', 'More cutlery', 'Takeaway box', 'Baby chair', 'Complaint', 'Special request'].map((s) => (
                  <button key={s} onClick={() => selectServiceType(s)} className={`py-2 px-3 text-sm border transition-all ${serviceType === s ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'}`}>{s}</button>
                ))
              )}
            </div>
            {serviceIsSpecial && (
              <div className="space-y-2">
                <label className="text-xs text-[var(--muted)] font-semibold">Your request</label>
                <input
                  ref={customServiceInputRef}
                  value={customServiceType}
                  onChange={(e) => setCustomServiceType(e.target.value)}
                  placeholder="Type what you need…"
                  className="w-full bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={closeService} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleServiceRequest} disabled={!canSendService} className="btn-primary flex-1 disabled:opacity-50">Send Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-4 right-4 z-[100] p-3 border text-sm font-medium animate-slide-up ${toast.type === 'success' ? 'bg-green-900/80 border-green-700 text-green-200' : 'bg-red-900/80 border-red-700 text-red-200'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
