import { describe, expect, it } from 'vitest';
import { InstallmentKind, PaymentTerms } from '../src/enums.js';
import { MoneyError, sumMinor } from '../src/money.js';
import { addMonths, allocatePayments, buildSchedule } from '../src/schedule.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('addMonths', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(d('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(addMonths(d('2026-11-15'), 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });
});

describe('buildSchedule', () => {
  it('FULL has a single balance row', () => {
    const rows = buildSchedule({
      totalMinor: 118000,
      paymentTerms: PaymentTerms.FULL,
      dueDate: d('2026-12-01'),
    });
    expect(rows).toEqual([
      { number: 1, kind: InstallmentKind.BALANCE, amountMinor: 118000, dueDate: d('2026-12-01') },
    ]);
  });

  it('ADVANCE_BALANCE records the advance separately', () => {
    const rows = buildSchedule({
      totalMinor: 100000,
      paymentTerms: PaymentTerms.ADVANCE_BALANCE,
      dueDate: d('2026-12-31'),
      advanceMinor: 30000,
      advanceDueDate: d('2026-11-05'),
    });
    expect(rows.map((r) => [r.kind, r.amountMinor])).toEqual([
      ['ADVANCE', 30000],
      ['BALANCE', 70000],
    ]);
  });

  it.each([2, 3, 6, 9, 12])('MONTHLY %i-month plan sums exactly', (months) => {
    const rows = buildSchedule({
      totalMinor: 1000001,
      paymentTerms: PaymentTerms.INSTALLMENTS,
      dueDate: d('2027-12-31'),
      advanceMinor: 200000,
      advanceDueDate: d('2026-11-01'),
      installments: { mode: 'MONTHLY', months, firstDueDate: d('2026-12-10') },
    });
    expect(rows).toHaveLength(months + 1);
    expect(sumMinor(rows.map((r) => r.amountMinor))).toBe(1000001);
    expect(rows[1]!.dueDate.toISOString().slice(0, 10)).toBe('2026-12-10');
    expect(rows.at(-1)!.dueDate.getUTCMonth()).toBe((11 + months - 1) % 12);
  });

  it('CUSTOM plans must add up to the amount after advance', () => {
    const base = {
      totalMinor: 90000,
      paymentTerms: PaymentTerms.INSTALLMENTS,
      dueDate: d('2027-03-01'),
    } as const;
    expect(() =>
      buildSchedule({
        ...base,
        installments: { mode: 'CUSTOM', items: [{ amountMinor: 50000, dueDate: d('2027-01-01') }] },
      }),
    ).toThrow(MoneyError);
    const rows = buildSchedule({
      ...base,
      installments: {
        mode: 'CUSTOM',
        items: [
          { amountMinor: 40000, dueDate: d('2027-02-01') },
          { amountMinor: 50000, dueDate: d('2027-01-01') },
        ],
      },
    });
    expect(rows.map((r) => r.amountMinor)).toEqual([50000, 40000]); // sorted by due date
  });

  it('rejects an advance that is not less than the total', () => {
    expect(() =>
      buildSchedule({
        totalMinor: 1000,
        paymentTerms: PaymentTerms.ADVANCE_BALANCE,
        dueDate: d('2026-12-01'),
        advanceMinor: 1000,
        advanceDueDate: d('2026-11-01'),
      }),
    ).toThrow(MoneyError);
  });
});

describe('allocatePayments', () => {
  it('fills rows oldest-first and reports any excess', () => {
    expect(allocatePayments([300, 350, 350], [500])).toEqual({
      paid: [300, 200, 0],
      unallocated: 0,
    });
    expect(allocatePayments([300, 700], [300, 700, 5])).toEqual({
      paid: [300, 700],
      unallocated: 5,
    });
    expect(allocatePayments([100], [])).toEqual({ paid: [0], unallocated: 0 });
  });
});
