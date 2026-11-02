import type { Types } from 'mongoose';
import { Role } from '@innovexa/shared';

interface SerializableUser {
  _id: Types.ObjectId;
  email: string;
  name: string;
  phone?: string | null;
  role: Role;
  status: string;
  emailVerifiedAt?: Date | null;
  lastLoginAt?: Date | null;
  partnerProfile?: {
    partnerType: string;
    category?: string | null;
    designation?: string | null;
    skills?: string[] | null;
    hourlyRateMinor?: number | null;
  } | null;
  clientId?: Types.ObjectId | null;
  invitationEmail?: { status: string; at: Date; error?: string | null } | null;
  permissions?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Whitelists user fields per viewer. Secrets are never included; the partner
 * hourly rate is visible to admins only.
 */
export function toUserDTO(user: SerializableUser, viewerRole: Role) {
  const profile = user.partnerProfile
    ? {
        partnerType: user.partnerProfile.partnerType,
        category: user.partnerProfile.category ?? undefined,
        designation: user.partnerProfile.designation ?? undefined,
        skills: user.partnerProfile.skills ?? [],
        ...(viewerRole === Role.ADMIN
          ? { hourlyRateMinor: user.partnerProfile.hourlyRateMinor ?? undefined }
          : {}),
      }
    : undefined;
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    phone: user.phone ?? undefined,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    lastLoginAt: user.lastLoginAt ?? undefined,
    partnerProfile: profile,
    clientId: user.clientId?.toString(),
    ...(viewerRole === Role.ADMIN
      ? {
          permissions: user.permissions ?? [],
          invitationEmail: user.invitationEmail
            ? {
                status: user.invitationEmail.status,
                at: user.invitationEmail.at,
                error: user.invitationEmail.error ?? undefined,
              }
            : undefined,
        }
      : {}),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export type UserDTO = ReturnType<typeof toUserDTO>;
