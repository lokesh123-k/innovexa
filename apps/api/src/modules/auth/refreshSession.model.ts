import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One row per issued refresh token. Tokens are rotated on every use; all
 * tokens descending from one login share a `familyId`, so presenting a
 * consumed token revokes the whole family (theft detection).
 */
const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    replacedById: { type: Schema.Types.ObjectId, ref: 'RefreshSession', default: null },
    ip: String,
    userAgent: String,
  },
  { timestamps: true },
);

// Expired sessions are purged automatically by MongoDB.
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshSessionAttrs = InferSchemaType<typeof refreshSessionSchema>;
export const RefreshSession = model('RefreshSession', refreshSessionSchema);
