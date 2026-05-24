import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApi, usePermission } from '../context/auth';

const PLAN_STATUS_COLOR: Record<string, string> = {
  trialing: 'text-yellow-400 border-yellow-800',
  active: 'text-green-400 border-green-800',
  suspended: 'text-red-400 border-red-800',
  cancelled: 'text-gray-400 border-gray-700',
};
const PLAN_COLOR: Record<string, string> = {
  trial: 'text-[var(--muted)]',
  starter: 'text-blue-400',
  growth: 'text-purple-400',
  enterprise: 'text-[var(--accent)]',
};

export function OrgsPage() {
  const api = useApi();
  const can = usePermission();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'inactive' | 'all'>('active');
  const [planStatusAll, setPlanStatusAll] = useState('');
  const [page, setPage] = useState(1);

  const planStatus =
    view === 'active'
      ? 'active,trialing'
      : view === 'inactive'
        ? 'cancelled,suspended'
        : planStatusAll;

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) qs.set('search', search);
    if (planStatus) qs.set('planStatus', planStatus);
    const res = await api.get(`/api/ops/orgs?${qs}`);
    if (res.success) {
      setOrgs(res.data);
      setMeta(res.meta);
    }
    setLoading(false);
  }, [api, search, planStatus, page]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (!can('view_orgs')) return <div className="text-red-400 p-8">Permission denied</div>;

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-4xl">ORGANISATIONS</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">{meta.total} total</p>
        </div>
        {can('onboard_org') && (
          <Link to="/onboard" className="btn btn-primary btn-sm">
            + Onboard New Org
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => {
              setView('active');
              setPage(1);
            }}
            className={`btn btn-sm ${view === 'active' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Active
          </button>
          <button
            onClick={() => {
              setView('inactive');
              setPage(1);
            }}
            className={`btn btn-sm ${view === 'inactive' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Inactive
          </button>
          <button
            onClick={() => {
              setView('all');
              setPage(1);
            }}
            className={`btn btn-sm ${view === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          >
            All
          </button>
        </div>
        <label htmlFor="ops_orgs_search" className="sr-only">
          Search organisations
        </label>
        <input
          id="ops_orgs_search"
          name="search"
          type="text"
          placeholder="Search name, slug, email…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-64 text-sm"
          autoComplete="off"
        />
        {view === 'all' && (
          <>
            <label htmlFor="ops_orgs_plan_status" className="sr-only">
              Plan status
            </label>
            <select
              id="ops_orgs_plan_status"
              name="planStatus"
              value={planStatusAll}
              onChange={(e) => {
                setPlanStatusAll(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-auto text-sm"
              autoComplete="off"
            >
              <option value="">All Statuses</option>
              <option value="trialing">Trialing</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </>
        )}
        <button
          onClick={() => {
            setSearch('');
            if (view === 'all') setPlanStatusAll('');
            setPage(1);
          }}
          className="btn btn-secondary btn-sm w-full sm:w-auto"
        >
          Clear
        </button>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="min-w-[1100px]">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Slug</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Source</th>
                <th>Branches</th>
                <th>Users</th>
                <th>Orders</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-[var(--muted)] py-10">
                    No organisations found
                  </td>
                </tr>
              )}
              {orgs.map((org: any) => (
                <tr key={org.id}>
                  <td>
                    <p className="font-semibold text-[var(--text)] text-sm">{org.name}</p>
                    {org.contactEmail && (
                      <p className="text-xs text-[var(--muted)]">{org.contactEmail}</p>
                    )}
                  </td>
                  <td className="font-mono text-xs text-[var(--muted)]">{org.slug}</td>
                  <td
                    className={`text-xs font-semibold uppercase ${PLAN_COLOR[org.plan] ?? 'text-[var(--muted)]'}`}
                  >
                    {org.plan}
                  </td>
                  <td>
                    <span
                      className={`text-xs border px-2 py-0.5 ${PLAN_STATUS_COLOR[org.planStatus] ?? ''}`}
                    >
                      {org.planStatus}
                    </span>
                  </td>
                  <td className="text-xs text-[var(--muted)]">
                    {org.selfSignup ? 'Self' : 'Manual'}
                  </td>
                  <td className="text-center text-[var(--muted)]">{org._count?.branches}</td>
                  <td className="text-center text-[var(--muted)]">{org._count?.users}</td>
                  <td className="text-center text-[var(--muted)]">{org._count?.orders}</td>
                  <td className="text-xs text-[var(--muted)]">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    {can('view_org_detail') && (
                      <Link to={`/orgs/${org.id}`} className="btn btn-secondary btn-sm">
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {meta.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn btn-secondary btn-sm disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {meta.pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}
            disabled={page === meta.pages}
            className="btn btn-secondary btn-sm disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
