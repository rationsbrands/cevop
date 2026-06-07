import { apiFetch } from '../lib/api';

export interface RecipeLine {
  id: string;
  menuItemId: string;
  itemId: string;
  quantity: number;
  unit: string;
  notes?: string;
  item: {
    id: string;
    name: string;
    unitOfMeasure: string;
    costPrice: number;
    currentStock: number;
  };
}

export interface RecipeDetail {
  menuItem: { id: string; name: string; price: number };
  lines: RecipeLine[];
  cogsPerPortion: number;
}

const h = (token: string) => ({ token });

export const getRecipe = (token: string, menuItemId: string) =>
  apiFetch<{ success: boolean; data: RecipeDetail }>(`/api/recipes/${menuItemId}`, h(token));

export const saveRecipe = (
  token: string,
  menuItemId: string,
  lines: { itemId: string; quantity: number; unit: string; notes?: string }[],
) =>
  apiFetch<{ success: boolean; data: RecipeLine[] }>(`/api/recipes/${menuItemId}`, {
    ...h(token),
    method: 'PUT',
    body: { lines },
  });

export const deleteRecipe = (token: string, menuItemId: string) =>
  apiFetch<{ success: boolean }>(`/api/recipes/${menuItemId}`, { ...h(token), method: 'DELETE' });
