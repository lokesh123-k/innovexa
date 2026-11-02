import { Schema, model, type InferSchemaType } from 'mongoose';
import { PAYMENT_METHODS, PAYMENT_STATUSES, PaymentStatus } from '@innovexa/shared';
import { money, ref } from '../../utils/schemaTypes';

/**
 * Payment attempt or recorded payment. Card numbers, CVV, UPI PIN or bank
 * credentials are never received or stored — only provider references.
 */
const paymentSchema = new Schema(
  {
    invoiceId: ref('Invoice', true),
    installmentId: ref('Installment'),
    clientId: ref('Client', true),
    amountMinor: money(),
    currency: { type: String, default: 'INR' },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    provider: { type: String, default: null },
    providerOrderId: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    status: { type: String, enum: PAYMENT_STATUSES, default: PaymentStatus.CREATED },
    isAdvance: { type: Boolean, default: false },
    verifiedAt: Date,
    paidAt: Date,
    recordedBy: ref('User'),
    reference: String,
    receiptNumber: { type: String, default: null },
    failureReason: String,
    refundedMinor: money(false),
  },
  { timestamps: true },
);

paymentSchema.index(
  { provider: 1, providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { providerPaymentId: { $type: 'string' } } },
);
paymentSchema.index(
  { providerOrderId: 1 },
  { partialFilterExpression: { providerOrderId: { $type: 'string' } } },
);
paymentSchema.index(
  { receiptNumber: 1 },
  { unique: true, partialFilterExpression: { receiptNumber: { $type: 'string' } } },
);
paymentSchema.index({ invoiceId: 1, status: 1 });
paymentSchema.index({ clientId: 1, createdAt: -1 });

export type PaymentAttrs = InferSchemaType<typeof paymentSchema>;
export const Payment = model('Payment', paymentSchema);
