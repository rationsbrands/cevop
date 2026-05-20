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

const DashboardPage = React.lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const MenuPage = React.lazy(() =>
  import('./pages/MenuPage').then((m) => ({ default: m.MenuPage })),
);
const TablesPage = React.lazy(() =>
  import('./pages/TablesPage').then((m) => ({ default: m.TablesPage })),
);
const OrdersPage = React.lazy(() =>
  import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })),
);
const UsersPage = React.lazy(() =>
  import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
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
  if (user.role !== 'ADMIN') return <Navigate to="/" replace />;
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

function AppRoutes() {
  return (
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
        <Route path="menu" element={<MenuPage />} />
        <Route path="tables" element={<TablesPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="help-options" element={<HelpOptionsPage />} />
        <Route
          path="settings"
          element={
            <RequireOrgAdmin>
              <SettingsPage />
            </RequireOrgAdmin>
          }
        />
        <Route
          path="branches"
          element={
            <RequireOrgAdmin>
              <BranchesPage />
            </RequireOrgAdmin>
          }
        />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);
