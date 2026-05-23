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
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'x-cevop-app': 'admin' };
const SESSION_MARKER_KEY = `cevop_admin_has_session:${window.location.hostname}`;

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
export interface BranchInfo {
  id: string;
  name: string;
  slug: string;
}
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  organizationId: string;
  branchId: string | null;
  organization: OrgInfo;
  branch: BranchInfo | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  setToken: (token: string) => void;
  activeBranchFilter: BranchInfo | null;
  setActiveBranchFilter: (branch: BranchInfo | null) => void;
  login: (
    email: string,
    password: string,
    organizationId?: string,
    rememberMe?: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBranchFilter, setActiveBranchFilter] = useState<BranchInfo | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshedAt = useRef<number>(0);
  const silentRefreshRef = useRef<() => void>(() => void 0);

  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const exp = getTokenExpiry(accessToken);
    if (!exp) return;
    const msUntilRefresh = Math.max(exp - Date.now() - 2 * 60 * 1000, 0);
    refreshTimerRef.current = setTimeout(() => silentRefreshRef.current(), msUntilRefresh);
  }, []);

  const setTokenInMemory = useCallback(
    (accessToken: string) => {
      setToken(accessToken);
      scheduleRefresh(accessToken);
      try {
        localStorage.setItem(SESSION_MARKER_KEY, '1');
      } catch {
        /* ignore */
      }
    },
    [scheduleRefresh],
  );

  const silentRefresh = useCallback(async (): Promise<string | null> => {
    // Debounce
    if (Date.now() - lastRefreshedAt.current < 30_000) {
      return token; // Return current in-memory token
    }

    if (!sessionStorage.getItem('impersonate_token') && !localStorage.getItem(SESSION_MARKER_KEY)) {
      return null;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // Cookie is sent automatically
        headers: AUTH_HEADERS,
        // No body
      });
      if (!res.ok) {
        if (res.status === 401) {
          try {
            localStorage.removeItem(SESSION_MARKER_KEY);
          } catch {
            /* ignore */
          }
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          sessionStorage.removeItem('impersonate_token');
          setToken(null);
          setUser(null);
          setActiveBranchFilter(null);
          return null;
        }
        return token;
      }
      const { data } = await res.json();
      setTokenInMemory(data.accessToken);
      try {
        localStorage.setItem(SESSION_MARKER_KEY, '1');
      } catch {
        /* ignore */
      }
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
    // Attempt to restore session from httpOnly cookie, or from URL token (Impersonation)
    (async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        let tokenFromUrl = urlParams.get('token');

        if (tokenFromUrl) {
          // Save to sessionStorage to survive StrictMode double-mount and page refreshes
          sessionStorage.setItem('impersonate_token', tokenFromUrl);
          // Clear token from URL so it's not bookmarked
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          // If not in URL, check if we have an active impersonation session
          tokenFromUrl = sessionStorage.getItem('impersonate_token');
        }

        let activeToken = tokenFromUrl;

        if (!tokenFromUrl) {
          if (!localStorage.getItem(SESSION_MARKER_KEY)) {
            setLoading(false);
            return;
          }
          const res = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: 'POST',
            credentials: 'include', // Required — sends the cookie
            headers: AUTH_HEADERS,
          });
          if (!res.ok) {
            try {
              localStorage.removeItem(SESSION_MARKER_KEY);
            } catch {
              /* ignore */
            }
            setLoading(false);
            return;
          }
          const { data } = await res.json();
          activeToken = data.accessToken;
          try {
            localStorage.setItem(SESSION_MARKER_KEY, '1');
          } catch {
            /* ignore */
          }
        }

        if (!activeToken) {
          setLoading(false);
          return;
        }

        setToken(activeToken);
        scheduleRefresh(activeToken);

        // Then fetch /me to get user details
        const meRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        const { data: userData } = await meRes.json();
        if (userData) {
          const allowedRoles = [
            'ORG_OWNER',
            'ADMIN',
            'ORG_MANAGER',
            'ORG_FINANCE',
            'ORG_AUDITOR',
            'BRANCH_ADMIN',
            'BRANCH_FINANCE',
          ];
          if (!allowedRoles.includes(userData.role)) {
            setUser(null);
            setToken(null);
            setLoading(false);
            return;
          }
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
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh]);

  async function login(
    email: string,
    password: string,
    organizationId?: string,
    rememberMe?: boolean,
  ) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include', // Required — server sets the cookie on this response
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

    const role = body.data.user.role;
    if (role === 'SUPERADMIN') {
      throw new Error('This account belongs to the Ops team. Please use the Ops Portal.');
    }
    if (role === 'SERVICE' || role === 'WAITER') {
      throw new Error('This is a branch staff account. Please use the Service Portal.');
    }
    const allowedRoles = [
      'ORG_OWNER',
      'ADMIN',
      'ORG_MANAGER',
      'ORG_FINANCE',
      'ORG_AUDITOR',
      'BRANCH_ADMIN',
      'BRANCH_FINANCE',
    ];
    if (!allowedRoles.includes(role)) {
      throw new Error('Access denied for this role');
    }

    setTokenInMemory(body.data.accessToken);
    setUser(body.data.user);
    if (body.data.user.branch) setActiveBranchFilter(body.data.user.branch);
    try {
      localStorage.setItem(SESSION_MARKER_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  async function logout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include', // Sends cookie so server can revoke it
        headers: AUTH_HEADERS,
      });
    } catch {
      /* ignore */
    }
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    sessionStorage.removeItem('impersonate_token');
    try {
      localStorage.removeItem(SESSION_MARKER_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    setActiveBranchFilter(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        setToken: setTokenInMemory,
        activeBranchFilter,
        setActiveBranchFilter,
        login,
        logout,
        loading,
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

// Central API hook — automatically appends branchId and sends auth header
export function useApi() {
  const { token, user, activeBranchFilter } = useAuth();
  const effectiveBranchId = user?.branchId ?? activeBranchFilter?.id ?? null;

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const shouldAppendBranchId = useCallback((pathname: string): boolean => {
    return (
      pathname.startsWith('/api/menu') ||
      pathname.startsWith('/api/tables') ||
      pathname.startsWith('/api/orders') ||
      pathname.startsWith('/api/waiter-calls') ||
      pathname.startsWith('/api/service-requests') ||
      pathname.startsWith('/api/sections') ||
      pathname.startsWith('/api/sessions') ||
      pathname.startsWith('/api/help-options') ||
      pathname.startsWith('/api/waiter-tasks')
    );
  }, []);

  const buildUrl = useCallback(
    (path: string, params?: Record<string, string>): string => {
      const base = API_BASE || '';
      // Parse path — may already have query string
      const [pathname, existingQs] = path.split('?');
      const url = new URLSearchParams(existingQs || '');
      if (shouldAppendBranchId(pathname) && effectiveBranchId && !url.has('branchId')) {
        url.set('branchId', effectiveBranchId);
      }
      if (params) Object.entries(params).forEach(([k, v]) => url.set(k, v));
      const qs = url.toString();
      return `${base}${pathname}${qs ? '?' + qs : ''}`;
    },
    [effectiveBranchId, shouldAppendBranchId],
  );

  const handleResponse = useCallback(async (res: Response) => {
    const data = await res.json();
    if (res.status === 402 && data.upgradeRequired) {
      alert(`Limit Reached:\n${data.error}\n\nPlease contact Cevop support to upgrade your plan.`);
    }
    return data;
  }, []);

  const get = useCallback(
    (path: string, params?: Record<string, string>) =>
      fetch(buildUrl(path, params), { headers, credentials: 'include' }).then(handleResponse),
    [buildUrl, handleResponse, headers],
  );
  const post = useCallback(
    (path: string, body: unknown) =>
      fetch(buildUrl(path), {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
      }).then(handleResponse),
    [buildUrl, handleResponse, headers],
  );
  const put = useCallback(
    (path: string, body: unknown) =>
      fetch(buildUrl(path), {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
      }).then(handleResponse),
    [buildUrl, handleResponse, headers],
  );
  const patch = useCallback(
    (path: string, body: unknown) =>
      fetch(buildUrl(path), {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
      }).then(handleResponse),
    [buildUrl, handleResponse, headers],
  );
  const del = useCallback(
    (path: string) =>
      fetch(buildUrl(path), { method: 'DELETE', headers, credentials: 'include' }).then(
        handleResponse,
      ),
    [buildUrl, handleResponse, headers],
  );

  return useMemo(
    () => ({ effectiveBranchId, get, post, put, patch, delete: del }),
    [del, effectiveBranchId, get, patch, post, put],
  );
}

// Keep for backward compat where needed
export const API = (token: string | null) => ({
  get: (path: string) =>
    fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
      r.json(),
    ),
  post: (path: string, body: unknown) =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
  put: (path: string, body: unknown) =>
    fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
  patch: (path: string, body: unknown) =>
    fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
  delete: (path: string) =>
    fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json()),
});
