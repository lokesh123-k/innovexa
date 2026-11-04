import type { PartnerType, Role, UserStatus } from '@innovexa/shared';

/** Mirrors the API's `toUserDTO` output. */
export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  lastLoginAt?: string;
  partnerProfile?: {
    partnerType: PartnerType;
    category?: string;
    designation?: string;
    skills: string[];
    hourlyRateMinor?: number;
  };
  clientId?: string;
  permissions?: string[];
  /** Admin-only: outcome of the latest invitation email. */
  invitationEmail?: { status: 'SENT' | 'FAILED' | 'NOT_SENT'; at: string; error?: string };
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  _id: string;
  action: string;
  entity: string;
  entityId?: string;
  actorRole: string;
  actorId?: { _id: string; name: string; email: string; role: Role } | null;
  ip?: string;
  createdAt: string;
}

/** Populated reference shapes returned by the API. */
export interface UserRef {
  _id: string;
  name: string;
  email?: string;
  role?: Role;
  partnerProfile?: { partnerType?: string; category?: string };
}
export interface ProjectRef {
  _id: string;
  title: string;
  projectCode?: string;
  status?: string;
}
export interface ClientRef {
  _id: string;
  companyName: string;
  clientCode?: string;
  email?: string;
  contactName?: string;
  phone?: string;
}

export interface ServiceCategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  isSystem: boolean;
}

export interface TaskCounts {
  total: number;
  done: number;
  pending: number;
  overdue: number;
  awaitingReview: number;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  order: number;
  dueDate?: string;
  status: string;
  completedAt?: string;
  clientVisible: boolean;
}

export interface Project {
  id: string;
  projectCode: string;
  title: string;
  client: ClientRef;
  serviceCategory?: { _id: string; name: string };
  description?: string;
  requirements?: string;
  startDate: string;
  expectedEndDate: string;
  completedAt?: string;
  priority: string;
  status: string;
  approvedProgress: number;
  submittedProgress?: number;
  budgetMinor?: number;
  contractAmountMinor?: number;
  partners?: UserRef[];
  internalNotes?: string;
  taskCounts: TaskCounts;
  milestones?: Milestone[];
  deliverables?: { _id: string; title: string; approvedAt?: string }[];
  progressHistory?: { approved: number; submitted: number; reason: string; at: string }[];
}

export interface Attachment {
  id: string;
  name: string;
  size?: number;
  url: string;
}

export interface ReviewNote {
  reviewerId: string;
  decision: 'APPROVED' | 'REVISION_REQUESTED';
  approvedProgress?: number;
  comment?: string;
  at: string;
}

export interface TaskUpdateEntry {
  id: string;
  kind: 'PROGRESS' | 'SUBMISSION' | 'ISSUE' | 'CLARIFICATION';
  partner?: UserRef;
  previousProgress: number;
  newProgress: number;
  description: string;
  minutesSpent: number;
  reviewStatus: string;
  reviewedBy?: UserRef;
  reviewedAt?: string;
  reviewComment?: string;
  attachments: Attachment[];
  createdAt: string;
  task?: { _id: string; title: string; status: string; projectId?: ProjectRef };
}

export interface Task {
  id: string;
  project: ProjectRef;
  milestoneId?: string;
  title: string;
  description?: string;
  instructions?: string;
  expectedDeliverables?: string;
  assignees: UserRef[];
  priority: string;
  status: string;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  weight: number;
  submittedProgress: number;
  approvedProgress: number;
  loggedMinutes: number;
  reviewNotes: ReviewNote[];
  approvedAt?: string;
  isOverdue: boolean;
  attachments?: Attachment[];
  updates?: TaskUpdateEntry[];
  createdAt: string;
}

export interface Installment {
  id: string;
  number: number;
  kind: 'ADVANCE' | 'INSTALLMENT' | 'BALANCE';
  amountMinor: number;
  paidMinor: number;
  dueMinor: number;
  dueDate: string;
  status: string;
  paidAt?: string;
}

export interface Payment {
  id: string;
  invoice?: { _id: string; invoiceNumber: string } | string;
  client?: ClientRef | string;
  amountMinor: number;
  method: string;
  provider?: string;
  status: string;
  isAdvance?: boolean;
  reference?: string;
  receiptNumber?: string;
  paidAt?: string;
  failureReason?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  client: ClientRef;
  project: ProjectRef;
  invoiceDate: string;
  dueDate: string;
  contractAmountMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  advanceMinor: number;
  advancePaidMinor: number;
  paidMinor: number;
  balanceMinor: number;
  paymentTerms: string;
  status: string;
  notes?: string;
  nextDue: Installment | null;
  installments: Installment[];
  payments?: Payment[];
}

/** A client's account partner (UNASSIGNED when none). */
export interface ClientAssignment {
  status: 'UNASSIGNED' | 'ASSIGNED';
  partner: { id: string; name: string; email: string; status: string } | null;
  assignedAt?: string;
  updatedAt?: string;
  assignedBy?: { id: string; name: string };
}

/** Active partner offered in the Assign Partner dialog. */
export interface AssignablePartner {
  id: string;
  name: string;
  email: string;
  status: string;
  partnerType?: string;
  category?: string;
}

/** Partner portal: a client assigned to the signed-in partner. */
export interface AssignedClient {
  id: string;
  clientCode: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  status: string;
  assignedAt?: string;
  projects: { id: string; title: string; projectCode: string; status: string }[];
}

export interface ClientRecord {
  id: string;
  clientCode: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  gstin?: string;
  notes?: string;
  status: string;
  projectCount?: number;
  activeProjects?: number;
  invoicedMinor?: number;
  outstandingMinor?: number;
  loginCount?: number;
  assignment?: ClientAssignment;
}

export interface BillingTotals {
  invoicedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  invoiceCount: number;
  advanceDueMinor: number;
  advancePaidMinor: number;
}

export interface UpcomingInstallment extends Installment {
  invoice: { _id: string; invoiceNumber: string; clientId?: ClientRef };
}

export interface Conversation {
  id: string;
  type: string;
  audience: 'PARTNER' | 'CLIENT';
  title?: string;
  user: UserRef;
  project?: ProjectRef;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unread: number;
  online: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: UserRef;
  body: string;
  attachments: Attachment[];
  readBy: { userId: string; at: string }[];
  createdAt: string;
}

export interface AppNotification {
  _id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  readAt?: string | null;
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  _id: string;
  requestCode: string;
  projectId: ProjectRef & { contractAmountMinor?: number };
  clientId: ClientRef;
  submittedBy?: UserRef;
  title: string;
  description: string;
  status: string;
  history?: { status: string; by: UserRef; note?: string; at: string }[];
  responses?: { _id: string; authorId: UserRef; body: string; at: string }[];
  changeOrder?: { amountMinor?: number; description?: string; approvedAt?: string };
  taskId?: string;
  attachments?: Attachment[];
  createdAt: string;
}

export interface WorkReport {
  _id: string;
  partnerId: UserRef;
  type: 'DAILY' | 'WEEKLY';
  date: string;
  periodEnd?: string;
  taskIds: { _id: string; title: string }[];
  workCompleted: string;
  progressPercent?: number;
  minutesWorked: number;
  problems?: string;
  nextPlan?: string;
  createdAt: string;
}
