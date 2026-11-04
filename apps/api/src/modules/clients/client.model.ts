import { Schema, model, type InferSchemaType } from 'mongoose';
import { CLIENT_STATUSES, ClientAssignmentStatus, ClientStatus } from '@innovexa/shared';
import { ref } from '../../utils/schemaTypes.js';

/**
 * The client's account partner. Absent means unassigned. It does not grant project access:
 * project and task permissions still come from each project's own partnerIds.
 */
const partnerAssignmentSchema = new Schema(
  {
    partnerId: ref('User', true),
    status: {
      type: String,
      enum: [ClientAssignmentStatus.ASSIGNED],
      default: ClientAssignmentStatus.ASSIGNED,
      required: true,
    },
    assignedBy: ref('User', true),
    assignedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

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
    partnerAssignment: { type: partnerAssignmentSchema, default: undefined },
    createdBy: ref('User'),
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

clientSchema.index({ email: 1 });
clientSchema.index({ status: 1, companyName: 1 });
// A partner's assigned clients (partner portal); sparse: most clients start unassigned.
clientSchema.index({ 'partnerAssignment.partnerId': 1 }, { sparse: true });

export type ClientAttrs = InferSchemaType<typeof clientSchema>;
export const Client = model('Client', clientSchema);
