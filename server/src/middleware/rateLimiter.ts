import rateLimit from 'express-rate-limit';

// Global limiter for standard API routes (100 requests per minute)
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per `window`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after a minute',
  },
});

// Strict limiter for sensitive routes like auth or waiter calls (10 requests per minute)
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'You are doing that too often. Please wait a minute before trying again.',
  },
});
