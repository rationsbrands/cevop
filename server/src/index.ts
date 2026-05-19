import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Ratelimit, type Duration } from '@upstash/ratelimit';import { Server as SocketServer } from 'socket.io';

import { getRedisClient } from './services/redis';

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

export const io = new SocketServer(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.set('trust proxy', 1);

// CORS
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ---------------------------------------------------------------------------
// Rate limiting — Upstash Redis when available, in-memory fallback otherwise
// ---------------------------------------------------------------------------

// Fallback in-memory limiters (used in dev or if Redis not configured)
const authFallback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down.' },
});

const apiFallback = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests.' },
});

const publicFallback = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests from this table.' },
});

// Build Upstash-backed limiters if Redis is configured
function makeUpstashLimiter(requests: number, window: Duration): Ratelimit | null {
  const redis = getRedisClient();
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: 'cevop:rl',
  });
}

const upstashAuth   = makeUpstashLimiter(20,  '15 m');
const upstashApi    = makeUpstashLimiter(500, '15 m');
const upstashPublic = makeUpstashLimiter(60,  '1 m');
// Wraps an Upstash limiter into Express middleware, falls back to in-memory
function makeLimiter(
  upstash: Ratelimit | null,
  fallback: ReturnType<typeof rateLimit>,
  errorMsg: string,
): express.RequestHandler {
  if (!upstash) return fallback;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
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

const authLimiter   = makeLimiter(upstashAuth,   authFallback,   'Too many requests, please slow down.');
const apiLimiter    = makeLimiter(upstashApi,    apiFallback,    'Too many requests.');
const publicLimiter = makeLimiter(upstashPublic, publicFallback, 'Too many requests from this table.');

// ---------------------------------------------------------------------------

app.use('/api/auth/login',          authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/signup',         authLimiter);
app.use('/api/auth/check-slug',     authLimiter);
app.use('/api/orders/public',        publicLimiter);
app.use('/api/waiter-calls/public',  publicLimiter);
app.use('/api/service-requests/public', publicLimiter);
app.use('/api/', apiLimiter);

// Enforce organization plan status
app.use('/api/', planGuard as express.RequestHandler);

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.1.0' });
});

// Routes
app.use('/api/auth',             authRouter);
app.use('/api/menu',             menuRouter);
app.use('/api/orders',           ordersRouter);
app.use('/api/tables',           tablesRouter);
app.use('/api/orgs',             orgsRouter);
app.use('/api/branches',         branchesRouter);
app.use('/api/users',            usersRouter);
app.use('/api/invites',          invitesRouter);
app.use('/api/waiter-calls',     waiterCallsRouter);
app.use('/api/service-requests', serviceRequestsRouter);
app.use('/api/help-options',     helpOptionsRouter);
app.use('/api/ops',              opsRouter);

// WebSocket
initSocketHandlers(io);

// Error handler (must be last)
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;
httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Cevop API running on port ${PORT}`);
  logger.info(`📡 WebSocket ready`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    logger.warn('UPSTASH_REDIS_REST_URL not set — rate limiters using in-memory store (not suitable for production)');
  }
});

export default app;