import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AuthProvider } from './services/auth.tsx';
import { ThemeProvider } from './context/theme.tsx';
import './index.css';

type DeferredPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

declare global {
  interface Window {
    __cevopDeferredInstallPrompt?: DeferredPromptEvent | null;
  }
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    void 0;
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-[var(--bg)] text-[var(--text)] flex items-center justify-center p-6">
          <div className="max-w-sm w-full space-y-3 text-center">
            <div className="font-display text-2xl">Something went wrong</div>
            <div className="text-sm text-[var(--muted)]">Please refresh and try again.</div>
            <button
              className="btn btn-primary w-full py-3"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    window.__cevopDeferredInstallPrompt = e as DeferredPromptEvent;
    window.dispatchEvent(new Event('cevop-install-available'));
  });
  window.addEventListener('appinstalled', () => {
    window.__cevopDeferredInstallPrompt = null;
    window.dispatchEvent(new Event('cevop-install-available'));
  });
} catch {
  void 0;
}

try {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.info('[SW] Registered:', registration.scope);
        })
        .catch((err) => {
          console.warn('[SW] Registration failed:', err);
        });
    });
  }
} catch {
  void 0;
}

if (import.meta.env.DEV) {
  try {
    if (window.location.hostname === '127.0.0.1') {
      window.location.replace(
        `${window.location.protocol}//localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
    }
  } catch {
    void 0;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? (
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  ) : (
    <React.StrictMode>
      <ThemeProvider>
        <ErrorBoundary>
          <AuthProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </React.StrictMode>
  ),
);
