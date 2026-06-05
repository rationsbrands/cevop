import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatPrice } from '../../../../shared/utils/currency';
import { useAuth } from '../services/auth';
import { AutoFitText } from './AutoFitText';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

interface WaiterPOSProps {
  onClose: () => void;
  onOrderSuccess: () => void;
  initialTableId?: string;
}

export function WaiterPOS({ onClose, onOrderSuccess, initialTableId }: WaiterPOSProps) {
  const { token, user } = useAuth() as any;
  // Keep a ref so async query functions always use the latest token
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedTableId, setSelectedTableId] = useState(initialTableId || '');
  const [cart, setCart] = useState<
    { menuItemId: string; quantity: number; notes: string; menuItem: any }[]
  >([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const { data: tables = [] } = useQuery({
    queryKey: ['tables', user?.branchId],
    queryFn: async () => {
      const bq = user?.branchId ? `?branchId=${user.branchId}` : '';
      const res = await fetch(`${API_BASE}/api/tables${bq}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      const json = await res.json();
      return json.success ? json.data : [];
    },
    enabled: !!token,
  });

  const { data: menuData = { categories: [], items: [] }, isLoading: menuLoading } = useQuery({
    queryKey: ['menu', user?.branchId],
    queryFn: async () => {
      const bq = user?.branchId ? `?branchId=${user.branchId}` : '';
      const res = await fetch(`${API_BASE}/api/menu${bq}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      const json = await res.json();
      if (json.success) {
        const categories = json.data;
        const items = categories.flatMap((c: any) => c.menuItems || []);
        return { categories, items };
      }
      return { categories: [], items: [] };
    },
    enabled: !!token,
  });

  const categories = menuData.categories;
  const menuItems = menuData.items;
  const loading = menuLoading;

  const activeCategoryId = selectedCategoryId || (categories.length > 0 ? categories[0].id : null);

  const activeMenuItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      // Search across all categories if there's a search query
      return menuItems.filter(
        (m: any) =>
          m.isAvailable &&
          (m.name.toLowerCase().includes(query) ||
            m.category?.name?.toLowerCase().includes(query) ||
            m.description?.toLowerCase().includes(query)),
      );
    }
    if (!activeCategoryId) return [];
    // Only show items belonging to the active category
    return menuItems.filter((m: any) => m.categoryId === activeCategoryId && m.isAvailable);
  }, [menuItems, activeCategoryId, searchQuery]);

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + Number(item.menuItem.price) * item.quantity, 0);
  }, [cart]);

  function addToCart(item: any) {
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItemId === item.id);
      if (existing) {
        return prev.map((i) => (i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { menuItemId: item.id, quantity: 1, notes: '', menuItem: item }];
    });
  }

  function updateQuantity(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.menuItemId === id) {
            const newQ = i.quantity + delta;
            return newQ > 0 ? { ...i, quantity: newQ } : i;
          }
          return i;
        })
        .filter((i) => i.quantity > 0),
    );
  }

  async function handleSubmit() {
    if (!selectedTableId || cart.length === 0 || !token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tableId: selectedTableId,
          notes: orderNotes,
          items: cart.map((c: any) => ({
            menuItemId: c.menuItemId,
            quantity: c.quantity,
            notes: c.notes,
          })),
        }),
      }).then((r) => r.json());

      if (res.success) {
        onOrderSuccess();
      } else {
        alert('Failed to place order: ' + (res.error || 'Unknown error'));
      }
    } catch {
      alert('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[var(--bg)] overflow-hidden flex flex-col md:flex-row">
      {/* Header - Mobile Only */}
      <div className="md:hidden p-2 sm:p-3 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface)] shrink-0 gap-2">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={onClose} className="p-2 -ml-1 text-[var(--text)] shrink-0">
            ✕
          </button>
          <h2 className="font-display font-bold text-[var(--accent)] text-sm sm:text-base truncate">
            NEW ORDER
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Integrated Search for Mobile Header to save space */}
          <div className="relative hidden xs:block w-32 sm:w-48">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-full py-1.5 pl-8 pr-3 text-xs focus:border-[var(--accent)] outline-none"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-[10px]">
              🔍
            </span>
          </div>

          <button
            onClick={() => setIsCartOpen(true)}
            className="relative p-2 bg-[var(--surface2)] rounded-lg flex items-center gap-2"
          >
            <span className="text-sm">🛒</span>
            {cart.length > 0 && (
              <span className="bg-[var(--accent)] text-black text-[10px] font-black px-1.5 py-0.5 rounded-md min-w-[18px] text-center">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Content: Categories & Items */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg)] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[var(--muted)] font-display animate-pulse">
            LOADING MENU...
          </div>
        ) : (
          <>
            {/* Sticky Header: Categories & Search */}
            <div className="border-b border-[var(--border)] bg-[var(--surface)] shrink-0 z-10">
              <div className="flex overflow-x-auto p-2 sm:p-4 gap-1.5 sm:gap-2 no-scrollbar">
                <button
                  onClick={() => {
                    setSelectedCategoryId(null);
                    setSearchQuery('');
                  }}
                  className={`px-3 sm:px-5 py-1.5 sm:py-2.5 whitespace-nowrap rounded-full text-[10px] sm:text-sm font-bold transition-all border ${
                    !selectedCategoryId && !searchQuery
                      ? 'bg-[var(--accent)] text-black border-[var(--accent)]'
                      : 'bg-[var(--surface2)] text-[var(--text)] border-transparent hover:border-[var(--border)] opacity-60'
                  }`}
                >
                  All Items
                </button>
                {categories.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCategoryId(c.id);
                      setSearchQuery('');
                    }}
                    className={`px-3 sm:px-5 py-1.5 sm:py-2.5 whitespace-nowrap rounded-full text-[10px] sm:text-sm font-bold transition-all border ${
                      activeCategoryId === c.id && !searchQuery
                        ? 'bg-[var(--accent)] text-black border-[var(--accent)] shadow-lg shadow-[var(--accent)]/10'
                        : 'bg-[var(--surface2)] text-[var(--text)] border-transparent hover:border-[var(--border)] opacity-60'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              {/* Search Bar - Mobile optimization (hide if integrated above on larger mobile) */}
              <div className="px-2 sm:px-4 pb-2 sm:pb-4 xs:hidden">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">
                    🔍
                  </span>
                  <input
                    type="text"
                    placeholder="Search dishes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl py-2 pl-9 pr-8 text-xs focus:border-[var(--accent)] outline-none transition-all placeholder:text-[var(--muted)]/50"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-[var(--surface2)] text-[var(--muted)] text-[10px]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Desktop Search Bar (shown on tablets/desktops) */}
              <div className="hidden sm:block px-4 pb-4">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)] text-sm">
                    🔍
                  </span>
                  <input
                    type="text"
                    placeholder="Search dishes, drinks..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl py-3 pl-11 pr-10 text-sm focus:border-[var(--accent)] outline-none transition-all placeholder:text-[var(--muted)]/50"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-[var(--surface2)] text-[var(--muted)]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Menu Items Grid */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4 content-start">
                {activeMenuItems.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="group relative flex flex-col p-3 sm:p-4 text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl hover:border-[var(--accent)] transition-all active:scale-[0.98]"
                  >
                    <div className="font-bold text-xs sm:text-sm leading-tight line-clamp-2 mb-1 group-hover:text-[var(--accent)] transition-colors">
                      {item.name}
                    </div>
                    {item.description && (
                      <div className="text-[10px] text-[var(--muted)] line-clamp-1 mb-2 hidden sm:block">
                        {item.description}
                      </div>
                    )}
                    <div className="mt-auto pt-2 flex items-center justify-between">
                      <div className="text-[var(--accent)] font-bold text-xs sm:text-sm">
                        {formatPrice(item.price)}
                      </div>
                      <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center text-[var(--accent)] group-hover:bg-[var(--accent)] group-hover:text-black transition-all font-bold">
                        +
                      </div>
                    </div>
                  </button>
                ))}
                {activeMenuItems.length === 0 && (
                  <div className="col-span-full py-20 text-center">
                    <div className="text-4xl mb-4 opacity-20">🍽️</div>
                    <div className="text-[var(--muted)] text-sm font-display uppercase tracking-widest">
                      No items found
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Cart Sidebar (Desktop) / Drawer (Mobile) */}
      <div
        className={`
        fixed inset-0 z-[60] md:relative md:inset-auto md:z-auto
        w-full md:w-[380px] lg:w-[420px] 
        flex flex-col shrink-0 bg-[var(--surface)] border-l border-[var(--border)]
        transition-transform duration-300 ease-in-out
        ${isCartOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
      `}
      >
        {/* Cart Header */}
        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold">CURRENT ORDER</h2>
            {cart.length > 0 && (
              <span className="bg-[var(--accent)] text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </div>
          <button
            onClick={() => {
              setIsCartOpen(false);
              if (window.innerWidth >= 768) onClose();
            }}
            className="p-2 hover:bg-[var(--surface2)] rounded-xl transition-colors text-[var(--muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        {/* Table Selection & Notes */}
        <div className="p-4 border-b border-[var(--border)] space-y-4 bg-[var(--surface2)]/50">
          <div>
            <label className="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-1">
              ASSIGN TO TABLE
            </label>
            <select
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl py-3 px-4 text-sm focus:border-[var(--accent)] outline-none appearance-none font-bold"
            >
              <option value="">-- CHOOSE TABLE --</option>
              {tables.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.label || t.number}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-1">
              ORDER NOTES (OPTIONAL)
            </label>
            <textarea
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="e.g. No onions, extra spicy..."
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl py-3 px-4 text-sm focus:border-[var(--accent)] outline-none min-h-[60px] resize-none"
            />
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {cart.map((item, idx) => (
            <div
              key={idx}
              className="flex flex-col p-3 border border-[var(--border)] rounded-2xl bg-[var(--bg)] shadow-sm"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="min-w-0 pr-2">
                  <div className="font-bold text-sm leading-tight mb-0.5">{item.menuItem.name}</div>
                  <div className="text-[10px] text-[var(--muted)] font-mono">
                    {formatPrice(item.menuItem.price)} / unit
                  </div>
                </div>
                <div className="font-bold text-sm text-[var(--accent)] shrink-0">
                  {formatPrice(Number(item.menuItem.price) * item.quantity)}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-[var(--surface2)] rounded-xl p-1">
                  <button
                    onClick={() => updateQuantity(item.menuItemId, -1)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--surface3)] font-bold text-lg active:scale-90"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold w-8 text-center text-sm">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.menuItemId, 1)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--surface3)] font-bold text-lg active:scale-90"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={() => updateQuantity(item.menuItemId, -999)}
                  className="text-[10px] text-[var(--danger)] uppercase font-bold tracking-widest px-2 py-1 hover:bg-[var(--danger)]/10 rounded-lg"
                >
                  REMOVE
                </button>
              </div>
              {/* Per-item special instructions */}
              <input
                type="text"
                maxLength={200}
                placeholder="Special instructions (e.g. no onions, well done…)"
                value={item.notes}
                onChange={(e) =>
                  setCart((prev) =>
                    prev.map((c) =>
                      c.menuItemId === item.menuItemId ? { ...c, notes: e.target.value } : c,
                    ),
                  )
                }
                className="mt-2 w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg py-2 px-3 text-xs focus:border-[var(--accent)] outline-none placeholder-[var(--muted)]/60"
              />
            </div>
          ))}
          {cart.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center py-20 text-center">
              <div className="text-4xl mb-4 opacity-10">🛍️</div>
              <div className="text-[var(--muted)] text-sm font-display uppercase tracking-widest">
                Cart is empty
              </div>
            </div>
          )}
        </div>

        {/* Checkout Footer */}
        <div className="p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] shadow-[0_-10px_20px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between items-center mb-6 gap-4">
            <span className="font-display font-bold text-[var(--muted)] tracking-widest shrink-0">
              TOTAL
            </span>
            <div className="flex-1 text-right max-w-[200px]">
              <AutoFitText
                className="font-display font-bold text-[var(--accent)]"
                maxFontSize="1.5rem"
              >
                {formatPrice(cartTotal)}
              </AutoFitText>
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedTableId || cart.length === 0}
            className="w-full h-16 rounded-2xl bg-[var(--accent)] text-black font-display font-black text-lg tracking-widest shadow-xl shadow-[var(--accent)]/20 active:scale-[0.98] disabled:opacity-30 disabled:grayscale transition-all flex items-center justify-center gap-3"
          >
            {submitting ? (
              <>
                <span className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                PLACING...
              </>
            ) : (
              'PLACE ORDER'
            )}
          </button>
        </div>
      </div>

      {/* Mobile Cart Overlay - Darkens background when drawer is open */}
      {isCartOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-[55] md:hidden backdrop-blur-sm"
          onClick={() => setIsCartOpen(false)}
        />
      )}

      {/* Floating Action Button (Mobile Only) */}
      {cart.length > 0 && !isCartOpen && (
        <button
          onClick={() => setIsCartOpen(true)}
          className="fixed bottom-6 right-6 z-40 md:hidden bg-[var(--accent)] text-black w-16 h-16 rounded-full shadow-2xl shadow-[var(--accent)]/40 flex items-center justify-center animate-bounce-slow"
        >
          <div className="relative">
            <span className="text-2xl">🛒</span>
            <span className="absolute -top-3 -right-3 bg-black text-[var(--accent)] text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-[var(--accent)]">
              {cart.reduce((s, i) => s + i.quantity, 0)}
            </span>
          </div>
        </button>
      )}
    </div>
  );
}
