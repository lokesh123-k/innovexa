/**
 * Money helpers. All amounts are integer minor units (e.g. paise). Never use
 * floating-point arithmetic on totals — conversion happens only at the edges
 * by string parsing/formatting.
 */

export const MINOR_UNITS = 2;
const SCALE = 10 ** MINOR_UNITS;

export class MoneyError extends Error {}

export function assertMinor(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units`);
  }
  return value;
}

/** Parse a decimal string or number such as "1234.5" into minor units (123450). */
export function toMinor(input: string | number): number {
  const str = typeof input === 'number' ? numberToPlainString(input) : input.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str.replace(/,/g, ''));
  if (!match) throw new MoneyError(`Invalid amount: "${input}"`);
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > MINOR_UNITS && /[1-9]/.test(fraction.slice(MINOR_UNITS))) {
    throw new MoneyError(`Amount "${input}" has more than ${MINOR_UNITS} decimal places`);
  }
  const minor =
    Number(whole) * SCALE + Number(fraction.slice(0, MINOR_UNITS).padEnd(MINOR_UNITS, '0'));
  assertMinor(minor);
  return sign && minor !== 0 ? -minor : minor;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new MoneyError(`Invalid amount: ${n}`);
  // toFixed with extra digits then let toMinor reject anything beyond 2 dp.
  const s = String(n);
  if (/e/i.test(s)) throw new MoneyError(`Amount out of range: ${n}`);
  return s;
}

/** Format minor units as a plain decimal string: 123450 -> "1234.50". */
export function fromMinor(minor: number): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / SCALE);
  const fraction = String(abs % SCALE).padStart(MINOR_UNITS, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Locale display, e.g. "₹1,234.50". Uses integer parts only, never float division. */
export function formatMoney(minor: number, currency = 'INR', locale = 'en-IN'): string {
  const [whole = '0', fraction = '00'] = fromMinor(minor).replace('-', '').split('.');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(whole));
  const symbol =
    new Intl.NumberFormat(locale, { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency;
  return `${minor < 0 ? '-' : ''}${symbol}${grouped}.${fraction}`;
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total = assertMinor(total + assertMinor(v), 'sum');
  return total;
}

/** Invoice total = contract + tax − discount; must not go negative. */
export function invoiceTotal(parts: {
  contractAmountMinor: number;
  taxMinor?: number;
  discountMinor?: number;
}): number {
  const { contractAmountMinor, taxMinor = 0, discountMinor = 0 } = parts;
  [contractAmountMinor, taxMinor, discountMinor].forEach((v) => {
    assertMinor(v);
    if (v < 0) throw new MoneyError('Invoice components cannot be negative');
  });
  const total = contractAmountMinor + taxMinor - discountMinor;
  if (total < 0) throw new MoneyError('Discount cannot exceed contract amount plus tax');
  return total;
}

/** Percentage of an amount in basis points (1% = 100 bp), rounded half-up to the minor unit. */
export function percentOf(minor: number, basisPoints: number): number {
  assertMinor(minor);
  assertMinor(basisPoints, 'basisPoints');
  const product = BigInt(minor) * BigInt(basisPoints);
  const q = product / 10000n;
  const r = product % 10000n;
  return Number(r * 2n >= 10000n ? q + 1n : q);
}

/**
 * Split an amount into `count` equal parts; the remainder (in minor units) is
 * added one unit at a time to the earliest parts so the parts sum exactly.
 */
export function splitEvenly(totalMinor: number, count: number): number[] {
  assertMinor(totalMinor);
  if (!Number.isInteger(count) || count < 1)
    throw new MoneyError('count must be a positive integer');
  if (totalMinor < 0) throw new MoneyError('Cannot split a negative amount');
  const base = Math.floor(totalMinor / count);
  const remainder = totalMinor - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Outstanding = total − net paid (paid minus refunds), floored at 0 for display of credit separately. */
export function outstanding(totalMinor: number, paidMinor: number, refundedMinor = 0): number {
  const net = assertMinor(paidMinor) - assertMinor(refundedMinor);
  return assertMinor(totalMinor) - net;
}
