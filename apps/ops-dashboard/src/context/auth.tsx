import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
  useCallback,
  useMemo,
} from 'react';
import { getTokenExpiry, isTokenStale } from '../../../../shared/utils/authSession';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'x-cevop-app': 'ops' };

export interface OpsUser {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  mustChangePassword: boolean;
  emailVerified: boolean;
}
interface AuthCtx {
  user: OpsUser | null;
  token: string | null;
  login: (email: string, password: string, organizationId?: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
  mustChangePassword: boolean;
  clearMustChange: () => void;
}
const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OpsUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshedAt = useRef<number>(0);
  const silentRefreshRef = useRef<() => void>(() => void 0);

  const scheduleRefresh = useCallback((accessToken: string) => {
    if (timer.current) clearTimeout(timer.current);
    const exp = getTokenExpiry(accessToken);
    if (!exp) return;
    const msUntilRefresh = Math.max(exp - Date.now() - 2 * 60 * 1000, 0);
    timer.current = setTimeout(() => silentRefreshRef.current(), msUntilRefresh);
  }, []);

  const silentRefresh = useCallback(async (): Promise<string | null> => {
    if (Date.now() - lastRefreshedAt.current < 30_000) {
      return token;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: AUTH_HEADERS,
      });
      if (!res.ok) {
        if (res.status === 401) {
          doLogout();
          return null;
        }
        return token;
      }
      const { data } = await res.json();
      setToken(data.accessToken);
      lastRefreshedAt.current = Date.now();
      scheduleRefresh(data.accessToken);
      return data.accessToken;
    } catch {
      return token;
    }
  }, [scheduleRefresh, token]);

  useEffect(() => {
    silentRefreshRef.current = () => {
      silentRefresh().catch(() => void 0);
    };
  }, [silentRefresh]);

  function doLogout() {
    setToken(null);
    setUser(null);
  }

  function clearMustChange() {
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : null));
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
          headers: AUTH_HEADERS,
        });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const { data } = await res.json();
        setToken(data.accessToken);
        scheduleRefresh(data.accessToken);

        const meRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${data.accessToken}` },
        });
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
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scheduleRefresh]);

  async function login(email: string, password: string, organizationId?: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ email, password, ...(organizationId ? { organizationId } : {}) }),
    });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 409 && body?.data?.accounts) {
        const err: any = new Error(body.error || 'Multiple accounts found');
        err.code = 'MULTI_ACCOUNT';
        err.accounts = body.data.accounts;
        throw err;
      }
      throw new Error(body.error || 'Login failed');
    }
    if (body.data.user.role !== 'SUPERADMIN')
      throw new Error('This portal is for Cevop operators only');
    setToken(body.data.accessToken);
    setUser(body.data.user);
    scheduleRefresh(body.data.accessToken);
  }
  async function logout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: AUTH_HEADERS,
      });
    } catch {
      /* ignore */
    }
    if (timer.current) clearTimeout(timer.current);
    doLogout();
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        loading,
        mustChangePassword: user?.mustChangePassword ?? false,
        clearMustChange,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('Need AuthProvider');
  return c;
}
export function useApi() {
  const { token } = useAuth();
  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const get = useCallback(
    (path: string) => fetch(`${API_BASE}${path}`, { headers }).then((r) => r.json()),
    [headers],
  );
  const post = useCallback(
    (path: string, body: unknown) =>
      fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    [headers],
  );
  const patch = useCallback(
    (path: string, body: unknown) =>
      fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    [headers],
  );
  const del = useCallback(
    (path: string) =>
      fetch(`${API_BASE}${path}`, { method: 'DELETE', headers }).then((r) => r.json()),
    [headers],
  );

  return useMemo(() => ({ get, post, patch, delete: del }), [del, get, patch, post]);
}
