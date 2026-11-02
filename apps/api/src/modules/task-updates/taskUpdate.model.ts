import { Schema, model, type InferSchemaType } from 'mongoose';
import { REVIEW_STATUSES, ReviewStatus, TASK_UPDATE_KINDS, TaskUpdateKind } from '@innovexa/shared';
import { ref, refs } from '../../utils/schemaTypes';

/** Immutable record of every partner progress update / submission / issue. */
const taskUpdateSchema = new Schema(
  {
    taskId: ref('Task', true),
    projectId: ref('Project', true),
    partnerId: ref('User', true),
    kind: { type: String, enum: TASK_UPDATE_KINDS, default: TaskUpdateKind.PROGRESS },
    previousProgress: { type: Number, required: true, min: 0, max: 100 },
    newProgress: { type: Number, required: true, min: 0, max: 100 },
    description: { type: String, required: true },
    minutesSpent: { type: Number, default: 0, min: 0 },
    attachmentIds: refs('File'),
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: ReviewStatus.PENDING },
    reviewedBy: ref('User'),
    reviewedAt: Date,
    reviewComment: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

taskUpdateSchema.index({ taskId: 1, createdAt: -1 });
taskUpdateSchema.index({ partnerId: 1, createdAt: -1 });

export type TaskUpdateAttrs = InferSchemaType<typeof taskUpdateSchema>;
export const TaskUpdate = model('TaskUpdate', taskUpdateSchema);
