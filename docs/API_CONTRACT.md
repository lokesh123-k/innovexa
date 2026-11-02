# API Contract (v1)

Base URL: `/api/v1`. JSON in and out. Auth uses httpOnly cookies (`ix_at`, `ix_rt`). Roles: **A** = admin, **P** = partner, **C** = client. "own" means the server filters by the signed-in user. Inaccessible records return **404**; wrong-role endpoints return **403**.

All endpoints below are implemented and covered by `apps/api/tests`.

## Auth

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | /auth/login | public | `{email, password}`; lockout after 5 failures (423 with `lockedUntil`) |
| POST | /auth/refresh · /auth/logout · /auth/logout-all | cookie / any | rotating refresh token, reuse detection |
| GET | /auth/me | any | |
| GET | /auth/invitations/:token | public | |
| POST | /auth/accept-invitation · /auth/forgot-password · /auth/reset-password · /auth/verify-email | public | |
| POST | /auth/resend-verification · /auth/change-password | any | |

## People

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /users | A | filters: role, status, partnerType, q |
| POST | /users/invite | A | admin or partner (client logins: /clients/:id/logins) |
| GET/PATCH | /users/:id | A | |
| PATCH | /users/:id/status | A | deactivation revokes sessions |
| POST | /users/:id/resend-invite | A | |
| PATCH | /users/me | any | |
| GET | /clients | A | q, status; includes projects, outstanding, logins |
| POST | /clients | A | CLI-#### |
| GET/PATCH | /clients/:id | A | GET returns the 360° view |
| PATCH | /clients/:id/status | A | cascades to client logins |
| POST | /clients/:id/logins | A | invites a CLIENT user |
| GET | /clients/me | C | own company profile |

## Projects and work

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /service-categories | any | `?all=true` (A) includes inactive |
| POST/PATCH | /service-categories(/:id) | A | |
| GET | /projects | A, P own, C own | status, clientId, partnerId, q |
| POST | /projects | A | with milestones and partnerIds |
| GET | /projects/:id | A, P own, C own | role-specific projection |
| PATCH | /projects/:id | A | |
| GET | /projects/:id/timeline | A, P, C own | |
| GET | /projects/:id/work | A, C own | completed / pending, client-safe |
| GET/POST | /projects/:id/milestones | read: own; create: A | |
| PATCH/DELETE | /milestones/:id | A | completion notifies the client |
| GET | /tasks | A, P own | projectId, assigneeId, status (csv), overdue, q |
| POST | /tasks | A | |
| GET | /tasks/:id | A, P own | with updates and attachments |
| PATCH | /tasks/:id | A | |
| POST | /tasks/:id/assign | A | |
| POST | /tasks/:id/updates | P assignee | progress (never approves) |
| POST | /tasks/:id/submit | P assignee | |
| POST | /tasks/:id/issues | P assignee | ISSUE or CLARIFICATION |
| POST | /tasks/:id/review | A | APPROVE (optional partial %) or REQUEST_REVISION (comment required) |
| POST | /tasks/:id/cancel · /reopen | A | progress recalculated |
| GET | /tasks/review-queue | A | |
| GET | /tasks/my-updates | P | kind, from, to |
| GET/POST | /work-reports | A (all, filters), P own | one DAILY per day |
| GET | /work-reports/:id | A, P own | |
| GET | /work-reports/time/summary | P own; A with partnerId | |

## Files

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | /files | scoped | multipart `file`, `kind` (PROJECT, TASK, CHANGE_REQUEST, CONVERSATION, WORK_REPORT), `refId`, `visibility` (A, PROJECT only) |
| GET | /files?kind&refId | scoped | clients see only CLIENT-visible project files |
| GET | /files/:id/download | authorized via parent | attachment, nosniff |
| PATCH | /files/:id/publish | A | share a project or task file with the client |

## Communication

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /conversations | A (all), P/C own | unread and online flags |
| POST | /conversations | A (`userId`), P/C (self) | optional projectId; find-or-create |
| GET | /conversations/unread-count | any | |
| GET/POST | /conversations/:id/messages | participant | attachments must be CONVERSATION files owned by the sender |
| POST | /conversations/:id/read | participant | read receipts |
| GET | /notifications | own | `unreadOnly`; `meta.unread` |
| POST | /notifications/:id/read · /read-all | own | |
| Socket.IO | `notification:new`, `message:new`, `message:read`, `presence` | cookie-authenticated | rooms `user:<id>`, `role:<ROLE>` |

## Change requests

| Method | Path | Roles |
|---|---|---|
| GET | /change-requests | A, C own |
| POST | /change-requests | C (own project) |
| GET | /change-requests/:id | A, C own |
| PATCH | /change-requests/:id/status | A |
| POST | /change-requests/:id/responses | A, C own |
| POST | /change-requests/:id/change-order | A (updates the contract amount once) |
| POST | /change-requests/:id/convert-to-task | A |

## Billing

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /invoices | A, C own (no drafts) | clientId, projectId, status |
| POST | /invoices | A | totals and schedule computed server side; `issue: true` to send |
| GET | /invoices/:id | A, C own | with installments and payments |
| POST | /invoices/:id/issue · /cancel | A | cancel only when unpaid |
| GET | /payments | A, C own | |
| GET | /payments/config | A, C | `{ enabled, keyId }` |
| POST | /payments/offline | A | ≤ balance; receipt number |
| POST | /payments/orders | C own | Razorpay order (503 when not configured) |
| POST | /payments/verify | C own | checkout signature |
| POST | /payments/webhooks/razorpay | provider | raw body HMAC; idempotent |
| GET | /payments/:id/receipt | A, C own | |

## Dashboards and reports

| Method | Path | Roles |
|---|---|---|
| GET | /dashboard/admin · /dashboard/partner · /dashboard/client | per role |
| GET | /dashboard/partners/:id | A |
| GET | /dashboard/settings-status | A |
| GET | /reports/{projects,partners,work,overdue-tasks,financial} | A; filters: from, to, clientId, projectId, partnerId; `format=csv` |
