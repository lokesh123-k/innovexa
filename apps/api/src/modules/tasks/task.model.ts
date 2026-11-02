import { Schema, model, type InferSchemaType } from 'mongoose';
import { PRIORITIES, Priority, TASK_STATUSES, TaskStatus } from '@innovexa/shared';
import { ref, refs } from '../../utils/schemaTypes';

const progressField = { type: Number, default: 0, min: 0, max: 100, validate: Number.isInteger };

const reviewNoteSchema = new Schema(
  {
    reviewerId: ref('User', true),
    decision: { type: String, enum: ['APPROVED', 'REVISION_REQUESTED'], required: true },
    approvedProgress: Number,
    comment: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const taskSchema = new Schema(
  {
    projectId: ref('Project', true),
    milestoneId: ref('Milestone'),
    title: { type: String, required: true, trim: true },
    description: String,
    instructions: String,
    expectedDeliverables: String,
    assigneeIds: refs('User'),
    priority: { type: String, enum: PRIORITIES, default: Priority.MEDIUM },
    status: { type: String, enum: TASK_STATUSES, default: TaskStatus.NOT_STARTED },
    startDate: Date,
    dueDate: Date,
    estimatedHours: { type: Number, min: 0 },
    /** Relative weight for project progress, integer 1–100. */
    weight: { type: Number, default: 1, min: 1, max: 100, validate: Number.isInteger },
    /** Latest progress reported by a partner (not client-visible). */
    submittedProgress: progressField,
    /** Progress confirmed by an admin; the only value that feeds client-visible progress. */
    approvedProgress: progressField,
    loggedMinutes: { type: Number, default: 0, min: 0 },
    attachmentIds: refs('File'),
    reviewNotes: { type: [reviewNoteSchema], default: [] },
    approvedAt: Date,
    approvedBy: ref('User'),
    cancelledAt: Date,
    /** Reminder bookkeeping so deadline notifications are sent once. */
    dueSoonNotifiedAt: Date,
    overdueNotifiedAt: Date,
    createdBy: ref('User'),
  },
  { timestamps: true },
);

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeIds: 1, status: 1 });
taskSchema.index({ dueDate: 1, status: 1 });

export type TaskAttrs = InferSchemaType<typeof taskSchema>;
export const Task = model('Task', taskSchema);
