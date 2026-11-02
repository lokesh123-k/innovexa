import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Parses request parts with Zod and stores the results on `req.valid`.
 * Express 5 exposes `req.query` as a getter, so parsed values are never written back.
 */
export const validate =
  (schemas: Schemas) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    req.valid ??= {};
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (schema) req.valid[key] = schema.parse(req[key] ?? {});
    }
    next();
  };

/** Typed accessor for a validated request part. */
export function valid<T>(req: Request, key: 'body' | 'query' | 'params'): T {
  return req.valid[key] as T;
}
