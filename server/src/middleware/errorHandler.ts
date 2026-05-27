import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../services/logger';

// Structured error codes — use these constants everywhere instead of raw strings.
// Clients switch on `code`, not `error` message strings.
export const E = {
  // 400
  VALIDATION: 'VALIDATION_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  SESSION_CLOSED: 'SESSION_ALREADY_CLOSED',
  SESSION_HAS_ACTIVE_ORDERS: 'SESSION_HAS_ACTIVE_ORDERS',
  TABLE_HAS_ACTIVE_SESSION: 'TABLE_HAS_ACTIVE_SESSION',
  TABLE_NOT_CLEANING: 'TABLE_NOT_CLEANING',
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  LIMIT_REACHED: 'LIMIT_REACHED',
  ITEM_CANCELLED: 'ITEM_ALREADY_CANCELLED',
  // 401/403
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  // 404
  NOT_FOUND: 'NOT_FOUND',
  // 409
  CONFLICT: 'CONFLICT',
  // 500
  INTERNAL: 'INTERNAL_ERROR',
  TIMEOUT: 'REQUEST_TIMEOUT',
} as const;

export type ErrorCode = (typeof E)[keyof typeof E];

/** Consistent error response shape: { success: false, code, error } */
export function apiError(res: Response, status: number, code: ErrorCode, message: string): void {
  res.status(status).json({ success: false, code, error: message });
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  void _next;
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      code: E.VALIDATION,
      error: 'Validation error',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });

  res.status(500).json({
    success: false,
    code: E.INTERNAL,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}
