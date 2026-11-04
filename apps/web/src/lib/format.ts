import { formatMoney } from '@innovexa/shared';

export const money = (minor?: number | null) => formatMoney(minor ?? 0);

export const minutesToHours = (m?: number) => `${Math.round(((m ?? 0) / 60) * 10) / 10}h`;

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const TONES: Record<string, Tone> = {
  ACTIVE: 'green',
  COMPLETED: 'green',
  APPROVED: 'green',
  PAID: 'green',
  ACCEPTED: 'green',
  SUCCEEDED: 'green',
  PENDING: 'neutral',
  UNASSIGNED: 'amber',
  NOT_STARTED: 'neutral',
  DRAFT: 'neutral',
  ASSIGNED: 'blue',
  IN_PROGRESS: 'blue',
  ISSUED: 'blue',
  UNDER_REVIEW: 'blue',
  SUBMITTED: 'blue',
  CONVERTED_TO_TASK: 'blue',
  SUBMITTED_FOR_REVIEW: 'amber',
  REVISION_REQUESTED: 'amber',
  PARTIALLY_PAID: 'amber',
  NEED_CLARIFICATION: 'amber',
  ON_HOLD: 'amber',
  INVITED: 'amber',
  OVERDUE: 'red',
  REJECTED: 'red',
  FAILED: 'red',
  CANCELLED: 'neutral',
  INACTIVE: 'neutral',
  HIGH: 'amber',
  URGENT: 'red',
  MEDIUM: 'blue',
  LOW: 'neutral',
};

export const toneFor = (status?: string): Tone =>
  status ? (TONES[status] ?? 'neutral') : 'neutral';
