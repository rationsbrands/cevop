import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { getTokenExpiry, isTokenStale } from '../../../../shared/utils/authSession';

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  currency: string;
  plan: string;
  planStatus: string;
  trialEndsAt?: string;
}
export interface BranchInfo { id: string; name: string; slug: string; }
export interface AuthUser {
  id: string; name: string; email: string; role: string;
  organizationId: string; branchId: string | null;
  organization: OrgInfo; branch: BranchInfo | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  activeBranchFilter: BranchInfo | null;
  setActiveBranchFilter: (branch: BranchInfo | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function apiCall(path: string, options: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, options);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBranchFilter, setActiveBranchFilter] = useState<BranchInfo | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshedAt = useRef<number>(0);

  function scheduleRefresh(accessToken: string) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const exp = getTokenExpiry(accessToken);
    if (!exp) return;
    // Refresh 2 minutes before the token actually expires
    const msUntilRefresh = Math.max(exp - Date.now() - 2 * 60 * 1000, 0);
    refreshTimerRef.current = setTimeout(silentRefresh, msUntilRefresh);
  }

  const silentRefresh = useCallback(async (): Promise<string | null> => {
    // Debounce
    if (Date.now() - lastRefreshedAt.current < 30_000) {
      return token;  // Return current in-memory token
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',  // Cookie is sent automatically
        headers: { 'Content-Type': 'application/json' },
        // No body
      });
      if (!res.ok) { logout(); return null; }
      const { data } = await res.json();
      setToken(data.accessToken);
      lastRefreshedAt.current = Date.now();
      scheduleRefresh(data.accessToken);
      return data.accessToken;
    } catch {
      logout();
      return null;
    }
  }, [token]);

  useEffect(() => {
    async function handleWake() {
      if (document.visibilityState !== 'visible') return;
      if (!token) return;
      if (isTokenStale(token)) {
        await silentRefresh();
      }
    }
    document.addEventListener('visibilitychange', handleWake);
    return () => document.removeEventListener('visibilitychange', handleWake);
  }, [silentRefresh, token]);

  useEffect(() => {
    // Attempt to restore session from httpOnly cookie via silent refresh
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',  // Required — sends the cookie
          headers: { 'Content-Type': 'application/json' },
          // No body — token comes from cookie
        });
        if (!res.ok) { setLoading(false); return; }
        const { data } = await res.json();
        setToken(data.accessToken);
        scheduleRefresh(data.accessToken);
        
        // Then fetch /me to get user details
        const meRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${data.accessToken}` },
        });
        const { data: userData } = await meRes.json();
        if (userData) {
          setUser(userData);
          if (userData.branch) setActiveBranchFilter(userData.branch);
        } else {
          setToken(null);
        }
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  async function login(email: string, password: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',  // Required — server sets the cookie on this response
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Login failed');

    setToken(body.data.accessToken);
    setUser(body.data.user);
    if (body.data.user.branch) setActiveBranchFilter(body.data.user.branch);
    scheduleRefresh(body.data.accessToken);
  }

  async function logout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',  // Sends cookie so server can revoke it
        headers: { 'Content-Type': 'application/json' },
      });
    } catch { /* ignore */ }
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setToken(null);
    setUser(null);
    setActiveBranchFilter(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, activeBranchFilter, setActiveBranchFilter, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

// Central API hook — automatically appends branchId and sends auth header
export function useApi() {
  const { token, user, activeBranchFilter } = useAuth();
  const effectiveBranchId = user?.branchId ?? activeBranchFilter?.id ?? null;

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  function buildUrl(path: string, params?: Record<string, string>): string {
    const base = API_BASE || '';
    // Parse path — may already have query string
    const [pathname, existingQs] = path.split('?');
    const url = new URLSearchParams(existingQs || '');
    if (effectiveBranchId && !url.has('branchId')) url.set('branchId', effectiveBranchId);
    if (params) Object.entries(params).forEach(([k, v]) => url.set(k, v));
    const qs = url.toString();
    return `${base}${pathname}${qs ? '?' + qs : ''}`;
  }

  return {
    effectiveBranchId,
    get: (path: string, params?: Record<string, string>) =>
      fetch(buildUrl(path, params), { headers }).then((r) => r.json()),
    post: (path: string, body: unknown) =>
      fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json()),
    put: (path: string, body: unknown) =>
      fetch(`${API_BASE}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) }).then((r) => r.json()),
    patch: (path: string, body: unknown) =>
      fetch(`${API_BASE}${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) }).then((r) => r.json()),
    delete: (path: string) =>
      fetch(`${API_BASE}${path}`, { method: 'DELETE', headers }).then((r) => r.json()),
  };
}

// Keep for backward compat where needed
export const API = (token: string | null) => ({
  get: (path: string) => fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
  post: (path: string, body: unknown) => fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.json()),
  put: (path: string, body: unknown) => fetch(`${API_BASE}${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.json()),
  patch: (path: string, body: unknown) => fetch(`${API_BASE}${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.json()),
  delete: (path: string) => fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
});
