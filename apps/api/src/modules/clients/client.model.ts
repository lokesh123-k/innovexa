import { Schema, model, type InferSchemaType } from 'mongoose';
import { CLIENT_STATUSES, ClientStatus } from '@innovexa/shared';
import { ref } from '../../utils/schemaTypes';

const clientSchema = new Schema(
  {
    clientCode: { type: String, required: true, unique: true },
    companyName: { type: String, required: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: { type: String, default: 'India' },
    },
    gstin: { type: String, trim: true, uppercase: true },
    /** Admin-only internal notes. */
    notes: { type: String },
    status: { type: String, enum: CLIENT_STATUSES, default: ClientStatus.ACTIVE },
    createdBy: ref('User'),
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

clientSchema.index({ email: 1 });
clientSchema.index({ status: 1, companyName: 1 });

export type ClientAttrs = InferSchemaType<typeof clientSchema>;
export const Client = model('Client', clientSchema);
