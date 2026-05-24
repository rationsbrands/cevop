export const API_BASE = (
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4000' : '')
).replace(/\/$/, '');

export async function fetchTableInfo(orgId: string, tableId: string) {
  const res = await fetch(`${API_BASE}/api/tables/public/${orgId}/${tableId}`);
  if (!res.ok) throw new Error('Table not found');
  const { data } = await res.json();
  return data; // includes branchId, branchName
}

export async function fetchMenu(orgId: string, branchId?: string | null) {
  const baseUrl = API_BASE || window.location.origin;
  const url = new URL(`${baseUrl}/api/menu/public/${orgId}`);
  if (branchId) url.searchParams.set('branchId', branchId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to load menu');
  const { data } = await res.json();
  return data;
}

export async function submitOrder(payload: {
  organizationId: string;
  tableId: string;
  branchId?: string | null;
  idempotencyKey: string;
  items: Array<{ menuItemId: string; quantity: number; notes?: string }>;
  notes?: string;
}) {
  const res = await fetch(`${API_BASE}/api/orders/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to place order');
  }
  return res.json();
}

export async function fetchHelpOptions(orgId: string, branchId?: string | null) {
  const baseUrl = API_BASE || window.location.origin;
  const url = new URL(`${baseUrl}/api/help-options/public`);
  url.searchParams.set('organizationId', orgId);
  if (branchId) url.searchParams.set('branchId', branchId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to load help options');
  const { data } = await res.json();
  return data;
}

export async function fetchOrderStatus(orderId: string) {
  const res = await fetch(`${API_BASE}/api/orders/public/${orderId}`);
  if (!res.ok) throw new Error('Order not found');
  const { data } = await res.json();
  return data;
}

export async function callWaiter(payload: {
  organizationId: string;
  tableId: string;
  branchId?: string | null;
  reason?: string;
}) {
  const res = await fetch(`${API_BASE}/api/waiter-calls/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let errBody: any = {};
    try {
      errBody = await res.json();
    } catch {
      void 0;
    }
    throw new Error(errBody.error || errBody.message || res.statusText || 'Failed to call waiter');
  }
  return res.json();
}

export async function requestService(payload: {
  organizationId: string;
  tableId: string;
  branchId?: string | null;
  serviceType: string;
  notes?: string;
}) {
  const res = await fetch(`${API_BASE}/api/service-requests/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let errBody: any = {};
    try {
      errBody = await res.json();
    } catch {
      void 0;
    }
    throw new Error(
      errBody.error || errBody.message || res.statusText || 'Failed to submit service request',
    );
  }
  return res.json();
}
