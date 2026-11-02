# MongoDB Schema Plan

Conventions: `_id` ObjectId, `timestamps: true` on every collection, money in **integer minor units** (`*Minor`), soft delete via `deletedAt` (or `archivedAt`) where business records must be retained. All references are ObjectIds.

| Model | Key fields | Indexes |
|---|---|---|
| **User** | email (lowercased), name, phone, role `ADMIN\|PARTNER\|CLIENT`, status `INVITED\|ACTIVE\|INACTIVE`, passwordHash (select:false), emailVerifiedAt, tokenVersion, failedLoginAttempts, lockUntil, lastLoginAt, partnerProfile {partnerType, category, designation, skills[], hourlyRateMinor (admin-only)}, clientId → Client, permissions[], deletedAt | `email` unique; `{role,status}` |
| **RefreshSession** | userId, familyId, tokenHash, expiresAt, usedAt, revokedAt, replacedById, ip, userAgent | `tokenHash` unique; `{userId}`; `{familyId}`; TTL on `expiresAt` |
| **AuthToken** | userId, purpose `INVITE\|VERIFY_EMAIL\|RESET_PASSWORD`, tokenHash, expiresAt, usedAt | `tokenHash` unique; TTL on `expiresAt` |
| **Client** | clientCode, companyName, contactName, email, phone, address, gstin, notes (admin-only), status, archivedAt | `clientCode` unique; `email`; `status` |
| **ServiceCategory** | name, slug, description, isActive, isSystem | `slug` unique |
| **Project** | projectCode, title, clientId, serviceCategoryId, description, requirements, budgetMinor, contractAmountMinor, currency, startDate, expectedEndDate, completedAt, priority, status, partnerIds[], progress {approved, submitted, calculatedAt}, progressHistory[], deliverables[], attachmentIds[], archivedAt | `projectCode` unique; `{clientId,status}`; `partnerIds`; `expectedEndDate` |
| **Milestone** | projectId, title, description, order, dueDate, status, completedAt, clientVisible | `{projectId,order}` |
| **Task** | projectId, milestoneId, title, description, instructions, expectedDeliverables, assigneeIds[], priority, status, startDate, dueDate, estimatedHours, weight (1-100), submittedProgress, approvedProgress, loggedMinutes, attachmentIds[], reviewNotes[], approvedAt/By, cancelledAt | `{projectId,status}`; `{assigneeIds,status}`; `dueDate` |
| **TaskUpdate** | taskId, projectId, partnerId, previousProgress, newProgress, description, minutesSpent, attachmentIds[], kind `PROGRESS\|SUBMISSION\|ISSUE\|CLARIFICATION`, reviewStatus `PENDING\|APPROVED\|REJECTED`, reviewedBy/At, reviewComment | `{taskId,createdAt}`; `{partnerId,createdAt}` |
| **WorkReport** | partnerId, type `DAILY\|WEEKLY`, date / periodStart / periodEnd, taskIds[], workCompleted, progressPercent, minutesWorked, problems, nextPlan, attachmentIds[] | `{partnerId,date}`; `{type,date}` |
| **Conversation** | type `DIRECT\|PROJECT`, participantIds[], projectId, audience `PARTNER\|CLIENT`, lastMessageAt, lastMessagePreview | `participantIds`; `{projectId}`; `lastMessageAt` |
| **Message** | conversationId, senderId, body, attachmentIds[], readBy[{userId, at}], deletedAt | `{conversationId,createdAt}` |
| **ChangeRequest** | requestCode, projectId, clientId, title, description, attachmentIds[], status, history[{status, by, note, at}], responses[], changeOrder {amountMinor, approvedBy, approvedAt, invoiceId}, taskId | `{projectId,status}`; `{clientId}` |
| **Invoice** | invoiceNumber, clientId, projectId, invoiceDate, dueDate, contractAmountMinor, taxMinor, discountMinor, totalMinor, advanceMinor, paidMinor, balanceMinor, paymentTerms `FULL\|ADVANCE_BALANCE\|INSTALLMENTS`, status `DRAFT\|ISSUED\|PARTIALLY_PAID\|PAID\|OVERDUE\|CANCELLED`, notes | `invoiceNumber` unique; `{clientId,status}`; `{projectId}`; `dueDate` |
| **Installment** | invoiceId, clientId, number, kind `ADVANCE\|INSTALLMENT\|BALANCE`, amountMinor, paidMinor, dueDate, status `PENDING\|PARTIALLY_PAID\|PAID\|OVERDUE\|WAIVED`, paymentReference | `{invoiceId,number}` unique; `{dueDate,status}` |
| **Payment** | invoiceId, installmentId, clientId, amountMinor, currency, method `GATEWAY\|BANK_TRANSFER\|UPI\|CASH\|CHEQUE\|OTHER`, provider, providerOrderId, providerPaymentId, status `CREATED\|PENDING\|SUCCEEDED\|FAILED\|REFUNDED`, verifiedAt, recordedBy, receiptNumber, failureReason | `{provider,providerPaymentId}` unique sparse; `providerOrderId`; `{invoiceId}`; `receiptNumber` unique sparse |
| **WebhookEvent** | provider, eventId, type, processedAt, payloadHash | `{provider,eventId}` unique (idempotency) |
| **File** | ownerId, storage provider, key, url, originalName, mimeType, size, scope {kind, refId}, visibility `INTERNAL\|CLIENT`, deletedAt | `{scope.kind, scope.refId}` |
| **Notification** | recipientId, type, title, body, link, data, readAt | `{recipientId,readAt,createdAt}` |
| **AuditLog** | actorId, actorRole, action, entity, entityId, before, after, ip, userAgent | `{entity,entityId}`; `{actorId,createdAt}`; `createdAt` |
| **Counter** | `_id` = sequence name, seq | Atomic `$inc`, used for human-readable codes (PRJ-0001, INV-2026-0001) |

## Derived values (never trusted from the client)

- `Invoice.totalMinor = contract + tax − discount`
- `Invoice.paidMinor = Σ succeeded payments − refunds`
- `Invoice.balanceMinor = totalMinor − paidMinor`
- `Project.progress.approved`: weighted formula over approved task progress
