import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@innovexa/shared';
import { PORTAL_HOME, useAuth } from '@/features/auth/AuthProvider';

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Loader2 className="size-6 animate-spin text-brand-700" aria-label="Loading" />
    </div>
  );
}

/**
 * UX-level guard only — the API independently enforces role and ownership on
 * every request. Users hitting another portal are redirected to their own.
 */
export function RequireRole({ role }: { role: Role }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={PORTAL_HOME[user.role]} replace />;
  return <Outlet />;
}

/** Public-only pages (login etc.) bounce signed-in users to their portal. */
export function GuestOnly() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (user) return <Navigate to={PORTAL_HOME[user.role]} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  return <Navigate to={user ? PORTAL_HOME[user.role] : '/login'} replace />;
}
