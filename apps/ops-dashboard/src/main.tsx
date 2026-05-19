import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/auth';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { MetricsPage } from './pages/MetricsPage';
import { OrgsPage } from './pages/OrgsPage';
import { OrgDetailPage } from './pages/OrgDetailPage';
import { OnboardPage } from './pages/OnboardPage';
import { ThemeProvider } from './context/theme';
import './index.css';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]"><div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
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
