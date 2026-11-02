import { InstallmentKind, PaymentTerms } from './enums.js';
import { MoneyError, assertMinor, splitEvenly, sumMinor } from './money.js';

export interface ScheduleRow {
  number: number;
  kind: InstallmentKind;
  amountMinor: number;
  dueDate: Date;
}

export type InstallmentPlan =
  | { mode: 'MONTHLY'; months: number; firstDueDate: Date }
  | { mode: 'CUSTOM'; items: { amountMinor: number; dueDate: Date }[] };

export interface ScheduleInput {
  totalMinor: number;
  paymentTerms: PaymentTerms;
  dueDate: Date;
  advanceMinor?: number;
  advanceDueDate?: Date;
  installments?: InstallmentPlan;
}

/** Same day-of-month `n` months later, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * Builds the payment schedule for an invoice. The rows always sum exactly to
 * the invoice total. This is an internal instalment schedule, not bank/card EMI.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const total = assertMinor(input.totalMinor, 'total');
  const advance = assertMinor(input.advanceMinor ?? 0, 'advance');
  if (total <= 0) throw new MoneyError('Invoice total must be greater than zero');
  if (advance < 0 || (advance > 0 && advance >= total)) {
    throw new MoneyError('Advance must be less than the invoice total');
  }

  const rows: ScheduleRow[] = [];
  const pushAdvance = () => {
    if (advance > 0) {
      if (!input.advanceDueDate) throw new MoneyError('Advance due date is required');
      rows.push({
        number: 0,
        kind: InstallmentKind.ADVANCE,
        amountMinor: advance,
        dueDate: input.advanceDueDate,
      });
    }
  };

  switch (input.paymentTerms) {
    case PaymentTerms.FULL:
      if (advance) throw new MoneyError('Full payment invoices have no separate advance');
      rows.push({
        number: 1,
        kind: InstallmentKind.BALANCE,
        amountMinor: total,
        dueDate: input.dueDate,
      });
      break;
    case PaymentTerms.ADVANCE_BALANCE:
      if (advance <= 0) throw new MoneyError('Advance + balance invoices need an advance amount');
      pushAdvance();
      rows.push({
        number: 1,
        kind: InstallmentKind.BALANCE,
        amountMinor: total - advance,
        dueDate: input.dueDate,
      });
      break;
    case PaymentTerms.INSTALLMENTS: {
      const plan = input.installments;
      if (!plan) throw new MoneyError('Instalment plan is required');
      pushAdvance();
      const remaining = total - advance;
      if (plan.mode === 'MONTHLY') {
        if (!Number.isInteger(plan.months) || plan.months < 2 || plan.months > 36) {
          throw new MoneyError('Monthly plans must have between 2 and 36 instalments');
        }
        splitEvenly(remaining, plan.months).forEach((amountMinor, i) =>
          rows.push({
            number: i + 1,
            kind: InstallmentKind.INSTALLMENT,
            amountMinor,
            dueDate: addMonths(plan.firstDueDate, i),
          }),
        );
      } else {
        if (plan.items.length < 1 || plan.items.length > 36) {
          throw new MoneyError('Custom plans need between 1 and 36 instalments');
        }
        const sum = sumMinor(plan.items.map((i) => i.amountMinor));
        if (sum !== remaining) {
          throw new MoneyError(
            `Custom instalments must add up to the amount after advance (${remaining}), got ${sum}`,
          );
        }
        [...plan.items]
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
          .forEach((item, i) => {
            if (item.amountMinor <= 0)
              throw new MoneyError('Each instalment must be greater than zero');
            rows.push({
              number: i + 1,
              kind: InstallmentKind.INSTALLMENT,
              amountMinor: item.amountMinor,
              dueDate: item.dueDate,
            });
          });
      }
      break;
    }
  }
  if (sumMinor(rows.map((r) => r.amountMinor)) !== total) {
    throw new MoneyError('Schedule does not add up to the invoice total');
  }
  return rows;
}

/**
 * Allocates verified payments to schedule rows oldest-first. Deterministic, so
 * instalment balances can always be recomputed from the payment ledger.
 */
export function allocatePayments(dues: readonly number[], payments: readonly number[]) {
  const paid = dues.map(() => 0);
  let pool = sumMinor(payments);
  dues.forEach((due, i) => {
    const take = Math.min(due, pool);
    paid[i] = take;
    pool -= take;
  });
  return { paid, unallocated: pool };
}
