import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/auth';
import { SocketProvider } from './context/socket';
import { Shell } from './components/Shell';
const LoginPage = React.lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const SignupPage = React.lazy(() =>
  import('./pages/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const ForgotPasswordPage = React.lazy(() =>
  import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = React.lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);
const VerifyEmailPage = React.lazy(() =>
  import('./pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })),
);
const AcceptInvitePage = React.lazy(() =>
  import('./pages/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage })),
);
import { ThemeProvider } from './context/theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

try {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => void 0);
  }
} catch {
  void 0;
}

const DashboardPage = React.lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const MenuPage = React.lazy(() =>
  import('./pages/MenuPage').then((m) => ({ default: m.MenuPage })),
);
const TablesPage = React.lazy(() =>
  import('./pages/TablesPage').then((m) => ({ default: m.TablesPage })),
);
const SectionsPage = React.lazy(() =>
  import('./pages/SectionsPage').then((m) => ({ default: m.SectionsPage })),
);
const OrdersPage = React.lazy(() =>
  import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })),
);
const KDSPage = React.lazy(() => import('./pages/KDSPage').then((m) => ({ default: m.KDSPage })));
const UsersPage = React.lazy(() =>
  import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const StationsPage = React.lazy(() =>
  import('./pages/StationsPage').then((m) => ({ default: m.StationsPage })),
);
const PaymentsPage = React.lazy(() =>
  import('./pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage })),
);
const HelpOptionsPage = React.lazy(() =>
  import('./pages/HelpOptionsPage').then((m) => ({ default: m.HelpOptionsPage })),
);
const SettingsPage = React.lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const BranchesPage = React.lazy(() =>
  import('./pages/BranchesPage').then((m) => ({ default: m.BranchesPage })),
);
const ReportsPage = React.lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const AuditLogsPage = React.lazy(() =>
  import('./pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })),
);
const NotificationsPage = React.lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const TimesheetsPage = React.lazy(() =>
  import('./pages/TimesheetsPage').then((m) => ({ default: m.TimesheetsPage })),
);
const ServiceDeskPage = React.lazy(() =>
  import('./pages/ServiceDeskPage').then((m) => ({ default: m.ServiceDeskPage })),
);
const CashierPage = React.lazy(() =>
  import('./pages/CashierPage').then((m) => ({ default: m.CashierPage })),
);

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireOrgAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!['ORG_OWNER', 'ADMIN'].includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SocketWrapper({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  return (
    <SocketProvider token={token} organizationId={user?.organizationId} branchId={user?.branchId}>
      {children}
    </SocketProvider>
  );
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

import { Outlet } from 'react-router-dom';
import { InstallPrompt } from './components/InstallPrompt';

function AppRoutes() {
  return (
    <>
      <Routes>
        {/* Public */}
        <Route
          element={
            <React.Suspense fallback={<PageLoader />}>
              <Outlet />
            </React.Suspense>
          }
        >
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
        </Route>

        {/* Protected */}
        <Route
          path="/"
          element={
            <Protected>
              <React.Suspense
                fallback={
                  <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
                    <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  </div>
                }
              >
                <SocketWrapper>
                  <Shell />
                </SocketWrapper>
              </React.Suspense>
            </Protected>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route
            path="orders"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'HOST']}>
                <OrdersPage />
              </RequireRole>
            }
          />
          <Route
            path="kds"
            element={
              <RequireRole
                roles={[
                  'ORG_OWNER',
                  'ADMIN',
                  'ORG_MANAGER',
                  'BRANCH_ADMIN',
                  'KITCHEN',
                  'BAR',
                  'WAITER',
                  'SUPERADMIN',
                ]}
              >
                <KDSPage />
              </RequireRole>
            }
          />
          <Route
            path="/cashier"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'CASHIER']}>
                <CashierPage />
              </RequireRole>
            }
          />
          <Route
            path="/service-desk"
            element={
              <RequireRole
                roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'HOST', 'WAITER']}
              >
                <ServiceDeskPage />
              </RequireRole>
            }
          />
          <Route
            path="menu"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN']}>
                <MenuPage />
              </RequireRole>
            }
          />
          <Route
            path="tables"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'HOST']}>
                <TablesPage />
              </RequireRole>
            }
          />
          <Route
            path="sections"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'HOST']}>
                <SectionsPage />
              </RequireRole>
            }
          />
          <Route
            path="stations"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN']}>
                <StationsPage />
              </RequireRole>
            }
          />
          <Route
            path="users"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN']}>
                <UsersPage />
              </RequireRole>
            }
          />
          <Route
            path="help-options"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN']}>
                <HelpOptionsPage />
              </RequireRole>
            }
          />
          <Route
            path="settings"
            element={
              <RequireOrgAdmin>
                <SettingsPage />
              </RequireOrgAdmin>
            }
          />
          <Route
            path="audit-logs"
            element={
              <RequireOrgAdmin>
                <AuditLogsPage />
              </RequireOrgAdmin>
            }
          />
          <Route
            path="notifications"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER']}>
                <NotificationsPage />
              </RequireRole>
            }
          />
          <Route
            path="timesheets"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER']}>
                <TimesheetsPage />
              </RequireRole>
            }
          />
          <Route
            path="branches"
            element={
              <RequireRole roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER']}>
                <BranchesPage />
              </RequireRole>
            }
          />
          <Route
            path="reports"
            element={
              <RequireRole
                roles={[
                  'ORG_OWNER',
                  'ADMIN',
                  'ORG_MANAGER',
                  'ORG_FINANCE',
                  'ORG_AUDITOR',
                  'BRANCH_ADMIN',
                  'BRANCH_FINANCE',
                  'SUPERADMIN',
                ]}
              >
                <ReportsPage />
              </RequireRole>
            }
          />
          <Route
            path="payments"
            element={
              <RequireRole
                roles={[
                  'ORG_OWNER',
                  'ADMIN',
                  'ORG_MANAGER',
                  'BRANCH_ADMIN',
                  'CASHIER',
                  'WAITER',
                  'SUPERADMIN',
                ]}
              >
                <PaymentsPage />
              </RequireRole>
            }
          />
          <Route
            path="audit-logs"
            element={
              <RequireRole
                roles={['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'ORG_AUDITOR', 'SUPERADMIN']}
              >
                <AuditLogsPage />
              </RequireRole>
            }
          />
        </Route>
      </Routes>
      <InstallPrompt />
    </>
  );
}

const RootWrapper = import.meta.env.DEV ? React.Fragment : React.StrictMode;

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RootWrapper>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ErrorBoundary>
          <AuthProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <AppRoutes />
            </BrowserRouter>
          </AuthProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </RootWrapper>,
);
