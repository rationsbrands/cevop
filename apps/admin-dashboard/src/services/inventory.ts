import { apiFetch } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StockStatus = 'ok' | 'low' | 'out';
export type UOM =
  | 'KG'
  | 'G'
  | 'LB'
  | 'OZ'
  | 'L'
  | 'ML'
  | 'PCS'
  | 'BOX'
  | 'CARTON'
  | 'BAG'
  | 'BOTTLE'
  | 'PACK'
  | 'PORTION'
  | 'SERVING';

export interface InventoryCategory {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  _count?: { items: number };
}

export interface InventoryItem {
  id: string;
  organizationId: string;
  branchId: string;
  name: string;
  sku?: string;
  barcode?: string;
  description?: string;
  categoryId?: string;
  supplierId?: string;
  unitOfMeasure: UOM;
  costPrice: number;
  sellingPrice?: number;
  currentStock: number;
  reorderPoint: number;
  reorderQuantity: number;
  expiryTracking: boolean;
  yieldPercent: number;
  isActive: boolean;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
  category?: InventoryCategory;
  supplier?: { id: string; name: string };
  stockStatus: StockStatus;
}

export interface StockMovement {
  id: string;
  itemId: string;
  branchId: string;
  type: string;
  quantity: number;
  unitCost: number;
  referenceId?: string;
  referenceType?: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
  item?: { id: string; name: string; unitOfMeasure: UOM };
}

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  _count?: { items: number; purchaseOrders: number };
}

export interface PurchaseOrderLine {
  id: string;
  itemId: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  totalCost: number;
  notes?: string;
  item?: { id: string; name: string; unitOfMeasure: UOM };
}

export interface PurchaseOrder {
  id: string;
  branchId: string;
  supplierId: string;
  poNumber?: string;
  status: string;
  expectedDelivery?: string;
  deliveredAt?: string;
  subtotal: number;
  total: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  supplier?: { id: string; name: string };
  lines: PurchaseOrderLine[];
}

export interface Stocktake {
  id: string;
  branchId: string;
  reference?: string;
  startedAt: string;
  completedAt?: string;
  conductedBy?: string;
  varianceValue?: number;
  isBlindCount: boolean;
  createdAt: string;
  _count?: { lines: number };
}

export interface WastageEntry {
  id: string;
  itemId: string;
  branchId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  reason: string;
  notes?: string;
  loggedBy?: string;
  createdAt: string;
  item?: { id: string; name: string; unitOfMeasure: UOM };
}

export interface InventorySummary {
  totalItems: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalStockValue: number;
  lowStockItems: InventoryItem[];
}

// ─── API calls ────────────────────────────────────────────────────────────────

const h = (token: string) => ({ token });

// Summary
export const getSummary = (token: string, branchId?: string) =>
  apiFetch<{ success: boolean; data: InventorySummary }>('/api/inventory/summary', {
    ...h(token),
    params: { branchId },
  });

// Categories
export const getCategories = (token: string) =>
  apiFetch<{ success: boolean; data: InventoryCategory[] }>('/api/inventory/categories', h(token));
export const createCategory = (token: string, body: Partial<InventoryCategory>) =>
  apiFetch<{ success: boolean; data: InventoryCategory }>('/api/inventory/categories', {
    ...h(token),
    method: 'POST',
    body,
  });
export const updateCategory = (token: string, id: string, body: Partial<InventoryCategory>) =>
  apiFetch<{ success: boolean }>(`/api/inventory/categories/${id}`, {
    ...h(token),
    method: 'PATCH',
    body,
  });

// Items
export const getItems = (
  token: string,
  params?: { branchId?: string; categoryId?: string; status?: string; search?: string },
) =>
  apiFetch<{ success: boolean; data: InventoryItem[] }>('/api/inventory/items', {
    ...h(token),
    params,
  });
export const getItem = (token: string, id: string) =>
  apiFetch<{
    success: boolean;
    data: InventoryItem & { movements: StockMovement[]; wastageEntries: WastageEntry[] };
  }>(`/api/inventory/items/${id}`, h(token));
export const createItem = (token: string, body: Partial<InventoryItem>) =>
  apiFetch<{ success: boolean; data: InventoryItem }>('/api/inventory/items', {
    ...h(token),
    method: 'POST',
    body,
  });
export const updateItem = (token: string, id: string, body: Partial<InventoryItem>) =>
  apiFetch<{ success: boolean }>(`/api/inventory/items/${id}`, {
    ...h(token),
    method: 'PATCH',
    body,
  });

// Movements
export const getMovements = (
  token: string,
  params?: { branchId?: string; itemId?: string; type?: string; limit?: number; offset?: number },
) =>
  apiFetch<{ success: boolean; data: StockMovement[]; total: number }>('/api/inventory/movements', {
    ...h(token),
    params,
  });
export const createMovement = (
  token: string,
  body: Partial<StockMovement> & { branchId: string },
) =>
  apiFetch<{ success: boolean; data: StockMovement }>('/api/inventory/movements', {
    ...h(token),
    method: 'POST',
    body,
  });

// Suppliers
export const getSuppliers = (token: string) =>
  apiFetch<{ success: boolean; data: Supplier[] }>('/api/inventory/suppliers', h(token));
export const createSupplier = (token: string, body: Partial<Supplier>) =>
  apiFetch<{ success: boolean; data: Supplier }>('/api/inventory/suppliers', {
    ...h(token),
    method: 'POST',
    body,
  });
export const updateSupplier = (token: string, id: string, body: Partial<Supplier>) =>
  apiFetch<{ success: boolean }>(`/api/inventory/suppliers/${id}`, {
    ...h(token),
    method: 'PATCH',
    body,
  });

// Purchase Orders
export const getPurchaseOrders = (
  token: string,
  params?: { branchId?: string; status?: string; supplierId?: string },
) =>
  apiFetch<{ success: boolean; data: PurchaseOrder[] }>('/api/inventory/purchase-orders', {
    ...h(token),
    params,
  });
export const createPurchaseOrder = (token: string, body: unknown) =>
  apiFetch<{ success: boolean; data: PurchaseOrder }>('/api/inventory/purchase-orders', {
    ...h(token),
    method: 'POST',
    body,
  });
export const updatePOStatus = (token: string, id: string, status: string) =>
  apiFetch<{ success: boolean }>(`/api/inventory/purchase-orders/${id}/status`, {
    ...h(token),
    method: 'PATCH',
    body: { status },
  });
export const receivePO = (token: string, id: string, body: unknown) =>
  apiFetch<{ success: boolean }>(`/api/inventory/purchase-orders/${id}/receive`, {
    ...h(token),
    method: 'POST',
    body,
  });

// Wastage
export const getWastage = (
  token: string,
  params?: { branchId?: string; from?: string; to?: string },
) =>
  apiFetch<{ success: boolean; data: WastageEntry[] }>('/api/inventory/wastage', {
    ...h(token),
    params,
  });
export const logWastage = (token: string, body: unknown) =>
  apiFetch<{ success: boolean; data: WastageEntry }>('/api/inventory/wastage', {
    ...h(token),
    method: 'POST',
    body,
  });

// Stocktake
export const getStocktakes = (token: string, params?: { branchId?: string }) =>
  apiFetch<{ success: boolean; data: Stocktake[] }>('/api/inventory/stocktakes', {
    ...h(token),
    params,
  });
export const startStocktake = (token: string, body: unknown) =>
  apiFetch<{ success: boolean; data: Stocktake }>('/api/inventory/stocktakes', {
    ...h(token),
    method: 'POST',
    body,
  });
export const submitStocktake = (token: string, id: string, body: unknown) =>
  apiFetch<{ success: boolean; varianceValue: number }>(`/api/inventory/stocktakes/${id}/submit`, {
    ...h(token),
    method: 'POST',
    body,
  });
