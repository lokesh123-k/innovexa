import { Schema, model, type InferSchemaType } from 'mongoose';
import { MILESTONE_STATUSES, MilestoneStatus } from '@innovexa/shared';
import { ref } from '../../utils/schemaTypes.js';

const milestoneSchema = new Schema(
  {
    projectId: ref('Project', true),
    title: { type: String, required: true, trim: true },
    description: String,
    order: { type: Number, required: true, min: 0 },
    dueDate: Date,
    status: { type: String, enum: MILESTONE_STATUSES, default: MilestoneStatus.PENDING },
    completedAt: Date,
    clientVisible: { type: Boolean, default: true },
  },
  { timestamps: true },
);

milestoneSchema.index({ projectId: 1, order: 1 });

export type MilestoneAttrs = InferSchemaType<typeof milestoneSchema>;
export const Milestone = model('Milestone', milestoneSchema);
