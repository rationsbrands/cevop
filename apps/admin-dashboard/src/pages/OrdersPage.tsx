import React, { useEffect, useState } from 'react';
import { useAuth, useApi } from '../context/auth';
import { formatPrice } from '../../../../shared/utils/currency';

const STATUS_OPTS = ['', 'RECEIVED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
const SC: Record<string, string> = {
  RECEIVED: 'text-blue-400', PREPARING: 'text-yellow-400',
  READY: 'text-green-400', SERVED: 'text-gray-500', CANCELLED: 'text-red-400',
};
const NEXT: Record<string, string> = { RECEIVED: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };

interface WaiterCall {
  id: string; status: string; reason?: string; notes?: string;
  table?: { label: string }; createdAt: string;
}
interface ServiceRequest {
  id: string; status: string; serviceType: string; notes?: string; adminNotes?: string;
  table?: { label: string }; createdAt: string;
}

export function OrdersPage() {
  const { activeBranchFilter, user } = useAuth();
  const api = useApi();
  const canEdit = user && ['SUPERADMIN', 'ADMIN', 'BRANCH_ADMIN', 'SERVICE'].includes(user.role);
  const [orders, setOrders] = useState<any[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'calls' | 'service'>('orders');

  // Edit modal for waiter calls / service requests
  const [editingCall, setEditingCall] = useState<WaiterCall | null>(null);
  const [editingService, setEditingService] = useState<ServiceRequest | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    setRefreshing(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}&limit=100` : '?limit=100';
      const [ordersRes, callsRes, serviceRes] = await Promise.all([
        api.get(`/api/orders${qs}`),
        api.get('/api/waiter-calls'),
        api.get('/api/service-requests'),
      ]);
      if (ordersRes.success) setOrders(ordersRes.data);
      if (callsRes.success) setWaiterCalls(callsRes.data);
      if (serviceRes.success) setServiceRequests(serviceRes.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter, activeBranchFilter]);

  async function updateOrderStatus(id: string, status: string) {
    await api.patch(`/api/orders/${id}/status`, { status });
    load();
  }

  async function saveCallEdit() {
    if (!editingCall) return;
    setEditSaving(true);
    await api.patch(`/api/waiter-calls/${editingCall.id}/status`, { status: editStatus, notes: editNotes });
    setEditingCall(null);
    setEditSaving(false);
    load();
  }

  async function saveServiceEdit() {
    if (!editingService) return;
    setEditSaving(true);
    await api.patch(`/api/service-requests/${editingService.id}/status`, { status: editStatus, adminNotes: editNotes });
    setEditingService(null);
    setEditSaving(false);
    load();
  }

  const pendingCalls = waiterCalls.filter(c => c.status === 'PENDING').length;
  const pendingService = serviceRequests.filter(s => s.status === 'PENDING').length;

  return (
    <div className="space-y-6 animate-in">
      {/* Tabs */}
      <div className="flex flex-col gap-4">
        <div className="flex border-b border-[var(--border)] overflow-x-auto scrollbar-hide shrink-0">
          {[
            { key: 'orders', label: `Orders`, badge: null },
            { key: 'calls', label: 'Waiter Calls', badge: pendingCalls },
            { key: 'service', label: 'Service Requests', badge: pendingService },
          ].map(({ key, label, badge }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`px-4 py-2.5 text-sm font-bold tracking-wider transition-all relative shrink-0 ${activeTab === key ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              {label}
              {badge !== null && badge > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">{badge}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {activeTab === 'orders' && (
              <>
                <label className="mb-0 normal-case text-sm shrink-0">Filter:</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-auto text-sm">
                  {STATUS_OPTS.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
                </select>
              </>
            )}
          </div>
          <button 
            className="btn btn-secondary btn-sm disabled:opacity-50 w-full sm:w-auto" 
            onClick={load} 
            disabled={refreshing}
          >
            <span className={refreshing ? 'animate-spin inline-block mr-1' : 'mr-1'}>↻</span>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>
      ) : activeTab === 'orders' ? (
        <div className="card overflow-x-auto">
          <table className="min-w-[800px]">
            <thead><tr><th>Order ID</th><th>Table</th><th>Items</th><th>Total</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={7} className="text-center text-[var(--muted)] py-10">No orders found</td></tr>}
              {orders.map((o) => (
                <React.Fragment key={o.id}>
                  <tr className="cursor-pointer" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                    <td className="font-mono text-xs text-[var(--muted)]">#{o.id.slice(-6).toUpperCase()}</td>
                    <td className="font-medium">{o.table?.label || '—'}</td>
                    <td className="text-[var(--muted)]">{o.items?.length ?? 0}</td>
                    <td className="text-[var(--accent)] font-semibold">{formatPrice(o.total)}</td>
                    <td><span className={'text-xs font-bold ' + (SC[o.status] || '')}>{o.status}</span></td>
                    <td className="text-[var(--muted)] text-xs">{new Date(o.createdAt).toLocaleString()}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit && NEXT[o.status] && (
                        <button className="btn btn-primary btn-sm" onClick={() => updateOrderStatus(o.id, NEXT[o.status])}>→ {NEXT[o.status]}</button>
                      )}
                      {canEdit && o.status !== 'CANCELLED' && o.status !== 'SERVED' && (
                        <button className="btn btn-danger btn-sm ml-1" onClick={() => updateOrderStatus(o.id, 'CANCELLED')}>Cancel</button>
                      )}
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr>
                      <td colSpan={7} className="bg-[var(--surface2)] p-4">
                        <div className="space-y-1">
                          {(o.items ?? []).map((item: any) => (
                            <div key={item.id} className="flex items-center gap-3 text-sm">
                              <span className="text-[var(--accent)] font-bold w-6">{item.quantity}×</span>
                              <span className="font-medium">{item.menuItem?.name || item.menuItemId}</span>
                              {item.notes && <span className="text-[var(--muted)] italic">"{item.notes}"</span>}
                              <span className="ml-auto text-[var(--muted)]">{formatPrice(Number(item.unitPrice) * item.quantity)}</span>
                            </div>
                          ))}
                        </div>
                        {o.notes && <p className="text-xs text-[var(--muted)] mt-2 border-t border-[var(--border)] pt-2">Note: {o.notes}</p>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : activeTab === 'calls' ? (
        <div className="card overflow-x-auto">
          <table className="min-w-[700px]">
            <thead><tr><th>Table</th><th>Reason</th><th>Notes</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead>
            <tbody>
              {waiterCalls.length === 0 && <tr><td colSpan={6} className="text-center text-[var(--muted)] py-10">No waiter calls</td></tr>}
              {waiterCalls.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.table?.label || '—'}</td>
                  <td className="text-[var(--muted)]">{c.reason || '—'}</td>
                  <td className="text-[var(--muted)] text-xs max-w-xs truncate">{c.notes || '—'}</td>
                  <td><span className={`text-xs font-bold ${c.status === 'PENDING' ? 'text-yellow-400' : c.status === 'RESOLVED' ? 'text-green-400' : 'text-blue-400'}`}>{c.status}</span></td>
                  <td className="text-[var(--muted)] text-xs">{new Date(c.createdAt).toLocaleString()}</td>
                  <td>
                    {canEdit && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { setEditingCall(c); setEditNotes(c.notes || ''); setEditStatus(c.status); }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-[800px]">
            <thead><tr><th>Table</th><th>Type</th><th>Customer Notes</th><th>Admin Notes</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead>
          <tbody>
              {serviceRequests.length === 0 && <tr><td colSpan={7} className="text-center text-[var(--muted)] py-10">No service requests</td></tr>}
              {serviceRequests.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.table?.label || '—'}</td>
                  <td className="font-semibold">{s.serviceType}</td>
                  <td className="text-[var(--muted)] text-xs max-w-xs truncate">{s.notes || '—'}</td>
                  <td className="text-[var(--muted)] text-xs max-w-xs truncate">{s.adminNotes || '—'}</td>
                  <td><span className={`text-xs font-bold ${s.status === 'PENDING' ? 'text-yellow-400' : s.status === 'RESOLVED' ? 'text-green-400' : 'text-blue-400'}`}>{s.status}</span></td>
                  <td className="text-[var(--muted)] text-xs">{new Date(s.createdAt).toLocaleString()}</td>
                  <td>
                    {canEdit && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { setEditingService(s); setEditNotes(s.adminNotes || ''); setEditStatus(s.status); }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Waiter Call Modal */}
      {editingCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setEditingCall(null)}>
          <div className="card w-full max-w-md p-6 space-y-4 animate-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl">EDIT WAITER CALL</h2>
            <div>
              <p className="text-sm text-[var(--muted)]">Table: <span className="text-[var(--text)] font-medium">{editingCall.table?.label}</span></p>
              <p className="text-sm text-[var(--muted)]">Reason: <span className="text-[var(--text)]">{editingCall.reason || '—'}</span></p>
            </div>
            <div>
              <label>Status</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="PENDING">PENDING</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="RESOLVED">RESOLVED</option>
              </select>
            </div>
            <div>
              <label>Notes (visible to staff only)</label>
              <textarea rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="resize-none" placeholder="Add resolution notes…" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingCall(null)} className="btn btn-secondary flex-1">Cancel</button>
              <button onClick={saveCallEdit} disabled={editSaving} className="btn btn-primary flex-1 disabled:opacity-50">
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Service Request Modal */}
      {editingService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setEditingService(null)}>
          <div className="card w-full max-w-md p-6 space-y-4 animate-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl">EDIT SERVICE REQUEST</h2>
            <div>
              <p className="text-sm text-[var(--muted)]">Table: <span className="text-[var(--text)] font-medium">{editingService.table?.label}</span></p>
              <p className="text-sm text-[var(--muted)]">Type: <span className="text-[var(--text)] font-semibold">{editingService.serviceType}</span></p>
              {editingService.notes && <p className="text-sm text-[var(--muted)]">Customer note: "{editingService.notes}"</p>}
            </div>
            <div>
              <label>Status</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="PENDING">PENDING</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="RESOLVED">RESOLVED</option>
              </select>
            </div>
            <div>
              <label>Admin Notes (staff only)</label>
              <textarea rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="resize-none" placeholder="Resolution or action taken…" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingService(null)} className="btn btn-secondary flex-1">Cancel</button>
              <button onClick={saveServiceEdit} disabled={editSaving} className="btn btn-primary flex-1 disabled:opacity-50">
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
