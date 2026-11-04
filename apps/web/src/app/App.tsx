import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createBrowserRouter,
  Link,
  Navigate,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';
import { Toaster } from 'sonner';
import { Role } from '@innovexa/shared';
import { AdminDashboard } from '@/features/admin/AdminDashboard';
import { AuditLogsPage } from '@/features/admin/AuditLogsPage';
import { AdminInvoiceDetailPage, InvoicesPage } from '@/features/admin/BillingPages';
import { ClientDetailPage, ClientsPage } from '@/features/admin/ClientsPages';
import { PartnerDetailPage } from '@/features/admin/PartnerDetailPage';
import { ProjectDetailPage, ProjectsPage } from '@/features/admin/ProjectsPages';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { AdminTaskDetailPage, AdminTasksPage, ApprovalsPage } from '@/features/admin/TasksPages';
import { UsersPage } from '@/features/admin/UsersPage';
import { AuthProvider } from '@/features/auth/AuthProvider';
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/features/auth/pages';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { InvoiceDetailPage, PaymentHistoryPage, ReceiptPage } from '@/features/billing/shared';
import {
  ChangeRequestDetailPage,
  ChangeRequestsPage,
} from '@/features/change-requests/ChangeRequestsPages';
import {
  ClientDashboard,
  ClientFilesPage,
  ClientInvoicesPage,
  ClientMilestonesPage,
  ClientProjectDetailPage,
  ClientProjectsPage,
  ClientTimelinePage,
  CompletedWorkPage,
  PendingWorkPage,
} from '@/features/clients/ClientPages';
import { MessagesPage } from '@/features/messages/MessagesPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import {
  PartnerDashboard,
  PartnerProjectDetailPage,
  PartnerClientsPage,
  PartnerProjectsPage,
  PartnerTaskDetailPage,
  PartnerTasksPage,
  PerformancePage,
  SubmissionsPage,
  TimeTrackingPage,
  WorkReportsPage,
} from '@/features/partners/PartnerPages';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { PortalLayout } from '@/layouts/PortalLayout';
import { SocketProvider } from '@/lib/socket';
import { GuestOnly, HomeRedirect, RequireRole } from '@/routes/guards';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        const status = (error as { response?: { status?: number } }).response?.status;
        return status !== undefined && status < 500 ? false : count < 2;
      },
    },
  },
});

function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <p className="text-sm font-semibold text-brand-700">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
        <Link
          to="/"
          className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline"
        >
          Go to your dashboard
        </Link>
      </div>
    </div>
  );
}

/** A portal: role guard → layout → pages. The API enforces the same rules server-side. */
const portal = (role: Role, children: RouteObject[]): RouteObject => ({
  path: `/${role.toLowerCase()}`,
  element: <RequireRole role={role} />,
  children: [
    {
      element: <PortalLayout />,
      children: [
        { index: true, element: <Navigate to="dashboard" replace /> },
        ...children,
        { path: 'messages', element: <MessagesPage /> },
        { path: 'notifications', element: <NotificationsPage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
});

const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Token links work whether or not someone is signed in on this browser.
  { path: '/accept-invitation', element: <AcceptInvitationPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  portal(Role.ADMIN, [
    { path: 'dashboard', element: <AdminDashboard /> },
    { path: 'partners', element: <UsersPage fixedRole={Role.PARTNER} key="partners" /> },
    { path: 'partners/:id', element: <PartnerDetailPage /> },
    { path: 'users', element: <UsersPage key="users" /> },
    { path: 'clients', element: <ClientsPage /> },
    { path: 'clients/:id', element: <ClientDetailPage /> },
    { path: 'projects', element: <ProjectsPage /> },
    { path: 'projects/:id', element: <ProjectDetailPage /> },
    { path: 'tasks', element: <AdminTasksPage /> },
    { path: 'tasks/:id', element: <AdminTaskDetailPage /> },
    { path: 'approvals', element: <ApprovalsPage /> },
    { path: 'change-requests', element: <ChangeRequestsPage /> },
    { path: 'change-requests/:id', element: <ChangeRequestDetailPage /> },
    { path: 'invoices', element: <InvoicesPage /> },
    { path: 'invoices/:id', element: <AdminInvoiceDetailPage /> },
    { path: 'receipts/:id', element: <ReceiptPage /> },
    { path: 'reports', element: <ReportsPage /> },
    { path: 'audit-logs', element: <AuditLogsPage /> },
    { path: 'settings', element: <SettingsPage /> },
  ]),
  portal(Role.PARTNER, [
    { path: 'dashboard', element: <PartnerDashboard /> },
    { path: 'projects', element: <PartnerProjectsPage /> },
    { path: 'clients', element: <PartnerClientsPage /> },
    { path: 'projects/:id', element: <PartnerProjectDetailPage /> },
    { path: 'tasks', element: <PartnerTasksPage /> },
    { path: 'tasks/:id', element: <PartnerTaskDetailPage /> },
    { path: 'daily-updates', element: <WorkReportsPage /> },
    { path: 'time', element: <TimeTrackingPage /> },
    { path: 'submissions', element: <SubmissionsPage /> },
    { path: 'reports', element: <PerformancePage /> },
  ]),
  portal(Role.CLIENT, [
    { path: 'dashboard', element: <ClientDashboard /> },
    { path: 'projects', element: <ClientProjectsPage /> },
    { path: 'projects/:id', element: <ClientProjectDetailPage /> },
    { path: 'timeline', element: <ClientTimelinePage /> },
    { path: 'milestones', element: <ClientMilestonesPage /> },
    { path: 'completed-work', element: <CompletedWorkPage /> },
    { path: 'pending-work', element: <PendingWorkPage /> },
    { path: 'files', element: <ClientFilesPage /> },
    { path: 'change-requests', element: <ChangeRequestsPage /> },
    { path: 'change-requests/:id', element: <ChangeRequestDetailPage /> },
    { path: 'invoices', element: <ClientInvoicesPage /> },
    { path: 'invoices/:id', element: <InvoiceDetailPage /> },
    { path: 'payments', element: <PaymentHistoryPage /> },
    { path: 'receipts/:id', element: <ReceiptPage /> },
  ]),
  { path: '*', element: <NotFound /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <RouterProvider router={router} />
        </SocketProvider>
      </AuthProvider>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
