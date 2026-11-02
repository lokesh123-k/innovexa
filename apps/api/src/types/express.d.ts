import type { Types } from 'mongoose';
import type { Role } from '@innovexa/shared';

export interface AuthUser {
  id: string;
  _id: Types.ObjectId;
  role: Role;
  email: string;
  name: string;
  clientId?: Types.ObjectId;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Zod-parsed request parts populated by the `validate` middleware. */
      valid: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}
