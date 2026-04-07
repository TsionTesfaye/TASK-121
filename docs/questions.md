# Business Logic Questions Log — RetailOps Insight & Compliance Console

---

## 1. Organization Hierarchy Scope

**Question:**  
The prompt defines a hierarchical structure (company → factory → store → warehouse) but does not specify whether entities can belong to multiple parents.

**Assumption:**  
Each entity belongs to exactly one parent.

**Solution:**  
Implemented a strict tree structure with single-parent relationships enforced at insertion and update.

---

## 2. Role Scope Across Hierarchy

**Question:**  
The prompt defines roles but does not specify whether access is scoped globally or by hierarchy level.

**Assumption:**  
Roles are scoped to the user’s assigned organization subtree.

**Solution:**  
All queries enforce hierarchical filtering based on assigned node.

---

## 3. Valid Hierarchy Pairing

**Question:**  
The prompt defines the hierarchy but does not explicitly list valid child-type combinations.

**Assumption:**  
Valid parent-child pairs are company → factory, factory → store, and store → warehouse only.

**Solution:**  
Rejected invalid parent-child combinations during create/update.

---

## 4. Master Data Version Activation

**Question:**  
The prompt states only one active version per entity type but does not define behavior when publishing a new version.

**Assumption:**  
Publishing a new version automatically deactivates the previous one.

**Solution:**  
On publish, system enforces an atomic active-version switch.

---

## 5. Version Change Concurrency

**Question:**  
The prompt does not define behavior if multiple users or tabs attempt to publish versions simultaneously.

**Assumption:**  
Publishing requires optimistic concurrency checks; stale editors must fail and reload.

**Solution:**  
Blocked publish if the active version changed after the editor loaded.

---

## 6. Deactivated Record Usage

**Question:**  
The prompt states deactivated records cannot be referenced by new styles but does not define behavior for existing references.

**Assumption:**  
Existing references remain valid.

**Solution:**  
Validation blocks new references to inactive records while preserving existing associations.

---

## 7. Reason Note Enforcement

**Question:**  
The prompt requires a 10-character reason note but does not define when validation occurs.

**Assumption:**  
Validation occurs before version publish.

**Solution:**  
Blocked submission if reason note length < 10.

---

## 8. Style SKU Structure

**Question:**  
The prompt centers master data around style SKU but does not define what a style must reference.

**Assumption:**  
A style references color, size, season, brand, and supplier, and may also be scoped to store/warehouse.

**Solution:**  
Implemented style validation against all required referenced entities.

---

## 9. Customer Allergy Handling

**Question:**  
The prompt states allergies/material restrictions are flagged on orders but does not define enforcement.

**Assumption:**  
Flags are warnings only and do not block order creation.

**Solution:**  
Displayed warnings on affected orders without blocking submission.

---

## 10. Allergy Restriction Length Validation

**Question:**  
The prompt sets a 500-character maximum but does not define whether validation occurs before or after encryption.

**Assumption:**  
Validation must occur before encryption.

**Solution:**  
Rejected values exceeding 500 plaintext characters before encryption.

---

## 11. Membership Value Constraints

**Question:**  
The prompt defines stored value in USD to two decimals but does not specify negative balance or fractional precision behavior.

**Assumption:**  
Negative balances are not allowed and values are rounded to two decimals.

**Solution:**  
Blocked operations that would produce negative balance and normalized stored value to two decimals.

---

## 12. Points Constraints

**Question:**  
The prompt defines optional points but does not specify whether negative or fractional points are allowed.

**Assumption:**  
Points are non-negative integers.

**Solution:**  
Validated points as integer values ≥ 0.

---

## 13. Service Rating Scale

**Question:**  
The prompt defines service ratings (1–5 stars) but does not specify whether half-star values are allowed.

**Assumption:**  
Only integer ratings 1–5 are allowed.

**Solution:**  
Validated ratings as whole-number values between 1 and 5 inclusive.

---

## 14. Order Progress Lifecycle

**Question:**  
The prompt requires “order progress” notifications but does not define order states.

**Assumption:**  
Orders follow a simple lifecycle: draft → placed → in_progress → ready → completed, with canceled as terminal alternative.

**Solution:**  
Implemented order state transitions and tied notification triggers to them.

---

## 15. Ticket SLA Expiry Behavior

**Question:**  
The prompt defines a 48-hour SLA but does not specify system behavior when exceeded.

**Assumption:**  
Tickets become overdue but remain active.

**Solution:**  
Marked tickets as overdue and triggered notifications.

---

## 16. Ticket State Finality

**Question:**  
The prompt does not define whether tickets can be reopened after closure.

**Assumption:**  
Closed tickets are terminal.

**Solution:**  
Blocked transitions from closed state to any other state.

---

## 17. Ticket Detail Requirements

**Question:**  
The prompt defines after-sales tickets but does not specify the minimum content required.

**Assumption:**  
Each ticket requires subject, description, category, and priority.

**Solution:**  
Rejected ticket creation without those fields.

---

## 18. Notification Retry Scheduling

**Question:**  
The prompt defines retry intervals but does not specify persistence across reloads.

**Assumption:**  
Retry schedule persists.

**Solution:**  
Stored retry timestamps in IndexedDB and resumed processing on app load.

---

## 19. Notification “Sent” Meaning

**Question:**  
The prompt defines Draft → Queued → Sent → Failed but does not define what “Sent” means in an offline in-app-only system.

**Assumption:**  
A message is Sent when it is successfully materialized into the recipient’s in-app notification store.

**Solution:**  
Marked queue items as Sent only after successful local notification creation.

---

## 20. Template Variable Validation

**Question:**  
The prompt requires placeholders but does not define validation behavior.

**Assumption:**  
All placeholders must be resolved before sending.

**Solution:**  
Blocked queueing of messages with missing variables.

---

## 21. Compact Notice Length Enforcement

**Question:**  
The prompt defines a 160-character limit for compact notices but does not specify whether the limit applies before or after variable substitution.

**Assumption:**  
The limit applies after substitution.

**Solution:**  
Validated the fully rendered compact message length before queueing.

---

## 22. Message Queue Failure Handling

**Question:**  
The prompt defines retry attempts but does not specify behavior after failure.

**Assumption:**  
After 3 retries, message is permanently failed.

**Solution:**  
Set status to Failed and stopped further retries.

---

## 23. Notification Trigger Duplication

**Question:**  
The prompt defines multiple triggers but does not specify deduplication.

**Assumption:**  
Duplicate triggers should not create duplicate messages.

**Solution:**  
Generated idempotency keys for queued messages.

---

## 24. NLP Technical Scope

**Question:**  
The prompt defines offline NLP features but does not specify whether they are transformer-based, rule-based, or heuristic.

**Assumption:**  
The system uses bundled lightweight local processors and dictionaries, not large remote or server-backed models.

**Solution:**  
Restricted NLP implementation to bundled offline-capable processors.

---

## 25. NLP Quality Metrics Meaning

**Question:**  
The prompt requires precision/recall/F1 metrics but does not define how they are computed for arbitrary imported text.

**Assumption:**  
Metrics come from the active validation profile associated with the model version, not from per-run ground-truth labels on arbitrary live data.

**Solution:**  
Stored benchmark metrics from locally maintained validation profiles with each run.

---

## 26. NLP Incremental Analysis

**Question:**  
The prompt allows “analyze new notes” but does not define whether “new” means created only or created/updated.

**Assumption:**  
Incremental runs must include records created or updated after the last run.

**Solution:**  
Used the last successful run timestamp against both createdAt and updatedAt.

---

## 27. Risk Rule Execution

**Question:**  
The prompt mentions configurable rules but does not define execution timing.

**Assumption:**  
Rules run on content submission and on imported event ingestion.

**Solution:**  
Triggered rule evaluation on create/update/import events.

---

## 28. Risk Rule Model Scope

**Question:**  
The prompt mentions configurable machine rules but does not define what a rule targets.

**Assumption:**  
Rules target a specific entity type and contain typed parameters.

**Solution:**  
Stored rule definitions with targetEntityType, ruleType, and parameter payload.

---

## 29. Image Validation Scope

**Question:**  
The prompt defines file type and size limits but not enforcement stage.

**Assumption:**  
Validation occurs before storage.

**Solution:**  
Rejected invalid files at upload stage.

---

## 30. Image Type Verification Method

**Question:**  
The prompt requires PNG/JPEG validation but does not specify whether extension, MIME type, or file signature is authoritative.

**Assumption:**  
Magic-byte signature and MIME type are both checked.

**Solution:**  
Validated file headers and MIME before acceptance.

---

## 31. Device Fingerprinting Stability

**Question:**  
The prompt uses local device fingerprinting but does not define persistence or accuracy expectations.

**Assumption:**  
Fingerprinting is best-effort only and persists per browser environment.

**Solution:**  
Stored a non-unique device fingerprint seed in LocalStorage and documented it as a weak heuristic signal.

---

## 32. Linked Account Definition

**Question:**  
The prompt refers to linked account patterns but does not define how accounts become linked.

**Assumption:**  
Linked accounts are inferred from shared fingerprint signals or manual reviewer linkage.

**Solution:**  
Stored explicit LinkedAccount relationships with evidence metadata.

---

## 33. Shill / Bidding Data Source

**Question:**  
The prompt requires abnormal bidding/shill heuristics but does not define where bidding-like events come from.

**Assumption:**  
Bid/event records are local operational records or imported event data; the app does not provide a full auction UI.

**Solution:**  
Added bid event ingestion and heuristic evaluation over stored event records.

---

## 34. Outcome Code Validation

**Question:**  
The prompt requires an outcome code and comment on risk resolution but does not define valid outcome codes.

**Assumption:**  
Outcome codes are enumerated and not free text.

**Solution:**  
Restricted case resolution to predefined outcome codes.

---

## 35. Import Conflict Handling

**Question:**  
The prompt allows import but does not define conflict resolution.

**Assumption:**  
Import overwrites existing data after preview and confirmation.

**Solution:**  
Implemented preview diff and controlled full replacement.

---

## 36. Protected Data During Import

**Question:**  
The prompt does not specify whether audit logs or sessions are overwritten.

**Assumption:**  
Sensitive system data must not be overwritten during normal import.

**Solution:**  
Excluded audit logs and session data from standard import.

---

## 37. Import Interruption Safety

**Question:**  
The prompt does not define behavior if import is interrupted mid-apply.

**Assumption:**  
Import must stage data before replacement and only promote once validation succeeds.

**Solution:**  
Used a staging-and-apply import flow instead of direct per-store replacement.

---

## 38. Encryption Key Lifecycle

**Question:**  
The prompt defines passphrase-based encryption but not algorithm details, IV handling, or password change behavior.

**Assumption:**  
AES-GCM is used with a unique IV per encryption operation, and password changes require full protected-data re-encryption.

**Solution:**  
Stored IVs alongside ciphertext and defined password-change re-encryption workflow.

---

## 39. Backup Encryption Scope

**Question:**  
The prompt requires encrypted backup export but does not define whether backup encryption uses the login password or a separate backup passphrase.

**Assumption:**  
Backup export uses a separate backup passphrase.

**Solution:**  
Separated account-login encryption from backup-file encryption.

---

## 40. Auto-Lock Behavior

**Question:**  
The prompt defines auto-lock but does not specify scope.

**Assumption:**  
Only encrypted data becomes inaccessible while session identity remains.

**Solution:**  
Maintained session but required password re-entry to decrypt protected data.

---

## 41. Guest Mode Restrictions

**Question:**  
The prompt defines guest mode but not expiry behavior or data visibility boundaries.

**Assumption:**  
Guest mode is read-only, cannot reveal protected fields, and hard-expires to the login screen at 30 minutes.

**Solution:**  
Blocked all write operations, blocked reveal actions, and forced guest logout on expiry.

---

## 42. RBAC Enforcement Location

**Question:**  
The prompt defines RBAC but does not specify enforcement layer.

**Assumption:**  
RBAC must be enforced in service layer, with UI visibility as a secondary aid only.

**Solution:**  
Added permission validation in all service methods.

---

## 43. IndexedDB Failure Handling

**Question:**  
The prompt does not define behavior for storage failures.

**Assumption:**  
Operations fail atomically.

**Solution:**  
Wrapped writes in transactions and aborted on failure.

---

## 44. Node 18 Test Compatibility

**Question:**  
The offline design depends on browser APIs such as IndexedDB, BroadcastChannel, localStorage, and Web Crypto, but tests must run under Node 18.

**Assumption:**  
Node tests use polyfills/shims rather than browser-native APIs.

**Solution:**  
Adopted `fake-indexeddb`, DOM shims, `node:crypto` Web Crypto, and BroadcastChannel mocks in the test strategy.