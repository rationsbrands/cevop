import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { getTokenExpiry, isTokenStale } from '../../../../shared/utils/authSession';

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

export interface OpsUser { id: string; name: string; email: string; role: string; organizationId: string; mustChangePassword: boolean; }
interface AuthCtx { user: OpsUser | null; token: string | null; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; loading: boolean; mustChangePassword: boolean; clearMustChange: () => void; }
const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OpsUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshedAt = useRef<number>(0);

  function scheduleRefresh(accessToken: string) {
    if (timer.current) clearTimeout(timer.current);
    const exp = getTokenExpiry(accessToken);
    if (!exp) return;
    const msUntilRefresh = Math.max(exp - Date.now() - 2 * 60 * 1000, 0);
    timer.current = setTimeout(silentRefresh, msUntilRefresh);
  }

  const silentRefresh = useCallback(async (): Promise<string | null> => {
    if (Date.now() - lastRefreshedAt.current < 30_000) {
      return token;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) { doLogout(); return null; }
      const { data } = await res.json();
      setToken(data.accessToken);
      lastRefreshedAt.current = Date.now();
      scheduleRefresh(data.accessToken);
      return data.accessToken;
    } catch { doLogout(); return null; }
  }, [token]);

  function doLogout() { setToken(null); setUser(null); }

  function clearMustChange() {
    setUser(prev => prev ? { ...prev, mustChangePassword: false } : null);
  }

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
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) { setLoading(false); return; }
        const { data } = await res.json();
        setToken(data.accessToken);
        scheduleRefresh(data.accessToken);

        const meRes = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${data.accessToken}` } });
        const { data: userData } = await meRes.json();
        if (userData?.role === 'SUPERADMIN') {
          setUser(userData);
        } else {
          doLogout();
        }
      } catch {
        doLogout();
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  async function login(email: string, password: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Login failed');
    if (body.data.user.role !== 'SUPERADMIN') throw new Error('This portal is for Cevop operators only');
    setToken(body.data.accessToken); setUser(body.data.user); scheduleRefresh(body.data.accessToken);
  }
  async function logout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    } catch { /* ignore */ }
    if (timer.current) clearTimeout(timer.current);
    doLogout();
  }
  return <AuthContext.Provider value={{ user, token, login, logout, loading, mustChangePassword: user?.mustChangePassword ?? false, clearMustChange }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const c = useContext(AuthContext); if (!c) throw new Error('Need AuthProvider'); return c; }
export function useApi() {
  const { token } = useAuth();
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  return {
    get: (path: string) => fetch(`${API_BASE}${path}`, { headers: h }).then(r => r.json()),
    post: (path: string, body: unknown) => fetch(`${API_BASE}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) }).then(r => r.json()),
    patch: (path: string, body: unknown) => fetch(`${API_BASE}${path}`, { method: 'PATCH', headers: h, body: JSON.stringify(body) }).then(r => r.json()),
  };
}
