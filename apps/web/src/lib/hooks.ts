import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** YYYY-MM-DD for <input type="date"> from a Date/ISO string. */
export const toDateInput = (value?: string | Date | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : '';

/** Converts a date input value to an ISO string at UTC midnight (or undefined). */
export const fromDateInput = (value: string) =>
  value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined;
