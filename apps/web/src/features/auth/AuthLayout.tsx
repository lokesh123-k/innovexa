import { CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';

const HIGHLIGHTS = [
  'Track every project, milestone and task in one place',
  'Approved progress and payment schedules for clients',
  'Daily work, time tracking and reviews for partners',
];

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-navy-900 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-brand-600/30 blur-3xl"
        />
        <Logo size="xl" className="relative ring-1 ring-white/10" />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            The operating system for Innovexa Digital projects.
          </h2>
          <ul className="mt-8 space-y-3 text-sm text-brand-100">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-300" />
                {h}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-200/70">
          © {new Date().getFullYear()} Innovexa Digital
        </p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size="md" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
