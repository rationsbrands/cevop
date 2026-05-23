import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/auth';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
const MetricsPage = React.lazy(() =>
  import('./pages/MetricsPage').then((m) => ({ default: m.MetricsPage })),
);
const OrgsPage = React.lazy(() =>
  import('./pages/OrgsPage').then((m) => ({ default: m.OrgsPage })),
);
const OrgDetailPage = React.lazy(() =>
  import('./pages/OrgDetailPage').then((m) => ({ default: m.OrgDetailPage })),
);
const OnboardPage = React.lazy(() =>
  import('./pages/OnboardPage').then((m) => ({ default: m.OnboardPage })),
);
const TeamPage = React.lazy(() =>
  import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })),
);
const SecurityPage = React.lazy(() =>
  import('./pages/SecurityPage').then((m) => ({ default: m.SecurityPage })),
);
const AuditLogsPage = React.lazy(() =>
  import('./pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })),
);
import { ThemeProvider } from './context/theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (loading)
    return (
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
              <Shell />
            </React.Suspense>
          </Protected>
        }
      >
        <Route index element={<MetricsPage />} />
        <Route path="orgs" element={<OrgsPage />} />
        <Route path="orgs/:orgId" element={<OrgDetailPage />} />
        <Route path="onboard" element={<OnboardPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="audit" element={<AuditLogsPage />} />
        <Route path="security" element={<SecurityPage />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);
