import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/auth';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { MetricsPage } from './pages/MetricsPage';
import { OrgsPage } from './pages/OrgsPage';
import { OrgDetailPage } from './pages/OrgDetailPage';
import { OnboardPage } from './pages/OnboardPage';
import { TeamPage } from './pages/TeamPage';
import { SecurityPage } from './pages/SecurityPage';
import { ThemeProvider } from './context/theme';
import './index.css';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (loading) return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
      <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return <Navigate to="/login" replace />;

  // Force password change before accessing anything else
  if (mustChangePassword && location.pathname !== '/security') {
    return <Navigate to="/security" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Protected><Shell /></Protected>}>
        <Route index element={<MetricsPage />} />
        <Route path="orgs" element={<OrgsPage />} />
        <Route path="orgs/:orgId" element={<OrgDetailPage />} />
        <Route path="onboard" element={<OnboardPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="security" element={<SecurityPage />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
    <BrowserRouter>
    <AuthProvider>
        <AppRoutes />
    </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
