import { Schema, model, type InferSchemaType } from 'mongoose';
import { WORK_REPORT_TYPES, WorkReportType } from '@innovexa/shared';
import { ref, refs } from '../../utils/schemaTypes.js';

const workReportSchema = new Schema(
  {
    partnerId: ref('User', true),
    type: { type: String, enum: WORK_REPORT_TYPES, default: WorkReportType.DAILY },
    /** Report date for DAILY; period start for WEEKLY (stored at UTC midnight). */
    date: { type: Date, required: true },
    periodEnd: Date,
    taskIds: refs('Task'),
    workCompleted: { type: String, required: true },
    progressPercent: { type: Number, min: 0, max: 100 },
    minutesWorked: { type: Number, required: true, min: 0, max: 7 * 24 * 60 },
    problems: String,
    nextPlan: String,
    attachmentIds: refs('File'),
  },
  { timestamps: true },
);

workReportSchema.index({ partnerId: 1, type: 1, date: -1 }, { unique: true });
workReportSchema.index({ type: 1, date: -1 });

export type WorkReportAttrs = InferSchemaType<typeof workReportSchema>;
export const WorkReport = model('WorkReport', workReportSchema);
