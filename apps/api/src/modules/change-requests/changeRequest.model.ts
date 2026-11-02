import { Schema, model, type InferSchemaType } from 'mongoose';
import { CHANGE_REQUEST_STATUSES, ChangeRequestStatus } from '@innovexa/shared';
import { money, ref, refs } from '../../utils/schemaTypes.js';

const changeRequestSchema = new Schema(
  {
    requestCode: { type: String, required: true, unique: true },
    projectId: ref('Project', true),
    clientId: ref('Client', true),
    submittedBy: ref('User', true),
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    attachmentIds: refs('File'),
    status: { type: String, enum: CHANGE_REQUEST_STATUSES, default: ChangeRequestStatus.SUBMITTED },
    history: {
      type: [
        new Schema(
          {
            status: { type: String, enum: CHANGE_REQUEST_STATUSES, required: true },
            by: ref('User', true),
            note: String,
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    responses: {
      type: [
        new Schema({
          authorId: ref('User', true),
          body: { type: String, required: true },
          attachmentIds: refs('File'),
          at: { type: Date, default: Date.now },
        }),
      ],
      default: [],
    },
    /** Scope/price change that only affects the contract once an admin approves it. */
    changeOrder: {
      amountMinor: money(false, undefined),
      description: String,
      approvedBy: ref('User'),
      approvedAt: Date,
      invoiceId: ref('Invoice'),
    },
    taskId: ref('Task'),
  },
  { timestamps: true },
);

changeRequestSchema.index({ projectId: 1, status: 1 });
changeRequestSchema.index({ clientId: 1, createdAt: -1 });

export type ChangeRequestAttrs = InferSchemaType<typeof changeRequestSchema>;
export const ChangeRequest = model('ChangeRequest', changeRequestSchema);
