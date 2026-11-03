# Innovexa Digital Management Platform

One MERN platform with three role-based portals (Admin, Partner, Client) for Innovexa Digital's projects, work tracking, communication and billing.

> **Status:** Admin, Partner and Client portals are implemented end to end (API, database, realtime, UI). See [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md).

## Repository layout

```
apps/
  api/        Express 5 + Mongoose API (TypeScript)
  web/        React + Vite + Tailwind SPA: Admin, Partner and Client portals
packages/
  shared/     Enums, Zod schemas, money and progress maths shared by api and web
docs/         Architecture, schema, API contract, roadmap, security risks
scripts/      Repo-level helper scripts
```

## Prerequisites

- Node.js 20.11+ (developed on 22.x) and npm 10+
- A MongoDB connection string: a MongoDB Atlas free cluster for development, or any local `mongod`

Tests do **not** need a database. They start an in-memory MongoDB automatically. The first run downloads a MongoDB binary of about 600 MB, which is then cached.

## Setup

```bash
npm install
cp .env.example .env        # then fill in MONGODB_URI and JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # for JWT_ACCESS_SECRET
npm run seed                # demo users + default service categories (dev only)
npm run dev                 # API on :4000 + web on http://localhost:5173
```

Open **http://localhost:5173** and sign in. In dev and preview, Vite proxies `/api` to the API, so cookies stay same-origin.

No Atlas yet? Point `MONGODB_URI` at `mongodb://127.0.0.1:27017/innovexa` and use `npm run dev:all`, which also starts a local development MongoDB with data kept in `.dev-db/`.

Keep demo data out of real data: `npm run seed` and `npm run test:e2e` create demo records, so they refuse to run unless `MONGODB_URI` is a local database (e.g. `mongodb://127.0.0.1:27017/innovexa-dev` with `npm run dev:db`). Set `ALLOW_REMOTE_DB_WRITES=1` only for a separate, disposable database.

`npm run seed` prints the demo accounts. Set `SEED_PASSWORD` in `.env` to choose their password; otherwise a random one is generated and printed once. Use `npm run seed -- --reset` to drop the database first. The seed refuses to run when `NODE_ENV=production`.

With `EMAIL_TRANSPORT=log` (the default), invitation, reset and verification links are printed to the API console instead of being emailed.

## Scripts (root)

| Command | Description |
|---|---|
| `npm run dev` | API (hot reload) and web (Vite, http://localhost:5173) together |
| `npm run dev:all` | Same, plus a local development MongoDB on :27017 |
| `npm run dev:api` / `dev:web` / `dev:db` | Run one piece on its own |
| `npm start` | Production build, then the built API on :4000 and a web preview on http://localhost:4173 |
| `npm run build` | Build shared, API (`apps/api/dist/server.js`) and web (`apps/web/dist`) |
| `npm run typecheck` | Type-check every workspace |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm test` | Unit tests (shared) and API integration tests (Vitest + Supertest + in-memory MongoDB) |
| `npm run seed` | Seed demo admin/partner/client accounts and service categories (dev only) |
| `npm run seed:admin` | Create or recover the development admin from `DEV_ADMIN_*` (`-- --unlock`, `-- --reset-password`) |
| `npm run test:e2e` | Playwright browser tests against the running app (`npm run dev` first) |

## Architecture and API

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): request pipeline, auth model, money and progress rules
- [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md): all collections and indexes
- [docs/API_CONTRACT.md](docs/API_CONTRACT.md): endpoints by phase, with implementation status
- [docs/SECURITY_AND_RISKS.md](docs/SECURITY_AND_RISKS.md): threat and business-rule risks with mitigations

## Security notes

- Auth uses httpOnly cookies: a 15-minute JWT access token and a rotating, hashed refresh token with reuse detection.
- Every protected request re-checks the user in the database, so deactivation and password resets take effect immediately.
- The API refuses to boot in production with an insecure config (non-secure cookies, weak JWT secret, http origins, non-SMTP email).
- Never commit `.env`. `.env.example` contains placeholders only.

## Deploying the API to Vercel

The API deploys as a separate Vercel project using Vercel's zero-config Express support. `apps/api/index.ts` default-exports the same `createApp()` used locally, so every `/api/v1` route is shared and nothing is duplicated. Local development (`npm run dev`, port 4000) still runs `src/server.ts` with Socket.IO and in-process jobs.

| Setting | Value |
|---|---|
| Root Directory | `apps/api` |
| Framework Preset | Express (set by `apps/api/vercel.json`) |
| Install Command | from `vercel.json`: `cd ../.. && npm ci --include=dev` (the in-memory MongoDB download is disabled through root `package.json` `config`) |
| Build Command | from `vercel.json`: `cd ../.. && npm run build -w @innovexa/shared && npm run typecheck -w @innovexa/api` |
| Output Directory | leave empty (not used by Express functions) |
| Include files outside root directory | enabled (needed for `packages/shared`) |

**API environment variables (production):** `NODE_ENV=production`, `MONGODB_URI`, `JWT_ACCESS_SECRET` (random, 48+ chars), `COOKIE_SECURE=true`, `COOKIE_SAMESITE` (leave unset: the default `auto` picks `None` for a web app on another domain), `TRUST_PROXY=1`, `APP_URL` and `CORS_ORIGINS` (the web app's https URL), optional `CORS_VERCEL_PREVIEWS` (`<web-project>:<team-slug>`, to allow that project's preview URLs), `EMAIL_TRANSPORT=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SENDER_EMAIL`, `SENDER_PASSWORD`, `CRON_SECRET`. Optional: `EMAIL_FROM`, `EMAIL_LOGO_URL`, `RAZORPAY_*`. If any are missing or invalid, every request returns a JSON 503 (`SERVICE_MISCONFIGURED`) and the function log lists the variable names.

**Web project environment variables:** `VITE_API_URL=https://<api-domain>/api/v1` and `VITE_REALTIME=false`. Vite variables are public, so never put secrets in them. Changing either one needs a redeploy.

**Serverless differences:**
- **MongoDB:** one lazily opened connection per warm instance.
- **Socket.IO:** not available, so the app relies on its periodic refresh.
- **Reminders:** run through Vercel Cron, calling `/api/v1/internal/cron/reminders` with `CRON_SECRET`.
- **File uploads:** return 503 until an object-storage provider is added.
- **Background emails:** use `waitUntil`, so they finish after the response.
