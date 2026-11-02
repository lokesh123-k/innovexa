import { z } from 'zod';
import {
  CHANGE_REQUEST_STATUSES,
  CLIENT_STATUSES,
  INSTALLMENT_PLAN_MONTHS,
  MILESTONE_STATUSES,
  PAYMENT_METHODS,
  PRIORITIES,
  PROJECT_STATUSES,
  PaymentMethod,
  PaymentTerms,
  TASK_STATUSES,
  TaskStatus,
  WORK_REPORT_TYPES,
} from '../enums.js';
import {
  emailSchema,
  minorAmountSchema,
  objectIdSchema,
  paginationQuerySchema,
  phoneSchema,
} from './common.js';

const text = (max: number) => z.string().trim().max(max);
const name = z.string().trim().min(2, 'Enter at least 2 characters').max(150);
const nonEmpty = (v: object) => Object.keys(v).length > 0;
const NO_CHANGES = { message: 'No changes provided' };
const dateSchema = z.coerce.date();
const ids = z.array(objectIdSchema).max(50);
const attachmentIds = z.array(objectIdSchema).max(10).default([]);
const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

/* ---------------------------------- Clients --------------------------------- */

const addressSchema = z
  .object({
    line1: text(200),
    line2: text(200),
    city: text(100),
    state: text(100),
    postalCode: text(20),
    country: text(100),
  })
  .partial();

const clientFields = {
  companyName: name,
  contactName: name,
  email: emailSchema,
  phone: phoneSchema.optional(),
  address: addressSchema.optional(),
  gstin: z.string().trim().toUpperCase().max(20).optional(),
  notes: text(2000).optional(),
};
export const createClientSchema = z.object(clientFields);
export type CreateClientInput = z.infer<typeof createClientSchema>;
export const updateClientSchema = z.object(clientFields).partial().refine(nonEmpty, NO_CHANGES);
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export const setClientStatusSchema = z.object({ status: z.enum(CLIENT_STATUSES) });
export const inviteClientUserSchema = z.object({
  name,
  email: emailSchema,
  phone: phoneSchema.optional(),
});
export type InviteClientUserInput = z.infer<typeof inviteClientUserSchema>;
export const listClientsQuerySchema = paginationQuerySchema.extend({
  q: text(100).optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

/* ---------------------------- Service categories ---------------------------- */

export const createServiceCategorySchema = z.object({ name, description: text(500).optional() });
export const updateServiceCategorySchema = z
  .object({
    name: name.optional(),
    description: text(500).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(nonEmpty, NO_CHANGES);

/* --------------------------------- Projects --------------------------------- */

const milestoneFields = {
  title: name,
  description: text(2000).optional(),
  dueDate: dateSchema.optional(),
  clientVisible: z.boolean().optional(),
};
export const createMilestoneSchema = z.object(milestoneFields);
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export const updateMilestoneSchema = z
  .object({
    ...milestoneFields,
    status: z.enum(MILESTONE_STATUSES),
    order: z.number().int().min(0),
  })
  .partial()
  .refine(nonEmpty, NO_CHANGES);
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

const projectFields = {
  title: name,
  clientId: objectIdSchema,
  serviceCategoryId: objectIdSchema,
  description: text(5000).optional(),
  requirements: text(5000).optional(),
  budgetMinor: minorAmountSchema.optional(),
  contractAmountMinor: minorAmountSchema,
  startDate: dateSchema,
  expectedEndDate: dateSchema,
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  partnerIds: ids.optional(),
  internalNotes: text(5000).optional(),
};
const datesInOrder = (v: { startDate?: Date; expectedEndDate?: Date }) =>
  !v.startDate || !v.expectedEndDate || v.expectedEndDate >= v.startDate;
const DATE_ORDER = {
  message: 'Expected completion must be on or after the start date',
  path: ['expectedEndDate'],
};

export const createProjectSchema = z
  .object({ ...projectFields, milestones: z.array(createMilestoneSchema).max(30).optional() })
  .refine(datesInOrder, DATE_ORDER);
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export const updateProjectSchema = z
  .object(projectFields)
  .partial()
  .refine(nonEmpty, NO_CHANGES)
  .refine(datesInOrder, DATE_ORDER);
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export const listProjectsQuerySchema = paginationQuerySchema.extend({
  q: text(100).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  clientId: objectIdSchema.optional(),
  partnerId: objectIdSchema.optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

/* ----------------------------------- Tasks ---------------------------------- */

const taskFields = {
  projectId: objectIdSchema,
  milestoneId: objectIdSchema.nullable().optional(),
  title: name,
  description: text(5000).optional(),
  instructions: text(5000).optional(),
  expectedDeliverables: text(2000).optional(),
  assigneeIds: ids.optional(),
  priority: z.enum(PRIORITIES).optional(),
  startDate: dateSchema.optional(),
  dueDate: dateSchema.optional(),
  estimatedHours: z.number().min(0).max(10000).optional(),
  weight: z.number().int().min(1).max(100).optional(),
};
export const createTaskSchema = z.object(taskFields);
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Statuses an admin may set directly; review/cancel have dedicated actions. */
export const ADMIN_SETTABLE_TASK_STATUSES = [
  TaskStatus.NOT_STARTED,
  TaskStatus.ASSIGNED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.ON_HOLD,
  TaskStatus.COMPLETED,
] as const;
export const updateTaskSchema = z
  .object({ ...taskFields, status: z.enum(ADMIN_SETTABLE_TASK_STATUSES) })
  .omit({ projectId: true, assigneeIds: true })
  .partial()
  .refine(nonEmpty, NO_CHANGES);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export const assignTaskSchema = z.object({ assigneeIds: ids });
export const listTasksQuerySchema = paginationQuerySchema.extend({
  q: text(100).optional(),
  projectId: objectIdSchema.optional(),
  assigneeId: objectIdSchema.optional(),
  status: z
    .string()
    .optional()
    .transform((s) => s?.split(',').filter(Boolean))
    .pipe(z.array(z.enum(TASK_STATUSES)).optional()),
  overdue: boolQuery.optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

const progress = z.number().int().min(0).max(100);
const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60)
  .default(0);

export const progressUpdateSchema = z.object({
  newProgress: progress,
  description: z.string().trim().min(3, 'Describe the work done').max(5000),
  minutesSpent: minutes,
  attachmentIds,
});
export type ProgressUpdateInput = z.infer<typeof progressUpdateSchema>;
export const submitTaskSchema = z.object({
  description: z.string().trim().min(3, 'Describe what you are submitting').max(5000),
  newProgress: progress.default(100),
  minutesSpent: minutes,
  attachmentIds,
});
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
export const taskIssueSchema = z.object({
  kind: z.enum(['ISSUE', 'CLARIFICATION']),
  description: z.string().trim().min(3).max(5000),
});
export type TaskIssueInput = z.infer<typeof taskIssueSchema>;
export const reviewTaskSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REQUEST_REVISION']),
    approvedProgress: progress.optional(),
    comment: text(5000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.comment && v.comment.length >= 3), {
    message: 'Explain what needs to change',
    path: ['comment'],
  });
export type ReviewTaskInput = z.infer<typeof reviewTaskSchema>;

/* ------------------------------- Work reports ------------------------------- */

export const createWorkReportSchema = z.object({
  type: z.enum(WORK_REPORT_TYPES),
  date: dateSchema,
  periodEnd: dateSchema.optional(),
  taskIds: ids.default([]),
  workCompleted: z.string().trim().min(3, 'Describe the work completed').max(5000),
  progressPercent: progress.optional(),
  minutesWorked: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60),
  problems: text(3000).optional(),
  nextPlan: text(3000).optional(),
});
export type CreateWorkReportInput = z.infer<typeof createWorkReportSchema>;
export const listWorkReportsQuerySchema = paginationQuerySchema.extend({
  partnerId: objectIdSchema.optional(),
  type: z.enum(WORK_REPORT_TYPES).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});
export type ListWorkReportsQuery = z.infer<typeof listWorkReportsQuerySchema>;

/* ------------------------------ Messaging -------------------------------- */

export const createConversationSchema = z.object({
  /** Admin only: the partner or client user to talk to. */
  userId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  title: text(150).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export const sendMessageSchema = z
  .object({ body: text(5000).default(''), attachmentIds })
  .refine((v) => v.body.length > 0 || v.attachmentIds.length > 0, {
    message: 'Write a message or attach a file',
    path: ['body'],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export const listMessagesQuerySchema = z.object({
  before: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/* ----------------------------- Change requests ----------------------------- */

export const createChangeRequestSchema = z.object({
  projectId: objectIdSchema,
  title: name,
  description: z.string().trim().min(10, 'Describe the change in a little more detail').max(5000),
});
export type CreateChangeRequestInput = z.infer<typeof createChangeRequestSchema>;
export const changeRequestStatusSchema = z.object({
  status: z.enum(CHANGE_REQUEST_STATUSES),
  note: text(3000).optional(),
});
export const changeRequestResponseSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const changeOrderSchema = z.object({
  amountMinor: minorAmountSchema,
  description: z.string().trim().min(3).max(2000),
});
export const convertChangeRequestSchema = z.object({
  title: name.optional(),
  assigneeIds: ids.optional(),
  dueDate: dateSchema.optional(),
  weight: z.number().int().min(1).max(100).optional(),
});
export const listChangeRequestsQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
});

/* --------------------------------- Billing --------------------------------- */

export const installmentPlanSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('MONTHLY'),
    months: z
      .number()
      .int()
      .refine((m) => (INSTALLMENT_PLAN_MONTHS as readonly number[]).includes(m), {
        message: `Choose ${INSTALLMENT_PLAN_MONTHS.join(', ')} months, or a custom plan`,
      }),
    firstDueDate: dateSchema,
  }),
  z.object({
    mode: z.literal('CUSTOM'),
    items: z
      .array(z.object({ amountMinor: minorAmountSchema, dueDate: dateSchema }))
      .min(1)
      .max(36),
  }),
]);

export const createInvoiceSchema = z
  .object({
    projectId: objectIdSchema,
    invoiceDate: dateSchema,
    dueDate: dateSchema,
    contractAmountMinor: minorAmountSchema,
    taxMinor: minorAmountSchema.default(0),
    discountMinor: minorAmountSchema.default(0),
    paymentTerms: z.enum([
      PaymentTerms.FULL,
      PaymentTerms.ADVANCE_BALANCE,
      PaymentTerms.INSTALLMENTS,
    ]),
    advanceMinor: minorAmountSchema.default(0),
    advanceDueDate: dateSchema.optional(),
    installments: installmentPlanSchema.optional(),
    notes: text(3000).optional(),
    issue: z.boolean().default(false),
  })
  .refine((v) => v.dueDate >= v.invoiceDate, {
    message: 'Due date must be on or after the invoice date',
    path: ['dueDate'],
  });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  clientId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  status: z.string().trim().max(40).optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const OFFLINE_PAYMENT_METHODS = PAYMENT_METHODS.filter(
  (m) => m !== PaymentMethod.GATEWAY,
) as [PaymentMethod, ...PaymentMethod[]];
export const recordOfflinePaymentSchema = z.object({
  invoiceId: objectIdSchema,
  amountMinor: minorAmountSchema.refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(OFFLINE_PAYMENT_METHODS),
  reference: text(200).optional(),
  paidAt: dateSchema.optional(),
});
export type RecordOfflinePaymentInput = z.infer<typeof recordOfflinePaymentSchema>;
export const createPaymentOrderSchema = z.object({
  invoiceId: objectIdSchema,
  amountMinor: minorAmountSchema.optional(),
});
export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(100),
  razorpay_payment_id: z.string().trim().min(1).max(100),
  razorpay_signature: z.string().trim().min(1).max(256),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  invoiceId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
});

/* --------------------------------- Reports --------------------------------- */

export const REPORT_TYPES = ['projects', 'partners', 'work', 'overdue-tasks', 'financial'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const reportQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  clientId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  partnerId: objectIdSchema.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const idParamSchema = z.object({ id: objectIdSchema });
