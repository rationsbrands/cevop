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
const HAS_SESSION_KEY =
  typeof window !== 'undefined'
    ? `cevop_ops_has_session_${window.location.hostname}`
    : 'cevop_ops_has_session';

export interface OpsUser {
  id: string;
  name: string;
  email: string;
  role: string;
  opsRole?: 'SUPER' | 'SUPPORT' | 'BILLING' | 'READONLY';
  organizationId: string;
  mustChangePassword: boolean;
  emailVerified: boolean;
}
interface AuthCtx {
  user: OpsUser | null;
  token: string | null;
  setToken: (token: string) => void;
  login: (
    email: string,
    password: string,
    organizationId?: string,
    rememberMe?: boolean,
  ) => Promise<void>;
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

  const setTokenInMemory = useCallback(
    (accessToken: string) => {
      setToken(accessToken);
      scheduleRefresh(accessToken);
      try {
        localStorage.setItem(HAS_SESSION_KEY, '1');
      } catch {
        void 0;
      }
    },
    [scheduleRefresh],
  );

  const silentRefresh = useCallback(async (): Promise<string | null> => {
    if (Date.now() - lastRefreshedAt.current < 30_000) {
      return token;
    }

    try {
      // If we're on the login page and don't have a marker, don't even try
      if (window.location.pathname === '/login' && !localStorage.getItem(HAS_SESSION_KEY)) {
        return null;
      }

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
      setTokenInMemory(data.accessToken);
      lastRefreshedAt.current = Date.now();
      return data.accessToken;
    } catch {
      return token;
    }
  }, [setTokenInMemory, token]);

  useEffect(() => {
    silentRefreshRef.current = () => {
      silentRefresh().catch(() => void 0);
    };
  }, [silentRefresh]);

  function doLogout() {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(HAS_SESSION_KEY);
    } catch {
      void 0;
    }
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
          if (res.status === 401) doLogout();
          setLoading(false);
          return;
        }
        const { data } = await res.json();
        setTokenInMemory(data.accessToken);
        try {
          localStorage.setItem(HAS_SESSION_KEY, '1');
        } catch {
          void 0;
        }

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
  }, [scheduleRefresh, setTokenInMemory]);

  async function login(
    email: string,
    password: string,
    organizationId?: string,
    rememberMe?: boolean,
  ) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        email,
        password,
        ...(organizationId ? { organizationId } : {}),
        ...(rememberMe ? { rememberMe } : {}),
      }),
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
    setTokenInMemory(body.data.accessToken);
    setUser(body.data.user);
    try {
      localStorage.setItem(HAS_SESSION_KEY, '1');
    } catch {
      void 0;
    }
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
        setToken: setTokenInMemory,
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
    (path: string) =>
      fetch(`${API_BASE}${path}`, { headers, credentials: 'include' }).then((r) => r.json()),
    [headers],
  );
  const post = useCallback(
    (path: string, body: unknown) =>
      fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    [headers],
  );
  const patch = useCallback(
    (path: string, body: unknown) =>
      fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    [headers],
  );
  const del = useCallback(
    (path: string) =>
      fetch(`${API_BASE}${path}`, { method: 'DELETE', headers, credentials: 'include' }).then((r) =>
        r.json(),
      ),
    [headers],
  );

  return useMemo(() => ({ get, post, patch, delete: del }), [del, get, patch, post]);
}

// Permission map — mirrors server/src/middleware/opsPermissions.ts
const OPS_PERMISSIONS: Record<string, string[]> = {
  SUPER: [
    'view_metrics',
    'view_orgs',
    'view_org_detail',
    'manage_plans',
    'assign_trial',
    'suspend_org',
    'activate_org',
    'delete_org',
    'impersonate',
    'view_audit',
    'view_team',
    'manage_team',
    'change_own_password',
    'onboard_org',
  ],
  BILLING: [
    'view_metrics',
    'view_orgs',
    'view_org_detail',
    'manage_plans',
    'assign_trial',
    'view_audit',
    'change_own_password',
  ],
  SUPPORT: ['view_orgs', 'view_org_detail', 'assign_trial', 'view_audit', 'change_own_password'],
  READONLY: ['view_metrics', 'view_orgs', 'change_own_password'],
};

export function usePermission() {
  const { user } = useAuth();
  return (permission: string): boolean => {
    if (!user) return false;
    const role = user.opsRole ?? 'SUPER'; // default to SUPER for legacy accounts
    return (OPS_PERMISSIONS[role] ?? []).includes(permission);
  };
}
