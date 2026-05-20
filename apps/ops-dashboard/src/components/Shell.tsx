import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useApi } from '../context/auth';
import { useTheme } from '../context/theme';

interface IconProps {
  size?: number;
}
const Ico = ({ d, size = 16 }: { d: string | string[]; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const IconOverview = ({ size }: IconProps) => (
  <Ico size={size} d={['M18 20V10', 'M12 20V4', 'M6 20v-6']} />
);
const IconOrgs = ({ size }: IconProps) => (
  <Ico
    size={size}
    d={[
      'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
      'M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0',
      'M23 21v-2a4 4 0 0 0-3-3.87',
      'M16 3.13a4 4 0 0 1 0 7.75',
    ]}
  />
);
const IconOnboard = ({ size }: IconProps) => <Ico size={size} d={['M12 5v14', 'M5 12h14']} />;
const IconLogout = ({ size }: IconProps) => (
  <Ico size={size} d={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9']} />
);
const IconTeam = ({ size }: IconProps) => (
  <Ico
    size={size}
    d={[
      'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
      'M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0',
      'M23 21v-2a4 4 0 0 0-3-3.87',
      'M16 3.13a4 4 0 0 1 0 7.75',
    ]}
  />
);
const IconSecurity = ({ size }: IconProps) => (
  <Ico size={size} d={['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10']} />
);
const IconAudit = ({ size }: IconProps) => (
  <Ico
    size={size}
    d={[
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
      'M14 2v6h6',
      'M16 13H8',
      'M16 17H8',
      'M10 9H8',
    ]}
  />
);
const IconChevronLeft = ({ size }: IconProps) => <Ico size={size} d={['M15 18l-6-6 6-6']} />;

const NAV = [
  { to: '/', label: 'Overview', Icon: IconOverview, exact: true },
  { to: '/orgs', label: 'Organisations', Icon: IconOrgs },
  { to: '/onboard', label: 'Onboard', Icon: IconOnboard },
  { to: '/team', label: 'Team', Icon: IconTeam },
  { to: '/audit', label: 'Audit Logs', Icon: IconAudit },
  { to: '/security', label: 'Security', Icon: IconSecurity },
];

export function Shell() {
  const { user, logout } = useAuth();
  const api = useApi();
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= 1024;
  });
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const sidebarWidth = mobileMenuOpen || sidebarOpen ? 'w-64' : 'w-16';

  const themeLabel = mode === 'system' ? 'OS' : mode === 'dark' ? 'D' : 'L';
  const nextThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'system' ? 'OS' : nextThemeMode === 'dark' ? 'D' : 'L';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  // Close mobile menu on route change
  useEffect(() => {
    const t = window.setTimeout(() => setMobileMenuOpen(false), 0);
    return () => window.clearTimeout(t);
  }, [location.pathname]);

  return (
    <div className="flex w-full h-dvh overflow-hidden relative bg-[var(--bg)]">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside
        className={`
        fixed inset-y-0 left-0 z-50 lg:static
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${sidebarWidth} shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-all duration-300 overflow-hidden
      `}
      >
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
            <>
              <span className="font-display text-base text-[var(--text)] tracking-wide">OPS</span>
              <span className="ml-auto text-[10px] border border-[var(--danger)] text-[var(--danger)] px-1.5 py-0.5 font-bold tracking-widest opacity-70">
                INTERNAL
              </span>
            </>
          )}

          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden ml-auto p-1 text-[var(--muted)] hover:text-[var(--text)]"
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto scrollbar-hide">
          {NAV.map(({ to, label, Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 text-sm transition-all rounded-sm ${
                  isActive
                    ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-semibold border-l-2 border-[var(--accent)] -ml-[2px]'
                    : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface2)]'
                }`
              }
            >
              <span className="w-5 flex items-center justify-center shrink-0">
                <Icon size={18} />
              </span>
              {(sidebarOpen || mobileMenuOpen) && (
                <span className="font-medium whitespace-nowrap">{label}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-[var(--border)] shrink-0 space-y-4">
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

          {sidebarOpen || mobileMenuOpen ? (
            <div className="px-3 pt-2 border-t border-[var(--border)] mt-2">
              <p className="text-xs text-[var(--text)] font-bold truncate">{user?.name}</p>
              <p className="text-[10px] text-[var(--danger)] mb-2 font-bold tracking-widest uppercase">
                SUPERADMIN
              </p>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors w-full rounded-sm"
              >
                <IconLogout size={16} />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <div className="pt-2 border-t border-[var(--border)] mt-2">
              <button
                onClick={handleLogout}
                className="flex items-center justify-center w-full py-3 text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
                title="Sign out"
              >
                <IconLogout size={18} />
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center px-4 lg:px-6 border-b border-[var(--border)] bg-[var(--surface)] justify-between shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
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
            <p className="text-sm text-[var(--muted)] font-bold">Operations Platform</p>
          </div>
          <p className="text-[10px] text-[var(--muted)] font-medium uppercase tracking-wider">
            {new Date().toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
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

        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
