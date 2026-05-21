import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './services/auth';
import './index.css';

const ServiceBoard = React.lazy(() =>
  import('./pages/ServiceBoard').then((m) => ({ default: m.ServiceBoard })),
);
const WaiterBoard = React.lazy(() =>
  import('./pages/WaiterBoard').then((m) => ({ default: m.WaiterBoard })),
);
const LoginPage = React.lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--accent)]">
        <div className="w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-display tracking-widest text-sm uppercase">Loading...</p>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRouter() {
  const { user } = useAuth();
  // WAITER role gets the waiter dashboard; everyone else gets the service board
  if (user?.role === 'WAITER') return <WaiterBoard />;
  return <ServiceBoard />;
}

function AppRoutes() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
          <div className="w-8 h-8 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RoleRouter />
            </ProtectedRoute>
          }
        />
      </Routes>
    </React.Suspense>
  );
}

export default function App() {
  return <AppRoutes />;
}
