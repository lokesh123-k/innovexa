import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@innovexa/shared';
import { AppError } from '../utils/AppError.js';

/** Role gate. Resource ownership is enforced separately in each service. */
export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw AppError.unauthorized();
    if (!roles.includes(req.user.role)) throw AppError.forbidden();
    next();
  };
