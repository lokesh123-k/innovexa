/** Single source of truth for enum values used by the API, database and web app. */

const values = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

export const Role = { ADMIN: 'ADMIN', PARTNER: 'PARTNER', CLIENT: 'CLIENT' } as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = values(Role);

export const UserStatus = { INVITED: 'INVITED', ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = values(UserStatus);

export const PartnerType = {
  INTERNAL_EMPLOYEE: 'INTERNAL_EMPLOYEE',
  FREELANCER: 'FREELANCER',
  CONTRACTOR: 'CONTRACTOR',
} as const;
export type PartnerType = (typeof PartnerType)[keyof typeof PartnerType];
export const PARTNER_TYPES = values(PartnerType);

export const ClientStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } as const;
export type ClientStatus = (typeof ClientStatus)[keyof typeof ClientStatus];
export const CLIENT_STATUSES = values(ClientStatus);

/** A client's account partner. UNASSIGNED is derived (no assignment stored). */
export const ClientAssignmentStatus = { UNASSIGNED: 'UNASSIGNED', ASSIGNED: 'ASSIGNED' } as const;
export type ClientAssignmentStatus =
  (typeof ClientAssignmentStatus)[keyof typeof ClientAssignmentStatus];
export const CLIENT_ASSIGNMENT_STATUSES = values(ClientAssignmentStatus);

export const Priority = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
export const PRIORITIES = values(Priority);

export const ProjectStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];
export const PROJECT_STATUSES = values(ProjectStatus);

export const MilestoneStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type MilestoneStatus = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];
export const MILESTONE_STATUSES = values(MilestoneStatus);

export const TaskStatus = {
  NOT_STARTED: 'NOT_STARTED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED_FOR_REVIEW: 'SUBMITTED_FOR_REVIEW',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  APPROVED: 'APPROVED',
  COMPLETED: 'COMPLETED',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = values(TaskStatus);

export const TaskUpdateKind = {
  PROGRESS: 'PROGRESS',
  SUBMISSION: 'SUBMISSION',
  ISSUE: 'ISSUE',
  CLARIFICATION: 'CLARIFICATION',
} as const;
export type TaskUpdateKind = (typeof TaskUpdateKind)[keyof typeof TaskUpdateKind];
export const TASK_UPDATE_KINDS = values(TaskUpdateKind);

export const ReviewStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];
export const REVIEW_STATUSES = values(ReviewStatus);

export const WorkReportType = { DAILY: 'DAILY', WEEKLY: 'WEEKLY' } as const;
export type WorkReportType = (typeof WorkReportType)[keyof typeof WorkReportType];
export const WORK_REPORT_TYPES = values(WorkReportType);

export const ConversationType = { DIRECT: 'DIRECT', PROJECT: 'PROJECT' } as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];
export const CONVERSATION_TYPES = values(ConversationType);

export const ChangeRequestStatus = {
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  NEED_CLARIFICATION: 'NEED_CLARIFICATION',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CONVERTED_TO_TASK: 'CONVERTED_TO_TASK',
  COMPLETED: 'COMPLETED',
} as const;
export type ChangeRequestStatus = (typeof ChangeRequestStatus)[keyof typeof ChangeRequestStatus];
export const CHANGE_REQUEST_STATUSES = values(ChangeRequestStatus);

export const PaymentTerms = {
  FULL: 'FULL',
  ADVANCE_BALANCE: 'ADVANCE_BALANCE',
  INSTALLMENTS: 'INSTALLMENTS',
} as const;
export type PaymentTerms = (typeof PaymentTerms)[keyof typeof PaymentTerms];
export const PAYMENT_TERMS = values(PaymentTerms);

export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const INVOICE_STATUSES = values(InvoiceStatus);

export const InstallmentKind = {
  ADVANCE: 'ADVANCE',
  INSTALLMENT: 'INSTALLMENT',
  BALANCE: 'BALANCE',
} as const;
export type InstallmentKind = (typeof InstallmentKind)[keyof typeof InstallmentKind];
export const INSTALLMENT_KINDS = values(InstallmentKind);

export const InstallmentStatus = {
  PENDING: 'PENDING',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  WAIVED: 'WAIVED',
} as const;
export type InstallmentStatus = (typeof InstallmentStatus)[keyof typeof InstallmentStatus];
export const INSTALLMENT_STATUSES = values(InstallmentStatus);

/** Preset instalment plans in months; CUSTOM lets admin define each row. */
export const INSTALLMENT_PLAN_MONTHS = [2, 3, 6, 9, 12] as const;

export const PaymentMethod = {
  GATEWAY: 'GATEWAY',
  BANK_TRANSFER: 'BANK_TRANSFER',
  UPI: 'UPI',
  CASH: 'CASH',
  CHEQUE: 'CHEQUE',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PAYMENT_METHODS = values(PaymentMethod);

export const PaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUSES = values(PaymentStatus);

export const FileVisibility = { INTERNAL: 'INTERNAL', CLIENT: 'CLIENT' } as const;
export type FileVisibility = (typeof FileVisibility)[keyof typeof FileVisibility];
export const FILE_VISIBILITIES = values(FileVisibility);

export const FileScope = {
  PROJECT: 'PROJECT',
  TASK: 'TASK',
  TASK_UPDATE: 'TASK_UPDATE',
  WORK_REPORT: 'WORK_REPORT',
  MESSAGE: 'MESSAGE',
  CHANGE_REQUEST: 'CHANGE_REQUEST',
  INVOICE: 'INVOICE',
  USER: 'USER',
  CONVERSATION: 'CONVERSATION',
} as const;
export type FileScope = (typeof FileScope)[keyof typeof FileScope];
export const FILE_SCOPES = values(FileScope);

export const NotificationType = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_DEADLINE_APPROACHING: 'TASK_DEADLINE_APPROACHING',
  TASK_OVERDUE: 'TASK_OVERDUE',
  PROGRESS_UPDATED: 'PROGRESS_UPDATED',
  WORK_SUBMITTED: 'WORK_SUBMITTED',
  WORK_APPROVED: 'WORK_APPROVED',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  PROJECT_CREATED: 'PROJECT_CREATED',
  MILESTONE_COMPLETED: 'MILESTONE_COMPLETED',
  CHANGE_REQUEST: 'CHANGE_REQUEST',
  NEW_MESSAGE: 'NEW_MESSAGE',
  INVOICE_CREATED: 'INVOICE_CREATED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  INSTALLMENT_DUE: 'INSTALLMENT_DUE',
  PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export const NOTIFICATION_TYPES = values(NotificationType);

export const AuthTokenPurpose = {
  INVITE: 'INVITE',
  VERIFY_EMAIL: 'VERIFY_EMAIL',
  RESET_PASSWORD: 'RESET_PASSWORD',
} as const;
export type AuthTokenPurpose = (typeof AuthTokenPurpose)[keyof typeof AuthTokenPurpose];
export const AUTH_TOKEN_PURPOSES = values(AuthTokenPurpose);

/** Quick-pick progress values offered to partners; any integer 0–100 is also accepted. */
export const PROGRESS_PRESETS = [0, 10, 25, 50, 75, 90, 100] as const;

export const DEFAULT_SERVICE_CATEGORIES = [
  'Website Development',
  'Mobile Application Development',
  'UI/UX Design',
  'Logo and Branding',
  'Graphic Design',
  'Social Media Marketing',
  'Digital Marketing',
  'SEO',
  'Software Development',
  'AI Automation',
  'Other Services',
] as const;
