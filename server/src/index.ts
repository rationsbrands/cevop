import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Initialise Sentry before anything else so it captures all errors
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: 0.1,
  enabled: !!process.env.SENTRY_DSN,
});

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Server as SocketServer } from 'socket.io';

import { getRedisClient } from './services/redis';
import { prisma } from './services/prisma';
import './services/queue'; // Initialise BullMQ workers

import { authRouter } from './routes/auth';
import { menuRouter } from './routes/menu';
import { ordersRouter } from './routes/orders';
import { sessionsRouter } from './routes/sessions';
import { tablesRouter } from './routes/tables';
import { orgsRouter } from './routes/orgs';
import { waiterCallsRouter } from './routes/waiterCalls';
import { serviceRequestsRouter } from './routes/serviceRequests';
import { usersRouter } from './routes/users';
import { branchesRouter } from './routes/branches';
import { sectionsRouter } from './routes/sections';
import { invitesRouter } from './routes/invites';
import { opsRouter } from './routes/ops';
import { helpOptionsRouter } from './routes/helpOptions';
import { waiterTasksRouter } from './routes/waiterTasks';
import { plansRouter } from './routes/plans';
import { pushRouter } from './routes/push';
import { paymentsRouter } from './routes/payments';
import { stationsRouter } from './routes/stations';
import { analyticsRouter } from './routes/analytics';
import { orderItemsRouter } from './routes/orderItems';
import { notificationsRouter } from './routes/notifications';
import { timesheetsRouter } from './routes/timesheets';
import { shiftsRouter } from './routes/shifts';
import { initSocketHandlers } from './sockets/handlers';
import { errorHandler } from './middleware/errorHandler';
import { planGuard } from './middleware/planGuard';
import { logger } from './services/logger';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const app = express();
const httpServer = createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean) || [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'https://admin.cevop.com',
  'https://service.cevop.com',
  'https://ops.cevop.com',
  'https://order.cevop.com',
  'https://www.cevop.com',
  'https://cevop.com',
];

const isDev = process.env.NODE_ENV !== 'production';

export const io = new SocketServer(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
});

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.set('trust proxy', 1);

function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
  if (isDev) return cb(null, true);
  if (!origin) return cb(null, true);
  if (allowedOrigins.includes(origin)) return cb(null, true);
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.cevop.com')) return cb(null, true);
  } catch {
    // ignore
  }
  return cb(null, false);
}

// CORS
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

// Use minimal format in production — 'combined' is too verbose and slow at high traffic
const morganFormat = process.env.NODE_ENV === 'production' ? 'tiny' : 'combined';
app.use(morgan(morganFormat, { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Request timeout — 30s hard limit. Prevents slow DB queries from hanging the server.
app.use((req: Request, res: Response, next: NextFunction) => {
  const TIMEOUT_MS = 30_000;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      logger.warn('Request timeout', { method: req.method, url: req.url });
      res.status(503).json({ success: false, error: 'Request timeout' });
    }
  }, TIMEOUT_MS);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

// ---------------------------------------------------------------------------
// Rate limiting — Upstash Redis when available, in-memory fallback otherwise
// ---------------------------------------------------------------------------

function getRateLimitKey(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).split(',')[0].trim();

  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * For the refresh endpoint, key by userId decoded from the JWT.
 * Falls back to IP if no valid token is present.
 * This means each user has their own rate limit bucket regardless of which
 * device or IP they are on — critical for restaurants with many devices on
 * one NAT IP.
 */
function getRefreshRateLimitKey(req: Request): string {
  try {
    const auth = req.headers.authorization;
    // Refresh uses httpOnly cookie, not a bearer token — so also check cookie
    // We just need to extract sub from the cookie's refresh token hash.
    // Since we can't decode the httpOnly cookie here easily, we try the
    // Authorization header first (for cases where token is passed), and
    // fall back to IP. The important thing is the Upstash key prefix
    // 'cevop:rl:refresh' is separate from 'cevop:rl:api'.
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
        if (payload?.sub) return `user:${payload.sub}`;
      }
    }
  } catch {
    // ignore — fall through to IP
  }
  return getRateLimitKey(req);
}

// Fallback in-memory limiters (used in dev or if Redis not configured)
const authFallback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skip: (req) => req.method === 'OPTIONS',
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down.' },
});

// Dedicated in-memory fallback for /api/auth/refresh
// Higher limit than auth (logins) since refresh is called automatically.
// Keyed separately from general API traffic so refresh never eats into API quota.
const authRefreshFallback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: (req) => req.method === 'OPTIONS',
  keyGenerator: getRefreshRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many token refresh requests, please slow down.' },
});

const apiFallback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: (req) => req.method === 'OPTIONS',
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests.' },
});

const publicFallback = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  skip: (req) => req.method === 'OPTIONS',
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests from this table.' },
});

// Build Upstash-backed limiters if Redis is configured
function makeUpstashLimiter(requests: number, window: Duration, prefix: string): Ratelimit | null {
  const redis = getRedisClient();
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: `cevop:rl:${prefix}`,
  });
}

const upstashAuth = makeUpstashLimiter(50, '15 m', 'auth');
// Refresh gets its own Upstash namespace so it never competes with general API traffic.
// 300 per 15 min per user = 20/min, ample for proactive + reactive refreshes.
const upstashRefresh = makeUpstashLimiter(300, '15 m', 'refresh');
const upstashApi = makeUpstashLimiter(500, '15 m', 'api');
const upstashPublic = makeUpstashLimiter(60, '1 m', 'public');
// Wraps an Upstash limiter into Express middleware, falls back to in-memory.
// keyFn allows per-endpoint key strategies (e.g. userId for refresh, IP for general API).
function makeLimiter(
  upstash: Ratelimit | null,
  fallback: ReturnType<typeof rateLimit>,
  errorMsg: string,
  keyFn: (req: Request) => string = getRateLimitKey,
): express.RequestHandler {
  if (!upstash) return fallback;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    try {
      const key = keyFn(req);
      const { success, reset, remaining } = await upstash.limit(key);
      if (!success) {
        // Inform the client exactly when the window resets so it can back off precisely
        const retryAfterSec = Math.ceil((reset - Date.now()) / 1000);
        res.setHeader('Retry-After', String(Math.max(retryAfterSec, 1)));
        res.setHeader('X-RateLimit-Remaining', '0');
        res
          .status(429)
          .json({ success: false, error: errorMsg, retryAfter: Math.max(retryAfterSec, 1) });
        return;
      }
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      next();
    } catch {
      // If Redis call fails, fail open — don't block legitimate requests
      next();
    }
  };
}

const authLimiter = makeLimiter(upstashAuth, authFallback, 'Too many requests, please slow down.');
// Refresh limiter uses getRefreshRateLimitKey so each user has their own bucket,
// not the shared restaurant IP bucket.
const authRefreshLimiter = makeLimiter(
  upstashRefresh,
  authRefreshFallback,
  'Too many token refresh requests, please slow down.',
  getRefreshRateLimitKey,
);
const apiLimiter = makeLimiter(upstashApi, apiFallback, 'Too many requests.');
const publicLimiter = makeLimiter(
  upstashPublic,
  publicFallback,
  'Too many requests from this table.',
);

// ---------------------------------------------------------------------------

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/signup', authLimiter);
// Refresh gets its own dedicated limiter (userId-keyed, separate Upstash namespace).
// It is registered BEFORE the /api/ catch-all so it is never double-counted.
app.use('/api/auth/refresh', authRefreshLimiter);
app.use('/api/auth/check-slug', apiLimiter);
app.use('/api/menu/public', publicLimiter);
app.use('/api/orders/public', publicLimiter);
app.use('/api/tables/public', publicLimiter);
app.use('/api/waiter-calls/public', publicLimiter);
app.use('/api/service-requests/public', publicLimiter);
app.use('/api/help-options/public', publicLimiter);
// Exclude /api/auth/refresh from the general API limiter — it has its own above.
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/auth/refresh')) return next();
  return apiLimiter(req, res, next);
});

app.use('/api/plans', plansRouter);

app.get('/api/public/config', (req, res) => {
  const configured = (process.env.ADMIN_DASHBOARD_URL || '').trim();
  const host = (req.headers.host || '').toLowerCase();
  const inferred =
    host.includes('localhost') || host.includes('127.0.0.1')
      ? 'http://localhost:5175'
      : 'https://app.cevop.com';
  const raw = configured || inferred;
  const adminDashboardUrl =
    raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  res.json({ success: true, data: { adminDashboardUrl } });
});

// Enforce organization plan status
app.use('/api/', planGuard as express.RequestHandler);

// Health — actually verify DB connectivity so Railway knows when we're truly unhealthy
app.get('/health', async (_req, res) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      db: 'ok',
      dbLatencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
      version: '1.1.0',
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'unreachable',
      error: err instanceof Error ? err.message : 'DB check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/menu', menuRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/order-items', orderItemsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/timesheets', timesheetsRouter);
app.use('/api/shifts', shiftsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/sections', sectionsRouter);
app.use('/api/users', usersRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/waiter-calls', waiterCallsRouter);
app.use('/api/service-requests', serviceRequestsRouter);
app.use('/api/help-options', helpOptionsRouter);
app.use('/api/ops', opsRouter);
app.use('/api/waiter-tasks', waiterTasksRouter);
app.use('/api/push', pushRouter);
app.use('/api/stations', stationsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/payments', paymentsRouter);

// WebSocket
initSocketHandlers(io);

// Redis adapter — enables horizontal scaling across multiple server instances
// Only activates when REDIS_URL is set. Safe to leave unset — falls back to single-instance.
if (process.env.REDIS_URL) {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('Socket.io Redis adapter connected');
    })
    .catch((err) => {
      logger.error('Socket.io Redis adapter failed — running single-instance', { err });
    });
}

const staleOrderCutoffMinutes = Number(process.env.STALE_ORDER_MINUTES || 30); // 30min default — flag early
const staleOrderCheckEveryMs = Number(process.env.STALE_ORDER_CHECK_MS || 5 * 60 * 1000);
const staleOrderAuditThrottleMs = 60 * 60 * 1000;
const lastStaleAudit = new Map<string, { count: number; at: number }>();

function startStaleOrderMonitor() {
  if (process.env.NODE_ENV === 'test') return;
  if (!Number.isFinite(staleOrderCutoffMinutes) || staleOrderCutoffMinutes <= 0) return;
  if (!Number.isFinite(staleOrderCheckEveryMs) || staleOrderCheckEveryMs < 30_000) return;

  const interval = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - staleOrderCutoffMinutes * 60 * 1000);
      const groups = await prisma.order.groupBy({
        by: ['organizationId', 'branchId'],
        where: { status: { in: ['RECEIVED', 'PREPARING', 'READY'] }, updatedAt: { lt: cutoff } },
        _count: { _all: true },
      });

      const now = Date.now();
      for (const g of groups) {
        const count = (g as any)?._count?._all ?? 0;
        if (!count) continue;
        const key = `${g.organizationId}:${g.branchId}`;
        const prev = lastStaleAudit.get(key);
        const shouldWrite =
          !prev || prev.count !== count || now - prev.at > staleOrderAuditThrottleMs;
        if (!shouldWrite) continue;

        await prisma.auditLog
          .create({
            data: {
              organizationId: g.organizationId,
              userId: null,
              action: 'STALE_ORDERS_DETECTED',
              entity: 'branch',
              entityId: g.branchId as string,
              metadata: {
                branchId: g.branchId as string,
                staleCount: count,
                cutoffMinutes: staleOrderCutoffMinutes,
                cutoffIso: cutoff.toISOString(),
              },
              ipAddress: null,
            },
          })
          .catch(() => void 0);

        logger.warn('Stale orders detected', {
          organizationId: g.organizationId,
          branchId: g.branchId,
          staleCount: count,
          cutoffMinutes: staleOrderCutoffMinutes,
        });

        io.to(`${g.organizationId}:${g.branchId}`).emit('STALE_ORDERS_DETECTED', {
          count,
          minAgeMinutes: staleOrderCutoffMinutes,
        });

        lastStaleAudit.set(key, { count, at: now });
      }
    } catch (err) {
      logger.error('Stale order monitor failed', { err });
    }
  }, staleOrderCheckEveryMs);

  (interval as any).unref?.();
}

/**
 * Task Escalation Monitor (Industry Grade Handshake)
 * Periodically checks for tasks that were assigned but never acknowledged by a device.
 * If a task is not acknowledged within the timeout, it is escalated (e.g. unassigned to broadcast to everyone).
 */
function startTaskEscalationMonitor() {
  if (process.env.NODE_ENV === 'test') return;

  const ESCALATION_CHECK_MS = 30_000; // Check every 30s
  const ACK_TIMEOUT_MS = 60_000; // Handshake timeout: 60s

  const interval = setInterval(async () => {
    try {
      const now = new Date();
      const cutoff = new Date(Date.now() - ACK_TIMEOUT_MS);

      // 1. Escalate Orders (READY status but no handshake)
      const unackedOrders = await prisma.order.findMany({
        where: {
          status: 'READY',
          assignedWaiter: { not: null },
          acknowledgedAt: null,
          assignedWaiterAt: { lt: cutoff },
          escalationLevel: 0,
        } as any,
      });

      for (const order of unackedOrders) {
        logger.warn('Order handshake timeout — escalating to broadcast', {
          orderId: order.id,
          branchId: order.branchId,
        });

        const updated = await prisma.order.update({
          where: { id: order.id },
          data: {
            assignedWaiter: null, // Unassign so it broadcasts to everyone
            assignedWaiterAt: null,
            escalationLevel: 1,
            lastEscalatedAt: now,
          } as any,
        });

        io.to(`${order.organizationId}:${order.branchId}`).emit('TASK_UNASSIGNED', {
          type: 'ORDER_READY',
          task: updated,
        });
        io.to(`${order.organizationId}:${order.branchId}`).emit('ORDER_UPDATED', updated);
      }

      // 2. Escalate Waiter Calls
      const unackedCalls = await prisma.waiterCall.findMany({
        where: {
          status: 'PENDING',
          assignedTo: { not: null },
          acknowledgedAt: null,
          assignedAt: { lt: cutoff },
          escalationLevel: 0,
        } as any,
      });

      for (const call of unackedCalls) {
        logger.warn('Waiter call handshake timeout — escalating to broadcast', {
          callId: call.id,
          branchId: call.branchId,
        });

        const updated = await prisma.waiterCall.update({
          where: { id: call.id },
          data: {
            assignedTo: null,
            assignedAt: null,
            escalationLevel: 1,
            lastEscalatedAt: now,
          } as any,
        });

        io.to(`${call.organizationId}:${call.branchId}`).emit('TASK_UNASSIGNED', {
          type: 'WAITER_CALL',
          task: updated,
        });
        io.to(`${call.organizationId}:${call.branchId}`).emit('WAITER_CALL_UPDATED', updated);
      }

      // 3. Escalate Service Requests
      const unackedRequests = await prisma.serviceRequest.findMany({
        where: {
          status: 'PENDING',
          assignedTo: { not: null },
          acknowledgedAt: null,
          assignedAt: { lt: cutoff },
          escalationLevel: 0,
        } as any,
      });

      for (const req of unackedRequests) {
        logger.warn('Service request handshake timeout — escalating to broadcast', {
          requestId: req.id,
          branchId: req.branchId,
        });

        const updated = await prisma.serviceRequest.update({
          where: { id: req.id },
          data: {
            assignedTo: null,
            assignedAt: null,
            escalationLevel: 1,
            lastEscalatedAt: now,
          } as any,
        });

        io.to(`${req.organizationId}:${req.branchId}`).emit('TASK_UNASSIGNED', {
          type: 'SERVICE_REQUEST',
          task: updated,
        });
        io.to(`${req.organizationId}:${req.branchId}`).emit('SERVICE_REQUEST_UPDATED', updated);
      }
    } catch (err) {
      logger.error('Task escalation monitor failed', { err });
    }
  }, ESCALATION_CHECK_MS);

  (interval as any).unref?.();
}

startStaleOrderMonitor();
startTaskEscalationMonitor();

// Sentry error handler must be before the custom error handler
Sentry.setupExpressErrorHandler(app);
// Error handler (must be last)
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;
const server = httpServer;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '::', () => {
    logger.info(`Server running on port ${PORT} (IPv4 + IPv6)`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    if (!process.env.UPSTASH_REDIS_REST_URL) {
      logger.warn(
        'UPSTASH_REDIS_REST_URL not set — rate limiters using in-memory store (not suitable for production)',
      );
    }
  });
}

// Graceful Shutdown
function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  io.close(() => {
    logger.info('WebSocket connections closed.');
  });
  server.close(async () => {
    logger.info('HTTP server closed.');
    await prisma.$disconnect();
    logger.info('Prisma disconnected.');
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
