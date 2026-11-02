import { Schema, model, type InferSchemaType } from 'mongoose';
import { PRIORITIES, PROJECT_STATUSES, Priority, ProjectStatus } from '@innovexa/shared';
import { money, ref, refs } from '../../utils/schemaTypes';

const progressSnapshotSchema = new Schema(
  {
    approved: { type: Number, required: true },
    submitted: { type: Number, required: true },
    reason: { type: String, required: true },
    taskId: ref('Task'),
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const deliverableSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: String,
  dueDate: Date,
  deliveredAt: Date,
  /** Only approved deliverables are shown to the client. */
  approvedAt: Date,
  fileIds: refs('File'),
});

const projectSchema = new Schema(
  {
    projectCode: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    clientId: ref('Client', true),
    serviceCategoryId: ref('ServiceCategory', true),
    description: String,
    requirements: String,
    budgetMinor: money(false),
    contractAmountMinor: money(),
    currency: { type: String, default: 'INR' },
    startDate: { type: Date, required: true },
    expectedEndDate: { type: Date, required: true },
    completedAt: Date,
    priority: { type: String, enum: PRIORITIES, default: Priority.MEDIUM },
    status: { type: String, enum: PROJECT_STATUSES, default: ProjectStatus.PENDING },
    partnerIds: refs('User'),
    /** Server-calculated only — see shared/progress.ts. */
    progress: {
      approved: { type: Number, default: 0 },
      submitted: { type: Number, default: 0 },
      calculatedAt: Date,
    },
    progressHistory: { type: [progressSnapshotSchema], default: [] },
    deliverables: { type: [deliverableSchema], default: [] },
    attachmentIds: refs('File'),
    /** Admin-only notes; stripped from partner and client views. */
    internalNotes: String,
    createdBy: ref('User'),
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

projectSchema.index({ clientId: 1, status: 1 });
projectSchema.index({ partnerIds: 1, status: 1 });
projectSchema.index({ status: 1, expectedEndDate: 1 });

export type ProjectAttrs = InferSchemaType<typeof projectSchema>;
export const Project = model('Project', projectSchema);
