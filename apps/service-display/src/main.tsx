import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AuthProvider } from './services/auth.tsx';
import { ThemeProvider } from './context/theme.tsx';
import './index.css';

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
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  ) : (
    <React.StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </React.StrictMode>
  ),
);
