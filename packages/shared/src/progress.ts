import { TaskStatus } from './enums.js';

export interface ProgressTaskInput {
  status: TaskStatus;
  /** Integer weight 1–100. */
  weight: number;
  /** Approved progress 0–100. */
  approvedProgress: number;
  /** Latest submitted (unapproved) progress 0–100, admin-only view. */
  submittedProgress?: number;
}

export interface ProjectProgress {
  /** Client-visible, weighted approved progress (0–100, 2 dp). */
  approved: number;
  /** Admin-only, weighted submitted progress (0–100, 2 dp). */
  submitted: number;
  totalWeight: number;
  activeTaskCount: number;
}

export class ProgressError extends Error {}

export function assertWeight(weight: number): number {
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
    throw new ProgressError('Task weight must be an integer between 1 and 100');
  }
  return weight;
}

export function assertProgress(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new ProgressError('Progress must be an integer between 0 and 100');
  }
  return value;
}

/** Round a ratio of integers to 2 decimal places without float accumulation. */
function ratioToPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  // numerator is Σ(weight × progress) so the result is already in percent.
  const hundredths = Math.round((numerator * 100) / denominator);
  return hundredths / 100;
}

/**
 * Project Progress = Σ(weight × approvedProgress) / Σ(weight) over non-cancelled tasks.
 * Returns 0 when there are no active tasks (zero total weight).
 */
export function computeProjectProgress(tasks: readonly ProgressTaskInput[]): ProjectProgress {
  let totalWeight = 0;
  let approvedSum = 0;
  let submittedSum = 0;
  let activeTaskCount = 0;
  for (const t of tasks) {
    if (t.status === TaskStatus.CANCELLED) continue;
    const w = assertWeight(t.weight);
    const approved = assertProgress(t.approvedProgress);
    // Submitted never trails approved for display purposes.
    const submitted = Math.max(assertProgress(t.submittedProgress ?? approved), approved);
    totalWeight += w;
    approvedSum += w * approved;
    submittedSum += w * submitted;
    activeTaskCount += 1;
  }
  return {
    approved: ratioToPercent(approvedSum, totalWeight),
    submitted: ratioToPercent(submittedSum, totalWeight),
    totalWeight,
    activeTaskCount,
  };
}
