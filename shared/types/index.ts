// ─────────────────────────────────────────────
// Cevop – Shared Types
// ─────────────────────────────────────────────

export type OrderStatus = 'RECEIVED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'BRANCH_ADMIN' | 'SERVICE' | 'WAITER';
export type WaiterCallStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
export type ServiceRequestStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  whatsappNumber?: string;
  slackWebhook?: string;
  timezone: string;
  currency: string;
  isActive: boolean;
  plan: string;
  planStatus: string;
  trialEndsAt?: string;
  selfSignup: boolean;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  branchId?: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface Table {
  id: string;
  organizationId: string;
  branchId?: string;
  label: string;
  number: number;
  isActive: boolean;
  qrCode?: string;
}

export interface Category {
  id: string;
  organizationId: string;
  branchId?: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuItem {
  id: string;
  organizationId: string;
  branchId?: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  image?: string;
  isAvailable: boolean;
  sortOrder: number;
  category?: Category;
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
  menuItem?: MenuItem;
}

export interface Order {
  id: string;
  organizationId: string;
  branchId?: string;
  tableId: string;
  idempotencyKey: string;
  status: OrderStatus;
  total: number;
  notes?: string;
  items: OrderItem[];
  table?: Table;
  createdAt: string;
  updatedAt: string;
}

export interface WaiterCall {
  id: string;
  organizationId: string;
  branchId?: string;
  tableId: string;
  reason?: string;
  status: WaiterCallStatus;
  table?: Table;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceRequest {
  id: string;
  organizationId: string;
  branchId?: string;
  tableId: string;
  serviceType: string;
  notes?: string;
  status: ServiceRequestStatus;
  table?: Table;
  createdAt: string;
  updatedAt: string;
}

// WebSocket event payloads
export interface WsEvent {
  type: WsEventType;
  payload: unknown;
  organizationId: string;
  branchId?: string;
}

export type WsEventType =
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'WAITER_CALLED'
  | 'WAITER_CALL_UPDATED'
  | 'SERVICE_REQUESTED'
  | 'SERVICE_REQUEST_UPDATED'
  | 'MENU_UPDATED';

// Cart types (client-side only)
export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
}

export interface AuthPayload {
  userId: string;
  organizationId: string;
  branchId?: string;
  role: string;
  plan?: string;
  impersonating?: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
