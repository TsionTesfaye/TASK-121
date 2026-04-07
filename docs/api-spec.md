# RetailOps Console — API Specification

> Offline-first Svelte 4 SPA with IndexedDB persistence, AES-256-GCM encryption, and role-based access control.

---

## Table of Contents

1. [Roles & Permissions](#roles--permissions)
2. [Organization Hierarchy](#organization-hierarchy)
3. [Enumerations](#enumerations)
4. [Routes](#routes)
5. [Services](#services)
   - [AuthService](#1-authservice)
   - [BootstrapService](#2-bootstrapservice)
   - [CustomerService](#3-customerservice)
   - [OrgService](#4-orgservice)
   - [OrderService](#5-orderservice)
   - [TicketService](#6-ticketservice)
   - [NotificationService](#7-notificationservice)
   - [TemplateService](#8-templateservice)
   - [EventDispatcherService](#9-eventdispatcherservice)
   - [NLPService](#10-nlpservice)
   - [RiskReviewService](#11-riskreviewservice)
   - [StyleService](#12-styleservice)
   - [LookupDataService](#13-lookupdataservice)
   - [MasterDataService](#14-masterdataservice)
   - [ImportExportService](#15-importexportservice)
   - [CryptoService](#16-cryptoservice)
   - [AuditService](#17-auditservice)
   - [SchedulerService](#18-schedulerservice)
6. [Encryption Model](#encryption-model)
7. [Versioning Models](#versioning-models)
8. [Validation Rules](#validation-rules)

---

## Roles & Permissions

| Role | Description |
|---|---|
| `administrator` | Full system access. Bypasses all role checks. |
| `store_manager` | Operational management: customers, orders, tickets, styles, templates, risk rules. |
| `analyst` | NLP text import and analysis. Read-only CRM access. |
| `reviewer` | Risk case review and ticket review. |
| `guest` | Read-only trial session. 30-minute hard expiry. No mutations. |

**Role hierarchy:** `administrator` implicitly satisfies all role requirements.

---

## Organization Hierarchy

```
COMPANY
  └─ FACTORY
       └─ STORE
            └─ WAREHOUSE
```

| Parent Type | Allowed Child Type |
|---|---|
| `company` | `factory` |
| `factory` | `store` |
| `store` | `warehouse` |

Only `company` nodes may be root (no parent).

---

## Enumerations

### Membership Tiers
`Bronze` | `Silver` | `Gold`

### Order Statuses
`draft` | `placed` | `in_progress` | `ready` | `completed` | `canceled`

**Transitions:**
- `draft` -> `placed`, `canceled`
- `placed` -> `in_progress`, `canceled`
- `in_progress` -> `ready`, `canceled`
- `ready` -> `completed`, `canceled`
- `completed`, `canceled` -> (terminal)

### Ticket Statuses
`open` | `in_progress` | `resolved` | `closed`

**Transitions:**
- `open` -> `in_progress`, `closed`
- `in_progress` -> `resolved`, `closed`
- `resolved` -> `closed`
- `closed` -> (terminal)

### Ticket Priorities
`low` | `medium` | `high`

### Ticket Event Types
`created` | `assigned` | `replied` | `resolved` | `closed` | `overdue`

### Event Types (Dispatcher)
`order_status` | `ticket_assigned` | `ticket_status` | `risk_case_flagged` | `master_data_published` | `deadline_approaching` | `grading_completed` | `announcement`

### Queue Statuses
`Draft` | `Queued` | `Sent` | `Failed`

### Risk Case Statuses
`open` | `in_review` | `resolved` | `dismissed`

### Outcome Codes
`no_issue` | `warning_issued` | `content_removed` | `account_link_confirmed` | `suspicious_activity_confirmed` | `false_positive`

### NLP Run Types
`batch` | `incremental`

### Master Data Entity Types
`color` | `size` | `season` | `brand` | `supplier` | `style`

---

## Routes

| Path | Access |
|---|---|
| `/login` | Public |
| `/bootstrap` | Public (first-run only) |
| `/crm` | administrator, store_manager, analyst, guest (read-only) |
| `/orders` | administrator, store_manager |
| `/tickets` | administrator, store_manager, reviewer |
| `/messages` | administrator, store_manager |
| `/master-data` | administrator, store_manager |
| `/nlp` | administrator, analyst |
| `/risk-review` | administrator, store_manager, reviewer |
| `/org-setup` | administrator |
| `/admin` | administrator |

---

## Services

### 1. AuthService

Authentication, session management, passphrase-based encryption unlock.

---

#### `login(username, password)`

Authenticates a user. Does **not** derive the data encryption key.

| Field | Value |
|---|---|
| **Params** | `username: string`, `password: string` |
| **Returns** | `Promise<User>` |
| **Auth** | None (public) |
| **Errors** | `Invalid credentials.` (generic for all failure paths: wrong password, unknown user, deactivated, locked out) |

**Lockout:** 5 failed attempts -> 15-minute lock.

---

#### `logout()`

Clears session, crypto key, broadcasts to other tabs.

| Field | Value |
|---|---|
| **Returns** | `Promise<void>` |
| **Auth** | Authenticated |

---

#### `unlockProtectedData(orgPassphrase)`

**The only way to derive the data encryption key.** Login password is never used for encryption.

| Field | Value |
|---|---|
| **Params** | `orgPassphrase: string` |
| **Returns** | `Promise<boolean>` — `true` if passphrase correct |
| **Auth** | `store_manager` minimum |
| **Errors** | `Organization config not found.`, `Org passphrase not configured.` |

---

#### `unlockSession(password)`

Unlocks the screen lock. Does **not** derive the encryption key.

| Field | Value |
|---|---|
| **Params** | `password: string` (user's login password) |
| **Returns** | `Promise<boolean>` |
| **Auth** | Locked session |
| **Errors** | `Too many failed unlock attempts (5). Session has been terminated.` |

---

#### `lockSession()`

Locks the screen and clears the encryption key.

| Field | Value |
|---|---|
| **Auth** | Authenticated |
| **Side Effects** | Broadcasts `SESSION_LOCKED` to other tabs |

---

#### `createUser({ username, password, role, organizationNodeId })`

| Field | Value |
|---|---|
| **Params** | `username: string`, `password: string` (12+ chars, 1+ digit, 1+ symbol), `role: string`, `organizationNodeId: string` |
| **Returns** | `Promise<User>` |
| **Auth** | `administrator` |
| **Errors** | Invalid password, invalid role, org node not found, non-admin role missing org node |

---

#### `changePassword(userId, oldPassword, newPassword)`

Changes login password. Does **not** affect data encryption key.

| Field | Value |
|---|---|
| **Params** | `userId: string`, `oldPassword: string`, `newPassword: string` |
| **Returns** | `Promise<void>` |
| **Auth** | Self or administrator |
| **Errors** | Old password incorrect, new password invalid |

---

#### `setupOrgPassphrase(orgPassphrase)`

Sets or changes the org-level data encryption passphrase.

| Field | Value |
|---|---|
| **Params** | `orgPassphrase: string` (12+ chars) |
| **Returns** | `Promise<void>` |
| **Auth** | `administrator` |
| **Side Effects** | Derives and caches session key, stores verifier hash |

---

#### `migrateToOrgPassphrase(oldLoginPassword, orgPassphrase)`

Re-encrypts all customer sensitive fields from password-derived key to passphrase-derived key.

| Field | Value |
|---|---|
| **Params** | `oldLoginPassword: string`, `orgPassphrase: string` (12+ chars) |
| **Returns** | `Promise<number>` — records migrated |
| **Auth** | `administrator` |
| **Errors** | `Already using passphrase model.` |

---

#### `createGuestSession(onExpiry)`

| Field | Value |
|---|---|
| **Params** | `onExpiry: (reason: string) => void` |
| **Returns** | `Promise<GuestUser>` |
| **Auth** | None |
| **Behavior** | 30-minute hard expiry, read-only |

---

#### `linkUserAccounts({ userIdA, userIdB, reason })`

| Field | Value |
|---|---|
| **Auth** | `administrator` |
| **Params** | `reason`: 10+ chars. No self-links. Duplicate-safe (A-B == B-A). |
| **Returns** | `Promise<Link>` |

---

#### `getLinkedAccounts(userId)` / `unlinkAccounts(linkId)` / `listUsers()` / `deactivateAccount(userId)`

All require `administrator` role.

---

#### State Accessors (no auth)

| Method | Returns |
|---|---|
| `getCurrentUser()` | `User \| null` |
| `isAuthenticated()` | `boolean` |
| `isLocked()` | `boolean` |
| `isGuest()` | `boolean` |
| `hasRole(role)` | `boolean` |
| `requireUnlocked()` | `void` (throws if locked) |
| `getEncryptionModel()` | `Promise<'passphrase'>` |

---

### 2. BootstrapService

First-run system initialization. Exempt from RBAC (runs before any user exists).

---

#### `isBootstrapped()`

| Field | Value |
|---|---|
| **Returns** | `Promise<boolean>` — `true` if any user exists |

---

#### `bootstrap({ adminUsername, adminPassword, orgName, orgPassphrase? })`

| Field | Value |
|---|---|
| **Params** | `adminUsername: string`, `adminPassword: string` (12+ chars), `orgName: string`, `orgPassphrase?: string` (defaults to adminPassword) |
| **Returns** | `Promise<{ admin: User, org: OrgNode }>` |
| **Errors** | `System is already initialized.` |
| **Side Effects** | Creates root org, admin user, system templates, org encryption salt, passphrase verifier |

---

### 3. CustomerService

Customer record management with encrypted sensitive fields (storedValue, allergies, materialRestrictions).

---

#### `createCustomer({ organizationId, name, membershipTier?, points?, storedValue?, allergies?, materialRestrictions?, actorId, reasonNote })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Returns** | `Promise<Customer>` |
| **Encrypted Fields** | `storedValue` (always), `allergies` (if present), `materialRestrictions` (if present) |
| **Validation** | `name` non-empty, `membershipTier` in {Bronze,Silver,Gold}, `points` >= 0, `storedValue` 0-999999.99, `allergies`/`materialRestrictions` <= 500 chars, `reasonNote` >= 10 chars |
| **Errors** | Session locked, validation failures |
| **Side Effects** | Creates version record, audit log |

---

#### `updateCustomer(customerId, { name?, membershipTier? }, actorId, reasonNote)`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Returns** | `Promise<Customer>` |
| **Side Effects** | Creates version record |

---

#### `adjustStoredValue(customerId, delta, actorId, reasonNote)`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Params** | `delta: number` — positive (credit) or negative (debit) |
| **Errors** | Negative balance rejected, session locked |

---

#### `adjustPoints(customerId, delta, actorId, reasonNote)`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Params** | `delta: integer` |

---

#### `addRating(customerId, rating, actorId, reasonNote)`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Params** | `rating: integer` 1-5 |
| **Side Effects** | Dispatches `GRADING_COMPLETED` event |

---

#### `revealSensitiveFields(customerId)`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Returns** | `Promise<{ storedValue: string, allergies: string \| null, materialRestrictions: string \| null }>` |
| **Errors** | Session locked |

---

#### `getMaskedFields(customerId)`

| Field | Value |
|---|---|
| **Auth** | Any authenticated |
| **Returns** | Masked placeholders (`••••••••`) |

---

#### `getByOrg(organizationId)` / `getById(customerId)`

Auth: any authenticated. Scope-enforced.

---

#### `publishCustomerVersion({ customerId, organizationId, reasonNote, actorId })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Behavior** | Snapshots current state, deactivates previous active version |

---

#### `getCustomerVersionHistory(customerId)` / `getActiveCustomerVersion(customerId)`

Auth: any authenticated. Returns newest first.

---

### 4. OrgService

Organization hierarchy management.

---

#### `createNode({ parentId?, type, name, organizationId, actorId })`

| Field | Value |
|---|---|
| **Auth** | `administrator` |
| **Params** | `type`: company/factory/store/warehouse. `parentId` required except for company roots. |
| **Validation** | Parent-child type pairing, same org, no cross-org links |

---

#### `updateNode(nodeId, { name?, type?, parentId? }, actorId)`

| Field | Value |
|---|---|
| **Auth** | `administrator` |
| **Validation** | Cycle detection, parent-child type compatibility, same org, children compatibility on type change |
| **Errors** | `Cannot set parent: would create a cycle`, `Invalid parent-child combination`, `Cannot move node to a different organization` |

---

#### `deleteNode(nodeId, actorId)`

| Field | Value |
|---|---|
| **Auth** | `administrator` |
| **Errors** | `Cannot delete a node with children.` (leaf-only deletion) |

---

#### `getTree(organizationId)`

Auth: any authenticated. Admin can pass `'all'` for all nodes.

---

#### `getSubtree(nodeId)` / `getScopedNodeIds(user)` / `isInScope(actor, targetOrgId)`

Auth: any authenticated. Scope-enforced. `isInScope` checks both descendants and ancestors.

---

#### `validateParentChildType(parentType, childType)`

Public. Returns `boolean`.

---

### 5. OrderService

Order lifecycle management.

---

#### `createOrder({ customerId, organizationId, storeId, items?, actorId })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Returns** | Order with `status: 'draft'` |
| **Validation** | Store must be store/company type in same org, customer in same org |
| **Side Effects** | Attaches restriction flags from customer allergies |

---

#### `transitionOrder(orderId, newStatus, actorId)`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Errors** | Invalid transition, terminal state |
| **Side Effects** | Dispatches `ORDER_STATUS_CHANGED` event |

---

#### `getByCustomer(customerId)` / `getOrderDetail(orderId)` / `getByStore(storeId)`

Auth: `store_manager` minimum. Scope-enforced.

---

### 6. TicketService

After-sales support ticket management.

---

#### `createTicket({ customerId?, orderId?, organizationId, storeId, subject, description, category, priority, actorId, slaHours? })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Params** | `priority`: low/medium/high. `slaHours`: default 48. |
| **Returns** | Ticket with `status: 'open'`, `isOverdue: false` |

---

#### `assignTicket(ticketId, assigneeId, actorId)`

Sets status to `in_progress`. Dispatches `TICKET_ASSIGNED` to assignee.

---

#### `transitionTicket(ticketId, newStatus, actorId, comment?)`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Side Effects** | Sets `resolvedAt`/`closedBy`, dispatches `TICKET_STATUS_CHANGED` |

---

#### `evaluateOverdue()`

System-only (scheduler). Marks overdue tickets, dispatches `DEADLINE_APPROACHING`.

---

#### `getOverdue()` / `getTicketDetail(ticketId)` / `getByCustomer(customerId)` / `getByStore(storeId)`

Auth: `store_manager` or `reviewer` minimum. Scope-enforced.

---

### 7. NotificationService

Channels, subscriptions, message queue, in-app inbox.

---

#### `upsertChannel({ organizationId, name, type?, isEnabled? })`

Auth: `store_manager` minimum. Only `'in_app'` type in offline runtime.

---

#### `subscribe({ userId, channelId, eventType, organizationId?, filters? })`

| Field | Value |
|---|---|
| **Auth** | Any authenticated (not guest) |
| **Constraints** | Non-admin can only subscribe self, scoped to own org |
| **Validation** | Channel must exist and be enabled |

---

#### `enqueue({ organizationId, recipientUserId, templateId, channelId?, vars?, eventSourceKey })`

| Field | Value |
|---|---|
| **Auth** | System or authenticated (not guest) |
| **Behavior** | Deduplicates on `eventSourceKey`. Missing placeholders create `Draft` item. |

---

#### `requeueDraft(itemId, updatedVars)`

Auth: `store_manager` minimum. Re-renders template, transitions Draft -> Queued.

---

#### `processDueItems()`

System-only (scheduler). Returns `{ sent: number, failed: number }`.

---

#### `notifyUser(userId, { type?, title, body })`

System-only. Direct in-app notification.

---

#### `getInbox(userId)` / `markRead(notificationId)` / `getSubscriptions(userId)` / `deleteSubscription(subscriptionId, actorId)`

Self or administrator.

---

#### `getSubscriptionsByEventType(eventType, organizationId?)` / `getQueueByOrg(organizationId)` / `getChannels(organizationId)`

Auth: `store_manager` minimum or system.

---

### 8. TemplateService

Notification template management.

---

#### `createTemplate({ organizationId, name, body, isCompact?, actorId })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Behavior** | Extracts `{placeholder}` syntax from body |

---

#### `renderTemplate(templateId, vars)`

| Field | Value |
|---|---|
| **Auth** | Any authenticated or system |
| **Errors** | Missing required placeholders, compact template > 160 chars |

---

#### `updateTemplate(templateId, data, actorId)` / `deleteTemplate(templateId, actorId)` / `getByOrg(organizationId)` / `getById(templateId)`

Auth: `store_manager` minimum for mutations, any authenticated for reads.

---

### 9. EventDispatcherService

Business event routing. All notifications are template-backed (no body-only bypass).

---

#### `dispatch({ organizationId, eventType, sourceId, actorId, vars?, templateId?, recipientUserIds?, title?, body? })`

| Field | Value |
|---|---|
| **Auth** | System or authenticated |
| **Behavior** | Resolves template (explicit > system template), delivers via subscriptions and/or direct recipients through queue |

---

#### `announce({ organizationId, title, body, actorId, recipientUserIds? })`

Auth: authenticated. Org-wide announcement.

---

### 10. NLPService

Offline NLP analysis workspace. All algorithms are bundled, deterministic, and offline.

---

#### `importText({ organizationId, sourceType, sourceId, filename, rawText, actorId })`

Auth: `analyst` minimum.

---

#### `runBatch({ organizationId, modelVersion, actorId })`

Auth: `analyst` minimum. Analyzes all imported texts.

---

#### `runIncremental({ organizationId, modelVersion, actorId })`

| Field | Value |
|---|---|
| **Auth** | `analyst` minimum |
| **Behavior** | Auto-ingests new CRM/ticket notes, then analyzes texts updated since last run |

---

#### `ingestNotes({ organizationId })`

Auth: `analyst` minimum. Manual trigger for CRM/ticket note ingestion. Returns count.

---

#### `clusterTopics(organizationId)`

Auth: `analyst` or `reviewer`. Returns `{ topicName: [textId, ...] }` from latest run.

---

#### `disambiguateEntities(text)`

No auth. Returns `Array<{ text: string, type: 'PERSON' | 'ORG' | 'LOCATION' | 'PRODUCT' }>`.

---

#### `setF1Threshold(threshold, organizationId)`

Auth: `administrator`. Threshold: 0-1.

---

#### `createValidationProfile({ modelVersion, corpusName, precision, recall, f1, labeledSampleCount, actorId })`

Auth: `administrator`. All metrics 0-1, sampleCount >= 1 integer.

---

#### `getRunHistory(organizationId)` / `getImportedTexts(organizationId)` / `getRunDetail(runId)` / `listProfiles()`

Auth: `analyst` or `reviewer` minimum.

---

### 11. RiskReviewService

Risk case evaluation, bidding heuristics, linked accounts.

---

#### `evaluateRules({ organizationId, entityType, entityId, payload, actorId })`

Auth: `store_manager` minimum. Checks active rules + sensitive word dictionary.

---

#### `evaluateBiddingHeuristics({ organizationId, itemId, windowMs?, frequencyThreshold? })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Params** | `windowMs`: default 3600000 (60 min), `frequencyThreshold`: default 10 |
| **Returns** | `{ flagged: boolean, reason: string \| null, evidence: object }` |
| **Checks** | Bid frequency, device fingerprint clustering, linked-account relationships |

---

#### `evaluateAndAutoCase(params)`

Auth: `store_manager` minimum. Runs heuristics + auto-creates risk case if flagged (idempotent).

---

#### `ingestBidEvent({ organizationId, userId, itemId, deviceFingerprint?, bidAmount, actorId })`

Auth: `store_manager` minimum. `bidAmount` must be positive.

---

#### `ingestLinkedAccount({ organizationId, primaryUserId, linkedUserId, evidenceType, evidenceDetails, actorId })`

Auth: `store_manager` minimum. Users must differ.

---

#### `assignCase(caseId, reviewerId, actorId)`

Auth: `reviewer` minimum. Sets status: `in_review`.

---

#### `resolveCase({ caseId, outcomeCode, resolutionComment, reviewerId })`

| Field | Value |
|---|---|
| **Auth** | `reviewer` minimum |
| **Params** | `outcomeCode`: one of outcome codes enum. `resolutionComment`: non-empty. |

---

#### `dismissCase(caseId, resolutionComment, reviewerId)`

Auth: `reviewer` minimum. Sets `FALSE_POSITIVE` outcome.

---

#### `createRule({ organizationId, name, ruleType, targetEntityType, parameters, actorId })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Params** | `ruleType`: `field_contains` or `field_exceeds`. `parameters`: `{ field, value }` or `{ field, threshold }` |

---

#### `getInbox(organizationId)` / `listRules(organizationId)` / `validateImage(file)`

Auth: `store_manager` or `reviewer` minimum.

---

#### `updateSensitiveWords(words, actorId)`

Auth: `store_manager` minimum. Persists to org-scoped appConfig.

---

### 12. StyleService

Style SKU management with master data cross-references.

---

#### `createStyle({ organizationId, sku, colorId, sizeId, seasonId, brandId, supplierId, storeId, warehouseId?, actorId, reasonNote })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Validation** | All referenced master data must exist, be active, and belong to same org. Warehouse must be `warehouse` type. `reasonNote` >= 10 chars. |

---

#### `updateStyle(styleId, data, actorId, reasonNote)` / `deactivateStyle(styleId, actorId, reasonNote)`

Auth: `store_manager` minimum. Creates version record.

---

#### `getByOrg(organizationId)` / `getByStore(storeId)` / `getStyleVersionHistory(styleId)` / `getActiveStyleVersion(styleId)`

Auth: any authenticated.

---

### 13. LookupDataService

Master data reference tables: colors, sizes, seasons, brands, suppliers.

---

#### `createEntry({ store, organizationId, name, actorId, reasonNote })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Params** | `store`: `'colors'` / `'sizes'` / `'seasons'` / `'brands'` / `'suppliers'`. `reasonNote` >= 10 chars. |

---

#### `deactivateEntry({ store, entryId, actorId, reasonNote })`

Auth: `store_manager` minimum. Rejects if active styles reference entry.

---

#### `reactivateEntry({ store, entryId, actorId, reasonNote })`

Auth: `store_manager` minimum.

---

#### `listEntries(store, organizationId)`

Auth: any authenticated.

---

### 14. MasterDataService

Dataset publish model: one active version per entityType + org.

---

#### `publishVersion({ entityType, entityId, organizationId, payload, reasonNote, createdBy, expectedActiveVersionId })`

| Field | Value |
|---|---|
| **Auth** | `store_manager` minimum |
| **Behavior** | Atomically deactivates previous active, creates new. Optimistic concurrency via `expectedActiveVersionId`. |
| **Side Effects** | Dispatches `MASTER_DATA_PUBLISHED` event |

---

#### `getActiveVersion(entityType, organizationId)` / `getVersionHistory(entityId, organizationId?)` / `getAllActiveVersions(organizationId)`

Auth: any authenticated. Scope-enforced.

---

### 15. ImportExportService

Encrypted backup/restore with schema validation.

---

#### `exportBackup({ actorId, backupPassphrase })`

| Field | Value |
|---|---|
| **Auth** | `administrator` |
| **Params** | `backupPassphrase`: separate from login/org passphrase |
| **Returns** | `Promise<Blob>` (.json) |
| **Behavior** | Excludes protected stores (sessions, auditLogs), encrypts with backup passphrase |

---

#### `previewImport({ file, backupPassphrase })`

| Field | Value |
|---|---|
| **Auth** | `administrator` |
| **Returns** | `{ diff, snapshot, schemaVersion }` |

---

#### `applyImport({ snapshot, schemaVersion, actorId })`

| Field | Value |
|---|---|
| **Auth** | `administrator` |
| **Behavior** | Validates structure, reconciles versions, enforces single-active invariant. **Force-logs out after import.** |

---

### 16. CryptoService

Application-level encryption facade. AES-256-GCM with PBKDF2-SHA256 key derivation.

---

| Method | Description |
|---|---|
| `hashNewPassword(password)` | Returns `{ hash, salt }` (hex). PBKDF2 310k iterations. |
| `verifyPassword(password, saltHex, hashHex)` | Timing-safe comparison. |
| `deriveSessionKey(passphrase, saltHex)` | Caches CryptoKey in-memory. |
| `deriveKeyRaw(passphrase, saltHex)` | Returns key without caching. |
| `setSessionKey(key)` | Direct key injection. |
| `clearSessionKey()` | Clears in-memory key. |
| `isUnlocked()` | `true` if session key present. |
| `generateOrgSalt()` | Random 32-byte salt (hex). |
| `encrypt(plaintext)` | AES-256-GCM. Returns `{ ciphertext, iv, algorithmVersion }`. |
| `decrypt(ciphertextB64, ivHex)` | Returns plaintext string. |
| `maskValue(value)` | Returns `'••••••••'`. |
| `deriveBackupKey(passphrase)` | One-time key for backup encryption. |
| `resolveBackupKey(passphrase, saltHex)` | Re-derives backup key for import. |
| `encryptBackup(json, key)` / `decryptBackup(ct, iv, key)` | Backup-specific encryption. |
| `rotateEncryptedFields(envelopes, oldPw, salt, newPw)` | Re-encrypts fields (migration use). |

---

### 17. AuditService

Append-only event logging. No auth required.

| Method | Description |
|---|---|
| `log({ actorId, action, entityType, entityId, metadata? })` | Creates immutable audit entry |
| `getEntityHistory(entityId)` | All events for entity |
| `getActorHistory(actorId)` | All events by actor |
| `getSince(sinceMs)` | All events since timestamp |

---

### 18. SchedulerService

Periodic task runner with multi-tab leader election.

| Method | Description |
|---|---|
| `registerTask(name, fn, intervalMs)` | Queue task for registration |
| `start()` | Run all tasks immediately, start leader election |
| `stop()` | Cancel timers, release leadership |

**Leader Election:** localStorage key + 5s heartbeat. Leader TTL: 10s. BroadcastChannel for takeover.

**Registered Tasks:**
- `queue_check` — `notificationService.processDueItems()` every 30s
- `overdue_check` — `ticketService.evaluateOverdue()` every 5 min

---

## Encryption Model

### Architecture

- **Key Derivation:** PBKDF2-SHA256, 310,000 iterations
- **Data Encryption:** AES-256-GCM, 96-bit random IV per field
- **Salt:** 32-byte random per org (stored in appConfig)

### Key Management

- Login password is **never** used for data encryption
- Encryption key derived from **org passphrase** + org salt
- All users in same org share the same encryption key via shared passphrase
- Key held in-memory only; cleared on lock/logout

### Encrypted Fields

| Record | Fields |
|---|---|
| Customer | `storedValue`, `allergies`, `materialRestrictions` |

Each field stores: `{ ciphertext: base64, iv: hex }`

### Migration

Legacy systems (password-derived encryption) can migrate via `migrateToOrgPassphrase()`:
1. Decrypts all customer sensitive fields with old password-derived key
2. Re-encrypts with new passphrase-derived key
3. Sets passphrase verifier hash
4. Idempotent (rejects if already migrated)

---

## Versioning Models

### Record History (one active per entityId)

Used by: Customer, Style, Lookup entries (colors, sizes, seasons, brands, suppliers)

- Each mutation creates a new version record
- Previous active version deactivated
- Full audit trail via `versionNumber` sequence

### Dataset Publish (one active per entityType + org)

Used by: MasterDataService

- Optimistic concurrency via `expectedActiveVersionId`
- Atomic version switch (single IndexedDB transaction)
- Dispatches `MASTER_DATA_PUBLISHED` event

---

## Validation Rules

| Rule | Value |
|---|---|
| Password minimum length | 12 characters |
| Password requirements | >= 1 digit, >= 1 symbol |
| Reason note minimum | 10 characters |
| Allergy/restriction max | 500 characters |
| Compact template max | 160 characters rendered |
| Rating range | 1-5 (integer) |
| Stored value range | 0.00 - 999,999.99 |
| Guest trial duration | 30 minutes |
| Auto-lock timeout | 10 minutes |
| Default ticket SLA | 48 hours |
| Login lockout threshold | 5 failed attempts |
| Lockout duration | 15 minutes |
| Unlock max attempts | 5 (then forced logout) |
| Max image size | 5 MB |
| Allowed image types | PNG, JPEG (magic byte validated) |
| Retry schedule | [1, 5, 15] minutes |
| Max retries | 3 |
| F1 alert threshold | 0.70 (default, configurable) |
