import 'dotenv/config';
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
import { initSocketHandlers } from './sockets/handlers';
import { errorHandler } from './middleware/errorHandler';
import { planGuard } from './middleware/planGuard';
import { logger } from './services/logger';

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
const upstashApi = makeUpstashLimiter(500, '15 m', 'api');
const upstashPublic = makeUpstashLimiter(60, '1 m', 'public');
// Wraps an Upstash limiter into Express middleware, falls back to in-memory
function makeLimiter(
  upstash: Ratelimit | null,
  fallback: ReturnType<typeof rateLimit>,
  errorMsg: string,
): express.RequestHandler {
  if (!upstash) return fallback;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    try {
      const key = getRateLimitKey(req);
      const { success } = await upstash.limit(key);
      if (!success) {
        res.status(429).json({ success: false, error: errorMsg });
        return;
      }
      next();
    } catch {
      // If Redis call fails, fail open — don't block legitimate requests
      next();
    }
  };
}

const authLimiter = makeLimiter(upstashAuth, authFallback, 'Too many requests, please slow down.');
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
app.use('/api/auth/check-slug', apiLimiter);
app.use('/api/menu/public', publicLimiter);
app.use('/api/orders/public', publicLimiter);
app.use('/api/tables/public', publicLimiter);
app.use('/api/waiter-calls/public', publicLimiter);
app.use('/api/service-requests/public', publicLimiter);
app.use('/api/help-options/public', publicLimiter);
app.use('/api/', apiLimiter);

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

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.1.0' });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/menu', menuRouter);
app.use('/api/orders', ordersRouter);
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
app.use('/api/payments', paymentsRouter);

// WebSocket
initSocketHandlers(io);

const staleOrderCutoffMinutes = Number(process.env.STALE_ORDER_MINUTES || 120);
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

        lastStaleAudit.set(key, { count, at: now });
      }
    } catch (err) {
      logger.error('Stale order monitor failed', { err });
    }
  }, staleOrderCheckEveryMs);

  (interval as any).unref?.();
}

startStaleOrderMonitor();

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
