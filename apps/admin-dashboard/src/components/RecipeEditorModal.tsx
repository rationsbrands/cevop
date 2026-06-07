import { useState, useEffect } from 'react';
import { useAuth } from '../context/auth';
import { useApi } from '../hooks/useFetch';
import { getRecipe, saveRecipe, type RecipeLine } from '../services/recipes';
import { getItems } from '../services/inventory';
import { formatCurrency } from '../lib/utils';

interface Props {
  menuItem: { id: string; name: string; price: number };
  branchId?: string;
  onClose: () => void;
}

type DraftLine = {
  itemId: string;
  quantity: string;
  unit: string;
  notes: string;
};

export default function RecipeEditorModal({ menuItem, branchId, onClose }: Props) {
  const { token, user } = useAuth();
  const currency = user?.organization?.currency ?? 'NGN';

  const { data: recipeRes, loading: recipeLoading } = useApi(
    () => getRecipe(token!, menuItem.id),
    [token, menuItem.id],
  );
  const { data: itemsRes } = useApi(() => getItems(token!, { branchId }), [token, branchId]);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const inventoryItems = itemsRes?.data ?? [];
  const recipe = recipeRes?.data;

  // Populate lines once recipe loads
  useEffect(() => {
    if (recipe) {
      if (recipe.lines.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLines(
          recipe.lines.map((l: RecipeLine) => ({
            itemId: l.itemId,
            quantity: String(l.quantity),
            unit: l.unit,
            notes: l.notes ?? '',
          })),
        );
      } else {
        setLines([{ itemId: '', quantity: '', unit: 'KG', notes: '' }]);
      }
    }
  }, [recipe]);

  function addLine() {
    setLines([...lines, { itemId: '', quantity: '', unit: 'KG', notes: '' }]);
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof DraftLine, value: string) {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'itemId') {
      const inv = inventoryItems.find((i) => i.id === value);
      if (inv) next[idx].unit = inv.unitOfMeasure;
    }
    setLines(next);
  }

  // Theoretical COGS per portion
  const cogsPerPortion = lines.reduce((sum, l) => {
    const inv = inventoryItems.find((i) => i.id === l.itemId);
    return sum + (Number(l.quantity) || 0) * (inv ? Number(inv.costPrice) : 0);
  }, 0);

  const grossMargin =
    menuItem.price > 0 ? ((menuItem.price - cogsPerPortion) / menuItem.price) * 100 : 0;

  async function handleSave() {
    const valid = lines.filter((l) => l.itemId && Number(l.quantity) > 0);
    if (valid.length === 0 && lines.some((l) => l.itemId)) {
      setError('Each ingredient needs a quantity greater than 0.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveRecipe(
        token!,
        menuItem.id,
        valid.map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unit: l.unit,
          notes: l.notes || undefined,
        })),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save recipe');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl animate-in overflow-y-auto"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="card-header">
          <div>
            <div className="font-bold" style={{ color: 'var(--text)' }}>
              Recipe — {menuItem.name}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Define ingredients deducted from stock when this dish is sold
            </div>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}>
            ✕
          </button>
        </div>

        <div className="card-body space-y-5">
          {/* Cost summary banner */}
          <div
            className="flex items-center justify-between rounded-lg px-4 py-3"
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
          >
            <div className="text-sm">
              <span style={{ color: 'var(--muted)' }}>Selling price: </span>
              <span className="font-bold" style={{ color: 'var(--text)' }}>
                {formatCurrency(menuItem.price, currency)}
              </span>
            </div>
            <div className="text-sm">
              <span style={{ color: 'var(--muted)' }}>COGS/portion: </span>
              <span className="font-bold" style={{ color: 'var(--danger)' }}>
                {formatCurrency(cogsPerPortion, currency)}
              </span>
            </div>
            <div className="text-sm">
              <span style={{ color: 'var(--muted)' }}>Gross margin: </span>
              <span
                className="font-bold"
                style={{
                  color:
                    grossMargin >= 60
                      ? 'var(--success)'
                      : grossMargin >= 30
                        ? 'var(--warning)'
                        : 'var(--danger)',
                }}
              >
                {grossMargin.toFixed(1)}%
              </span>
            </div>
          </div>

          {error && (
            <div
              className="text-xs px-3 py-2 rounded-lg"
              style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
            >
              {error}
            </div>
          )}

          {recipeLoading ? (
            <div className="text-sm py-4 text-center" style={{ color: 'var(--muted)' }}>
              Loading recipe…
            </div>
          ) : (
            <>
              {/* Ingredients */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label style={{ marginBottom: 0 }}>Ingredients</label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addLine}>
                    + Add Ingredient
                  </button>
                </div>

                {lines.length === 0 ? (
                  <div className="text-sm py-4 text-center" style={{ color: 'var(--muted)' }}>
                    No ingredients yet. Add the first one above.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Column headers */}
                    <div
                      className="grid text-xs font-semibold px-1"
                      style={{
                        gridTemplateColumns: '2fr 1fr 1fr 1.5fr auto',
                        color: 'var(--muted)',
                        gap: '8px',
                      }}
                    >
                      <span>Ingredient</span>
                      <span>Qty per portion</span>
                      <span>Unit</span>
                      <span>Notes</span>
                      <span></span>
                    </div>

                    {lines.map((line, idx) => {
                      const inv = inventoryItems.find((i) => i.id === line.itemId);
                      const lineCost =
                        (Number(line.quantity) || 0) * (inv ? Number(inv.costPrice) : 0);
                      return (
                        <div
                          key={idx}
                          className="grid items-center"
                          style={{ gridTemplateColumns: '2fr 1fr 1fr 1.5fr auto', gap: '8px' }}
                        >
                          <select
                            value={line.itemId}
                            onChange={(e) => updateLine(idx, 'itemId', e.target.value)}
                          >
                            <option value="">— Select item —</option>
                            {inventoryItems.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unitOfMeasure})
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            placeholder="0.000"
                            value={line.quantity}
                            onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                          />
                          <select
                            value={line.unit}
                            onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                          >
                            {[
                              'KG',
                              'G',
                              'LB',
                              'OZ',
                              'L',
                              'ML',
                              'PCS',
                              'BOX',
                              'CARTON',
                              'BAG',
                              'BOTTLE',
                              'PACK',
                              'PORTION',
                              'SERVING',
                            ].map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-col gap-1">
                            <input
                              type="text"
                              placeholder="Optional note"
                              value={line.notes}
                              onChange={(e) => updateLine(idx, 'notes', e.target.value)}
                            />
                            {line.itemId && lineCost > 0 && (
                              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                                Cost: {formatCurrency(lineCost, currency)}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            style={{ color: 'var(--danger)', flexShrink: 0 }}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {!branchId && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--warning-dim)', color: 'var(--warning)' }}
                >
                  No branch selected — inventory items may not show. Select a branch in the sidebar
                  for accurate ingredient lists.
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-2">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Recipe'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
