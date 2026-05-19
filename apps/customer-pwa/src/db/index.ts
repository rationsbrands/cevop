import Dexie, { Table } from 'dexie';

export interface PendingOrder {
  id?: number;
  idempotencyKey: string;
  organizationId: string;
  branchId?: string | null;
  tableId: string;
  items: Array<{ menuItemId: string; quantity: number; notes?: string }>;
  notes?: string;
  total: number;
  createdAt: Date;
  retryCount: number;
}

export interface CachedMenu {
  organizationId: string;
  data: unknown;
  cachedAt: Date;
}

export interface CachedOrder {
  id: string;
  organizationId: string;
  tableId: string;
  status: string;
  total: number;
  items: unknown;
  createdAt: string;
  updatedAt: string;
}

class CevopDB extends Dexie {
  pendingOrders!: Table<PendingOrder>;
  cachedMenus!: Table<CachedMenu>;
  cachedOrders!: Table<CachedOrder>;

  constructor() {
    super('cevop-customer');

    this.version(1).stores({
      pendingOrders: '++id, idempotencyKey, organizationId, tableId, createdAt',
      cachedMenus: 'organizationId, cachedAt',
      cachedOrders: 'id, organizationId, tableId, status',
    });
  }
}

export const db = new CevopDB();

// Background sync: attempt to flush pending orders
export async function syncPendingOrders(apiBase: string): Promise<void> {
  const pending = await db.pendingOrders.toArray();
  if (pending.length === 0) return;

  for (const order of pending) {
    try {
      const res = await fetch(`${apiBase}/api/orders/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: order.organizationId,
          branchId: order.branchId || undefined,
          tableId: order.tableId,
          idempotencyKey: order.idempotencyKey,
          items: order.items,
          notes: order.notes,
        }),
      });

      if (res.ok) {
        const { data } = await res.json();
        // Cache the confirmed order
        await db.cachedOrders.put({
          id: data.id,
          organizationId: data.organizationId,
          tableId: data.tableId,
          status: data.status,
          total: Number(data.total),
          items: data.items,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
        // Remove from pending
        if (order.id) await db.pendingOrders.delete(order.id);
      } else if (res.status === 400) {
        // Bad request - don't retry
        if (order.id) await db.pendingOrders.delete(order.id);
      } else {
        // Increment retry count
        if (order.id) {
          await db.pendingOrders.update(order.id, { retryCount: (order.retryCount || 0) + 1 });
        }
      }
    } catch {
      // Network error - will retry next sync
      if (order.id) {
        await db.pendingOrders.update(order.id, { retryCount: (order.retryCount || 0) + 1 });
      }
    }
  }
}
