import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { MoneyError, ProgressError } from '@innovexa/shared';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'Some fields are invalid',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (err instanceof MoneyError || err instanceof ProgressError) {
    return new AppError(400, 'VALIDATION_ERROR', err.message);
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(400, 'INVALID_ID', `Invalid value for ${err.path}`);
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'Some fields are invalid',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }
  if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    const fields = Object.keys((err as { keyValue?: object }).keyValue ?? {});
    return new AppError(
      409,
      'DUPLICATE',
      `A record with this ${fields.join(', ') || 'value'} already exists`,
    );
  }
  const bp = err as BodyParserError;
  if (bp?.type === 'entity.parse.failed')
    return new AppError(400, 'INVALID_JSON', 'Malformed JSON body');
  if (bp?.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = normalize(err);
  if (appError.status >= 500) {
    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  }
  res.status(appError.status).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
}
