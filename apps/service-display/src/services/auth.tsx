import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
  useCallback,
} from 'react';
import { getTokenExpiry, isTokenStale } from '../../../../shared/utils/authSession';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  organization: { id: string; name: string; slug: string };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  silentRefresh: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'x-cevop-app': 'service' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshedAt = useRef<number>(0);

  function scheduleRefresh(accessToken: string) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const exp = getTokenExpiry(accessToken);
    if (!exp) return;
    const msUntilRefresh = Math.max(exp - Date.now() - 2 * 60 * 1000, 0);
    refreshTimerRef.current = setTimeout(silentRefresh, msUntilRefresh);
  }

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
        logout();
        return null;
      }
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
        if (userData) {
          setUser(userData);
        } else {
          logout();
        }
      } catch {
        logout();
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

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
    setToken(null);
    setUser(null);
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const { data, error } = await res.json();
    if (!res.ok) throw new Error(error || 'Login failed');

    // Enforce that only service/admin/branch_admin roles can log in here
    const allowedRoles = ['SERVICE', 'ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN', 'WAITER'];
    if (!allowedRoles.includes(data.user.role)) {
      throw new Error('Access denied for this role');
    }

    setToken(data.accessToken);
    setUser(data.user);
    scheduleRefresh(data.accessToken);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, silentRefresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
