import React from 'react';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col items-center justify-center p-6 text-center gap-4">
      <h1 className="font-display text-6xl text-[var(--accent)]">404</h1>
      <p className="text-[var(--muted)]">Page not found. Please scan your table's QR code again.</p>
      <button onClick={() => navigate(-1)} className="btn-secondary">Go Back</button>
    </div>
  );
}
