import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, useApi } from '../context/auth';
import { useTheme } from '../context/theme';
import {
  IconDashboard,
  IconMenu,
  IconTables,
  IconOrders,
  IconStaff,
  IconHelp,
  IconBranches,
  IconSettings,
  IconOnboard,
  IconLogout,
  IconChevronLeft,
  IconX,
} from './Icons';

interface BranchOption {
  id: string;
  name: string;
  slug: string;
}

export function Shell() {
  const { user, logout, activeBranchFilter, setActiveBranchFilter, loading } = useAuth();
  const { mode, setMode } = useTheme();
  const api = useApi();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  const isBranchScoped = !!user?.branchId;
  const isOrgAdmin = user?.role === 'ADMIN';

  // Close sidebar by default on mobile, open on desktop
  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    setSidebarOpen(!isMobile);
  }, []);

  useEffect(() => {
    if (!isOrgAdmin) return;
    api
      .get('/api/branches')
      .then(({ data }) => {
        if (data) setBranches(data);
      })
      .catch(() => {});
  }, [isOrgAdmin]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [navigate]);

  const NAV = [
    { to: '/', label: 'Dashboard', Icon: IconDashboard, exact: true, show: true },
    { to: '/menu', label: 'Menu', Icon: IconMenu, show: true },
    { to: '/tables', label: 'Tables & QR', Icon: IconTables, show: true },
    { to: '/orders', label: 'Orders', Icon: IconOrders, show: true },
    { to: '/users', label: 'Staff', Icon: IconStaff, show: true },
    { to: '/help-options', label: 'Help Options', Icon: IconHelp, show: true },
    { to: '/branches', label: 'Branches', Icon: IconBranches, show: isOrgAdmin },
    { to: '/settings', label: 'Settings', Icon: IconSettings, show: isOrgAdmin },
  ].filter((n) => n.show);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex w-full h-dvh overflow-hidden relative">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
        fixed inset-y-0 left-0 z-50 lg:static
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${sidebarOpen ? 'w-64' : 'w-16'}
        shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-all duration-300 overflow-hidden
      `}
      >
        {/* Logo row */}
        <div className="h-14 flex items-center px-3 border-b border-[var(--border)] shrink-0 gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-8 h-8 flex items-center justify-center text-[var(--accent)] font-display text-base shrink-0 hover:bg-[var(--surface2)] transition-colors rounded-sm"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? (
              <IconChevronLeft size={16} />
            ) : (
              <span className="brand-mark text-[var(--accent)]" />
            )}
          </button>
          {(sidebarOpen || mobileMenuOpen) && (
            <span className="brand-mark text-base text-[var(--text)] whitespace-nowrap tracking-wide">
              CEVOP
            </span>
          )}

          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden ml-auto p-2 text-[var(--muted)] hover:text-[var(--text)]"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Branch selector for org admins */}
        {(sidebarOpen || mobileMenuOpen) && isOrgAdmin && branches.length > 0 && (
          <div className="mx-3 mt-4">
            <label className="text-[10px] mb-1">Active Branch</label>
            <select
              className="w-full bg-[var(--surface2)] border-[var(--border)] text-xs py-1.5"
              value={activeBranchFilter?.id ?? ''}
              onChange={(e) =>
                setActiveBranchFilter(branches.find((b) => b.id === e.target.value) ?? null)
              }
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Nav links */}
        <nav className="flex-1 py-4 space-y-1 px-2 mt-1 overflow-y-auto scrollbar-hide">
          {NAV.map(({ to, label, Icon: NavIcon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-150 rounded-sm ${
                  isActive
                    ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface2)]'
                }`
              }
            >
              <span className="shrink-0 w-5 flex items-center justify-center">
                <NavIcon size={18} />
              </span>
              {(sidebarOpen || mobileMenuOpen) && (
                <span className="whitespace-nowrap">{label}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--border)] shrink-0 space-y-4">
          {/* Theme toggle */}
          {sidebarOpen || mobileMenuOpen ? (
            <div className="flex flex-col gap-1.5 px-1">
              <label className="text-[9px] text-[var(--muted)] uppercase font-bold tracking-widest px-1">
                Theme
              </label>
              <div className="flex items-center gap-2 px-1">
                <button
                  onClick={() => setMode(nextThemeMode)}
                  className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
                    mode === 'system'
                      ? 'bg-[var(--surface2)] border-[var(--border)] text-[var(--text)] shadow-sm'
                      : mode === 'dark'
                        ? 'bg-black border-[var(--border)] text-[var(--text)] shadow-sm'
                        : 'bg-white border-[var(--border)] text-black shadow-sm'
                  }`}
                  title={`Theme: ${themeLabel} (click → ${nextThemeLabel})`}
                  aria-label={`Theme ${themeLabel}. Click to switch to ${nextThemeLabel}.`}
                >
                  {themeLabel}
                </button>
                <span className="text-xs text-[var(--muted)] font-semibold">
                  {mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'}
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setMode(nextThemeMode)}
              className={`w-10 h-10 mx-auto rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
                mode === 'system'
                  ? 'bg-[var(--surface2)] border-[var(--border)] text-[var(--text)] shadow-sm'
                  : mode === 'dark'
                    ? 'bg-black border-[var(--border)] text-[var(--text)] shadow-sm'
                    : 'bg-white border-[var(--border)] text-black shadow-sm'
              }`}
              title={`Theme: ${themeLabel} (click → ${nextThemeLabel})`}
              aria-label={`Theme ${themeLabel}. Click to switch to ${nextThemeLabel}.`}
            >
              {themeLabel}
            </button>
          )}

          {/* User info */}
          {sidebarOpen || mobileMenuOpen ? (
            <div className="pt-2 border-t border-[var(--border)] mt-2">
              <div className="px-3 mb-3">
                <p className="text-xs text-[var(--text)] font-bold truncate">{user?.name}</p>
                <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
                  {user?.role === 'ADMIN' || user?.role === 'SUPERADMIN'
                    ? `Org. ${user.role.replace(/_/g, ' ')}`
                    : user?.role === 'BRANCH_ADMIN' && user?.branch
                      ? `${user.branch.name} Admin`
                      : user?.role?.replace(/_/g, ' ')}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors w-full rounded-sm"
              >
                <IconLogout size={16} />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogout}
              className="flex items-center justify-center w-full py-3 text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
            >
              <IconLogout size={18} />
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[var(--bg)]">
        {/* Top bar */}
        <header className="h-14 flex items-center px-4 lg:px-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[var(--text)]"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <NavLink
                to="/"
                className="font-bold text-[var(--text)] truncate hover:text-[var(--accent)] transition-colors"
              >
                {user?.organization?.name}
              </NavLink>
              {(activeBranchFilter || isBranchScoped) && (
                <>
                  <span className="text-[var(--muted)] opacity-50">/</span>
                  <span className="text-[var(--accent)] font-semibold truncate">
                    {isBranchScoped ? user?.branch?.name : activeBranchFilter?.name}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--muted)] font-bold bg-[var(--surface2)] px-2 py-1 rounded-full border border-[var(--border)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
              Live
            </div>
          </div>
        </header>

        {user && user.emailVerified === false && (
          <div
            className={`px-4 py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0 border-b transition-colors ${
              resendStatus === 'sent'
                ? 'bg-[var(--success)]/10 border-[var(--success)]/20'
                : 'bg-yellow-500/10 border-yellow-500/20'
            }`}
          >
            <div
              className={`flex items-center gap-2 text-sm ${resendStatus === 'sent' ? 'text-[var(--success)]' : 'text-yellow-600 dark:text-yellow-400'}`}
            >
              {resendStatus === 'sent' ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              )}
              <span>
                {resendStatus === 'sent'
                  ? 'Verification email sent! Please check your inbox.'
                  : 'Please verify your email address to secure your account.'}
              </span>
            </div>
            {resendStatus !== 'sent' && (
              <button
                onClick={async () => {
                  setResendStatus('sending');
                  try {
                    await api.post('/api/auth/resend-verification', {});
                    setResendStatus('sent');
                  } catch {
                    setResendStatus('error');
                    setTimeout(() => setResendStatus('idle'), 3000);
                  }
                }}
                disabled={resendStatus === 'sending'}
                className="text-xs font-semibold bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/30 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                {resendStatus === 'sending'
                  ? 'Sending...'
                  : resendStatus === 'error'
                    ? 'Failed'
                    : 'Resend verification'}
              </button>
            )}
          </div>
        )}

        {/* Page outlet */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
