# Implementation Roadmap

Each phase ends with a passing typecheck, lint and tests, plus updates to `DEVELOPMENT_PROGRESS.md`, `README.md` and `docs/API_CONTRACT.md`.

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Foundation** | Monorepo, shared package (enums, money, progress), API skeleton (config, security middleware, error envelope, logging), **all Mongoose models with indexes**, auth (login, refresh rotation, invite, verify, forgot/reset, lockout), users/partners admin, audit log, mailer, seed script, test harness (Vitest + Supertest + in-memory MongoDB) | Auth and RBAC tests green, including token reuse detection and deactivated-user lockout |
| **2. Core records + web shell** | Clients, service categories, projects, milestones, counters (PRJ/CLI codes). Web: Vite + Tailwind + shadcn/ui design system, auth pages, three portal layouts, route guards, admin client and project CRUD | Cross-client isolation tests; admin can create a client, invite them and create a project in the UI |
| **3. Tasks and work** | Tasks, assignment, progress updates, submission and review workflow, weighted progress recalculation and history, time tracking, daily and weekly reports, file uploads (storage provider). Web: Kanban, task detail, partner dashboard | Partner cannot approve; client sees only approved progress; cross-partner isolation tests |
| **4. Communication** | Conversations, messages, read receipts, unread counts, Socket.IO, presence, notifications (in-app + email), change requests + change orders. Web: messaging UI, notification centre, client change requests | Partner↔client messaging impossible; realtime delivery tested |
| **5. Billing** | Invoices, instalment plans (2/3/6/9/12/custom), offline payments, Razorpay orders, checkout verification, webhooks (signature + idempotency), receipts, overdue jobs. Web: invoice layout, EMI schedule, payment history | Financial maths tests; duplicate webhook test; outstanding = total − net paid |
| **6. Dashboards and reports** | Admin, partner and client dashboards (Recharts), all reports with filters, CSV export, printable PDF views | Report totals reconciled against DB in tests |
| **7. Hardening and deploy** | Playwright E2E per role, deploy configs (Render/Railway API, Vercel/Netlify web), Atlas network rules, monitoring (Sentry, uptime), backups, `docs/DEPLOYMENT.md` | Green CI; staging deploy checklist complete |
