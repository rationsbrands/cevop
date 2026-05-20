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
import { tablesRouter } from './routes/tables';
import { orgsRouter } from './routes/orgs';
import { waiterCallsRouter } from './routes/waiterCalls';
import { serviceRequestsRouter } from './routes/serviceRequests';
import { usersRouter } from './routes/users';
import { branchesRouter } from './routes/branches';
import { invitesRouter } from './routes/invites';
import { opsRouter } from './routes/ops';
import { helpOptionsRouter } from './routes/helpOptions';
import { initSocketHandlers } from './sockets/handlers';
import { errorHandler } from './middleware/errorHandler';
import { planGuard } from './middleware/planGuard';
import { logger } from './services/logger';

const app = express();
const httpServer = createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) || [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
];

const isDev = process.env.NODE_ENV !== 'production';

export const io = new SocketServer(httpServer, {
  cors: { origin: isDev ? true : allowedOrigins, methods: ['GET', 'POST'], credentials: true },
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

// CORS
app.use(cors({ origin: isDev ? true : allowedOrigins, credentials: true }));
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

// Fallback in-memory limiters (used in dev or if Redis not configured)
const authFallback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down.' },
});

const apiFallback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests.' },
});

const publicFallback = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
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
    prefix: `cevop:rl2:${prefix}`,
  });
}

const upstashAuth = makeUpstashLimiter(100, '15 m', 'auth');
const upstashApi = makeUpstashLimiter(3000, '15 m', 'api');
const upstashPublic = makeUpstashLimiter(120, '1 m', 'public');
// Wraps an Upstash limiter into Express middleware, falls back to in-memory
function makeLimiter(
  upstash: Ratelimit | null,
  fallback: ReturnType<typeof rateLimit>,
  errorMsg: string,
): express.RequestHandler {
  if (!upstash) return fallback;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const { success } = await upstash.limit(ip);
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
app.use('/api/orders/public', publicLimiter);
app.use('/api/waiter-calls/public', publicLimiter);
app.use('/api/service-requests/public', publicLimiter);
app.use('/api/', apiLimiter);

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
app.use('/api/tables', tablesRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/users', usersRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/waiter-calls', waiterCallsRouter);
app.use('/api/service-requests', serviceRequestsRouter);
app.use('/api/help-options', helpOptionsRouter);
app.use('/api/ops', opsRouter);

// WebSocket
initSocketHandlers(io);

// Error handler (must be last)
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;
const server = httpServer;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 API running on http://0.0.0.0:${PORT}`);
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
