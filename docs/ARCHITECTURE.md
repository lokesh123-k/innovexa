# Architecture

## Overview

One MERN monorepo serving three role-based portals (Admin, Partner, Client) from a single React SPA and a single Express API backed by MongoDB Atlas.

```
              ┌───────────────────────────── app.innovexadigital.com ─┐
 Browser ───▶ │ React SPA (Vite)  /admin/*  /partner/*  /client/*      │
              └──────────────┬─────────────────────────────────────────┘
                             │ HTTPS, httpOnly cookies, Socket.IO
              ┌──────────────▼──────────── api.innovexadigital.com ───┐
              │ Express 5 API  /api/v1/*                              │
              │  helmet · CORS allowlist · origin check · rate limit  │
              │  authenticate (JWT cookie) → authorize (role)         │
              │  → validate (Zod) → controller → service → model      │
              │  Socket.IO (same JWT, per-user rooms)                 │
              └───┬──────────────┬───────────────┬────────────────────┘
                  │              │               │
            MongoDB Atlas   Cloudinary/S3    Razorpay  ·  SMTP provider
```

## Monorepo layout

| Path | Purpose |
|---|---|
| `packages/shared` | Enums, Zod schemas shared by API and web, money and progress maths. Built with `tsc` to `dist/`. |
| `apps/api` | Express + Mongoose API. One folder per business module under `src/modules`. |
| `apps/web` | React + Vite SPA. One folder per feature under `src/features`; one layout per portal. |
| `docs` | Architecture, schema, API contract, roadmap, risks, deployment. |
| `scripts` | Repo-level helper scripts. |

npm workspaces link the packages. `npm run build` builds `shared`, then `api`, then `web`.

## Backend module convention

Each module in `apps/api/src/modules/<name>/` contains:

- `<name>.model.ts`: Mongoose schema, indexes, and the exported type
- `<name>.validation.ts`: Zod request schemas (or re-exports from `@innovexa/shared`)
- `<name>.service.ts`: business rules and DB access. It is the only layer that touches models.
- `<name>.controller.ts`: thin HTTP adapters that call services
- `<name>.routes.ts`: router wiring plus the auth, role and validation middleware
- tests in `apps/api/tests/<name>.test.ts`

## Request pipeline

1. `helmet`, `cors` (allowlist from `CORS_ORIGINS`), `cookie-parser`, JSON body limit
2. `originGuard`: rejects state-changing requests whose `Origin` is not allowlisted (CSRF defence in depth alongside SameSite cookies)
3. Global rate limiter, plus a stricter one on `/auth/*`
4. `authenticate`: verifies the access JWT, loads the user, and rejects inactive or deleted users and stale `tokenVersion`
5. `authorize(...roles)`: role gate
6. `validate({ body, query, params })`: Zod parse; results go on `req.valid`
7. The service layer performs **resource ownership checks** (e.g. a client may only load projects whose `clientId` matches theirs)
8. `errorHandler` maps `AppError`, Zod, Mongoose and JWT errors to a consistent JSON envelope

Response envelope:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 57 } }
{ "success": false, "error": { "code": "FORBIDDEN", "message": "…", "details": [] } }
```

## Authentication

- **Access token**: JWT (HS256, 15 min), claims `sub`, `role`, `tv` (token version). Sent as the httpOnly cookie `ix_at`. An `Authorization: Bearer` header is also accepted for tooling.
- **Refresh token**: opaque 48-byte random value, 7 days, sent as the httpOnly cookie `ix_rt` scoped to `/api/v1/auth`. Only its SHA-256 hash is stored, in `RefreshSession`.
- **Rotation**: every `/auth/refresh` consumes the presented token and issues a new one in the same *family*. Presenting an already-consumed token is treated as theft, and the whole family is revoked.
- **Invitation signup**: the admin creates a user with status `INVITED`. A one-time token (hash stored, 72 h) is emailed. Accepting it sets the password, marks the email verified and activates the account.
- **Forgot/reset**: always responds 200. The reset token is single use and lasts 60 min. A reset bumps `tokenVersion` and revokes all sessions.
- **Lockout**: 5 failed logins lock the account for 15 min.
- Cookies use `Secure` in production, `SameSite=Lax`, and an optional `COOKIE_DOMAIN=.innovexadigital.com`.

## Money

All amounts are stored as **integer minor units** (paise) in `Number` fields, validated with `Number.isSafeInteger`. They are converted to and from decimal strings only at the edges (`toMinor("1234.50")` gives `123450`), with no float arithmetic. Instalment splitting distributes remainders deterministically. See `packages/shared/src/money.ts`.

## Progress

Project progress is computed **server side only** from approved task progress:

`progress = Σ(weight × approvedProgress) / Σ(weight)` over non-cancelled tasks. If the total weight is 0, progress is 0. See `packages/shared/src/progress.ts`. Submitted (unapproved) progress is stored separately and shown only to admins.

## Realtime

Socket.IO shares the HTTP server. The handshake authenticates with the same `ix_at` cookie. Each socket joins `user:<id>` and, for project-linked conversations it is permitted to see, `conversation:<id>`. Notifications and messages are persisted first, then emitted.

## Files

Uploads go through the API (Multer memory storage with size and MIME allowlists) to Cloudinary or S3-compatible storage behind a `StorageProvider` interface. A local-disk provider exists for development only. Downloads are authorized per file through the owning resource (project, task, message, change request).
