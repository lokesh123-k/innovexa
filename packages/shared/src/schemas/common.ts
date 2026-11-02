import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

export const hasOuterWhitespace = (value: string) => value !== value.trim();

/**
 * New-password policy: at least 10 chars with upper, lower and a digit.
 * Inner spaces are allowed; leading/trailing whitespace is rejected (never
 * trimmed) because it is almost always an accidental paste or autofill.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number')
  .refine((v) => !hasOuterWhitespace(v), 'Password cannot start or end with a space');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{7,20}$/, 'Enter a valid phone number');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Minor-unit money amount accepted from APIs. */
export const minorAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
