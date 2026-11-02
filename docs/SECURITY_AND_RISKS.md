# Security and Business-Rule Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **IDOR / cross-tenant reads**: a client guesses another project ID | Every service query includes an ownership filter derived from `req.user` (clientId or partner assignment), never from request input. Integration tests cover cross-client and cross-partner access. |
| 2 | **Data leakage through shared endpoints**: partner pay, internal notes, unapproved deliverables | Role-specific serializers (`toClientView`, `toPartnerView`) whitelist fields. Files carry a `visibility` flag. Clients only see `progress.approved`. |
| 3 | **Self-approval** by partners | Review endpoints are `ADMIN` only. The service also rejects a reviewer who is an assignee. |
| 4 | **Progress tampering** | Progress totals are recalculated server side; client-sent totals are ignored. Weights are validated as integers 1–100. Zero total weight yields 0. |
| 5 | **Float errors in money** | Integer minor units everywhere; `toMinor` parses strings; instalment sums are validated to equal the balance exactly. |
| 6 | **Duplicate or forged payment webhooks** | HMAC-SHA256 over the raw body with timing-safe compare; `WebhookEvent` unique index on `(provider, eventId)`; payment state transitions are idempotent (unique `providerPaymentId`). |
| 7 | **Client-side "payment succeeded" spoofing** | A payment is only marked SUCCEEDED after server-side signature verification or a webhook. The checkout callback alone is not trusted for amounts. |
| 8 | **Refresh token theft** | Opaque, hashed at rest, rotated on use, with reuse detection revoking the family. Path-scoped httpOnly cookie. |
| 9 | **Brute force / credential stuffing** | Rate limits on `/auth`, account lockout after 5 failures, bcrypt cost 12, generic error messages, forgot-password never reveals whether an account exists. |
| 10 | **CSRF** | SameSite=Lax cookies, CORS allowlist, and an `Origin` check on unsafe methods. |
| 11 | **Deactivated user keeps access** | `authenticate` reloads the user on every request; deactivation bumps `tokenVersion` and revokes sessions. |
| 12 | **Malicious uploads** | MIME and extension allowlist, size cap, randomized storage keys, never served from the API origin as HTML, `Content-Disposition: attachment`. |
| 13 | **Scope creep without price change** | Change requests that alter scope or price require an admin-approved change order before the contract amount or invoice changes. |
| 14 | **Instalment plan ≠ bank EMI** | UI and docs label it "Instalment schedule"; no lending or financing claims. |
| 15 | **Card data** | Hosted checkout only; the platform never receives PAN, CVV or UPI PIN. |
| 16 | **Secrets in the repo** | `.env` is gitignored, `.env.example` holds placeholders only, config is Zod-validated at boot, and production refuses weak JWT secrets. |
| 17 | **Free-tier hosting terms** | Verify commercial-use terms and upgrade before live client data (see the deployment doc in Phase 7). |
| 18 | **Audit gaps** | Every admin mutation on users, projects, tasks, invoices and payments writes an `AuditLog` entry with before and after. |
