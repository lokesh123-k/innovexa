import {
  InstallmentStatus,
  InvoiceStatus,
  NotificationType,
  TaskStatus,
  formatMoney,
} from '@innovexa/shared';
import { Installment } from '../modules/installments/installment.model';
import { Invoice } from '../modules/invoices/invoice.model';
import { notify, notifyAdmins } from '../modules/notifications/notification.service';
import { clientUserIds } from '../modules/projects/projects.service';
import { Task } from '../modules/tasks/task.model';
import { logger } from '../utils/logger';

const OPEN_TASK = [
  TaskStatus.ASSIGNED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.REVISION_REQUESTED,
  TaskStatus.NOT_STARTED,
];
const OPEN_ROW = [InstallmentStatus.PENDING, InstallmentStatus.PARTIALLY_PAID];

/**
 * Sends deadline and payment reminders once each. Safe to run repeatedly:
 * every reminder is guarded by a "*NotifiedAt" timestamp claimed atomically.
 */
export async function runReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3_600_000);
  let sent = 0;

  for (const t of await Task.find({
    status: { $in: OPEN_TASK },
    dueDate: { $gte: now, $lte: soon },
    dueSoonNotifiedAt: null,
  }).lean()) {
    const claimed = await Task.updateOne(
      { _id: t._id, dueSoonNotifiedAt: null },
      { $set: { dueSoonNotifiedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    await notify({
      recipients: t.assigneeIds,
      type: NotificationType.TASK_DEADLINE_APPROACHING,
      title: `Due soon: ${t.title}`,
      body: `This task is due ${t.dueDate!.toUTCString()}.`,
      link: `/partner/tasks/${t._id.toString()}`,
      email: true,
    });
    sent++;
  }

  for (const t of await Task.find({
    status: { $in: OPEN_TASK },
    dueDate: { $lt: now },
    overdueNotifiedAt: null,
  }).lean()) {
    const claimed = await Task.updateOne(
      { _id: t._id, overdueNotifiedAt: null },
      { $set: { overdueNotifiedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    await notify({
      recipients: t.assigneeIds,
      type: NotificationType.TASK_OVERDUE,
      title: `Overdue: ${t.title}`,
      link: `/partner/tasks/${t._id.toString()}`,
      email: true,
    });
    await notifyAdmins({
      type: NotificationType.TASK_OVERDUE,
      title: `Task overdue: ${t.title}`,
      link: `/admin/tasks/${t._id.toString()}`,
    });
    sent++;
  }

  const payable = await Invoice.find({
    status: { $in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
  })
    .select('_id invoiceNumber clientId')
    .lean();
  const invoiceById = new Map(payable.map((i) => [i._id.toString(), i]));
  const ids = payable.map((i) => i._id);
  const inThreeDays = new Date(now.getTime() + 3 * 86_400_000);

  for (const row of await Installment.find({
    invoiceId: { $in: ids },
    status: { $in: OPEN_ROW },
    dueDate: { $gte: now, $lte: inThreeDays },
    dueSoonNotifiedAt: null,
  }).lean()) {
    const claimed = await Installment.updateOne(
      { _id: row._id, dueSoonNotifiedAt: null },
      { $set: { dueSoonNotifiedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    const inv = invoiceById.get(row.invoiceId.toString())!;
    await notify({
      recipients: await clientUserIds(inv.clientId),
      type: NotificationType.INSTALLMENT_DUE,
      title: `Payment due soon: ${formatMoney(row.amountMinor - row.paidMinor)}`,
      body: `${inv.invoiceNumber} instalment is due on ${row.dueDate.toDateString()}.`,
      link: `/client/invoices/${inv._id.toString()}`,
      email: true,
    });
    sent++;
  }

  for (const row of await Installment.find({
    invoiceId: { $in: ids },
    status: { $in: OPEN_ROW },
    dueDate: { $lt: now },
    overdueNotifiedAt: null,
  }).lean()) {
    const claimed = await Installment.updateOne(
      { _id: row._id, overdueNotifiedAt: null },
      { $set: { overdueNotifiedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    const inv = invoiceById.get(row.invoiceId.toString())!;
    const amount = formatMoney(row.amountMinor - row.paidMinor);
    await notify({
      recipients: await clientUserIds(inv.clientId),
      type: NotificationType.PAYMENT_OVERDUE,
      title: `Payment overdue: ${amount}`,
      body: `${inv.invoiceNumber} instalment was due on ${row.dueDate.toDateString()}.`,
      link: `/client/invoices/${inv._id.toString()}`,
      email: true,
    });
    await notifyAdmins({
      type: NotificationType.PAYMENT_OVERDUE,
      title: `Payment overdue: ${inv.invoiceNumber} (${amount})`,
      link: `/admin/invoices/${inv._id.toString()}`,
    });
    sent++;
  }

  if (sent) logger.info({ sent }, 'Reminders sent');
  return sent;
}

export function startReminderJob(intervalMs = 30 * 60_000) {
  const run = () =>
    runReminders().catch((err: unknown) => logger.error({ err }, 'Reminder job failed'));
  setTimeout(run, 15_000).unref();
  return setInterval(run, intervalMs).unref();
}
