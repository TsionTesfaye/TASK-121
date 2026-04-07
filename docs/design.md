# RetailOps Insight & Compliance Console — Design Document

## 1. System Overview

RetailOps Insight & Compliance Console is a fully offline, browser-based single-page application (SPA) for managing multi-store retail master data, customer communications, order progress, offline NLP analysis, and compliance/risk workflows.

Primary roles:
- Administrator
- Store Manager
- Analyst
- Reviewer

Core capabilities:
- organization hierarchy management
- versioned retail master data management
- customer CRM, orders, and after-sales tickets
- in-app notification and messaging queue
- offline NLP analysis on imported text and CRM notes
- content and risk review workflows
- encrypted local backup/import portability

The application runs entirely offline with all business logic implemented in a frontend service layer. Data is stored in IndexedDB (primary) and LocalStorage (secondary).

---

## 2. Design Goals

- Fully offline operation with no backend dependency
- Clear separation between UI, business logic, persistence, security utilities, and scheduler/queue runtime
- Deterministic workflows for versioning, order progress, ticket handling, notifications, analytics, and risk review
- Strict service-layer validation and fail-closed behavior
- Secure local handling of sensitive data through masking and encryption
- Modular design that can later support backend integration without major redesign
- Responsive, role-aware UI for desktop and tablet use
- Node 18-compatible test architecture for repository, service, and component tests

---

## 3. High-Level Architecture

The system follows a layered frontend-only architecture:

Svelte UI / Router / Components  
↓  
Application Services Layer  
↓  
Repository Layer (IndexedDB abstraction)  
↓  
IndexedDB + LocalStorage  

Supporting runtime modules:
- Validation Engine
- Crypto Service
- Scheduler / Timer Service
- Import/Export Service
- Notification Queue Processor
- NLP Processing Service
- Cross-Tab Coordination Service

### Architecture Principle

All business logic resides in services. UI components are responsible only for rendering, local interaction state, and invoking service methods.

### Offline-First Principle

All features must function without network access.
No external APIs, no remote channels, and no online NLP services are used.
All writes are committed locally first and treated as the source of truth.

### Multi-Tab Coordination Principle

The app must coordinate across tabs using:
- `BroadcastChannel` for state-change notifications
- a single-leader background worker policy for scheduler/queue processing
- optimistic version checks for master data publish operations

Only one tab may actively process queue retries and periodic overdue checks at a time.

---

## 4. Repository Abstraction

Each domain defines:
- a repository interface
- a concrete IndexedDB implementation

Flow:
Service → Repository → IndexedDB

Benefits:
- decouples business logic from storage
- improves maintainability
- enables future backend integration
- prevents direct IndexedDB access from UI code

---

## 5. Frontend Architecture

### 5.1 Framework

- Svelte SPA
- frontend routing
- responsive layout
- browser-only runtime

### 5.2 Route Structure

- `/login`
- `/org-setup`
- `/master-data`
- `/crm`
- `/orders`
- `/messages`
- `/nlp`
- `/risk-review`
- `/admin`

### 5.3 UI Composition

- app shell with role-based navigation
- page-level workspaces
- reusable components such as tables, tree views, modals, drawers, filters, and status badges

### 5.4 Core UI Components

- organization hierarchy tree
- editable master data table
- version history drawer
- modal forms with reason-note enforcement
- CRM customer detail panel
- order detail panel with restriction flags
- ticket queue and SLA badge display
- notification queue table
- template editor with placeholder validation
- NLP run history panel
- risk review inbox
- compliance case resolution form

---

## 6. Application Services Layer

All business logic is implemented in frontend services.

### 6.1 AuthService

Responsibilities:
- local username/password authentication
- password validation
- guest trial session handling
- inactivity lock enforcement
- password re-entry for decryption unlock
- password change with protected-data re-encryption
- account deactivation handling

### 6.2 OrgService

Responsibilities:
- organization tree CRUD
- parent-child validation
- hierarchy traversal
- subtree scoping for role access

### 6.3 MasterDataService

Responsibilities:
- master data CRUD
- version creation and publishing
- active/inactive state enforcement
- reference validation
- reason-note validation
- version history retrieval
- optimistic concurrency validation for publish

### 6.4 StyleService

Responsibilities:
- style SKU CRUD
- validation of referenced color, size, season, brand, supplier, and warehouse/store scope
- blocking of new references to inactive master data
- style version/reference audit logging

### 6.5 CustomerService

Responsibilities:
- customer record CRUD
- membership tier updates
- points and stored value validation
- allergy/material restriction validation and encryption
- rating updates
- masking/unmasking of sensitive fields

### 6.6 OrderService

Responsibilities:
- order CRUD
- order progress transitions
- allergy/material restriction flagging on orders
- notification trigger generation
- order event logging

### 6.7 TicketService

Responsibilities:
- after-sales ticket creation
- ticket state transitions
- SLA timer evaluation
- overdue flagging
- ticket assignment and resolution
- customer notification triggers

### 6.8 NotificationService

Responsibilities:
- channel configuration
- subscription rule evaluation
- template validation
- queue creation
- delivery status transitions
- retry scheduling
- read/unread notification center handling

### 6.9 TemplateService

Responsibilities:
- message template CRUD
- placeholder validation
- compact notice length validation
- variable substitution before queueing

### 6.10 NLPService

Responsibilities:
- imported text ingestion
- keyword extraction
- summary generation
- topic clustering/classification
- sentiment analysis
- dictionary-based NER
- entity disambiguation
- incremental “analyze new notes” processing
- model version and benchmark metric storage

### 6.11 RiskReviewService

Responsibilities:
- machine-rule evaluation
- sensitive-word matching
- image file validation
- abnormal bidding/order-event heuristic checks
- linked account pattern checks
- case generation
- reviewer decision workflows
- outcome-code enforcement

### 6.12 ImportExportService

Responsibilities:
- full encrypted backup export
- import schema validation
- preview diff generation
- safe apply/replace behavior
- protected-store handling
- migration/version checks

### 6.13 CryptoService

Responsibilities:
- password hashing
- passphrase-derived key creation
- field encryption/decryption
- IV generation and storage
- key rotation during password change
- masking helpers for sensitive values

### 6.14 AuditService

Responsibilities:
- append-only event logs
- version publish logs
- order and ticket updates
- notification status logs
- reviewer action logs
- import/export event logs

### 6.15 SchedulerService

Responsibilities:
- retry queue timing
- ticket SLA timer checks
- notification retry progression
- overdue work detection on startup
- missed scheduled work reconciliation

---

## 7. Data Persistence Design

### 7.1 IndexedDB Stores

- users
- sessions
- organizations
- masterDataVersions
- styles
- colors
- sizes
- seasons
- brands
- suppliers
- warehouses
- customers
- orders
- orderEvents
- tickets
- ticketEvents
- notificationChannels
- notificationSubscriptions
- templates
- messageQueue
- notifications
- importedTexts
- validationProfiles
- nlpRuns
- riskRules
- riskCases
- bidEvents
- linkedAccounts
- auditLogs
- appConfig

### 7.2 LocalStorage

- UI preferences
- last selected store
- table column layouts
- non-sensitive session/UI flags
- best-effort device fingerprint seed

### 7.3 Principle

Repositories are the only layer interacting with IndexedDB.

### 7.4 Storage Strategy for Versioned Master Data

- `masterDataVersions` stores version history for all versioned master data entities
- dedicated entity stores (`styles`, `colors`, `sizes`, `seasons`, `brands`, `suppliers`) store the current resolved record only
- publish operations update both history and current-state stores atomically

### 7.5 Schema Versioning

The IndexedDB schema includes a version number.
Database upgrades are handled through controlled migration steps to preserve compatibility across app updates and imports.

---

## 8. Domain Models

### 8.1 User

Fields:
- id
- username
- passwordHash
- passwordSalt
- role
- organizationNodeId
- isActive
- isGuest
- guestExpiresAt
- lockoutUntil
- createdAt
- updatedAt

### 8.2 OrganizationNode

Fields:
- id
- parentId
- type
- name
- organizationId
- createdAt
- updatedAt

Types:
- company
- factory
- store
- warehouse

Valid parent-child pairs:
- company → factory
- factory → store
- store → warehouse

### 8.3 MasterDataVersion

Fields:
- id
- organizationId
- entityType
- entityId
- versionNumber
- payload
- reasonNote
- isActive
- createdBy
- createdAt

### 8.4 Style

Fields:
- id
- organizationId
- sku
- colorId
- sizeId
- seasonId
- brandId
- supplierId
- storeId
- warehouseId
- isActive
- createdAt
- updatedAt

### 8.5 Customer

Fields:
- id
- organizationId
- name
- membershipTier
- points
- storedValueCiphertext
- storedValueIv
- allergiesCiphertext
- allergiesIv
- materialRestrictionsCiphertext
- materialRestrictionsIv
- ratingAverage
- ratingCount
- createdAt
- updatedAt

Membership tiers:
- Bronze
- Silver
- Gold

### 8.6 Order

Fields:
- id
- customerId
- organizationId
- storeId
- status
- restrictionFlags
- createdAt
- updatedAt

Statuses:
- draft
- placed
- in_progress
- ready
- completed
- canceled

### 8.7 OrderEvent

Fields:
- id
- orderId
- type
- actorId
- createdAt
- metadata

### 8.8 Ticket

Fields:
- id
- customerId
- orderId
- organizationId
- storeId
- subject
- description
- category
- priority
- status
- slaDueAt
- isOverdue
- assignedTo
- createdAt
- updatedAt
- resolvedAt
- closedBy

Statuses:
- open
- in_progress
- resolved
- closed

Priorities:
- low
- medium
- high

### 8.9 TicketEvent

Fields:
- id
- ticketId
- type
- comment
- actorId
- createdAt

Valid event types:
- created
- assigned
- replied
- resolved
- closed
- overdue

### 8.10 NotificationChannel

Fields:
- id
- organizationId
- name
- type
- isEnabled
- createdAt
- updatedAt

Types:
- in_app

### 8.11 NotificationSubscription

Fields:
- id
- userId
- channelId
- eventType
- filters
- isEnabled

### 8.12 NotificationTemplate

Fields:
- id
- organizationId
- name
- body
- placeholders
- isCompact
- createdAt
- updatedAt

### 8.13 MessageQueueItem

Fields:
- id
- organizationId
- recipientUserId
- templateId
- channelId
- payload
- renderedBody
- status
- retryCount
- nextRetryAt
- failureReason
- createdAt
- updatedAt

Statuses:
- Draft
- Queued
- Sent
- Failed

### 8.14 Notification

Fields:
- id
- userId
- type
- title
- body
- read
- createdAt

### 8.15 ImportedText

Fields:
- id
- sourceType
- sourceId
- filename
- rawText
- sizeBytes
- importedAt
- updatedAt

### 8.16 ValidationProfile

Fields:
- id
- modelVersion
- corpusName
- precision
- recall
- f1
- labeledSampleCount
- createdAt

### 8.17 NLPRun

Fields:
- id
- organizationId
- runType
- modelVersion
- inputIds
- outputPayload
- benchmarkPrecision
- benchmarkRecall
- benchmarkF1
- createdBy
- createdAt

### 8.18 RiskRule

Fields:
- id
- organizationId
- name
- targetEntityType
- ruleType
- parameters
- isActive
- createdAt
- updatedAt

### 8.19 BidEvent

Fields:
- id
- organizationId
- itemId
- userId
- deviceFingerprint
- amount
- createdAt

### 8.20 LinkedAccount

Fields:
- id
- organizationId
- primaryUserId
- linkedUserId
- linkType
- evidence
- createdAt

### 8.21 RiskCase

Fields:
- id
- organizationId
- sourceType
- sourceId
- ruleMatches
- status
- outcomeCode
- resolutionComment
- assignedReviewerId
- createdAt
- resolvedAt

Statuses:
- open
- in_review
- resolved
- dismissed

Valid outcome codes:
- no_issue
- warning_issued
- content_removed
- account_link_confirmed
- suspicious_activity_confirmed
- false_positive

### 8.22 AppConfig

Fields:
- id
- organizationId
- defaultTicketSlaHours
- queueRetryScheduleMinutes
- compactNoticeLimit
- maxAllergyChars
- maxImageBytes
- riskThresholds
- createdAt
- updatedAt

### 8.23 AuditLog

Fields:
- id
- actorId
- action
- entityType
- entityId
- metadata
- createdAt

---

## 9. Authentication, Security, and RBAC Design

### 9.1 Authentication Model

- local-only username/password login
- no OAuth
- no external identity provider
- optional guest trial mode
- role access derived locally

### 9.2 Password Handling

- passwords hashed using PBKDF2 via Web Crypto
- per-user random salt stored alongside password hash
- PBKDF2 parameters are fixed in app config and versioned
- verification performed locally

### 9.3 Encryption at Rest

Sensitive data is encrypted using AES-GCM.
Each encrypted field stores:
- ciphertext
- unique 96-bit IV
- algorithm version

### 9.4 Key Lifecycle

- the data key is derived from the user password per unlocked session
- lock/logout clears the in-memory key
- password change triggers a protected-data re-encryption migration before commit
- encrypted backup export uses a separate backup passphrase, not the login password

### 9.5 Guest Trial Mode

- guest sessions are read-only
- automatically expire after 30 minutes
- blocked from all write actions and encrypted-field reveal actions
- on expiry, user is redirected to login and in-memory decrypted state is cleared

### 9.6 Auto-Lock

- app auto-locks after 10 minutes of inactivity
- protected data becomes inaccessible until password is re-entered
- lock state propagates across tabs

### 9.7 RBAC Permission Matrix

#### Administrator
- manage organizations, users, roles, policies, app config, import/export
- publish/deactivate master data
- view all CRM, orders, tickets, notifications, NLP runs, and risk cases
- manage templates, channels, and subscriptions
- view audit logs

#### Store Manager
- manage store-scoped master data and styles
- manage customers, orders, tickets, and store-level notifications
- cannot manage NLP configurations or reviewer outcomes outside assigned scope

#### Analyst
- import texts
- run NLP jobs
- view NLP runs and validation profiles
- cannot publish master data, resolve risk cases, or manage users

#### Reviewer
- access risk inbox
- review cases
- assign outcome codes
- dismiss/resolve alerts
- cannot modify master data or CRM financial fields

### 9.8 Security Limitation

Because the system is a pure offline frontend SPA, authentication and RBAC are local-only protections and are not equivalent to server-enforced security.
All service-layer checks still must be implemented for internal consistency and QA compliance.

---

## 10. Organization Setup Design

### 10.1 Hierarchy Management

The Organization Setup workspace manages:
- company
- factory
- store
- warehouse

### 10.2 Tree Integrity

Rules:
- every node has exactly one parent except the root company
- cycles are not allowed
- child type must be valid for parent type
- users only see/edit nodes inside their scope

### 10.3 Editable Table Integration

The table view and tree view operate over the same source of truth and must remain synchronized after edits.

---

## 11. Master Data and Versioning Design

### 11.1 Supported Master Data

- style SKU
- color
- size
- season
- brand
- supplier
- customer

### 11.2 Change Workflow

1. user opens modal form
2. edits data
3. enters reason note
4. submits
5. new version is created
6. active version switches atomically

### 11.3 Active Version Rule

Only one active version per entity type per organization may exist at a time.

### 11.4 Deactivation Rule

Deactivated records:
- remain visible in history
- cannot be referenced by new styles
- may still appear in legacy records

### 11.5 Version History

Historical versions are immutable and retained for audit purposes.
Publish operations must fail if the record changed since the editor loaded it.

---

## 12. CRM, Orders, and Ticketing Design

### 12.1 Customer Preferences

Customer profiles support:
- allergies/material restrictions
- membership tiers
- points
- stored value in USD to two decimals
- service ratings

Allergy/material restriction input is validated against the 500-character limit before encryption.

### 12.2 Order Workflow

Orders support:
- creation
- order progress transitions
- restriction flag display
- event logging
- notification triggers

### 12.3 Ticket Workflow

Tickets support:
- creation
- assignment
- progress tracking
- overdue evaluation
- resolution logging

### 12.4 SLA Design

Default SLA:
- 48 hours from ticket creation

If exceeded:
- ticket is flagged overdue
- notification may be generated
- ticket remains active until resolved

---

## 13. Notification and Messaging Design

### 13.1 Offline Constraint

Messaging is in-app only.
No SMS, email, WeChat, or external channels are executed.

### 13.2 Queue Triggers

Queue items may be generated from:
- publish events
- deadlines
- announcements
- order progress
- ticket updates
- NLP review alerts
- risk case updates

### 13.3 Template Rules

Templates must:
- validate required placeholders
- enforce the 160-character limit on the rendered compact message after substitution
- fail queueing if post-substitution compact content exceeds 160 characters

### 13.4 Delivery Status Workflow

Draft → Queued → Sent → Failed

Meaning of Sent:
- the queue item was successfully materialized into the recipient’s in-app notification inbox and logged

Meaning of Failed:
- local processing failed because of validation, template, encryption, or storage error after all retries

Retries:
- 1 minute
- 5 minutes
- 15 minutes

After final retry failure:
- status becomes Failed
- no further attempts are scheduled

---

## 14. NLP Analysis Design

### 14.1 Supported NLP Functions

The offline NLP workspace uses bundled local processors:
- keyword extraction via rule-based and frequency analysis
- summary extraction via extractive summarization
- topic classification via lightweight keyword/TF-IDF classifiers
- sentiment analysis via bundled lexicon/rule models
- dictionary-based NER
- deterministic entity disambiguation via local alias dictionaries

### 14.2 Batch and Incremental Runs

The workspace supports:
- full batch runs
- incremental analysis of new or updated CRM notes since last run

### 14.3 Run Metadata

Every run stores:
- model version label
- run type
- createdBy
- benchmark precision/recall/F1 metrics from the active validation profile

### 14.4 Quality Threshold

If the active validation profile benchmark has F1 < 0.70:
- result is flagged
- warning is shown
- output remains available for review

### 14.5 NLP Scope Constraint

The system does not attempt large transformer-based online-scale NLP in browser runtime.
All supported NLP must fit within bundled offline assets and acceptable browser memory limits.

---

## 15. Content and Risk Review Design

### 15.1 Machine Rules + Manual Review

Risk review combines:
- configurable machine rules
- sensitive-word matching
- manual reviewer decisions

### 15.2 Image Validation

Only:
- PNG
- JPEG

Maximum size:
- 5 MB

Validation checks MIME type and file signature bytes before storage.

### 15.3 Abnormal Bidding / Shill Detection

Risk heuristics evaluate:
- bid event frequency thresholds
- local device fingerprint correlations
- linked account patterns

Device fingerprinting is best-effort only and not treated as a unique identifier.

### 15.4 Closed-Loop Resolution

Each risk case must be resolved with:
- outcome code
- comment
- reviewer attribution
- resolution timestamp

No case can be closed without a reviewer decision.

---

## 16. Import/Export and Recovery Design

### 16.1 Export

Admins can export a full encrypted JSON backup via browser download.

### 16.2 Import

Import flow:
1. select file
2. validate schema version
3. compute preview diff
4. load into staging
5. confirm apply
6. atomically replace live stores where supported

### 16.3 Protected Data Handling

Sessions and audit logs are protected stores and are excluded from standard import overwrite.

### 16.4 Recovery

A valid import acts as a restore operation on another machine.

---

## 17. Error Handling Strategy

- invalid operations are blocked in services, not only in UI
- user-facing failures produce clear inline or toast feedback
- schema, crypto, and parsing errors are surfaced clearly
- no silent failure for authentication, version publish, queue processing, order handling, ticket handling, or review workflows

---

## 18. Logging and Diagnostics

Planned logging:
- authentication attempts
- version publish actions
- order and ticket updates
- queue retries/failures
- NLP run creation
- risk review actions
- import/export operations

Logs are local and may be stored in IndexedDB for diagnostic review/export.

---

## 19. Testing Strategy

### 19.1 Unit Tests

Focus areas:
- password validation and hashing
- AES-GCM encrypt/decrypt envelope handling
- version switching and optimistic publish guards
- reason-note validation
- deactivated record reference blocking
- order restriction flagging
- ticket SLA calculation
- template placeholder validation
- rendered compact length validation
- retry scheduling
- risk rule evaluation

### 19.2 UI / Component Tests

Focus areas:
- tree + table synchronization
- modal form validation
- CRM masking/unmasking
- order flag rendering
- queue status rendering
- NLP run history display
- risk inbox filters
- role-aware navigation

### 19.3 End-to-End Flows

- login / logout / auto-lock / unlock
- password change with re-encryption
- create and publish master data version
- block new style reference to deactivated record
- create order with restriction flag
- create ticket and observe overdue state
- queue message and process retries
- import text and run NLP analysis
- create and resolve risk case
- export encrypted backup and restore

### 19.4 Node 18 Test Environment Strategy

Node 18 test runs use:
- `fake-indexeddb` for IndexedDB APIs
- `jsdom` or equivalent DOM shim for component tests
- `node:crypto` Web Crypto for PBKDF2/AES-GCM tests
- mocked `BroadcastChannel` for cross-tab coordination tests

---

## 20. Implementation Constraints

- Pure frontend only
- No backend calls
- All logic must exist in services
- IndexedDB is source of truth for structured data
- LocalStorage stores lightweight UI/session preferences only
- No mock-only UI
- Must run in a Node 18-compatible toolchain for tests/build verification

---

## 21. Future Integration Readiness

Although offline-first is the current runtime model, the design remains integration-ready by:
- using repository abstractions
- isolating service logic from storage logic
- separating crypto, import/export, NLP, queue processing, and cross-tab coordination concerns
- keeping domain workflows independent from specific persistence details

This allows future replacement of local repositories with API-backed adapters without redesigning business workflows.