import { toast } from 'sonner';
import { cn, formatDateTime } from '@/lib/utils';
import type { User } from '@/types';

/** Delivery outcome of the latest invitation email, for INVITED users. */
export function InviteEmailStatus({ user, className }: { user: User; className?: string }) {
  const e = user.invitationEmail;
  if (user.status !== 'INVITED' || !e) return null;
  const tone =
    e.status === 'SENT'
      ? 'text-emerald-700'
      : e.status === 'FAILED'
        ? 'text-red-600'
        : 'text-amber-700';
  const label =
    e.status === 'SENT'
      ? `Invite email sent ${formatDateTime(e.at)}`
      : e.status === 'FAILED'
        ? `Invite email failed: ${e.error ?? 'delivery error'}`
        : 'Invite email not sent (email not configured)';
  return (
    <div className={cn('mt-1 max-w-xs text-xs', tone, className)} title={e.error}>
      {label}
    </div>
  );
}

/** Toast that reflects what really happened to the invitation email. */
export function announceInvite(user: Pick<User, 'email' | 'invitationEmail'>) {
  const e = user.invitationEmail;
  if (e?.status === 'SENT') {
    toast.success(`Invitation email sent to ${user.email}`);
  } else if (e?.status === 'FAILED') {
    toast.error(
      `Account created, but the invitation email was NOT sent: ${e.error ?? 'delivery error'}`,
      {
        description: 'Fix the email settings, then use “Resend”.',
        duration: 12_000,
      },
    );
  } else {
    toast.warning(
      `Account created for ${user.email}, but no email was sent (email not configured).`,
      {
        duration: 10_000,
      },
    );
  }
}
