import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import type { Types } from 'mongoose';
import {
  InstallmentKind,
  InstallmentStatus,
  InvoiceStatus,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  Role,
  allocatePayments,
  buildSchedule,
  formatMoney,
  invoiceTotal,
  type CreateInvoiceInput,
  type ListInvoicesQuery,
  type RecordOfflinePaymentInput,
  type VerifyPaymentInput,
} from '@innovexa/shared';
import { env } from '../../config/env';
import type { AuthUser } from '../../types/express';
import { loadProjectFor } from '../../utils/access';
import { AppError } from '../../utils/AppError';
import { safeEqual, sha256 } from '../../utils/crypto';
import { pageMeta } from '../../utils/http';
import { logger } from '../../utils/logger';
import { formatCode, nextSequence } from '../../utils/sequence';
import { recordAudit } from '../audit-logs/auditLog.service';
import { Installment } from '../installments/installment.model';
import { notify, notifyAdmins } from '../notifications/notification.service';
import { Payment } from '../payments/payment.model';
import { WebhookEvent } from '../payments/webhookEvent.model';
import { clientUserIds } from '../projects/projects.service';
import { Invoice } from './invoice.model';

const PAYABLE: string[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export function invoiceScope(user: AuthUser): Record<string, unknown> {
  if (user.role === Role.ADMIN) return {};
  if (user.role === Role.CLIENT)
    return { clientId: user.clientId ?? null, status: { $ne: InvoiceStatus.DRAFT } };
  throw AppError.forbidden();
}

async function loadInvoiceFor(user: AuthUser, id: string | Types.ObjectId) {
  const invoice = await Invoice.findOne({ _id: id, ...invoiceScope(user) });
  if (!invoice) throw AppError.notFound('Invoice');
  return invoice;
}

/* --------------------------------- Views --------------------------------- */

type InstallmentLean = Record<string, unknown> & { _id: Types.ObjectId };

export function installmentView(i: InstallmentLean) {
  const o = ('toObject' in i && typeof i.toObject === 'function' ? i.toObject() : i) as Record<
    string,
    unknown
  > & {
    _id: Types.ObjectId;
    amountMinor: number;
    paidMinor: number;
    dueDate: Date;
    status: string;
  };
  const open =
    o.status === InstallmentStatus.PENDING || o.status === InstallmentStatus.PARTIALLY_PAID;
  return {
    id: o._id.toString(),
    number: o.number,
    kind: o.kind,
    amountMinor: o.amountMinor,
    paidMinor: o.paidMinor,
    dueMinor: o.amountMinor - o.paidMinor,
    dueDate: o.dueDate,
    status: open && o.dueDate < startOfToday() ? InstallmentStatus.OVERDUE : o.status,
    paidAt: o.paidAt,
    paymentReference: o.paymentReference,
  };
}

export function invoiceView(
  inv: Record<string, unknown> & {
    _id: Types.ObjectId;
    status: string;
    dueDate: Date;
    balanceMinor: number;
  },
  installments: ReturnType<typeof installmentView>[] = [],
) {
  const payable = PAYABLE.includes(inv.status);
  const overdue =
    payable &&
    (installments.some((i) => i.status === InstallmentStatus.OVERDUE) ||
      (installments.length === 0 && inv.dueDate < startOfToday()));
  return {
    id: inv._id.toString(),
    invoiceNumber: inv.invoiceNumber,
    client: inv.clientId,
    project: inv.projectId,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    contractAmountMinor: inv.contractAmountMinor,
    taxMinor: inv.taxMinor,
    discountMinor: inv.discountMinor,
    totalMinor: inv.totalMinor,
    advanceMinor: inv.advanceMinor,
    advancePaidMinor: installments
      .filter((i) => i.kind === InstallmentKind.ADVANCE)
      .reduce((s, i) => s + i.paidMinor, 0),
    paidMinor: inv.paidMinor,
    refundedMinor: inv.refundedMinor,
    balanceMinor: inv.balanceMinor,
    paymentTerms: inv.paymentTerms,
    status: overdue ? InvoiceStatus.OVERDUE : inv.status,
    notes: inv.notes,
    issuedAt: inv.issuedAt,
    nextDue: installments.find((i) => i.dueMinor > 0) ?? null,
    installments,
    createdAt: inv.createdAt,
  };
}

/* ------------------------------ Recalculation ------------------------------ */

/** Recomputes paid/balance/status for an invoice and its schedule from the payment ledger. */
export async function recalcInvoice(invoiceId: Types.ObjectId | string) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return;
  const [payments, installments] = await Promise.all([
    Payment.find({ invoiceId, status: { $in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] } })
      .sort({ paidAt: 1, createdAt: 1 })
      .lean(),
    Installment.find({ invoiceId }).sort({ number: 1 }),
  ]);
  const gross = payments.reduce((s, p) => s + p.amountMinor, 0);
  const refunded = payments.reduce((s, p) => s + (p.refundedMinor ?? 0), 0);
  const net = gross - refunded;
  const { paid } = allocatePayments(
    installments.map((i) => i.amountMinor),
    payments.map((p) => p.amountMinor - (p.refundedMinor ?? 0)),
  );
  const lastPaidAt = payments.at(-1)?.paidAt;
  await Promise.all(
    installments.map((row, idx) => {
      const p = paid[idx]!;
      row.paidMinor = p;
      if (row.status !== InstallmentStatus.WAIVED) {
        row.status =
          p >= row.amountMinor
            ? InstallmentStatus.PAID
            : p > 0
              ? InstallmentStatus.PARTIALLY_PAID
              : InstallmentStatus.PENDING;
      }
      row.paidAt = p >= row.amountMinor ? (row.paidAt ?? lastPaidAt) : undefined;
      return row.save();
    }),
  );
  invoice.paidMinor = gross;
  invoice.refundedMinor = refunded;
  invoice.balanceMinor = invoice.totalMinor - net;
  if (invoice.status !== InvoiceStatus.CANCELLED && invoice.status !== InvoiceStatus.DRAFT) {
    invoice.status =
      invoice.balanceMinor <= 0
        ? InvoiceStatus.PAID
        : net > 0
          ? InvoiceStatus.PARTIALLY_PAID
          : InvoiceStatus.ISSUED;
  }
  await invoice.save();
  return invoice;
}

/* --------------------------------- Invoices --------------------------------- */

export async function createInvoice(req: Request, input: CreateInvoiceInput) {
  const admin = req.user!;
  const project = await loadProjectFor(admin, input.projectId);
  const totalMinor = invoiceTotal(input);
  const schedule = buildSchedule({
    totalMinor,
    paymentTerms: input.paymentTerms,
    dueDate: input.dueDate,
    advanceMinor: input.advanceMinor,
    advanceDueDate: input.advanceDueDate,
    installments: input.installments,
  });
  const year = input.invoiceDate.getUTCFullYear();
  const invoice = await Invoice.create({
    invoiceNumber: formatCode(`INV-${year}`, await nextSequence(`invoice-${year}`)),
    clientId: project.clientId,
    projectId: project._id,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    contractAmountMinor: input.contractAmountMinor,
    taxMinor: input.taxMinor,
    discountMinor: input.discountMinor,
    totalMinor,
    advanceMinor: input.advanceMinor,
    paidMinor: 0,
    balanceMinor: totalMinor,
    paymentTerms: input.paymentTerms,
    status: input.issue ? InvoiceStatus.ISSUED : InvoiceStatus.DRAFT,
    issuedAt: input.issue ? new Date() : undefined,
    notes: input.notes,
    createdBy: admin._id,
  });
  await Installment.insertMany(
    schedule.map((r) => ({ ...r, invoiceId: invoice._id, clientId: project.clientId })),
  );
  await recordAudit({
    req,
    action: 'invoice.created',
    entity: 'Invoice',
    entityId: invoice._id,
    after: invoice,
  });
  if (input.issue) await notifyInvoiceIssued(invoice);
  return invoice;
}

async function notifyInvoiceIssued(invoice: {
  _id: Types.ObjectId;
  clientId: Types.ObjectId;
  invoiceNumber: string;
  totalMinor: number;
}) {
  await notify({
    recipients: await clientUserIds(invoice.clientId),
    type: NotificationType.INVOICE_CREATED,
    title: `New invoice ${invoice.invoiceNumber}`,
    body: `Invoice total ${formatMoney(invoice.totalMinor)}. View the payment schedule in your portal.`,
    link: `/client/invoices/${invoice._id.toString()}`,
    email: true,
  });
}

export async function issueInvoice(req: Request, id: string) {
  const invoice = await loadInvoiceFor(req.user!, id);
  if (invoice.status !== InvoiceStatus.DRAFT)
    throw AppError.conflict('Only draft invoices can be issued');
  invoice.status = InvoiceStatus.ISSUED;
  invoice.issuedAt = new Date();
  await invoice.save();
  await recordAudit({ req, action: 'invoice.issued', entity: 'Invoice', entityId: invoice._id });
  await notifyInvoiceIssued(invoice);
  return invoice;
}

export async function cancelInvoice(req: Request, id: string) {
  const invoice = await loadInvoiceFor(req.user!, id);
  if (invoice.paidMinor > 0)
    throw AppError.conflict('Invoices with recorded payments cannot be cancelled');
  if (invoice.status === InvoiceStatus.CANCELLED) return invoice;
  const before = invoice.status;
  invoice.status = InvoiceStatus.CANCELLED;
  invoice.cancelledAt = new Date();
  await invoice.save();
  await recordAudit({
    req,
    action: 'invoice.cancelled',
    entity: 'Invoice',
    entityId: invoice._id,
    before: { status: before },
  });
  return invoice;
}

const INVOICE_POPULATE = [
  { path: 'clientId', select: 'companyName clientCode email' },
  { path: 'projectId', select: 'title projectCode' },
];

export async function listInvoices(user: AuthUser, q: ListInvoicesQuery) {
  const filter: Record<string, unknown> = { ...invoiceScope(user) };
  if (q.projectId) filter.projectId = q.projectId;
  if (user.role === Role.ADMIN && q.clientId) filter.clientId = q.clientId;
  if (q.status && q.status !== InvoiceStatus.OVERDUE) filter.status = q.status;
  const [items, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ invoiceDate: -1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate(INVOICE_POPULATE)
      .lean(),
    Invoice.countDocuments(filter),
  ]);
  const rows = await Installment.find({ invoiceId: { $in: items.map((i) => i._id) } })
    .sort({ number: 1 })
    .lean();
  const byInvoice = new Map<string, ReturnType<typeof installmentView>[]>();
  for (const r of rows) {
    const k = r.invoiceId.toString();
    byInvoice.set(k, [...(byInvoice.get(k) ?? []), installmentView(r)]);
  }
  let views = items.map((i) => invoiceView(i, byInvoice.get(i._id.toString())));
  if (q.status === InvoiceStatus.OVERDUE)
    views = views.filter((v) => v.status === InvoiceStatus.OVERDUE);
  return { items: views, meta: pageMeta(q.page, q.limit, total) };
}

export async function getInvoice(user: AuthUser, id: string) {
  const invoice = await loadInvoiceFor(user, id);
  await invoice.populate(INVOICE_POPULATE);
  const [rows, payments] = await Promise.all([
    Installment.find({ invoiceId: invoice._id }).sort({ number: 1 }).lean(),
    Payment.find({
      invoiceId: invoice._id,
      status: { $in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED, PaymentStatus.FAILED] },
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  return {
    ...invoiceView(invoice.toObject(), rows.map(installmentView)),
    payments: payments.map(paymentView),
  };
}

/* --------------------------------- Payments --------------------------------- */

export function paymentView(p: Record<string, unknown> & { _id: Types.ObjectId }) {
  return {
    id: p._id.toString(),
    invoice: p.invoiceId,
    client: p.clientId,
    amountMinor: p.amountMinor,
    currency: p.currency,
    method: p.method,
    provider: p.provider,
    status: p.status,
    isAdvance: p.isAdvance,
    reference: p.reference ?? p.providerPaymentId,
    receiptNumber: p.receiptNumber,
    paidAt: p.paidAt,
    failureReason: p.failureReason,
    createdAt: p.createdAt,
  };
}

async function nextReceiptNumber() {
  const year = new Date().getUTCFullYear();
  return formatCode(`RCP-${year}`, await nextSequence(`receipt-${year}`));
}

/** Whether money arriving now would first settle the advance row. */
async function appliesToAdvance(invoiceId: Types.ObjectId) {
  const adv = await Installment.findOne({ invoiceId, kind: InstallmentKind.ADVANCE }).lean();
  return !!adv && adv.paidMinor < adv.amountMinor;
}

async function afterPaymentSucceeded(payment: {
  _id: Types.ObjectId;
  invoiceId: Types.ObjectId;
  clientId: Types.ObjectId;
  amountMinor: number;
}) {
  const invoice = await recalcInvoice(payment.invoiceId);
  await notify({
    recipients: await clientUserIds(payment.clientId),
    type: NotificationType.PAYMENT_RECEIVED,
    title: `Payment received: ${formatMoney(payment.amountMinor)}`,
    body: invoice
      ? `Invoice ${invoice.invoiceNumber} balance is now ${formatMoney(Math.max(0, invoice.balanceMinor))}.`
      : undefined,
    link: `/client/payments`,
    email: true,
  });
  await notifyAdmins({
    type: NotificationType.PAYMENT_RECEIVED,
    title: `Payment received: ${formatMoney(payment.amountMinor)}${invoice ? ` for ${invoice.invoiceNumber}` : ''}`,
    link: invoice ? `/admin/invoices/${invoice._id.toString()}` : '/admin/invoices',
  });
}

export async function recordOfflinePayment(req: Request, input: RecordOfflinePaymentInput) {
  const invoice = await loadInvoiceFor(req.user!, input.invoiceId);
  if (!PAYABLE.includes(invoice.status))
    throw AppError.conflict(
      `Payments cannot be recorded on a ${invoice.status.toLowerCase()} invoice`,
    );
  if (input.amountMinor > invoice.balanceMinor) {
    throw AppError.badRequest(
      `Amount exceeds the outstanding balance of ${formatMoney(invoice.balanceMinor)}`,
    );
  }
  const payment = await Payment.create({
    invoiceId: invoice._id,
    clientId: invoice.clientId,
    amountMinor: input.amountMinor,
    method: input.method,
    status: PaymentStatus.SUCCEEDED,
    isAdvance: await appliesToAdvance(invoice._id),
    reference: input.reference,
    paidAt: input.paidAt ?? new Date(),
    verifiedAt: new Date(),
    recordedBy: req.user!._id,
    receiptNumber: await nextReceiptNumber(),
  });
  await recordAudit({
    req,
    action: 'payment.recorded_offline',
    entity: 'Payment',
    entityId: payment._id,
    after: payment,
  });
  await afterPaymentSucceeded(payment);
  return payment;
}

export async function listPayments(
  user: AuthUser,
  q: { page: number; limit: number; invoiceId?: string; clientId?: string },
) {
  const filter: Record<string, unknown> = {
    status: { $in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED, PaymentStatus.FAILED] },
  };
  if (user.role === Role.CLIENT) filter.clientId = user.clientId ?? null;
  else if (user.role !== Role.ADMIN) throw AppError.forbidden();
  else if (q.clientId) filter.clientId = q.clientId;
  if (q.invoiceId) filter.invoiceId = q.invoiceId;
  const [items, total] = await Promise.all([
    Payment.find(filter)
      .sort({ paidAt: -1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('invoiceId', 'invoiceNumber')
      .populate('clientId', 'companyName')
      .lean(),
    Payment.countDocuments(filter),
  ]);
  return { items: items.map(paymentView), meta: pageMeta(q.page, q.limit, total) };
}

export async function getReceipt(user: AuthUser, id: string) {
  const filter: Record<string, unknown> = { _id: id, status: PaymentStatus.SUCCEEDED };
  if (user.role === Role.CLIENT) filter.clientId = user.clientId ?? null;
  else if (user.role !== Role.ADMIN) throw AppError.forbidden();
  const payment = await Payment.findOne(filter)
    .populate('clientId', 'companyName contactName email address gstin')
    .populate({
      path: 'invoiceId',
      select: 'invoiceNumber totalMinor paidMinor balanceMinor projectId',
      populate: { path: 'projectId', select: 'title projectCode' },
    })
    .lean();
  if (!payment) throw AppError.notFound('Receipt');
  return { ...paymentView(payment), invoice: payment.invoiceId, client: payment.clientId };
}

/* ------------------------------ Online gateway ------------------------------ */

export function gatewayConfig() {
  const cfg = env();
  const enabled = Boolean(cfg.RAZORPAY_KEY_ID && cfg.RAZORPAY_KEY_SECRET);
  return {
    enabled,
    provider: 'razorpay' as const,
    keyId: enabled ? cfg.RAZORPAY_KEY_ID : undefined,
  };
}

export async function createGatewayOrder(
  user: AuthUser,
  input: { invoiceId: string; amountMinor?: number },
) {
  const cfg = env();
  if (!gatewayConfig().enabled)
    throw new AppError(
      503,
      'PAYMENTS_DISABLED',
      'Online payments are not enabled. Please contact Innovexa to pay offline.',
    );
  const invoice = await loadInvoiceFor(user, input.invoiceId);
  if (!PAYABLE.includes(invoice.status)) throw AppError.conflict('This invoice is not payable');
  const next = await Installment.findOne({
    invoiceId: invoice._id,
    $expr: { $lt: ['$paidMinor', '$amountMinor'] },
  })
    .sort({ number: 1 })
    .lean();
  const amountMinor =
    input.amountMinor ?? (next ? next.amountMinor - next.paidMinor : invoice.balanceMinor);
  if (amountMinor < 100) throw AppError.badRequest('The minimum online payment is ₹1.00');
  if (amountMinor > invoice.balanceMinor)
    throw AppError.badRequest('Amount exceeds the outstanding balance');

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${cfg.RAZORPAY_KEY_ID}:${cfg.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
    },
    body: JSON.stringify({
      amount: amountMinor,
      currency: invoice.currency,
      receipt: invoice.invoiceNumber,
      notes: { invoiceId: invoice._id.toString() },
    }),
  });
  if (!res.ok) {
    logger.error({ status: res.status }, 'Razorpay order creation failed');
    throw new AppError(502, 'GATEWAY_ERROR', 'Could not start the payment. Please try again.');
  }
  const order = (await res.json()) as { id: string; amount: number; currency: string };
  if (order.amount !== amountMinor)
    throw new AppError(502, 'GATEWAY_ERROR', 'Gateway returned an unexpected amount');
  await Payment.create({
    invoiceId: invoice._id,
    clientId: invoice.clientId,
    amountMinor,
    currency: invoice.currency,
    method: PaymentMethod.GATEWAY,
    provider: 'razorpay',
    providerOrderId: order.id,
    status: PaymentStatus.CREATED,
  });
  return {
    orderId: order.id,
    amountMinor,
    currency: order.currency,
    keyId: cfg.RAZORPAY_KEY_ID,
    invoiceNumber: invoice.invoiceNumber,
  };
}

/** Idempotent: a provider payment id can only ever succeed once. */
async function markGatewayPaymentSucceeded(
  orderId: string,
  providerPaymentId: string,
  amountMinor?: number,
) {
  const payment = await Payment.findOne({ provider: 'razorpay', providerOrderId: orderId });
  if (!payment) throw AppError.notFound('Payment');
  if (payment.status === PaymentStatus.SUCCEEDED) return { payment, alreadyProcessed: true };
  if (amountMinor !== undefined && amountMinor !== payment.amountMinor) {
    payment.status = PaymentStatus.FAILED;
    payment.failureReason = `Amount mismatch: expected ${payment.amountMinor}, gateway reported ${amountMinor}`;
    await payment.save();
    await notifyAdmins({
      type: NotificationType.PAYMENT_RECEIVED,
      title: 'Payment amount mismatch needs review',
      link: '/admin/invoices',
    });
    throw AppError.badRequest('Payment amount mismatch');
  }
  const isAdvance = await appliesToAdvance(payment.invoiceId);
  const receiptNumber = await nextReceiptNumber();
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: PaymentStatus.SUCCEEDED } },
    {
      $set: {
        status: PaymentStatus.SUCCEEDED,
        providerPaymentId,
        verifiedAt: new Date(),
        paidAt: new Date(),
        receiptNumber,
        isAdvance,
      },
    },
    { new: true },
  );
  if (!updated) return { payment, alreadyProcessed: true };
  await afterPaymentSucceeded(updated);
  return { payment: updated, alreadyProcessed: false };
}

export async function verifyCheckout(user: AuthUser, input: VerifyPaymentInput) {
  const cfg = env();
  if (!gatewayConfig().enabled)
    throw new AppError(503, 'PAYMENTS_DISABLED', 'Online payments are not enabled');
  const payment = await Payment.findOne({
    provider: 'razorpay',
    providerOrderId: input.razorpay_order_id,
    clientId: user.clientId ?? null,
  }).lean();
  if (!payment) throw AppError.notFound('Payment');
  const expected = createHmac('sha256', cfg.RAZORPAY_KEY_SECRET!)
    .update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`)
    .digest('hex');
  if (!safeEqual(expected, input.razorpay_signature))
    throw AppError.badRequest('Payment verification failed');
  const { payment: done } = await markGatewayPaymentSucceeded(
    input.razorpay_order_id,
    input.razorpay_payment_id,
  );
  return paymentView(done.toObject());
}

/** Razorpay webhook: signature-verified and processed at most once per event. */
export async function handleRazorpayWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  eventIdHeader: string | undefined,
) {
  const secret = env().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new AppError(503, 'PAYMENTS_DISABLED', 'Webhook not configured');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!signature || !safeEqual(expected, signature)) throw AppError.badRequest('Invalid signature');

  const payload = JSON.parse(rawBody.toString('utf8')) as {
    event: string;
    payload?: {
      payment?: {
        entity?: { id: string; order_id: string; amount: number; error_description?: string };
      };
    };
  };
  const eventId = eventIdHeader ?? sha256(rawBody.toString('utf8'));
  try {
    await WebhookEvent.create({
      provider: 'razorpay',
      eventId,
      type: payload.event,
      payloadHash: sha256(rawBody.toString('utf8')),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { duplicate: true };
    throw err;
  }

  const entity = payload.payload?.payment?.entity;
  try {
    if (entity && (payload.event === 'payment.captured' || payload.event === 'order.paid')) {
      await markGatewayPaymentSucceeded(entity.order_id, entity.id, entity.amount);
    } else if (entity && payload.event === 'payment.failed') {
      await Payment.updateOne(
        {
          provider: 'razorpay',
          providerOrderId: entity.order_id,
          status: { $ne: PaymentStatus.SUCCEEDED },
        },
        {
          $set: {
            status: PaymentStatus.FAILED,
            failureReason: entity.error_description ?? 'Payment failed',
          },
        },
      );
    }
    await WebhookEvent.updateOne(
      { provider: 'razorpay', eventId },
      { $set: { processedAt: new Date() } },
    );
  } catch (err) {
    await WebhookEvent.updateOne(
      { provider: 'razorpay', eventId },
      { $set: { error: (err as Error).message } },
    );
    if (!(err instanceof AppError)) throw err;
  }
  return { duplicate: false };
}

/* ------------------------------ Aggregates ------------------------------ */

export async function billingTotals(filter: Record<string, unknown>) {
  const [row] = await Invoice.aggregate<{
    invoiced: number;
    paid: number;
    refunded: number;
    balance: number;
    count: number;
  }>([
    { $match: { ...filter, status: { $nin: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] } } },
    {
      $group: {
        _id: null,
        invoiced: { $sum: '$totalMinor' },
        paid: { $sum: '$paidMinor' },
        refunded: { $sum: '$refundedMinor' },
        balance: { $sum: '$balanceMinor' },
        count: { $sum: 1 },
      },
    },
  ]);
  const invoiceIds = (
    await Invoice.find({
      ...filter,
      status: { $nin: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
    })
      .select('_id')
      .lean()
  ).map((i) => i._id);
  const [adv] = await Installment.aggregate<{ due: number; paid: number }>([
    { $match: { invoiceId: { $in: invoiceIds }, kind: InstallmentKind.ADVANCE } },
    { $group: { _id: null, due: { $sum: '$amountMinor' }, paid: { $sum: '$paidMinor' } } },
  ]);
  return {
    invoicedMinor: row?.invoiced ?? 0,
    receivedMinor: (row?.paid ?? 0) - (row?.refunded ?? 0),
    outstandingMinor: row?.balance ?? 0,
    invoiceCount: row?.count ?? 0,
    advanceDueMinor: adv?.due ?? 0,
    advancePaidMinor: adv?.paid ?? 0,
  };
}

export async function upcomingInstallments(filter: Record<string, unknown>, days = 30, limit = 8) {
  const issued = await Invoice.find({ ...filter, status: { $in: PAYABLE } })
    .select('_id')
    .lean();
  const until = new Date(Date.now() + days * 86_400_000);
  const rows = await Installment.find({
    invoiceId: { $in: issued.map((i) => i._id) },
    status: { $in: [InstallmentStatus.PENDING, InstallmentStatus.PARTIALLY_PAID] },
    dueDate: { $lte: until },
  })
    .sort({ dueDate: 1 })
    .limit(limit)
    .populate({
      path: 'invoiceId',
      select: 'invoiceNumber clientId',
      populate: { path: 'clientId', select: 'companyName' },
    })
    .lean();
  return rows.map((r) => ({ ...installmentView(r), invoice: r.invoiceId }));
}
