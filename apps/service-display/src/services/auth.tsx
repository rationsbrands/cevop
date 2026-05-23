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
const HAS_SESSION_KEY =
  typeof window !== 'undefined'
    ? `cevop_service_has_session_${window.location.hostname}`
    : 'cevop_service_has_session';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isOnShift?: boolean;
  organizationId: string;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  staffCode?: string;
  organization: { id: string; name: string; slug: string };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, organizationId?: string) => Promise<void>;
  logout: () => void;
  silentRefresh: () => Promise<string | null>;
  updateUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'x-cevop-app': 'service' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshedAt = useRef<number>(0);
  const silentRefreshRef = useRef<() => void>(() => void 0);

  function doLogout() {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(HAS_SESSION_KEY);
    } catch {
      void 0;
    }
  }

  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const exp = getTokenExpiry(accessToken);
    if (!exp) return;
    const msUntilRefresh = Math.max(exp - Date.now() - 2 * 60 * 1000, 0);
    refreshTimerRef.current = setTimeout(() => silentRefreshRef.current(), msUntilRefresh);
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
      try {
        localStorage.setItem(HAS_SESSION_KEY, '1');
      } catch {
        void 0;
      }
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
        let hasSession = false;
        try {
          hasSession = localStorage.getItem(HAS_SESSION_KEY) === '1';
        } catch {
          hasSession = false;
        }

        if (!hasSession) {
          setLoading(false);
          return;
        }

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
        try {
          localStorage.setItem(HAS_SESSION_KEY, '1');
        } catch {
          void 0;
        }

        const meRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${data.accessToken}` },
        });
        const { data: userData } = await meRes.json();
        if (userData) {
          const allowedRoles = ['SERVICE', 'WAITER', 'KITCHEN'];
          if (!allowedRoles.includes(userData.role) || !userData.branchId) {
            doLogout();
            return;
          }
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
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh]);

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
    doLogout();
  }

  async function login(email: string, password: string, organizationId?: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ email, password, ...(organizationId ? { organizationId } : {}) }),
    });
    const { data, error } = await res.json();
    if (!res.ok) {
      if (res.status === 409 && (data as any)?.accounts) {
        const err: any = new Error(error || 'Multiple accounts found');
        err.code = 'MULTI_ACCOUNT';
        err.accounts = (data as any).accounts;
        throw err;
      }
      throw new Error(error || 'Login failed');
    }

    const role = data.user.role;
    if (role === 'SUPERADMIN') {
      throw new Error('This account belongs to the Ops team. Please use the Ops Portal.');
    }
    if (
      role === 'ORG_OWNER' ||
      role === 'ADMIN' ||
      role === 'ORG_MANAGER' ||
      role === 'ORG_FINANCE' ||
      role === 'ORG_AUDITOR' ||
      role === 'BRANCH_ADMIN'
    ) {
      throw new Error('This is an admin account. Please use the Admin Dashboard.');
    }
    const allowedRoles = ['SERVICE', 'WAITER', 'KITCHEN'];
    if (!allowedRoles.includes(role)) {
      throw new Error('Access denied for this role');
    }

    setToken(data.accessToken);
    setUser(data.user);
    scheduleRefresh(data.accessToken);
    try {
      localStorage.setItem(HAS_SESSION_KEY, '1');
    } catch {
      void 0;
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        silentRefresh,
        updateUser: (patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev)),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
