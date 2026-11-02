import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  formatMoney,
  fromMinor,
  invoiceTotal,
  outstanding,
  percentOf,
  splitEvenly,
  sumMinor,
  toMinor,
} from '../src/money.js';

describe('toMinor / fromMinor', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1.5', 150],
    ['1234.50', 123450],
    ['1,00,000.99', 10000099],
    ['0.10', 10],
    ['-12.34', -1234],
    [99.99, 9999],
    ['5.100', 510],
  ] as const)('parses %s', (input, expected) => {
    expect(toMinor(input)).toBe(expected);
  });

  it('rejects more than 2 significant decimals and garbage', () => {
    expect(() => toMinor('1.234')).toThrow(MoneyError);
    expect(() => toMinor('abc')).toThrow(MoneyError);
    expect(() => toMinor(0.1 + 0.2)).toThrow(MoneyError);
    expect(() => toMinor(Number.NaN)).toThrow(MoneyError);
  });

  it('round-trips', () => {
    for (const s of ['0.00', '0.05', '10.00', '123456789.01', '-3.40']) {
      expect(fromMinor(toMinor(s))).toBe(s);
    }
  });

  it('formats INR with Indian grouping', () => {
    expect(formatMoney(12345678)).toBe('₹1,23,456.78');
    expect(formatMoney(-50)).toBe('-₹0.50');
  });
});

describe('arithmetic', () => {
  it('sums exactly where floats would drift', () => {
    const tenths = Array.from({ length: 10 }, () => toMinor('0.10'));
    expect(sumMinor(tenths)).toBe(100);
  });

  it('rejects non-integer minor units', () => {
    expect(() => sumMinor([1.5])).toThrow(MoneyError);
  });

  it('computes invoice totals', () => {
    expect(
      invoiceTotal({ contractAmountMinor: 100000, taxMinor: 18000, discountMinor: 5000 }),
    ).toBe(113000);
    expect(() => invoiceTotal({ contractAmountMinor: 100, discountMinor: 200 })).toThrow(
      MoneyError,
    );
    expect(() => invoiceTotal({ contractAmountMinor: -1 })).toThrow(MoneyError);
  });

  it('computes percentages with half-up rounding', () => {
    expect(percentOf(100000, 1800)).toBe(18000); // 18% of 1000.00
    expect(percentOf(333, 1800)).toBe(60); // 59.94 -> 60
    expect(percentOf(1, 5000)).toBe(1); // 0.5 -> 1
  });

  it('splits instalments so parts sum exactly', () => {
    expect(splitEvenly(100000, 3)).toEqual([33334, 33333, 33333]);
    for (const n of [2, 3, 6, 9, 12]) {
      const parts = splitEvenly(9999999, n);
      expect(parts).toHaveLength(n);
      expect(sumMinor(parts)).toBe(9999999);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    }
  });

  it('computes outstanding net of refunds', () => {
    expect(outstanding(113000, 50000)).toBe(63000);
    expect(outstanding(113000, 113000, 13000)).toBe(13000);
  });
});
