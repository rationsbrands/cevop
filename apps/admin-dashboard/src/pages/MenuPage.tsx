import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApi, useAuth } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';
import { ConfirmDialog, showToast } from '../components/Popup';

interface Category {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  branchId: string | null;
  menuItems: MenuItem[];
}
interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
  categoryId: string;
  branchId: string | null;
}

type ModalMode = 'add-cat' | 'edit-cat' | 'add-item' | 'edit-item' | null;

export function MenuPage() {
  const { user } = useAuth();
  const api = useApi();
  const currency = user?.organization?.currency ?? 'NGN';
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [useOrgMenu, setUseOrgMenu] = useState<boolean>(true);
  const [orgMenuSaving, setOrgMenuSaving] = useState(false);
  const [modal, setModal] = useState<ModalMode>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [catForm, setCatForm] = useState({
    name: '',
    description: '',
    sortOrder: 0,
    isActive: true,
    scope: 'branch',
  });
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    categoryId: '',
    sortOrder: 0,
    isAvailable: true,
    scope: 'branch',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeCat, setActiveCat] = useState<string>('');
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmLabel, setConfirmLabel] = useState('Confirm');
  const [confirmVariant, setConfirmVariant] = useState<'default' | 'danger'>('default');
  const confirmActionRef = useRef<null | (() => Promise<void> | void)>(null);

  function openConfirm(opts: {
    title: string;
    message?: string;
    confirmLabel?: string;
    variant?: 'default' | 'danger';
    action: () => Promise<void> | void;
  }) {
    confirmActionRef.current = opts.action;
    setConfirmTitle(opts.title);
    setConfirmMessage(opts.message ?? '');
    setConfirmLabel(opts.confirmLabel ?? 'Confirm');
    setConfirmVariant(opts.variant ?? 'default');
    setConfirmOpen(true);
  }

  async function onConfirm() {
    if (confirmBusy) return;
    const action = confirmActionRef.current;
    if (!action) {
      setConfirmOpen(false);
      return;
    }
    setConfirmBusy(true);
    try {
      await action();
      setConfirmOpen(false);
    } catch (e: any) {
      showToast(e?.message ? String(e.message) : 'Action failed', 'error');
    } finally {
      setConfirmBusy(false);
    }
  }

  function moveById<T extends { id: string }>(list: T[], fromId: string, toId: string): T[] {
    const fromIndex = list.findIndex((x) => x.id === fromId);
    const toIndex = list.findIndex((x) => x.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return list;
    const next = [...list];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  }

  const load = useCallback(
    async (cancelled = false) => {
      setLoading(true);
      if (!api.effectiveBranchId) {
        if (!cancelled) {
          setCategories([]);
          setLoading(false);
        }
        return;
      }
      const [menuRes, branchRes] = await Promise.all([
        api.get('/api/menu'),
        api.get('/api/branches/' + api.effectiveBranchId),
      ]);
      if (!cancelled) {
        if (menuRes.success) {
          setCategories(menuRes.data);
          if (menuRes.data.length > 0) setActiveCat((prev) => prev || menuRes.data[0].id);
        }
        if (branchRes.success) {
          setUseOrgMenu(branchRes.data.useOrgMenu ?? true);
        }
        setLoading(false);
      }
    },
    [api],
  );

  const persistCategoryOrder = useCallback(
    async (nextCategories: Category[]) => {
      try {
        const updated = nextCategories.map((c, i) => ({ ...c, sortOrder: i * 10 }));
        setCategories(updated);
        await Promise.all(
          updated.map((c) => api.put('/api/menu/categories/' + c.id, { sortOrder: c.sortOrder })),
        );
      } catch {
        setError('Failed to save category order');
        void load();
      }
    },
    [api, load],
  );

  const persistItemOrder = useCallback(
    async (categoryId: string, nextItems: MenuItem[]) => {
      try {
        const updatedItems = nextItems.map((it, i) => ({ ...it, sortOrder: i * 10 }));
        setCategories((prev) =>
          prev.map((c) => (c.id === categoryId ? { ...c, menuItems: updatedItems } : c)),
        );
        await Promise.all(
          updatedItems.map((it) =>
            api.put('/api/menu/items/' + it.id, { sortOrder: it.sortOrder }),
          ),
        );
      } catch {
        setError('Failed to save item order');
        void load();
      }
    },
    [api, load],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load(cancelled).catch(() => void 0);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  function openAddCat() {
    const nextSort = categories.reduce((max, c) => Math.max(max, c.sortOrder ?? 0), 0) + 10;
    setCatForm({ name: '', description: '', sortOrder: nextSort, isActive: true, scope: 'branch' });
    setModal('add-cat');
    setError('');
  }
  function openEditCat(cat: Category) {
    setCatForm({
      name: cat.name,
      description: cat.description || '',
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
      scope: cat.branchId === null ? 'org' : 'branch',
    });
    setEditTarget(cat);
    setModal('edit-cat');
    setError('');
  }
  function openAddItem(catId: string) {
    const cat = categories.find((c) => c.id === catId);
    const nextSort =
      (cat?.menuItems ?? []).reduce((max, it) => Math.max(max, it.sortOrder ?? 0), 0) + 10;
    setItemForm({
      name: '',
      description: '',
      price: '',
      categoryId: catId,
      sortOrder: nextSort,
      isAvailable: true,
      scope: 'branch',
    });
    setModal('add-item');
    setError('');
  }
  function openEditItem(item: MenuItem) {
    setItemForm({
      name: item.name,
      description: item.description || '',
      price: String(item.price),
      categoryId: item.categoryId,
      sortOrder: item.sortOrder,
      isAvailable: item.isAvailable,
      scope: item.branchId === null ? 'org' : 'branch',
    });
    setEditTarget(item);
    setModal('edit-item');
    setError('');
  }
  function closeModal() {
    setModal(null);
    setEditTarget(null);
    setError('');
  }

  async function saveCat() {
    setSaving(true);
    setError('');
    try {
      const body = {
        name: catForm.name,
        description: catForm.description,
        sortOrder: Number(catForm.sortOrder),
        isActive: catForm.isActive,
        branchId: catForm.scope === 'org' ? null : api.effectiveBranchId,
      };
      const res =
        modal === 'add-cat'
          ? await api.post('/api/menu/categories', body)
          : await api.put('/api/menu/categories/' + editTarget.id, body);
      if (!res.success) throw new Error(res.error);
      closeModal();
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function deleteCat(id: string) {
    openConfirm({
      title: 'Delete Category',
      message: 'Delete this category and all its items?',
      confirmLabel: 'Delete',
      variant: 'danger',
      action: async () => {
        await api.delete('/api/menu/categories/' + id);
        await load();
      },
    });
  }

  async function saveItem() {
    setSaving(true);
    setError('');
    try {
      const body = {
        name: itemForm.name,
        description: itemForm.description,
        categoryId: itemForm.categoryId,
        isAvailable: itemForm.isAvailable,
        price: parseFloat(itemForm.price),
        sortOrder: Number(itemForm.sortOrder),
        branchId: itemForm.scope === 'org' ? null : api.effectiveBranchId,
      };
      if (!body.price || isNaN(body.price)) throw new Error('Valid price required');
      const res =
        modal === 'add-item'
          ? await api.post('/api/menu/items', body)
          : await api.put('/api/menu/items/' + editTarget.id, body);
      if (!res.success) throw new Error(res.error);
      closeModal();
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function toggleItem(item: MenuItem) {
    await api.patch('/api/menu/items/' + item.id + '/toggle', {});
    load();
  }
  async function deleteItem(id: string) {
    openConfirm({
      title: 'Delete Item',
      message: 'Delete this item?',
      confirmLabel: 'Delete',
      variant: 'danger',
      action: async () => {
        await api.delete('/api/menu/items/' + id);
        await load();
      },
    });
  }

  async function bulkToggleCategory(catId: string, isAvailable: boolean) {
    openConfirm({
      title: 'Bulk Update',
      message: `Mark all items in this category as ${isAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}?`,
      confirmLabel: 'Apply',
      action: async () => {
        await api.patch(`/api/menu/categories/${catId}/bulk-toggle`, { isAvailable });
        await load();
      },
    });
  }

  const currentCat = categories.find((c) => c.id === activeCat);

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (!api.effectiveBranchId)
    return (
      <div className="card p-6">
        <h1 className="font-display text-3xl mb-2">MENU</h1>
        <p className="text-[var(--muted)] text-sm">
          Select a branch to manage menu items for that branch.
        </p>
      </div>
    );

  const canManageOrgWide = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(
    user?.role ?? '',
  );
  const canEditItem = (item: MenuItem): boolean => {
    if (canManageOrgWide) return true;
    return item.branchId !== null;
  };
  const canEditCategory = (cat: Category): boolean => {
    if (canManageOrgWide) return true;
    return cat.branchId !== null;
  };

  return (
    <div className="space-y-6 animate-in">
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        variant={confirmVariant}
        busy={confirmBusy}
        onCancel={() => {
          if (confirmBusy) return;
          setConfirmOpen(false);
        }}
        onConfirm={() => void onConfirm()}
      />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">MENU</h1>
        <button className="btn btn-primary btn-sm" onClick={openAddCat}>
          + Add Category
        </button>
      </div>

      {/* Branch menu mode banner */}
      <div
        className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border gap-4 ${
          useOrgMenu
            ? 'border-[var(--border)] bg-[var(--surface)]'
            : 'border-[var(--accent)]/40 bg-[var(--accent)]/5'
        }`}
      >
        <div>
          <p className="text-sm font-bold text-[var(--text)]">
            {useOrgMenu ? 'Using Organisation Menu' : 'Independent Branch Menu'}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {useOrgMenu
              ? 'This branch shows org-wide items plus any branch-specific additions.'
              : 'This branch has an independent menu. Org-wide items are not shown to customers here.'}
          </p>
        </div>
        <button
          className={`text-xs font-bold px-3 py-1.5 border transition-all shrink-0 ${
            useOrgMenu
              ? 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              : 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
          }`}
          disabled={orgMenuSaving}
          onClick={async () => {
            setOrgMenuSaving(true);
            const next = !useOrgMenu;
            const res = await api.put(`/api/branches/${api.effectiveBranchId}`, {
              useOrgMenu: next,
            });
            if (res.success) setUseOrgMenu(next);
            setOrgMenuSaving(false);
          }}
        >
          {orgMenuSaving
            ? 'Saving…'
            : useOrgMenu
              ? 'Switch to Independent Menu'
              : 'Switch to Org Menu'}
        </button>
      </div>
      <div className="flex gap-4 flex-col lg:flex-row overflow-hidden">
        <div className="lg:w-64 shrink-0 flex lg:flex-col overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 gap-2 scrollbar-hide">
          {categories.map((cat) => (
            <div
              key={cat.id}
              data-reorder-id={cat.id}
              className={
                'p-3 border transition-all shrink-0 w-48 lg:w-auto ' +
                (activeCat === cat.id
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'card hover:border-[var(--accent)]')
              }
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="touch-none select-none cursor-grab active:cursor-grabbing text-[var(--muted)] hover:text-[var(--text)] px-1 -ml-1"
                  onPointerDown={(e) => {
                    setDraggingCategoryId(cat.id);
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!draggingCategoryId) return;
                    const el = document.elementFromPoint(
                      e.clientX,
                      e.clientY,
                    ) as HTMLElement | null;
                    const target = el?.closest('[data-reorder-id]') as HTMLElement | null;
                    const overId = target?.dataset.reorderId;
                    if (!overId || overId === draggingCategoryId) return;
                    setCategories((prev) => moveById(prev, draggingCategoryId, overId));
                  }}
                  onPointerUp={async (e) => {
                    if (!draggingCategoryId) return;
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    const finalId = draggingCategoryId;
                    setDraggingCategoryId(null);
                    const el = document.elementFromPoint(
                      e.clientX,
                      e.clientY,
                    ) as HTMLElement | null;
                    const target = el?.closest('[data-reorder-id]') as HTMLElement | null;
                    const overId = target?.dataset.reorderId;
                    const next = overId ? moveById(categories, finalId, overId) : categories;
                    if (next !== categories) setCategories(next);
                    await persistCategoryOrder(next);
                  }}
                  aria-label="Reorder category"
                >
                  ≡
                </button>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setActiveCat(cat.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={
                        'text-sm font-semibold ' +
                        (activeCat === cat.id ? 'text-[var(--accent)]' : 'text-[var(--text)]')
                      }
                    >
                      {cat.name}
                    </span>
                    <span className={'badge ' + (cat.isActive ? 'badge-active' : 'badge-inactive')}>
                      {cat.isActive ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-xs text-[var(--muted)]">
                      {cat.menuItems?.length ?? 0} items
                    </span>
                    {cat.branchId === null ? (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border border-[var(--border)] text-[var(--muted)] shrink-0">
                        Org-wide
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)] shrink-0">
                        This Branch
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 card">
          {!currentCat ? (
            <div className="card-body text-[var(--muted)] text-sm">Select a category</div>
          ) : (
            <>
              <div className="card-header flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div>
                  <h2 className="font-semibold">{currentCat.name}</h2>
                  {currentCat.description && (
                    <p className="text-xs text-[var(--muted)] mt-0.5">{currentCat.description}</p>
                  )}
                </div>
                <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                  {canEditCategory(currentCat) ? (
                    <>
                      <button
                        className="btn btn-secondary btn-sm shrink-0"
                        onClick={() => openEditCat(currentCat)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger btn-sm shrink-0"
                        onClick={() => deleteCat(currentCat.id)}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-[var(--muted)] italic border border-[var(--border)] px-2 py-1 flex items-center">
                      Managed by head office
                    </span>
                  )}
                  <button
                    className="btn btn-secondary btn-sm shrink-0"
                    onClick={() => bulkToggleCategory(currentCat.id, true)}
                  >
                    Enable All
                  </button>
                  <button
                    className="btn btn-secondary btn-sm shrink-0"
                    onClick={() => bulkToggleCategory(currentCat.id, false)}
                  >
                    Disable All
                  </button>
                  <button
                    className="btn btn-primary btn-sm shrink-0"
                    onClick={() => openAddItem(currentCat.id)}
                  >
                    + Item
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-10"></th>
                      <th className="w-[40%]">Name</th>
                      <th className="w-[25%]">Description</th>
                      <th>Price</th>
                      <th>Available</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(currentCat.menuItems ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center text-[var(--muted)] py-6 text-sm">
                          No items yet.
                        </td>
                      </tr>
                    )}
                    {(currentCat.menuItems ?? []).map((item) => (
                      <tr key={item.id} data-reorder-id={item.id}>
                        <td className="w-10">
                          <button
                            type="button"
                            className="touch-none select-none cursor-grab active:cursor-grabbing text-[var(--muted)] hover:text-[var(--text)] px-2"
                            onPointerDown={(e) => {
                              setDraggingItemId(item.id);
                              e.currentTarget.setPointerCapture(e.pointerId);
                            }}
                            onPointerMove={(e) => {
                              if (!draggingItemId) return;
                              const el = document.elementFromPoint(
                                e.clientX,
                                e.clientY,
                              ) as HTMLElement | null;
                              const target = el?.closest(
                                'tr[data-reorder-id]',
                              ) as HTMLElement | null;
                              const overId = target?.dataset.reorderId;
                              if (!overId || overId === draggingItemId) return;
                              setCategories((prev) =>
                                prev.map((c) =>
                                  c.id === currentCat.id
                                    ? {
                                        ...c,
                                        menuItems: moveById(
                                          c.menuItems ?? [],
                                          draggingItemId,
                                          overId,
                                        ),
                                      }
                                    : c,
                                ),
                              );
                            }}
                            onPointerUp={async (e) => {
                              if (!draggingItemId) return;
                              e.currentTarget.releasePointerCapture(e.pointerId);
                              const finalId = draggingItemId;
                              setDraggingItemId(null);
                              const el = document.elementFromPoint(
                                e.clientX,
                                e.clientY,
                              ) as HTMLElement | null;
                              const target = el?.closest(
                                'tr[data-reorder-id]',
                              ) as HTMLElement | null;
                              const overId = target?.dataset.reorderId;
                              const currentItems = (categories.find((c) => c.id === currentCat.id)
                                ?.menuItems ?? currentCat.menuItems) as MenuItem[];
                              const nextItems = overId
                                ? moveById(currentItems, finalId, overId)
                                : currentItems;
                              await persistItemOrder(currentCat.id, nextItems);
                            }}
                            aria-label="Reorder menu item"
                          >
                            ≡
                          </button>
                        </td>
                        <td className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{item.name}</span>
                            {item.branchId === null ? (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border border-[var(--border)] text-[var(--muted)] shrink-0">
                                Org-wide
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)] shrink-0">
                                This Branch
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-[var(--muted)] text-xs max-w-[180px] truncate">
                          {item.description || '—'}
                        </td>
                        <td className="text-[var(--accent)] font-semibold">
                          {formatPrice(item.price, currency)}
                        </td>
                        <td>
                          <button
                            onClick={() => toggleItem(item)}
                            className={
                              'badge cursor-pointer hover:opacity-80 ' +
                              (item.isAvailable ? 'badge-active' : 'badge-inactive')
                            }
                          >
                            {item.isAvailable ? 'YES' : 'NO'}
                          </button>
                        </td>
                        <td>
                          {canEditItem(item) ? (
                            <div className="flex gap-1">
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => openEditItem(item)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => deleteItem(item.id)}
                              >
                                Del
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-[var(--muted)] italic">
                              Managed by head office
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={closeModal}
        >
          <div
            className="card w-full max-w-md p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-2xl">
              {modal === 'add-cat'
                ? 'ADD CATEGORY'
                : modal === 'edit-cat'
                  ? 'EDIT CATEGORY'
                  : modal === 'add-item'
                    ? 'ADD ITEM'
                    : 'EDIT ITEM'}
            </h2>
            {(modal === 'add-cat' || modal === 'edit-cat') && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="menu_cat_name">Name *</label>
                  <input
                    id="menu_cat_name"
                    name="name"
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="menu_cat_description">Description</label>
                  <input
                    id="menu_cat_description"
                    name="description"
                    value={catForm.description}
                    onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="ca"
                    name="isActive"
                    checked={catForm.isActive}
                    onChange={(e) => setCatForm({ ...catForm, isActive: e.target.checked })}
                    className="w-auto"
                  />
                  <label htmlFor="ca" className="mb-0 normal-case text-sm text-[var(--text)]">
                    Active
                  </label>
                </div>
                {canManageOrgWide && (
                  <div>
                    <label className="label">Scope</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setCatForm((f) => ({ ...f, scope: 'branch' }))}
                        className={`flex-1 py-2 text-sm border transition-all ${
                          catForm.scope !== 'org'
                            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface2)]'
                        }`}
                      >
                        This Branch Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setCatForm((f) => ({ ...f, scope: 'org' }))}
                        className={`flex-1 py-2 text-sm border transition-all ${
                          catForm.scope === 'org'
                            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface2)]'
                        }`}
                      >
                        All Branches (Org-wide)
                      </button>
                    </div>
                    <p className="text-xs text-[var(--muted)] mt-1">
                      {catForm.scope === 'org'
                        ? 'This category will appear on all branches that use the org menu.'
                        : 'This category will only appear on this branch.'}
                    </p>
                  </div>
                )}
              </div>
            )}
            {(modal === 'add-item' || modal === 'edit-item') && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="menu_item_name">Name *</label>
                  <input
                    id="menu_item_name"
                    name="name"
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="menu_item_description">Description</label>
                  <textarea
                    id="menu_item_description"
                    name="description"
                    rows={2}
                    value={itemForm.description}
                    onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                    className="resize-none"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="menu_item_price">Price *</label>
                  <input
                    id="menu_item_price"
                    name="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="menu_item_category">Category</label>
                  <select
                    id="menu_item_category"
                    name="categoryId"
                    value={itemForm.categoryId}
                    onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })}
                    autoComplete="off"
                  >
                    <option value="">Select</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="ia"
                    name="isAvailable"
                    checked={itemForm.isAvailable}
                    onChange={(e) => setItemForm({ ...itemForm, isAvailable: e.target.checked })}
                    className="w-auto"
                  />
                  <label htmlFor="ia" className="mb-0 normal-case text-sm text-[var(--text)]">
                    Available
                  </label>
                </div>
                {canManageOrgWide && (
                  <div>
                    <label className="label">Scope</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setItemForm((f) => ({ ...f, scope: 'branch' }))}
                        className={`flex-1 py-2 text-sm border transition-all ${
                          itemForm.scope !== 'org'
                            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface2)]'
                        }`}
                      >
                        This Branch Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemForm((f) => ({ ...f, scope: 'org' }))}
                        className={`flex-1 py-2 text-sm border transition-all ${
                          itemForm.scope === 'org'
                            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface2)]'
                        }`}
                      >
                        All Branches (Org-wide)
                      </button>
                    </div>
                    <p className="text-xs text-[var(--muted)] mt-1">
                      {itemForm.scope === 'org'
                        ? 'This item will appear on all branches that use the org menu.'
                        : 'This item will only appear on this branch.'}
                    </p>
                  </div>
                )}
              </div>
            )}
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button className="btn btn-secondary flex-1" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="btn btn-primary flex-1"
                disabled={saving}
                onClick={modal.includes('cat') ? saveCat : saveItem}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
