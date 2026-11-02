# Development Progress

## Phase 1: Foundation (complete, 2026-10-31)

### Delivered

- **Monorepo**: npm workspaces (`apps/api`, `apps/web`, `packages/shared`), shared TS config, ESLint 9 flat config, Prettier, `.env.example`, `.gitignore`, full folder structure for every planned module.
- **Planning docs**: architecture, MongoDB schema plan, API contract, roadmap and security risks in `docs/`.
- **`@innovexa/shared`**:
  - single-source enums for roles, statuses, partner types and notifications
  - money helpers: integer minor units, string parsing, exact instalment splitting, basis-point percentages
  - weighted project-progress calculation
  - Zod schemas for auth and users
- **API foundation**:
  - Zod-validated env config with production safety checks
  - helmet, CORS allowlist, Origin-based CSRF guard, rate limiting
  - JSON error envelope, pino logging with secret redaction, health endpoint, graceful shutdown
- **All 21 Mongoose models with indexes**: User, RefreshSession, AuthToken, AuditLog, Client, ServiceCategory, Project, Milestone, Task, TaskUpdate, WorkReport, Conversation, Message, ChangeRequest, Invoice, Installment, Payment, WebhookEvent, File, Notification, Counter. Money fields reject non-integers at the schema level.
- **Auth module**:
  - login with uniform errors, timing equalisation and lockout
  - access JWT cookie plus rotating refresh token with family reuse detection
  - logout and logout-all
  - invitation signup, forgot/reset password, email verification, change password
- **Users module (admin)**: list/search/filter/paginate, invite (admin, partner, client), resend invite, edit, activate/deactivate (revokes sessions instantly), self-service profile. The partner hourly rate is visible to admins only.
- **Audit log**: written on every auth and user mutation, secrets scrubbed, admin query endpoint.
- **Seed script**: demo admin, 2 partners, client, and the 11 default service categories. No hardcoded passwords; refuses to run in production.

### Tests executed

| Suite | Result |
|---|---|
| `packages/shared`: money (18) and progress (7) | ✅ 25 / 25 |
| `apps/api` auth: login, lockout, rotation and reuse, logout-all, invitation, reset, verify, change password (18) | ✅ 18 / 18 |
| `apps/api` users: RBAC for partner and client, filters, deactivation, audit scrubbing (11) | ✅ 11 / 11 |
| `apps/api` security: headers, CORS, CSRF guard, malformed JSON, operator injection, rate limiting (6) | ✅ 6 / 6 |
| `npm run typecheck`, `npm run lint`, `npm run build -w @innovexa/api` | ✅ clean |
| Manual smoke: built `dist/server.js` with seed data and curl (health, login, me, list, refresh, partner→403) | ✅ |
| Production config guard: weak secret, insecure cookie and http origin are refused at boot | ✅ |

### Known issues and follow-ups

- **No MongoDB Atlas connection has been tested yet.** Everything ran against MongoDB 7.0 in memory. Atlas needs a real `MONGODB_URI` in `.env`.
- SMTP delivery is untested. The `smtp` transport is wired up but needs provider credentials.
- `npm audit` reports 4 advisories in **dev-only** tooling (vitest/@vitest/mocker, esbuild, minimatch through eslint). Production dependencies have 0 advisories. Revisit when upgrading to Vitest 4 / ESLint 10.
- Two browser tabs refreshing at the same instant will trip refresh-reuse detection. The web client must single-flight `/auth/refresh` (Phase 2).

## Phase 2a: Web shell (complete, 2026-10-31)

- **Stack:** React 19, Vite 7, Tailwind 4, React Router 7, TanStack Query, React Hook Form + Zod (the shared schemas), sonner toasts.
- **UI components:** shadcn-style Button, Input/Select/Field, Card, Badge, Dialog, Skeleton, EmptyState, PageHeader and Avatar. Navy and blue brand palette.
- **Auth pages:** login, accept invitation, forgot and reset password, verify email.
- **Session handling:** Axios client with single-flight refresh on 401, which also fixes the two-tab rotation issue from Phase 1.
- **Routing:** route guards per role; each user lands in their own portal.
- **Portals:** responsive sidebar layout for all three, with a mobile drawer.
- **Admin pages:**
  - dashboard with live counts, partner mix and recent activity
  - Partners page and Users & access page: search, filters, pagination, invite dialog, resend invite, activate/deactivate with confirmation
  - Audit logs page
- **Partner and Client portals:** dashboards with honest empty states, plus a shared Profile page (edit details, change password, sign out everywhere).
- **Root scripts:** `npm run dev` (API + web), `npm run dev:all` (+ local DB), `npm start` (production build + preview).
- **Verified:** typecheck, lint and production build all pass. A self-cleaning end-to-end smoke test passed 8/8 through the Vite proxy: SPA deep link, login, cookie session, invite, accept invitation, partner 403, refresh rotation.
- **Known:** the web bundle is 932 KB (276 KB gzipped). Route-level code splitting will come with the larger modules.

## Phases 2b–6: Complete three-portal implementation (2026-10-31)

### Model mapping (no duplicate models)

| Requested model | Implemented as |
|---|---|
| PartnerProfile | `User.partnerProfile` (embedded; the hourly rate is admin-only) |
| ClientProfile | `Client` (company record) + `User` with role CLIENT and `clientId` |
| ProjectMilestone | `Milestone` |
| WorkUpdate / WorkSubmission | `TaskUpdate`, `kind` = PROGRESS / SUBMISSION / ISSUE / CLARIFICATION |
| ActivityLog | `AuditLog` |
| Project, Task, Invoice, Installment, Payment, Message, Conversation, Notification, ChangeRequest, File, WorkReport, WebhookEvent | as named |

### Backend (all routes enforce role and ownership on the server)

- **Central access policy** (`utils/access.ts`):
  - partners only see projects they are allocated to and tasks assigned to them
  - clients only see their own client's projects, invoices, payments, change requests and threads
  - inaccessible records return 404 rather than 403, so their existence isn't leaked
- **Clients:** CRUD, login invitations, activate/deactivate (cascades to logins and revokes sessions), and a 360° summary (projects, invoices, advance, balance, upcoming instalments).
- **Service categories:** defaults are seeded on boot; admins can add or deactivate categories.
- **Projects:**
  - CRUD with PRJ-#### codes, milestones and partner allocation
  - role-specific views: clients never see budget, internal notes, team or submitted progress
  - timeline and completed/pending work views
- **Progress:** server-side weighted approved progress with history; recalculated on approve, cancel, reopen and weight changes.
- **Tasks:**
  - create, edit, assign and reassign
  - partner progress updates, submissions and issue/clarification reports
  - admin review (approve with partial progress, or request revision with a required comment), cancel and reopen, review queue
  - partners can never review; submitting, approving and requesting a revision is a strict state machine
- **Work reports:** daily and weekly reports (one per day/period), admin filters, time-tracking aggregates.
- **Files:**
  - type allowlist (no SVG or HTML) and a size limit
  - randomized keys on local storage behind an interface
  - downloads authorized by the parent record and sent as `Content-Disposition: attachment`
  - admins publish deliverables to clients
- **Billing:**
  - invoices numbered INV-YYYY-#### with exact paise maths
  - Full / Advance + Balance / EMI schedules (2/3/6/9/12 months or custom), draft then issue, cancel
  - offline payments: advance first, then oldest instalment; overpayment rejected; RCP-YYYY-#### receipts
  - Razorpay: server-side order creation, checkout signature verification, webhook HMAC check, idempotent processing via the `WebhookEvent` unique key plus a once-only succeeded transition, amount-mismatch guard
  - balances are always recomputed from the payment ledger
- **Change requests:** client submissions with attachments, admin status changes and notes, threaded replies, change orders that affect the contract only after admin approval, convert to task.
- **Messaging:**
  - admin ↔ partner and admin ↔ client threads (general or project-linked)
  - attachments, read receipts, unread counts and an online indicator
  - partners and clients can never see each other's threads
- **Notifications:** persisted, pushed in real time over Socket.IO (cookie-authenticated, Origin-checked), emailed for key events, read/unread.
- **Reminder job (every 30 min):** due-soon and overdue tasks, instalment due and payment overdue. Each reminder is sent once, guarded by atomically claimed timestamps.
- **Dashboards** for admin, partner and client, plus an admin partner overview and settings status.
- **Reports:** project completion, partner productivity, work reports, overdue tasks, revenue/collections/outstanding. Filters, CSV with formula-injection protection, and printable view.

### Frontend

- **Admin portal (15 menu items):** Dashboard (Recharts collections chart), Partners (+ profile page with tasks, allocations, reports, progress, edit, assign), Users & Access, Clients (+ 360° page), Projects (+ milestones, tasks, files, invoices), Tasks & Assignments (list and board), Work Approvals, Change Requests, Messages, Invoices & Payments (builder with live schedule preview using the server's own maths, record payment, receipts), Reports & Analytics, Audit Logs, Notifications, My Profile, Settings.
- **Partner portal:** Dashboard, My Projects, My Tasks (board/list, task detail with 0/10/25/50/75/90/100% or custom progress, hours, files, submit, ask/report, feedback), Daily Work Updates, Time Tracking (chart), Work Submission, Reports (performance), Messages, Notifications, My Profile.
- **Client portal:** Dashboard, My Projects, Project Timeline, Milestones, Completed Work, Pending Work, Files & Deliverables, Change Requests, Invoices & Payments (EMI schedule, online pay when Razorpay is configured), Payment History, printable receipts, Messages, Notifications, My Profile.
- **Routing:** each role lands on `/{role}/dashboard`.
- **UI details:** realtime toasts and unread badges, loading skeletons, empty states, confirmation dialogs, mobile drawer navigation, print styles.

### Tests

| Suite | Result |
|---|---|
| Shared (money, progress, schedule/allocation) | ✅ 36 / 36 |
| API integration (in-memory MongoDB) | ✅ 42 / 42 |
| `workflow.test.ts`: full Part 9 lifecycle, isolation, webhook duplicates, reports reconciliation, reminders | ✅ |
| Browser (Playwright, against the running app and the configured Atlas DB) | ✅ 5 / 5 |
| `e2e/portals.spec.ts`: 3 logins and menus, API role blocks, partner UI update and submit, admin UI approval, client sees 100%, change request and reply, EMI invoice, payment, receipt, realtime chat both ways, notifications | ✅ |
| Typecheck, lint, production build | ✅ |

### Known limitations and next steps

- **Razorpay:** live order creation is only tested with a mocked gateway response. Real checkout needs test keys in `.env`. Signature and webhook logic are tested.
- **File storage** is local disk (`apps/api/uploads`). Add a Cloudinary/S3 provider before deploying to ephemeral hosting.
- **Email** uses the `log` transport in development; configure SMTP to deliver.
- **Data from browser tests:** each run of `e2e/portals.spec.ts` creates uniquely named "E2E …" projects, tasks and invoices in the configured database.
- **Bundle size:** the web bundle should get route-level code splitting.
- **Phase 7 (deployment):** hosting configs, monitoring, backups and a deployment runbook.

## Single login, role-based portals: hardening (2026-11-01)

- **Verified, unchanged:**
  - one `/login` page; the role is always read from the database (a role sent by the browser is ignored)
  - ADMIN, PARTNER and CLIENT land on `/admin/dashboard`, `/partner/dashboard` and `/client/dashboard`
  - other portals redirect to the user's own dashboard; the API returns 403 for the same requests
  - accounts are invitation-only (no self-registration, so no self-made ADMIN), with duplicate emails rejected
- **Fixed: two tabs refreshing at once logged the user out everywhere.** The server now treats a rotated refresh token re-presented within `REFRESH_REUSE_GRACE_SECONDS` (default 30) as a multi-tab race, not theft. Revoked tokens never qualify, and theft detection still applies after the window.
- **Fixed: the client could retry refresh several times after a session ended.** After one failed refresh the client stops refreshing until the next successful response.
- **Rate limits:**
  - sign-in now counts **failed** attempts only (20 per 15 min per IP, plus the per-account lockout)
  - token endpoints stay strict
  - the general API budget is `RATE_LIMIT_PER_15_MIN` (default 3,000, was 600), so offices behind one IP aren't throttled
- **Tests:** API 44/44 (new: two-tab refresh, failed-only login limit). Browser 14/14, including the new `e2e/roles.spec.ts`: three role logins, persistence, cross-portal redirects, backend 403s, wrong password, unknown account, inactive account, logout invalidation, and silent renewal vs. expired session.

## Email delivery via SMTP / Gmail (2026-11-01)

- **Settings:**
  - `SENDER_EMAIL` / `SENDER_PASSWORD` are the SMTP login (`SMTP_USER` / `SMTP_PASS` still accepted)
  - `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_SECURE=false` use STARTTLS (required for remote hosts)
  - `EMAIL_FROM` sets the display name; with Gmail the address is `SENDER_EMAIL`
  - spaces in Gmail App Passwords are stripped
- **Delivery status:**
  - an invitation is `SENT` only when the mail server accepts it; `FAILED` stores a safe reason, and `NOT_SENT` means the `log` transport
  - the outcome is stored on the user and shown in Users & Access, Partners and client logins, with honest toasts
  - resend returns 502 on failure
- **Checks:** SMTP is verified at startup; Settings shows the live status and has a "Send test email" button; `npm run email:test` runs the same check from the command line.
- **Secrets:** passwords never appear in responses or logs; invitation and reset tokens are redacted from the log transport and from request-log URLs.
- **Forgot-password** responds identically whether or not delivery fails (no account enumeration).
- **Tests:** 9 new SMTP tests against an in-process authenticated SMTP server (partner and client invites, link → password setup → active, failure handling, test email, log redaction). API 53/53; browser 13/13 for login and roles.
- **Pending:** real Gmail delivery is untested until the `SENDER_*` values are added to `.env`.
