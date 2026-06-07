import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useApi } from '../context/auth';
import { useTheme } from '../context/theme';
import { useSocket } from '../context/socket';
import { ToastViewport } from './Popup';
import {
  IconDashboard,
  IconMenu,
  IconTables,
  IconSections,
  IconOrders,
  IconStaff,
  IconHelp,
  IconBranches,
  IconSettings,
  IconLogout,
  IconChevronLeft,
  IconX,
  IconOverview,
  IconCashier,
  IconInventory,
  IconOverview as IconFinance,
} from './Icons';

interface BranchOption {
  id: string;
  name: string;
  slug: string;
}

export function Shell() {
  const { user, logout, activeBranchFilter, setActiveBranchFilter } = useAuth();
  const { mode, setMode } = useTheme();
  const { connected } = useSocket();
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const [installAvailable, setInstallAvailable] = useState(false);
  const [iosInstallOpen, setIosInstallOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= 1024;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  const role = user?.role ?? '';
  const isBranchScoped = !!user?.branchId;
  const isOrgWideRole = [
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
  ].includes(role);
  const hasBranchContext = isBranchScoped || !!activeBranchFilter;
  const canManageOrg = ['ORG_OWNER', 'ADMIN'].includes(role);
  const canManageOperations = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'].includes(role);
  const canManageStaff = [
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'ORG_FINANCE',
    'ORG_AUDITOR',
  ].includes(role);
  const canViewReports = [
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
  ].includes(role);
  const canViewAuditLogs = [
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_AUDITOR',
    'SUPERADMIN',
  ].includes(role);
  const canViewOrders = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'HOST'].includes(
    role,
  );
  const canViewKDS = [
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'KITCHEN',
    'BAR',
    'WAITER',
  ].includes(role);
  const canViewFloor = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'HOST'].includes(role);
  const canViewCashier = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'CASHIER'].includes(
    role,
  );
  const canViewInventory = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'].includes(role);
  const canViewFinance = [
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
  ].includes(role);
  const canViewServiceDesk = [
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'HOST',
    'WAITER',
  ].includes(role);

  useEffect(() => {
    const updateInstallState = () => {
      try {
        const ua = (navigator.userAgent || '').toLowerCase();
        const isIos = /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
        const isStandalone =
          window.matchMedia?.('(display-mode: standalone)')?.matches ||
          (navigator as any).standalone === true;
        const hasDeferred = !!window.__cevopDeferredInstallPrompt;
        setInstallAvailable(!isStandalone && (hasDeferred || isIos));
      } catch {
        setInstallAvailable(false);
      }
    };
    updateInstallState();
    window.addEventListener('cevop-install-available', updateInstallState as EventListener);
    return () =>
      window.removeEventListener('cevop-install-available', updateInstallState as EventListener);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const isMobile = window.innerWidth < 1024;
      setSidebarOpen((prev) => {
        const next = !isMobile;
        return prev === next ? prev : next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isOrgWideRole) return;
    api
      .get('/api/branches')
      .then(({ data }) => {
        if (data) {
          setBranches(data);
        }
      })
      .catch(() => {
        void 0;
      });
  }, [activeBranchFilter, api, isBranchScoped, isOrgWideRole, setActiveBranchFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => setMobileMenuOpen(false), 0);
    return () => window.clearTimeout(t);
  }, [location.pathname]);

  type NavItem = {
    to: string;
    label: string;
    Icon: React.ComponentType<{ size?: number }>;
    exact?: boolean;
    indent?: boolean;
    toggle?: () => void;
    isOpen?: boolean;
  };
  type NavGroup = {
    group: string;
    items: NavItem[];
    collapsible?: boolean;
    open?: boolean;
    onToggle?: () => void;
  };

  const inFinance = location.pathname.startsWith('/finance');
  const inInventory = location.pathname.startsWith('/inventory');
  const [financeOpen, setFinanceOpen] = useState(inFinance);
  const [inventoryOpen, setInventoryOpen] = useState(inInventory);
  const [operationsOpen, setOperationsOpen] = useState(true);
  const [restaurantOpen, setRestaurantOpen] = useState(true);
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [orgOpen, setOrgOpen] = useState(true);
  const [financeGroupOpen, setFinanceGroupOpen] = useState(inFinance);
  const [inventoryGroupOpen, setInventoryGroupOpen] = useState(inInventory);

  // Keep open state in sync when navigating externally (e.g. browser back)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inFinance) {
      setFinanceOpen(true);
      setFinanceGroupOpen(true);
    }
  }, [inFinance]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inInventory) {
      setInventoryOpen(true);
      setInventoryGroupOpen(true);
    }
  }, [inInventory]);

  const NAV_GROUPS: NavGroup[] = [
    {
      group: '',
      items: [{ to: '/', label: 'Dashboard', Icon: IconDashboard, exact: true }],
    },
    {
      group: 'Operations',
      collapsible: true,
      open: operationsOpen,
      onToggle: () => setOperationsOpen((v) => !v),
      items: [
        { to: '/service-desk', label: 'Service Desk', Icon: IconOrders },
        { to: '/kds', label: 'Kitchen Display', Icon: IconOrders },
        { to: '/orders', label: 'Orders', Icon: IconOrders },
        { to: '/register', label: 'Register', Icon: IconCashier },
        { to: '/cashier', label: 'Cashier', Icon: IconCashier },
        { to: '/payments', label: 'Transactions', Icon: IconOrders },
      ].filter(({ to }) => {
        if (to === '/service-desk') return canViewServiceDesk && hasBranchContext;
        if (to === '/kds') return canViewKDS && hasBranchContext;
        if (to === '/orders') return canViewOrders && hasBranchContext;
        if (to === '/register' || to === '/cashier') return canViewCashier && hasBranchContext;
        if (to === '/payments') return canViewCashier && hasBranchContext;
        return false;
      }),
    },
    {
      group: 'Restaurant',
      collapsible: true,
      open: restaurantOpen,
      onToggle: () => setRestaurantOpen((v) => !v),
      items: [
        { to: '/menu', label: 'Menu', Icon: IconMenu },
        { to: '/tables', label: 'Tables & QR', Icon: IconTables },
        { to: '/sections', label: 'Sections', Icon: IconSections },
        { to: '/stations', label: 'Stations', Icon: IconSections },
        { to: '/help-options', label: 'Help Options', Icon: IconHelp },
      ].filter(({ to }) => {
        if (to === '/menu' || to === '/stations') return canManageOperations && hasBranchContext;
        if (to === '/tables' || to === '/sections') return canViewFloor && hasBranchContext;
        if (to === '/help-options') return canManageOperations && hasBranchContext;
        return false;
      }),
    },
    {
      group: 'Finance',
      collapsible: true,
      open: financeGroupOpen,
      onToggle: () => setFinanceGroupOpen((v) => !v),
      items: [
        {
          to: '/finance',
          label: 'Overview',
          Icon: IconFinance,
          toggle: () => setFinanceOpen((v) => !v),
          isOpen: financeOpen,
        },
        ...(financeOpen
          ? [
              { to: '/finance/pnl', label: 'P&L', Icon: IconFinance, indent: true },
              { to: '/finance/expenses', label: 'Expenses', Icon: IconFinance, indent: true },
            ]
          : []),
        { to: '/reports', label: 'Reports', Icon: IconOverview },
      ].filter(({ to }) => {
        if (to === '/reports') return canViewReports;
        return canViewFinance;
      }),
    },
    {
      group: 'Inventory',
      collapsible: true,
      open: inventoryGroupOpen,
      onToggle: () => setInventoryGroupOpen((v) => !v),
      items: [
        {
          to: '/inventory',
          label: 'Overview',
          Icon: IconInventory,
          toggle: () => setInventoryOpen((v) => !v),
          isOpen: inventoryOpen,
        },
        ...(inventoryOpen
          ? [
              { to: '/inventory/items', label: 'Items', Icon: IconInventory, indent: true },
              { to: '/inventory/movements', label: 'Movements', Icon: IconInventory, indent: true },
              { to: '/inventory/stocktake', label: 'Stocktake', Icon: IconInventory, indent: true },
              { to: '/inventory/wastage', label: 'Wastage', Icon: IconInventory, indent: true },
              { to: '/inventory/suppliers', label: 'Suppliers', Icon: IconInventory, indent: true },
              {
                to: '/inventory/purchase-orders',
                label: 'Purchase Orders',
                Icon: IconInventory,
                indent: true,
              },
            ]
          : []),
      ].filter(() => canViewInventory),
    },
    {
      group: 'People',
      collapsible: true,
      open: peopleOpen,
      onToggle: () => setPeopleOpen((v) => !v),
      items: [
        { to: '/users', label: 'Staff', Icon: IconStaff },
        { to: '/timesheets', label: 'Timesheets & Payroll', Icon: IconStaff },
      ].filter(() => canManageStaff),
    },
    {
      group: 'Organisation',
      collapsible: true,
      open: orgOpen,
      onToggle: () => setOrgOpen((v) => !v),
      items: [
        { to: '/branches', label: 'Branches', Icon: IconBranches },
        { to: '/audit-logs', label: 'Audit Logs', Icon: IconSettings },
        { to: '/notifications', label: 'Comms Log', Icon: IconSettings },
        { to: '/settings', label: 'Settings', Icon: IconSettings },
      ].filter(({ to }) => {
        if (to === '/branches' || to === '/settings') return canManageOrg;
        if (to === '/audit-logs' || to === '/notifications') return canViewAuditLogs;
        return false;
      }),
    },
  ]
    .map((g) => ({ ...g, items: g.items as NavItem[] }))
    .filter((g) => g.items.length > 0);

  const [togglingShift, setTogglingShift] = useState(false);
  const { updateUser } = useAuth();

  async function handleToggleShift() {
    setTogglingShift(true);
    try {
      const { success, data } = await api.patch('/api/shifts/toggle', {});
      if (success && data) {
        updateUser({ isOnShift: data.isOnShift });
      }
    } catch {
      // toast error
    } finally {
      setTogglingShift(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  async function handleInstall() {
    try {
      const ua = (navigator.userAgent || '').toLowerCase();
      const isIos = /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
      const isStandalone =
        window.matchMedia?.('(display-mode: standalone)')?.matches ||
        (navigator as any).standalone === true;
      if (isStandalone) return;

      const deferred = window.__cevopDeferredInstallPrompt;
      if (deferred?.prompt) {
        try {
          await deferred.prompt();
          await deferred.userChoice.catch(() => void 0);
        } finally {
          window.__cevopDeferredInstallPrompt = null;
          window.dispatchEvent(new Event('cevop-install-available'));
        }
        return;
      }

      if (isIos) {
        setIosInstallOpen(true);
      }
    } catch {
      void 0;
    }
  }

  return (
    <div className="flex w-full h-dvh overflow-hidden relative">
      <ToastViewport />
      {iosInstallOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setIosInstallOpen(false)}
        >
          <div
            className="card w-full max-w-md p-6 space-y-4 animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="font-display text-2xl text-[var(--text)]">Install Cevop Admin</h3>
              <p className="text-sm text-[var(--muted)]">
                On iPhone/iPad Safari: tap Share, then Add to Home Screen.
              </p>
            </div>
            <div className="flex justify-end">
              <button className="btn btn-secondary" onClick={() => setIosInstallOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[45] lg:hidden backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
        fixed inset-y-0 left-0 z-[50] lg:static
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${mobileMenuOpen || sidebarOpen ? 'w-64' : 'w-16'}
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
              <img src="/icon-192.png" alt="Cevop" className="w-5 h-5" draggable={false} />
            )}
          </button>
          {(sidebarOpen || mobileMenuOpen) && (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span role="img" aria-label="Cevop" className="cevop-wordmark cevop-wordmark-md" />
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
        {(sidebarOpen || mobileMenuOpen) && isOrgWideRole && branches.length > 0 && (
          <div className="mx-3 mt-4">
            <label
              htmlFor="admin_active_branch_filter"
              className="text-[10px] mb-1 uppercase font-bold tracking-widest text-[var(--muted)]"
            >
              Active Branch
            </label>
            <select
              id="admin_active_branch_filter"
              name="activeBranchId"
              className="w-full bg-[var(--surface2)] border border-[var(--border)] text-xs py-2 px-2 rounded-lg outline-none focus:border-[var(--accent)] transition-all"
              value={activeBranchFilter?.id ?? ''}
              onChange={(e) =>
                setActiveBranchFilter(branches.find((b) => b.id === e.target.value) ?? null)
              }
              autoComplete="off"
            >
              <option value="">Select branch…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Nav links */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto scrollbar-hide space-y-4">
          {NAV_GROUPS.map(({ group, items, collapsible, open: groupOpen, onToggle }) => (
            <div key={group || '__top'}>
              {/* Group label — clickable if collapsible */}
              {group &&
                (sidebarOpen || mobileMenuOpen) &&
                (collapsible ? (
                  <button
                    type="button"
                    onClick={onToggle}
                    className="w-full flex items-center justify-between px-3 mb-1 mt-1 group"
                  >
                    <span className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--muted)] group-hover:text-[var(--text)] transition-colors">
                      {group}
                    </span>
                    <span
                      className="text-[9px] text-[var(--muted)] group-hover:text-[var(--text)] transition-all duration-200"
                      style={{
                        transform: groupOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                        display: 'inline-block',
                      }}
                    >
                      ▾
                    </span>
                  </button>
                ) : (
                  <div className="px-3 mb-1 mt-1">
                    <span className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">
                      {group}
                    </span>
                  </div>
                ))}
              {/* Group items — hidden when collapsed */}
              {(collapsible ? groupOpen : true) && (
                <div className="space-y-0.5">
                  {items.map(({ to, label, Icon: NavIcon, exact, indent, toggle, isOpen }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={exact}
                      onClick={(e) => {
                        if (toggle) {
                          // If already on this route, just toggle — don't re-navigate
                          if (location.pathname === to || location.pathname.startsWith(to + '/')) {
                            e.preventDefault();
                          }
                          toggle();
                        }
                        setMobileMenuOpen(false);
                      }}
                      className={({ isActive }) =>
                        `flex items-center gap-3 text-sm transition-all duration-150 rounded-lg ${
                          indent ? 'py-1.5 pl-8 pr-3' : 'py-2 px-3'
                        } ${
                          isActive
                            ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-semibold'
                            : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface2)]'
                        }`
                      }
                    >
                      {!indent && (
                        <span className="shrink-0 w-4 flex items-center justify-center">
                          <NavIcon size={15} />
                        </span>
                      )}
                      {indent && (sidebarOpen || mobileMenuOpen) && (
                        <span className="w-1 h-1 rounded-full bg-current shrink-0 opacity-50 ml-0.5" />
                      )}
                      {(sidebarOpen || mobileMenuOpen) && (
                        <span
                          className={`whitespace-nowrap flex-1 ${indent ? 'text-xs font-medium' : 'text-sm font-medium'}`}
                        >
                          {label}
                        </span>
                      )}
                      {toggle && (sidebarOpen || mobileMenuOpen) && (
                        <span
                          className="shrink-0 text-[10px] opacity-50 transition-transform duration-200"
                          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                          ▾
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--border)] shrink-0 space-y-4">
          {/* Theme toggle */}
          {sidebarOpen || mobileMenuOpen ? (
            <div className="flex flex-col gap-1.5 px-1">
              <span className="text-[9px] text-[var(--muted)] uppercase font-bold tracking-widest px-1">
                Theme
              </span>
              <div className="flex items-center gap-2 px-1">
                <button
                  onClick={() => setMode(nextThemeMode)}
                  className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
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
              className={`w-9 h-9 mx-auto rounded-full border flex items-center justify-center transition-colors text-[10px] font-bold tracking-widest ${
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
                <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">
                  {[
                    'ORG_OWNER',
                    'ADMIN',
                    'ORG_MANAGER',
                    'ORG_FINANCE',
                    'ORG_AUDITOR',
                    'SUPERADMIN',
                  ].includes(role)
                    ? `Org. ${role.replace(/_/g, ' ')}`
                    : user?.role === 'BRANCH_ADMIN' && user?.branch
                      ? `${user.branch.name} Admin`
                      : user?.role === 'BRANCH_FINANCE' && user?.branch
                        ? `${user.branch.name} Finance`
                        : user?.role?.replace(/_/g, ' ')}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors w-full rounded-lg font-bold"
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
        <header className="h-14 flex items-center px-4 lg:px-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 justify-between sticky top-0 z-[40]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[var(--text)] hover:bg-[var(--surface2)] rounded-lg transition-colors"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
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
                className="font-bold text-[var(--text)] truncate hover:text-[var(--accent)] transition-colors uppercase tracking-tight"
              >
                {user?.organization?.name}
              </NavLink>
              {(activeBranchFilter || isBranchScoped) && (
                <>
                  <span className="text-[var(--muted)] opacity-50">/</span>
                  <span className="text-[var(--accent)] font-bold truncate uppercase tracking-tight">
                    {isBranchScoped ? user?.branch?.name : activeBranchFilter?.name}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {['WAITER', 'CASHIER', 'SERVICE'].includes(role) && (
              <button
                onClick={handleToggleShift}
                disabled={togglingShift}
                className={`flex items-center gap-2 btn btn-sm font-bold tracking-widest text-[10px] ${
                  user?.isOnShift ? 'btn-danger' : 'btn-primary'
                }`}
              >
                {togglingShift ? '...' : user?.isOnShift ? 'END SHIFT' : 'START SHIFT'}
              </button>
            )}
            {installAvailable && (
              <button
                className="hidden sm:block btn btn-secondary btn-sm font-bold tracking-widest text-[10px]"
                onClick={handleInstall}
              >
                INSTALL
              </button>
            )}
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-[var(--surface2)] border border-[var(--border)]">
              <div
                className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]'}`}
              />
              <span className="text-[9px] font-black text-[var(--text)] uppercase tracking-widest">
                {connected ? 'Live' : 'Offline'}
              </span>
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
