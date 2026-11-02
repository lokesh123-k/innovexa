import { Schema, model, type InferSchemaType } from 'mongoose';
import { INVOICE_STATUSES, InvoiceStatus, PAYMENT_TERMS, PaymentTerms } from '@innovexa/shared';
import { money, ref } from '../../utils/schemaTypes.js';

/**
 * All amounts are integer minor units. `totalMinor`, `paidMinor` and
 * `balanceMinor` are derived by the billing service — never accepted from clients.
 */
const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    clientId: ref('Client', true),
    projectId: ref('Project', true),
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    currency: { type: String, default: 'INR' },
    contractAmountMinor: money(),
    taxMinor: money(false),
    discountMinor: money(false),
    totalMinor: money(),
    advanceMinor: money(false),
    paidMinor: money(false),
    refundedMinor: money(false),
    /** May be negative when the client holds a credit. */
    balanceMinor: { type: Number, required: true, validate: Number.isSafeInteger },
    paymentTerms: { type: String, enum: PAYMENT_TERMS, default: PaymentTerms.FULL },
    status: { type: String, enum: INVOICE_STATUSES, default: InvoiceStatus.DRAFT },
    notes: String,
    issuedAt: Date,
    cancelledAt: Date,
    createdBy: ref('User'),
  },
  { timestamps: true },
);

invoiceSchema.index({ clientId: 1, status: 1 });
invoiceSchema.index({ projectId: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 });

export type InvoiceAttrs = InferSchemaType<typeof invoiceSchema>;
export const Invoice = model('Invoice', invoiceSchema);
