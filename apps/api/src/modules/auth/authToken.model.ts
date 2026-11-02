import { Schema, model, type InferSchemaType } from 'mongoose';
import { AUTH_TOKEN_PURPOSES } from '@innovexa/shared';

/** Single-use emailed tokens (invitation, email verification, password reset). Only hashes are stored. */
const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: AUTH_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

authTokenSchema.index({ userId: 1, purpose: 1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthTokenAttrs = InferSchemaType<typeof authTokenSchema>;
export const AuthToken = model('AuthToken', authTokenSchema);
