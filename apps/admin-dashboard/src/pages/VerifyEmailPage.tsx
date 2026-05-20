import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMsg, setErrorMsg] = useState('');
  const hasAttempted = useRef(false);

  useEffect(() => {
    if (!token || hasAttempted.current) return;
    hasAttempted.current = true;

    async function verify() {
      try {
        const res = await fetch(`${API_BASE}/api/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Verification failed');
        }

        // Verification successful, cookie is set.
        setStatus('success');

        // Full reload to allow AuthProvider to pick up the new cookie
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      } catch (err: any) {
        setStatus('error');
        setErrorMsg(err.message || 'Invalid or expired verification link.');
      }
    }

    verify();
  }, [token, navigate]);

  return (
    <div className="min-h-dvh w-full flex items-center justify-center p-6 bg-[var(--bg)]">
      <div className="w-full max-w-md text-center space-y-6 animate-in">
        <div className="brand-mark text-4xl text-[var(--accent)] mb-8 leading-none">CEVOP</div>

        {status === 'verifying' && (
          <div className="space-y-4">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
            <h1 className="font-display text-2xl text-[var(--text)]">Verifying email...</h1>
            <p className="text-[var(--muted)]">Please wait while we confirm your address.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <h1 className="font-display text-2xl text-[var(--text)]">Email Verified!</h1>
            <p className="text-[var(--muted)]">
              Your account is ready. Redirecting to your dashboard...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="w-16 h-16 bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)] rounded-full flex items-center justify-center mx-auto">
              <svg
                width="32"
                height="32"
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
            </div>
            <h1 className="font-display text-2xl text-[var(--text)]">Verification Failed</h1>
            <p className="bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[var(--danger)]/30 text-[var(--danger)] p-3 rounded-md text-sm">
              {errorMsg}
            </p>
            <button onClick={() => navigate('/login')} className="btn btn-primary w-full py-3 mt-4">
              Go to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
