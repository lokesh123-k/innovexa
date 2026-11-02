import { describe, expect, it } from 'vitest';
import { TaskStatus } from '../src/enums.js';
import { ProgressError, computeProjectProgress } from '../src/progress.js';

const t = (
  weight: number,
  approvedProgress: number,
  status: TaskStatus = TaskStatus.IN_PROGRESS,
  submittedProgress?: number,
) => ({ weight, approvedProgress, status, submittedProgress });

describe('computeProjectProgress', () => {
  it('returns 0 for no tasks (zero weight)', () => {
    expect(computeProjectProgress([])).toEqual({
      approved: 0,
      submitted: 0,
      totalWeight: 0,
      activeTaskCount: 0,
    });
  });

  it('weights approved progress', () => {
    // (3*100 + 1*0) / 4 = 75
    expect(computeProjectProgress([t(3, 100), t(1, 0)]).approved).toBe(75);
  });

  it('excludes cancelled tasks from the denominator', () => {
    const r = computeProjectProgress([t(1, 100), t(5, 0, TaskStatus.CANCELLED)]);
    expect(r.approved).toBe(100);
    expect(r.totalWeight).toBe(1);
  });

  it('returns 0 when every task is cancelled', () => {
    expect(computeProjectProgress([t(2, 50, TaskStatus.CANCELLED)]).approved).toBe(0);
  });

  it('keeps submitted separate from approved', () => {
    const r = computeProjectProgress([t(1, 50, TaskStatus.SUBMITTED_FOR_REVIEW, 90), t(1, 0)]);
    expect(r.approved).toBe(25);
    expect(r.submitted).toBe(45);
  });

  it('rounds to 2 decimals', () => {
    expect(computeProjectProgress([t(1, 100), t(1, 0), t(1, 0)]).approved).toBe(33.33);
  });

  it('validates weights and progress', () => {
    expect(() => computeProjectProgress([t(0, 10)])).toThrow(ProgressError);
    expect(() => computeProjectProgress([t(1.5, 10)])).toThrow(ProgressError);
    expect(() => computeProjectProgress([t(1, 101)])).toThrow(ProgressError);
  });
});
