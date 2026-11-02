import { z } from 'zod';
import { PARTNER_TYPES, ROLES, Role, USER_STATUSES, UserStatus } from '../enums.js';
import {
  emailSchema,
  minorAmountSchema,
  objectIdSchema,
  paginationQuerySchema,
  phoneSchema,
} from './common.js';

export const partnerProfileSchema = z.object({
  partnerType: z.enum(PARTNER_TYPES),
  category: z.string().trim().max(80).optional(),
  designation: z.string().trim().max(80).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  hourlyRateMinor: minorAmountSchema.optional(),
});
export type PartnerProfileInput = z.infer<typeof partnerProfileSchema>;

const nameSchema = z.string().trim().min(2).max(100);

export const inviteUserSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    role: z.enum(ROLES),
    phone: phoneSchema.optional(),
    partnerProfile: partnerProfileSchema.optional(),
    clientId: objectIdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === Role.PARTNER && !v.partnerProfile) {
      ctx.addIssue({
        code: 'custom',
        path: ['partnerProfile'],
        message: 'Partner profile is required',
      });
    }
    if (v.role !== Role.PARTNER && v.partnerProfile) {
      ctx.addIssue({
        code: 'custom',
        path: ['partnerProfile'],
        message: 'Only partners have a partner profile',
      });
    }
    if (v.role === Role.CLIENT && !v.clientId) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientId'],
        message: 'Client users must be linked to a client',
      });
    }
    if (v.role !== Role.CLIENT && v.clientId) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientId'],
        message: 'Only client users can be linked to a client',
      });
    }
  });
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    partnerProfile: partnerProfileSchema.partial().optional(),
    permissions: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateOwnProfileSchema = z
  .object({ name: nameSchema.optional(), phone: phoneSchema.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' });
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const setUserStatusSchema = z.object({
  status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE]),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  partnerType: z.enum(PARTNER_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  actorId: objectIdSchema.optional(),
  entity: z.string().trim().max(60).optional(),
  entityId: objectIdSchema.optional(),
  action: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
