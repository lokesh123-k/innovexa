import { Schema, model, type InferSchemaType } from 'mongoose';

/** Idempotency ledger: a provider event is processed at most once. */
const webhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    payloadHash: { type: String, required: true },
    processedAt: Date,
    error: String,
  },
  { timestamps: true },
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export type WebhookEventAttrs = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
