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
import { showToast } from '../components/Popup';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'x-cevop-app': 'admin' };
const SESSION_MARKER_KEY = `cevop_admin_has_session:${window.location.hostname}`;

const OFFLINE_DB_NAME = 'cevop_admin_offline';
const OFFLINE_DB_VERSION = 1;
const OFFLINE_CACHE_STORE = 'cache';
const OFFLINE_QUEUE_STORE = 'queue';

type OfflineCacheEntry = { key: string; ts: number; value: any };
type OfflineQueueEntry = {
  id?: number;
  ts: number;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: any;
};

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_CACHE_STORE)) {
        db.createObjectStore(OFFLINE_CACHE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function getOfflineCache(key: string): Promise<any | null> {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(OFFLINE_CACHE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_CACHE_STORE);
    const req = store.get(key);
    req.onsuccess = () => {
      const row = req.result as OfflineCacheEntry | undefined;
      resolve(row?.value ?? null);
    };
    req.onerror = () => resolve(null);
  });
}

async function setOfflineCache(key: string, value: any): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(OFFLINE_CACHE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.objectStore(OFFLINE_CACHE_STORE).put({
      key,
      ts: Date.now(),
      value,
    } satisfies OfflineCacheEntry);
  });
}

async function enqueueOfflineMutation(entry: Omit<OfflineQueueEntry, 'id'>): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.objectStore(OFFLINE_QUEUE_STORE).add(entry);
  });
}

async function listOfflineQueue(): Promise<OfflineQueueEntry[]> {
  const db = await openOfflineDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as OfflineQueueEntry[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

async function deleteOfflineQueueItem(id: number): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.objectStore(OFFLINE_QUEUE_STORE).delete(id);
  });
}

async function flushOfflineQueue(
  headers: Record<string, string>,
): Promise<{ flushed: number; remaining: number }> {
  const queued = await listOfflineQueue();
  if (queued.length === 0) return { flushed: 0, remaining: 0 };

  const sorted = [...queued].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let flushed = 0;

  for (const item of sorted) {
    if (!navigator.onLine) break;
    if (!item?.id) break;

    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers,
        credentials: 'include',
        body: item.method === 'DELETE' ? undefined : JSON.stringify(item.body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 402 && (json as any)?.upgradeRequired) {
        showToast(
          `Limit reached:\n${(json as any)?.error || 'Upgrade required'}\n\nPlease contact Cevop support to upgrade your plan.`,
          'error',
        );
      }
      if (!res.ok || (json && typeof json === 'object' && (json as any).success === false)) {
        break;
      }

      await deleteOfflineQueueItem(item.id);
      flushed += 1;
    } catch {
      break;
    }
  }

  const remaining = (await listOfflineQueue()).length;
  return { flushed, remaining };
}

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
    if (!token) return;

    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const onOnline = () => {
      flushOfflineQueue(headers)
        .then(({ flushed }) => {
          if (flushed > 0) {
            showToast(`Synced ${flushed} pending change${flushed === 1 ? '' : 's'}.`, 'success');
          }
        })
        .catch(() => void 0);
    };

    if (navigator.onLine) onOnline();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [token]);

  const hydrateFromToken = useCallback(
    async (activeToken: string) => {
      setToken(activeToken);
      scheduleRefresh(activeToken);

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
          'CASHIER',
          'HOST',
        ];
        if (!allowedRoles.includes(userData.role)) {
          setUser(null);
          setToken(null);
          setActiveBranchFilter(null);
          return false;
        }
        setUser(userData);
        if (userData.branch) setActiveBranchFilter(userData.branch);
        return true;
      }
      setToken(null);
      setUser(null);
      setActiveBranchFilter(null);
      return false;
    },
    [scheduleRefresh],
  );

  useEffect(() => {
    function isAllowedOrigin(origin: string): boolean {
      try {
        const o = new URL(origin);
        if (o.protocol === 'https:' && o.hostname.endsWith('.cevop.com')) return true;
        if (o.hostname === 'cevop.com' && o.protocol === 'https:') return true;
        if (o.hostname === 'localhost' || o.hostname === '127.0.0.1') return true;
      } catch {
        void 0;
      }
      return false;
    }

    async function onMessage(ev: MessageEvent) {
      if (!isAllowedOrigin(ev.origin)) return;
      if (ev.data?.type !== 'CEVOP_IMPERSONATE_TOKEN') return;
      const incomingToken = ev.data?.token;
      if (typeof incomingToken !== 'string' || incomingToken.length < 50) return;

      try {
        sessionStorage.setItem('impersonate_token', incomingToken);
      } catch {
        void 0;
      }

      setLoading(true);
      const ok = await hydrateFromToken(incomingToken).catch(() => false);
      setLoading(false);

      try {
        (ev.source as WindowProxy | null)?.postMessage(
          { type: 'CEVOP_IMPERSONATE_ACK' },
          ev.origin,
        );
      } catch {
        void 0;
      }

      if (ok && window.location.pathname === '/login') {
        window.location.replace('/');
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [hydrateFromToken]);

  useEffect(() => {
    // Attempt to restore session from httpOnly cookie, or from URL token (Impersonation)
    (async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const codeFromUrl = urlParams.get('code');
        let tokenFromUrl = urlParams.get('token');

        if (codeFromUrl && !tokenFromUrl) {
          const exchangeRes = await fetch(
            `${API_BASE}/api/auth/impersonate/exchange?code=${encodeURIComponent(codeFromUrl)}`,
            { headers: AUTH_HEADERS, credentials: 'include' },
          );
          if (exchangeRes.ok) {
            const { data } = await exchangeRes.json();
            const exchangedToken = typeof data?.token === 'string' ? data.token : null;
            if (exchangedToken) {
              tokenFromUrl = exchangedToken;
              sessionStorage.setItem('impersonate_token', exchangedToken);
            }
          }
          window.history.replaceState({}, document.title, window.location.pathname);
        }

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
        await hydrateFromToken(activeToken);
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [hydrateFromToken]);

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
      'CASHIER',
      'HOST',
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
      pathname.startsWith('/api/waiter-tasks') ||
      pathname.startsWith('/api/payments')
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
      showToast(
        `Limit reached:\n${data.error}\n\nPlease contact Cevop support to upgrade your plan.`,
        'error',
      );
    }
    return data;
  }, []);

  const request = useCallback(
    async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: any) => {
      const cacheKey = `${method}:${url}`;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

      if (method === 'GET') {
        if (offline) {
          const cached = await getOfflineCache(cacheKey);
          if (cached) return cached;
          return { success: false, error: 'Offline' };
        }
        try {
          const json = await fetch(url, { headers, credentials: 'include' }).then(handleResponse);
          if (json && typeof json === 'object' && (json as any).success === true) {
            setOfflineCache(cacheKey, json).catch(() => void 0);
          }
          return json;
        } catch {
          const cached = await getOfflineCache(cacheKey);
          if (cached) return cached;
          return { success: false, error: 'Network error' };
        }
      }

      try {
        const init: RequestInit = {
          method,
          headers,
          credentials: 'include',
        };
        if (method !== 'DELETE') init.body = JSON.stringify(body ?? {});
        const json = await fetch(url, init).then(handleResponse);
        return json;
      } catch {
        try {
          await enqueueOfflineMutation({
            ts: Date.now(),
            method: method as any,
            url,
            body: method === 'DELETE' ? null : (body ?? {}),
          });
          showToast('Saved offline. Will sync when you are back online.', 'info');
          return { success: true, queued: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      }
    },
    [handleResponse, headers],
  );

  const get = useCallback(
    (path: string, params?: Record<string, string>) => request('GET', buildUrl(path, params)),
    [buildUrl, request],
  );
  const post = useCallback(
    (path: string, body: unknown) => request('POST', buildUrl(path), body),
    [buildUrl, request],
  );
  const put = useCallback(
    (path: string, body: unknown) => request('PUT', buildUrl(path), body),
    [buildUrl, request],
  );
  const patch = useCallback(
    (path: string, body: unknown) => request('PATCH', buildUrl(path), body),
    [buildUrl, request],
  );
  const del = useCallback((path: string) => request('DELETE', buildUrl(path)), [buildUrl, request]);

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
