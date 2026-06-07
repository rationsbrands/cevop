import { useAuth } from '../../context/auth';
import { useApi } from '../../hooks/useFetch';
import { getSuppliers } from '../../services/inventory';

export default function SuppliersPage() {
  const { token } = useAuth();
  const { data, loading, error, refetch } = useApi(() => getSuppliers(token!), [token]);
  const suppliers = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${suppliers.length} suppliers`}
        </p>
        <button className="btn btn-primary btn-sm">+ Add Supplier</button>
      </div>

      {error && (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
        >
          {error}{' '}
          <button onClick={refetch} className="underline ml-1">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>
            Loading suppliers…
          </div>
        ) : suppliers.length === 0 ? (
          <div className="card p-5 flex flex-col items-center justify-center gap-2 border-dashed col-span-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
              No suppliers yet
            </p>
            <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
              Add your first supplier to start creating purchase orders
            </p>
            <button className="btn btn-primary btn-sm mt-2">+ Add Supplier</button>
          </div>
        ) : (
          suppliers.map((s) => (
            <div key={s.id} className="card p-5 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                    {s.name}
                  </div>
                  {s.contactName && (
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {s.contactName}
                    </div>
                  )}
                </div>
                <span className={`badge ${s.isActive ? 'badge-ok' : 'badge-inactive'}`}>
                  {s.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              {s.email && (
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {s.email}
                </div>
              )}
              {s.phone && (
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {s.phone}
                </div>
              )}
              <div className="flex gap-3 text-xs pt-1" style={{ color: 'var(--muted)' }}>
                <span>{s._count?.items ?? 0} items</span>
                <span>{s._count?.purchaseOrders ?? 0} POs</span>
                {s.leadTimeDays != null && <span>{s.leadTimeDays}d lead time</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
