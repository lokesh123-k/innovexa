import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CalendarRange,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Clock,
  CreditCard,
  FileClock,
  FileText,
  FolderKanban,
  GitPullRequest,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Milestone,
  Send,
  Settings,
  ShieldCheck,
  Timer,
  TrendingUp,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Role } from '@innovexa/shared';
import { Logo } from '@/components/Logo';
import { Avatar } from '@/components/ui/misc';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useUnreadMessages,
  useUnreadNotifications,
} from '@/features/notifications/NotificationsPage';
import { cn, humanize } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: 'messages' | 'notifications';
}

const NAV: Record<Role, NavItem[]> = {
  [Role.ADMIN]: [
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/partners', label: 'Partners', icon: Briefcase },
    { to: '/admin/users', label: 'Users & Access', icon: Users },
    { to: '/admin/clients', label: 'Clients', icon: Building2 },
    { to: '/admin/projects', label: 'Projects', icon: FolderKanban },
    { to: '/admin/tasks', label: 'Tasks & Assignments', icon: ClipboardList },
    { to: '/admin/approvals', label: 'Work Approvals', icon: CheckSquare },
    { to: '/admin/change-requests', label: 'Change Requests', icon: GitPullRequest },
    { to: '/admin/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' },
    { to: '/admin/invoices', label: 'Invoices & Payments', icon: CreditCard },
    { to: '/admin/reports', label: 'Reports & Analytics', icon: BarChart3 },
    { to: '/admin/audit-logs', label: 'Audit Logs', icon: ShieldCheck },
    { to: '/admin/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/admin/profile', label: 'My Profile', icon: UserCircle },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ],
  [Role.PARTNER]: [
    { to: '/partner/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/partner/projects', label: 'My Projects', icon: FolderKanban },
    { to: '/partner/clients', label: 'My Clients', icon: Building2 },
    { to: '/partner/tasks', label: 'My Tasks', icon: ClipboardList },
    { to: '/partner/daily-updates', label: 'Daily Work Updates', icon: FileClock },
    { to: '/partner/time', label: 'Time Tracking', icon: Timer },
    { to: '/partner/submissions', label: 'Work Submission', icon: Send },
    { to: '/partner/reports', label: 'Reports', icon: TrendingUp },
    { to: '/partner/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' },
    { to: '/partner/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/partner/profile', label: 'My Profile', icon: UserCircle },
  ],
  [Role.CLIENT]: [
    { to: '/client/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/client/projects', label: 'My Projects', icon: FolderKanban },
    { to: '/client/timeline', label: 'Project Timeline', icon: CalendarRange },
    { to: '/client/milestones', label: 'Milestones', icon: Milestone },
    { to: '/client/completed-work', label: 'Completed Work', icon: CheckCircle2 },
    { to: '/client/pending-work', label: 'Pending Work', icon: Clock },
    { to: '/client/files', label: 'Files & Deliverables', icon: FileText },
    { to: '/client/change-requests', label: 'Change Requests', icon: GitPullRequest },
    { to: '/client/invoices', label: 'Invoices & Payments', icon: CreditCard },
    { to: '/client/payments', label: 'Payment History', icon: History },
    { to: '/client/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' },
    { to: '/client/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/client/profile', label: 'My Profile', icon: UserCircle },
  ],
};

const PORTAL_NAME: Record<Role, string> = {
  [Role.ADMIN]: 'Admin Portal',
  [Role.PARTNER]: 'Partner Portal',
  [Role.CLIENT]: 'Client Portal',
};

function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const messages = useUnreadMessages();
  const notifications = useUnreadNotifications();
  const counts = { messages: messages.data ?? 0, notifications: notifications.data ?? 0 };
  return (
    <div className="flex h-full flex-col bg-navy-900 text-brand-100">
      <div className="flex justify-center px-5 pb-4 pt-5">
        <Logo size="lg" className="ring-1 ring-white/10" />
      </div>
      <div className="px-5 pb-3 text-[11px] font-semibold uppercase tracking-wider text-brand-300/80">
        {PORTAL_NAME[role]}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV[role].map((item) => {
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-brand-100/80 hover:bg-white/5 hover:text-white',
                )
              }
            >
              <item.icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {count > 0 && (
                <span className="rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export function PortalLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const notifications = useUnreadNotifications();
  if (!user) return null;
  const base = `/${user.role.toLowerCase()}`;

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen lg:pl-64 print:pl-0">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block print:hidden">
        <Sidebar role={user.role} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Sidebar role={user.role} onNavigate={() => setMobileOpen(false)} />
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-md p-1 text-brand-100 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 print:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <Link to={`${base}/dashboard`} aria-label="Go to dashboard" className="shrink-0">
          <Logo size="sm" />
        </Link>
        <div className="flex-1" />
        <Link
          to={`${base}/notifications`}
          className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell className="size-5" />
          {!!notifications.data && (
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {notifications.data > 9 ? '9+' : notifications.data}
            </span>
          )}
        </Link>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium leading-tight text-slate-900">{user.name}</div>
            <div className="text-xs text-slate-500">{humanize(user.role)}</div>
          </div>
          <Avatar name={user.name} />
          <button
            onClick={signOut}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:p-0">
        <Outlet />
      </main>
    </div>
  );
}
