import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

const API_BASE = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  syncSignal: number; // increments every time SYNC_REQUIRED fires — pages watch this to re-fetch
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
  syncSignal: 0,
});

export function SocketProvider({
  children,
  token,
  organizationId,
  branchId,
}: {
  children: ReactNode;
  token: string | null;
  organizationId?: string;
  branchId?: string | null;
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [syncSignal, setSyncSignal] = useState(0);
  const tokenRef = useRef(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (!token || !organizationId) return;

    const SOCKET_URL = API_BASE || window.location.origin;

    const s = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        cb({ token: tokenRef.current });
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    setSocket(s);

    function joinRooms() {
      if (branchId) {
        s.emit('JOIN_BRANCH', { orgId: organizationId, branchId });
      } else {
        s.emit('JOIN_ORG', organizationId);
      }
    }

    s.on('connect', () => {
      setConnected(true);
      joinRooms();
    });

    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));

    // Bump syncSignal on SYNC_REQUIRED so any page watching it can re-fetch
    s.on('SYNC_REQUIRED', () => setSyncSignal((n) => n + 1));

    // Keepalive ping every 25 seconds — prevents iOS/Android killing idle connections
    const keepAlive = setInterval(() => {
      if (s.connected) s.emit('ping');
    }, 25000);

    // Re-connect and re-fetch when the app comes back from background/sleep
    function onVisible() {
      if (document.visibilityState === 'visible') {
        if (!s.connected) {
          s.connect();
        } else {
          // Already connected — rooms may have been dropped, rejoin and signal a sync
          joinRooms();
        }
        setSyncSignal((n) => n + 1);
      }
    }

    // Re-connect when network comes back after being offline
    function onOnline() {
      if (!s.connected) s.connect();
      setSyncSignal((n) => n + 1);
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(keepAlive);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token, organizationId, branchId]);

  return (
    <SocketContext.Provider value={{ socket, connected, syncSignal }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
