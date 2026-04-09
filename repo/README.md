# RetailOps Insight & Compliance Console

A fully offline, browser-based SPA for managing multi-store retail master data,
customer communications, NLP analysis, and compliance/risk workflows.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | Svelte 4 |
| Build Tool | Vite 5 |
| Test Framework | Vitest 1 |
| Storage (primary) | IndexedDB via repository abstraction |
| Storage (secondary) | LocalStorage (UI preferences) |
| Encryption | Web Crypto API (AES-GCM / PBKDF2) |
| Cross-tab | BroadcastChannel |

---

## Quickstart (Docker)

The recommended way to run the project is via Docker. No local Node installation required.

### Run the full test suite

```bash
docker-compose up test
```

Builds the image (Node 18 Alpine), installs dependencies, and runs the full test suite.
Exit code 0 means all tests passed.

### Start the development server

```bash
docker-compose up dev
```

Opens the Vite dev server. Navigate to `http://localhost:5173` in a browser.

### Build and run in one step

```bash
docker-compose up
```

Runs the `test` service by default.

---

## Local Installation (Node 18.x required)

The project requires **Node 18.x or later**. Use NVM to pin the version:

```bash
nvm install 18
nvm use 18
```

Install dependencies:

```bash
npm install
```

### Development server

```bash
npm run dev
```

Opens at `http://localhost:5173`. The app runs entirely offline — no network
requests are made after the initial page load.

### Production build

```bash
npm run build
npm run preview
```

---

## Test Suite

```bash
# Run the full test suite once
npm run test

# Watch mode (re-runs on file change)
npm run test:watch

# Coverage report (output written to coverage/)
npm run test:coverage
```

### Test environment

All tests run in a **jsdom** environment under Node 18. The suite covers five
distinct layers:

| Layer | Description |
|-------|-------------|
| Unit | Pure function and service logic, validators, RBAC, state machines |
| Integration | Services with real IndexedDB (fake-indexeddb) |
| Simulation | Auth lockout flows, multi-tab coordination |
| E2E (simulation-based) | Full user journeys through real service and repository layers |
| Component | Svelte component behaviour in jsdom |

### E2E testing strategy

The primary E2E suite is **simulation-based**: it exercises the full service +
repository + IndexedDB stack directly in Node using `fake-indexeddb`. This gives
complete, deterministic coverage of every user flow — auth, orders, tickets, CRM,
NLP, risk review, import/export — without requiring a running browser or network.

A single **Playwright + Chromium** smoke test supplements the simulation suite
with real browser-driver confidence (see [Browser smoke test](#browser-smoke-test-playwright) below).

The simulation-first approach was chosen because:
- The system has no backend — all logic lives in services and IndexedDB
- Deterministic execution eliminates flakiness from DOM timing
- The Playwright smoke test covers the minimal bootstrap → login → protected page flow that only a real browser can verify

Browser API shims used in tests:

| Browser API | Test shim |
|-------------|-----------|
| IndexedDB | `fake-indexeddb/auto` (shimmed in `tests/setup.js`) |
| Web Crypto | `globalThis.crypto.subtle` (native in Node 18) |
| BroadcastChannel | Lightweight in-process mock (`tests/setup.js`) |
| LocalStorage | jsdom built-in |

### Browser smoke test (Playwright)

A single Playwright + Chromium smoke test provides real browser-driver confidence
on top of the simulation-based suite. It covers bootstrap → login → protected
page load → route guard redirect.

The simulation-based E2E suite remains the primary test strategy.

```bash
# Build the app first, then run the browser smoke test
npm run build
npm run test:browser
```

---

## Architecture

```
src/
├── app/
│   ├── router/          Hash-based SPA router
│   └── stores/          Svelte writable stores (auth, org, ui)
│
├── modules/             Feature module re-exports (one per domain)
│   └── <domain>/index.js
│
├── pages/               Svelte page components (one per route)
│
├── services/            ALL business logic lives here
│   ├── AuthService.js
│   ├── CryptoService.js
│   ├── MasterDataService.js
│   ├── CustomerService.js
│   ├── OrderService.js
│   ├── TicketService.js
│   ├── NotificationService.js
│   ├── TemplateService.js
│   ├── NLPService.js
│   ├── RiskReviewService.js
│   ├── ImportExportService.js
│   ├── AuditService.js
│   ├── OrgService.js
│   ├── StyleService.js
│   └── SchedulerService.js
│
├── repositories/
│   ├── base/            IRepository interface + BaseRepository (IndexedDB)
│   └── implementations/ One repository class per domain
│
├── infrastructure/
│   ├── db/              IndexedDB schema + init module
│   ├── crypto/          Web Crypto primitives
│   ├── scheduler/       Timer manager (setTimeout wrapper)
│   └── broadcast/       BroadcastChannel wrapper
│
└── utils/
    ├── constants.js     Domain enums and validation limits
    ├── validation.js    Pure validation functions (no side effects)
    └── idGenerator.js   UUID and prefixed ID generators
```

### Layer rules (enforced by architecture)

```
Svelte UI / Router
       ↓  (calls service methods only)
Services Layer
       ↓  (calls repository methods only)
Repository Layer
       ↓  (calls IndexedDB only)
IndexedDB / LocalStorage
```

- **UI components** may only call service methods and read Svelte stores.
- **Services** may only call repositories, infrastructure modules, and other services.
- **Repositories** are the only layer that touches IndexedDB directly.
- **No service** calls `getDB()` directly — all DB access goes through repository methods.

---

## Authentication & Password Rules

### Password requirements

All passwords (at creation and change) must satisfy:

- Minimum **12 characters**
- At least **one digit** (0–9)
- At least **one symbol** (any non-alphanumeric character)

Passwords that do not meet these rules are rejected at the service layer before any
hashing occurs.

### Login lockout

After **5 consecutive failed login attempts**, the account is locked for **15 minutes**.
The lockout timestamp is persisted in IndexedDB. The same generic error message
(`Invalid username or password`) is returned regardless of whether a lockout has
been triggered, to prevent username enumeration.

### Session auto-lock

After **10 minutes of inactivity**, the session locks automatically. The encryption
key is cleared from memory. The user must re-enter their password to unlock. On
successful unlock, the data encryption key is automatically restored from the
per-user wrapped org passphrase — no separate passphrase prompt is needed.

### Unlock attempt limit

If the unlock password is entered incorrectly **5 times in a row**, the session is
**forcibly terminated** (full logout). The user must log in from scratch. This
prevents brute-force attacks against a locked but active session.

### Guest sessions

A guest session is a read-only, temporary session with no persistent identity.
Guest sessions are automatically scoped to the bootstrapped organization so guests
can explore existing CRM data. They **hard-expire after 30 minutes** and are
automatically redirected to the login page. Guests cannot perform any write
operations (subscribe, enqueue, create, update, or delete).

---

## RBAC — Roles and Permissions

The system has five roles. The `administrator` role bypasses all organization-scope
checks and can access data from any organization.

### Role summary

| Role | Description |
|------|-------------|
| `administrator` | Full system access across all organizations |
| `store_manager` | Manages orders, tickets, customers, styles within their org |
| `analyst` | Reads CRM data; runs NLP analysis within their org |
| `reviewer` | Manages risk review cases within their org |
| `guest` | Read-only access to CRM data; 30-minute session limit |

### Permissions by role

| Operation | Administrator | Store Manager | Analyst | Reviewer | Guest |
|-----------|:---:|:---:|:---:|:---:|:---:|
| Create / manage users | ✓ | — | — | — | — |
| Create / update customers | ✓ | ✓ | — | — | — |
| Read customer CRM data | ✓ | ✓ | ✓ | — | ✓ |
| Reveal encrypted customer fields | ✓ | ✓ | — | — | — |
| Create / transition orders | ✓ | ✓ | — | — | — |
| Read order data | ✓ | ✓ | — | — | — |
| Create / manage tickets | ✓ | ✓ | — | — | — |
| Review risk cases (inbox/assign/resolve) | ✓ | — | — | ✓ | — |
| Manage risk rules/dictionary/heuristics | ✓ | ✓ | — | — | — |
| Import / run NLP analysis | ✓ | — | ✓ | — | — |
| View NLP runs and history | ✓ | — | ✓ | ✓ | — |
| Create validation profiles | ✓ | — | — | — | — |
| Create / manage templates | ✓ | ✓ | — | — | — |
| Publish master data versions | ✓ | ✓ | — | — | — |
| Create / manage styles (SKUs) | ✓ | ✓ | — | — | — |
| Export / import backup | ✓ | — | — | — | — |
| Org setup and admin panel | ✓ | — | — | — | — |

All non-administrator roles are **organization-scoped**: they can only access records
whose `organizationId` matches their own `organizationNodeId`. Any cross-org access
attempt throws a `Scope violation` error.

---

## State Machines

### Order lifecycle

```
DRAFT ──→ PLACED ──→ IN_PROGRESS ──→ READY ──→ COMPLETED (terminal)
  │          │              │            │
  └──────────┴──────────────┴────────────┴──→ CANCELED (terminal)
```

| From | Allowed transitions |
|------|-------------------|
| `draft` | `placed`, `canceled` |
| `placed` | `in_progress`, `canceled` |
| `in_progress` | `ready`, `canceled` |
| `ready` | `completed`, `canceled` |
| `completed` | — (terminal) |
| `canceled` | — (terminal) |

Once an order reaches `completed` or `canceled`, no further transitions are possible.

---

### Ticket lifecycle

```
OPEN ──→ IN_PROGRESS ──→ RESOLVED ──→ CLOSED (terminal)
  │             │
  └─────────────┴──→ CLOSED (terminal)
```

| From | Allowed transitions |
|------|-------------------|
| `open` | `in_progress`, `closed` |
| `in_progress` | `resolved`, `closed` |
| `resolved` | `closed` |
| `closed` | — (terminal) |

Tickets enter `in_progress` automatically when assigned to an agent.
SLA due time is calculated at creation. Overdue evaluation runs on a scheduler.

---

### Risk case lifecycle

```
OPEN ──→ IN_REVIEW ──→ RESOLVED  (terminal)
                   └─→ DISMISSED (terminal)
```

| From | Allowed transitions |
|------|-------------------|
| `open` | `in_review` (via assignCase) |
| `in_review` | `resolved` (via resolveCase), `dismissed` (via dismissCase) |
| `resolved` | — (terminal) |
| `dismissed` | — (terminal) |

Resolving a case requires a valid outcome code from:
`no_issue`, `warning_issued`, `content_removed`, `account_link_confirmed`,
`suspicious_activity_confirmed`, `false_positive`.

---

### Notification queue lifecycle

```
DRAFT ──→ QUEUED ──→ SENT    (terminal)
  ↑          └──→ FAILED  (terminal, after max retries)
  │
  └── requeueDraft() (after correcting missing variables)
```

| Status | Meaning |
|--------|---------|
| `Draft` | Template variables missing — awaiting correction via `requeueDraft()` |
| `Queued` | Pending delivery |
| `Sent` | Successfully written to recipient's notifications store |
| `Failed` | All retry attempts exhausted |

Retry schedule: **1 min → 5 min → 15 min** (max 3 retries). Because the system is
offline-only, "Sent" means the record was successfully written to the recipient's
in-app IndexedDB `notifications` store — not delivered over a network.

Draft items can be remediated from the Messages → Queue tab by editing the template
variables and clicking "Requeue." This transitions the item back to `Queued` for
normal delivery processing.

### Import mode

Imports use **full restore** mode: each store in the snapshot is cleared and replaced
atomically in a single IndexedDB transaction. If any write fails, the entire
transaction aborts — no partial state is left. Protected stores (`sessions`,
`auditLogs`) are never touched. After import, the session is forcibly logged out.

### Test suite

All tests are simulation-based (no real browser driver). The suite exercises the
full service + repository + IndexedDB stack using `fake-indexeddb` in Node.
See [E2E testing strategy](#e2e-testing-strategy) for rationale.

---

## Key Design Decisions

### Master data versioning

The system uses two explicit versioning models:

**Dataset publish path** (MasterDataService.publishVersion):
One active version per `(entityType, organizationId)`. Publishing a new version
atomically deactivates the previous active version in a single IndexedDB
transaction (`MasterDataRepository.atomicVersionSwitch`). An optimistic concurrency
check (`expectedActiveVersionId`) prevents lost-update conflicts when multiple tabs
have the same editor open.

**Record history path** (LookupDataService, StyleService, CustomerService versioning):
One active version per `entityId`. Each create, update, or deactivate mutation
creates a new version record and deactivates all prior active versions for that
specific entity. This allows multiple entities of the same type (e.g. two different
colors) to each have their own independent version history.

### Encryption

- Password hashing: PBKDF2 / SHA-256 / 310,000 iterations.
- Field encryption: AES-GCM / 256-bit key / unique 96-bit IV per operation.
- Session key: derived from the org passphrase + organization-level salt; cleared on lock/logout.
- Backup key: derived from a **separate** backup passphrase (not the login password).
- IV is stored alongside ciphertext in the Customer model (`storedValueIv`, `allergiesIv`, etc.).

#### Encryption model

The data encryption key is derived from an **org passphrase** combined with an
organization-level salt (generated at bootstrap, stored in `appConfig`). At bootstrap
the org passphrase defaults to the admin password.

The org passphrase is **wrapped (encrypted) per-user** with a key derived from each
user's login password and stored on the user record. This means:

- On **login**, the system automatically unwraps the org passphrase using the login
  password and derives the session encryption key. No separate passphrase prompt is
  required.
- On **session unlock** after inactivity lock, the same automatic unwrapping occurs —
  the user's password restores both the session and the data decryption capability.
- Users within the same org share the same underlying encryption key, regardless of
  their individual login passwords.
- **Password changes** automatically re-wrap the org passphrase with the new password.
- **Logout** and **session lock** clear the encryption key from memory.

The org salt lookup works for users assigned at **any level** of the hierarchy
(company, factory, store, warehouse) — all resolve to the same root company salt.

Security properties:

- No extractable key material is stored in plaintext — the org passphrase exists
  only wrapped per-user, and the derived CryptoKey lives only in memory during an
  unlocked session.
- Cross-org isolation is enforced: each organization has its own salt and passphrase.

### Multi-tab coordination

Only one tab runs the scheduler (queue retries, SLA overdue checks) at a time.
Leader election uses `BroadcastChannel` heartbeats with a timestamp in `LocalStorage`.
Lock state changes are broadcast so all tabs lock simultaneously.

### NLP

All NLP processing uses bundled, deterministic, offline processors:
TF-IDF keyword extraction, extractive summarization, keyword-bag topic classification,
lexicon sentiment, and regex-based NER.
Quality metrics (precision/recall/F1) come from a stored `ValidationProfile`
associated with the model version, not from per-run ground-truth evaluation.

---

## Import / Export

The backup system exports all non-protected IndexedDB stores as an AES-GCM
encrypted JSON file. A separate backup passphrase (independent of the login
password) is required to encrypt and decrypt backups.

### Protected stores

`sessions` and `auditLogs` are **never exported and never overwritten** during a
restore. The audit trail cannot be erased by a backup operation.

### Import workflow

1. **`previewImport`** — decrypts the backup, validates the schema version, and
   returns a diff showing what records would be added, updated, or deleted.
   No changes are applied at this stage.

2. **`applyImport`** — applies the snapshot. Requires the `schemaVersion` returned
   by `previewImport` to be passed explicitly. If the schema version in the backup
   does not match the current database version, the import is rejected with a
   `Schema version mismatch` error. This prevents applying a backup built for a
   different schema against the live database. **After a successful import, the
   current session is forcibly logged out.** This ensures no stale permissions or
   crypto state survives the dataset replacement. The user must log in again
   against the imported data.

### Customer data fields

Sensitive customer fields encrypted at rest:

| Field | Description |
|-------|-------------|
| `storedValue` | Account balance in USD (2 decimal places max) |
| `allergies` | Free-text allergy notes (max 500 chars) |
| `materialRestrictions` | Free-text restriction notes (max 500 chars) |

Membership tiers: `Bronze`, `Silver`, `Gold`.

---

## Routes

| Hash path | Page | Min role |
|-----------|------|----------|
| `/login` | Login | Public |
| `/bootstrap` | Bootstrap | Public (first-run only) |
| `/crm` | Customer CRM | Guest+ (all authenticated) |
| `/orders` | Orders | Store Manager+ |
| `/master-data` | Master Data | Store Manager+ |
| `/messages` | Notifications | Store Manager+ |
| `/nlp` | NLP Analysis | Analyst+ |
| `/tickets` | Ticket Management | Store Manager+, Reviewer (read-only) |
| `/risk-review` | Risk Review | Store Manager+ (operations), Reviewer (inbox) |
| `/org-setup` | Org Setup | Admin |
| `/admin` | Administration | Admin |

---

## Known Limitations

- **Device-local only.** All data is stored in the browser's IndexedDB. There is no
  server, no cloud sync, and no network communication after page load. Data exists
  only on the device and browser where it was created.

- **Clearing browser storage destroys all data.** There is no server-side backup.
  The only recovery mechanism is a previously exported encrypted backup file.

- **Multi-user on the same device share one IndexedDB namespace.** Different users
  logging in on the same browser profile access the same physical database. This is
  by design for a local multi-user kiosk scenario, but means one user's data is
  not isolated from another's at the storage level.

- **No external APIs.** The system makes no HTTP requests. All processing (NLP,
  encryption, validation) is performed locally using bundled algorithms and the
  Web Crypto API.

- **Client-side RBAC only.** Authentication and role enforcement are implemented in
  JavaScript and are not backed by a server. A technically sophisticated user with
  browser DevTools access can bypass them. The protections provide internal
  consistency and a meaningful audit trail, not server-enforced security.

- **Browser storage quota.** IndexedDB storage is subject to browser quota limits
  (typically 50–80% of available disk). Large NLP text imports or extensive audit
  logs may eventually hit this limit. The system does not currently enforce a cap
  or warn when approaching quota.

---

## Security Notes

Sensitive data (stored value, allergy notes, material restrictions) is encrypted
at rest using AES-GCM. The encryption key is derived from the org passphrase
(wrapped per-user with login passwords) and held in memory only during an unlocked
session. It is cleared on lock or logout and automatically restored on password
re-entry.

See [Authentication & Password Rules](#authentication--password-rules) for lockout,
auto-lock, and session expiry behavior.

---

## QA Evidence

The following areas have been verified through the test suite:

- **Login flow**: Generic error messages on all failure paths (wrong password, lockout,
  deactivated account, unknown user) — no information leakage.
- **Import/export**: Round-trip export → import preserves data. Import forces logout and
  session cleanup. Schema validation rejects malformed or version-mismatched backups.
- **Multi-user isolation**: Login clears previous session state (crypto keys, risk
  dictionary, NLP threshold, selected store, org tree). No cross-user data leakage.
- **Cross-tab consistency**: Lock events broadcast via BroadcastChannel clear the crypto
  key in all tabs simultaneously.
- **Versioning**: All master data, lookup, style, and customer mutations require a
  reason note (≥10 chars) and create version records with single-active invariant.
- **RBAC**: Every service method enforces authentication, role checks, and org scope.
  Guest users are blocked from all write operations.
- **Notification pipeline**: All events route through template-backed queue delivery.
  Draft items can be recovered via `requeueDraft()`. Retry schedule is deterministic.
- **Accessibility**: Zero a11y build warnings. All modals have `role="dialog"`,
  `aria-modal="true"`, and Escape key support.
- **Responsive design**: All split-pane pages collapse to single column at ≤768px.
