Re-checked from scratch against the same 5 items.

Issue 1: Draft queue remediation in UI
Status: FIXED
Code Evidence:

Draft row action button exists and is user-clickable: MessagesPage.svelte (line 389), MessagesPage.svelte (line 390)
Variable editing UI exists (JSON textarea): MessagesPage.svelte (line 587), MessagesPage.svelte (line 590)
UI calls requeueDraft() via handler: MessagesPage.svelte (line 105), MessagesPage.svelte (line 111)
Success/error feedback: MessagesPage.svelte (line 113), MessagesPage.svelte (line 116), MessagesPage.svelte (line 588)
Test Evidence:
Requeue success test: uiCompleteness.test.js (line 50), uiCompleteness.test.js (line 67)
Non-draft rejection test: uiCompleteness.test.js (line 75), uiCompleteness.test.js (line 89)
Runtime/Behavior reasoning:
Queue row button opens modal, user edits JSON, submit triggers handleRequeue -> notificationService.requeueDraft, then success toast + queue reload.
Issue 2: Preferences wiring (store + column layouts)
Status: PARTIAL
Code Evidence:

Store selector UI now exists and updates persisted store: Sidebar.svelte (line 57), Sidebar.svelte (line 60), Sidebar.svelte (line 16), Sidebar.svelte (line 19), App.svelte (line 33)
Column layout helpers exist, but no UI call sites found for saveColumnLayout: ui.js (line 61)
Test Evidence:
Store selector wiring checks: layoutIsolation.test.js (line 101), layoutIsolation.test.js (line 111)
Column layout tests are helper/store-level, not UI interaction: uiCompleteness.test.js (line 115), localStorageScoping.test.js (line 41)
Runtime/Behavior reasoning:
Store preference is user-operable from sidebar.
No user-operable column-layout control is evidenced in pages/components, so “fully wired preferences” is not complete.
Issue 3: Cross-user layout state leakage
Status: FIXED
Code Evidence:

Logout clears in-memory layouts: App.svelte (line 134)
Login cleanup also clears in-memory layouts before next login: LoginPage.svelte (line 28)
Test Evidence:
No-leak after reset path: layoutIsolation.test.js (line 47), layoutIsolation.test.js (line 57)
User isolation checks: localStorageScoping.test.js (line 59), localStorageScoping.test.js (line 74)
Runtime/Behavior reasoning:
Reproduced switch flow with current logic: output was layouts_after_user_switch {} and leak_present false.
Issue 4: Browser-driver E2E tests
Status: PARTIAL
Code Evidence:

No Playwright/Cypress/WebDriver deps/scripts: package.json (line 6), package.json (line 18)
README explicitly documents no real browser driver: README.md (line 112)
Test Evidence:
E2E tests are simulation-based under Vitest/jsdom, e.g.: notificationFlow.test.js (line 1)
Runtime/Behavior reasoning:
Real browser-driver coverage still absent; limitation is documented.
Issue 5: Missing tests (draft requeue flow + layout reset behavior)
Status: PARTIAL
Code Evidence:

Requeue path in UI/service exists: MessagesPage.svelte (line 111), NotificationService.js (line 257)
Layout reset hooks in app/login: App.svelte (line 134), LoginPage.svelte (line 28)
Test Evidence:
Draft requeue success + non-draft rejection: uiCompleteness.test.js (line 50), uiCompleteness.test.js (line 75)
Layout isolation/reset tests: layoutIsolation.test.js (line 47), layoutIsolation.test.js (line 79), uiCompleteness.test.js (line 128)
Runtime/Behavior reasoning:
Targeted suites pass (37/37 in selected runs), but some logout-reset checks remain source/simulation-level rather than full UI interaction-driven end-to-end assertions.
Final Verdict: PARTIAL PASS
