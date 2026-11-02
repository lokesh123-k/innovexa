import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  INSTALLMENT_KINDS,
  INSTALLMENT_STATUSES,
  InstallmentKind,
  InstallmentStatus,
} from '@innovexa/shared';
import { money, ref } from '../../utils/schemaTypes.js';

/** An internal payment schedule row. This is not bank/card EMI financing. */
const installmentSchema = new Schema(
  {
    invoiceId: ref('Invoice', true),
    clientId: ref('Client', true),
    number: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: INSTALLMENT_KINDS, default: InstallmentKind.INSTALLMENT },
    amountMinor: money(),
    paidMinor: money(false),
    dueDate: { type: Date, required: true },
    status: { type: String, enum: INSTALLMENT_STATUSES, default: InstallmentStatus.PENDING },
    paymentReference: String,
    paidAt: Date,
    dueSoonNotifiedAt: Date,
    overdueNotifiedAt: Date,
  },
  { timestamps: true },
);

installmentSchema.index({ invoiceId: 1, number: 1 }, { unique: true });
installmentSchema.index({ dueDate: 1, status: 1 });
installmentSchema.index({ clientId: 1, dueDate: 1 });

export type InstallmentAttrs = InferSchemaType<typeof installmentSchema>;
export const Installment = model('Installment', installmentSchema);
