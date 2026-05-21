import React, { useEffect, useState, useCallback } from 'react';
import { useApi } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';

interface Category {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
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
}

type ModalMode = 'add-cat' | 'edit-cat' | 'add-item' | 'edit-item' | null;

export function MenuPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalMode>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [catForm, setCatForm] = useState({
    name: '',
    description: '',
    sortOrder: 0,
    isActive: true,
  });
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    categoryId: '',
    sortOrder: 0,
    isAvailable: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeCat, setActiveCat] = useState<string>('');
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  function moveById<T extends { id: string }>(list: T[], fromId: string, toId: string): T[] {
    const fromIndex = list.findIndex((x) => x.id === fromId);
    const toIndex = list.findIndex((x) => x.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return list;
    const next = [...list];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get('/api/menu');
    if (res.success) {
      setCategories(res.data);
      if (res.data.length > 0) setActiveCat((prev) => prev || res.data[0].id);
    }
    setLoading(false);
  }, [api]);

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
        load();
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
        load();
      }
    },
    [api, load],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  function openAddCat() {
    const nextSort = categories.reduce((max, c) => Math.max(max, c.sortOrder ?? 0), 0) + 10;
    setCatForm({ name: '', description: '', sortOrder: nextSort, isActive: true });
    setModal('add-cat');
    setError('');
  }
  function openEditCat(cat: Category) {
    setCatForm({
      name: cat.name,
      description: cat.description || '',
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
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
      const body = { ...catForm, sortOrder: Number(catForm.sortOrder) };
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
    if (!confirm('Delete this category and all its items?')) return;
    await api.delete('/api/menu/categories/' + id);
    load();
  }

  async function saveItem() {
    setSaving(true);
    setError('');
    try {
      const body = {
        ...itemForm,
        price: parseFloat(itemForm.price),
        sortOrder: Number(itemForm.sortOrder),
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
    if (!confirm('Delete this item?')) return;
    await api.delete('/api/menu/items/' + id);
    load();
  }

  const currentCat = categories.find((c) => c.id === activeCat);

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">MENU</h1>
        <button className="btn btn-primary btn-sm" onClick={openAddCat}>
          + Add Category
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
                  <span className="text-xs text-[var(--muted)]">
                    {cat.menuItems?.length ?? 0} items
                  </span>
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
                      <th></th>
                      <th>Name</th>
                      <th>Description</th>
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
                        <td className="font-medium">{item.name}</td>
                        <td className="text-[var(--muted)] text-xs max-w-xs truncate">
                          {item.description || '—'}
                        </td>
                        <td className="text-[var(--accent)] font-semibold">
                          {formatPrice(item.price)}
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
                  <label>Name *</label>
                  <input
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label>Description</label>
                  <input
                    value={catForm.description}
                    onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="ca"
                    checked={catForm.isActive}
                    onChange={(e) => setCatForm({ ...catForm, isActive: e.target.checked })}
                    className="w-auto"
                  />
                  <label htmlFor="ca" className="mb-0 normal-case text-sm text-[var(--text)]">
                    Active
                  </label>
                </div>
              </div>
            )}
            {(modal === 'add-item' || modal === 'edit-item') && (
              <div className="space-y-3">
                <div>
                  <label>Name *</label>
                  <input
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label>Description</label>
                  <textarea
                    rows={2}
                    value={itemForm.description}
                    onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                    className="resize-none"
                  />
                </div>
                <div>
                  <label>Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                  />
                </div>
                <div>
                  <label>Category</label>
                  <select
                    value={itemForm.categoryId}
                    onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })}
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
                    checked={itemForm.isAvailable}
                    onChange={(e) => setItemForm({ ...itemForm, isAvailable: e.target.checked })}
                    className="w-auto"
                  />
                  <label htmlFor="ia" className="mb-0 normal-case text-sm text-[var(--text)]">
                    Available
                  </label>
                </div>
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
