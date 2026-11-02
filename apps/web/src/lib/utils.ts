import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (value?: string | Date | null) =>
  value ? dateFmt.format(new Date(value)) : '—';
export const formatDateTime = (value?: string | Date | null) =>
  value ? dateTimeFmt.format(new Date(value)) : '—';

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

const ACRONYMS = new Set(['UPI', 'EMI', 'SEO', 'AI', 'UI', 'UX', 'GST']);

/** "BANK_TRANSFER" → "Bank Transfer"; known acronyms stay upper-case ("UPI"). */
export const humanize = (value: string) =>
  value
    .split('_')
    .filter(Boolean)
    .map((w) =>
      ACRONYMS.has(w.toUpperCase())
        ? w.toUpperCase()
        : w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(' ');
