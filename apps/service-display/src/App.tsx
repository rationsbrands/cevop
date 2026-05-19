import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './services/auth';
import { ServiceBoard } from './pages/ServiceBoard';
import { LoginPage } from './pages/LoginPage';
import './index.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--accent)]">
      <div className="w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin mb-4" />
      <p className="font-display tracking-widest text-sm uppercase">Loading...</p>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><ServiceBoard /></ProtectedRoute>} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
