import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PARTNER_TYPES, ROLES, USER_STATUSES, UserStatus } from '@innovexa/shared';

const partnerProfileSchema = new Schema(
  {
    partnerType: { type: String, enum: PARTNER_TYPES, required: true },
    category: { type: String, trim: true },
    designation: { type: String, trim: true },
    skills: { type: [String], default: undefined },
    /** Admin-only. Never included in partner/client serializers. */
    hourlyRateMinor: { type: Number, min: 0, validate: Number.isSafeInteger },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, default: UserStatus.INVITED, required: true },
    passwordHash: { type: String, select: false },
    emailVerifiedAt: { type: Date, default: null },
    /** Bumped to invalidate every outstanding access token for this user. */
    tokenVersion: { type: Number, default: 0, required: true },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
    partnerProfile: { type: partnerProfileSchema, default: undefined },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: undefined },
    permissions: { type: [String], default: [] },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Outcome of the most recent invitation email (shown to admins). */
    invitationEmail: {
      type: new Schema(
        {
          status: { type: String, enum: ['SENT', 'FAILED', 'NOT_SENT'], required: true },
          at: { type: Date, required: true },
          error: String,
          transport: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, status: 1 });
userSchema.index({ clientId: 1 }, { sparse: true });
userSchema.index({ 'partnerProfile.partnerType': 1 }, { sparse: true });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);
