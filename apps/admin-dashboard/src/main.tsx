import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/auth';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { MenuPage } from './pages/MenuPage';
import { TablesPage } from './pages/TablesPage';
import { OrdersPage } from './pages/OrdersPage';
import { UsersPage } from './pages/UsersPage';
import { HelpOptionsPage } from './pages/HelpOptionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { BranchesPage } from './pages/BranchesPage';
import { ThemeProvider } from './context/theme';
import './index.css';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
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
  if (user.role !== 'ADMIN' && user.role !== 'SUPERADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'SUPERADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />

      {/* Protected */}
      <Route path="/" element={<Protected><Shell /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="tables" element={<TablesPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="help-options" element={<HelpOptionsPage />} />
        <Route path="settings" element={<RequireOrgAdmin><SettingsPage /></RequireOrgAdmin>} />
        <Route path="branches" element={<RequireOrgAdmin><BranchesPage /></RequireOrgAdmin>} />
        <Route path="onboard" element={<RequireSuperAdmin><OnboardingPage /></RequireSuperAdmin>} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
