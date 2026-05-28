import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ThemeProvider } from './context/theme.tsx';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RootWrapper = import.meta.env.DEV ? React.Fragment : React.StrictMode;

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
            <button className="btn-primary w-full py-3" onClick={() => window.location.reload()}>
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RootWrapper>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ErrorBoundary>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </BrowserRouter>
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </RootWrapper>,
);
