# Verdict Two

Issue 1 (Encryption): NOT FIXED  
Evidence:

- Passphrase-based derivation is implemented in AuthService.js (line 571) and AuthService.js (line 613), and login/unlock no longer derive from login password in AuthService.js (line 118), AuthService.js (line 263), AuthService.js (line 444).
- Cross-user, wrong-passphrase, logout/lock-clear behaviors are test-covered in orgPassphrase.test.js (line 96), orgPassphrase.test.js (line 160), orgPassphrase.test.js (line 174), orgPassphrase.test.js (line 250).
- Migration function exists at AuthService.js (line 627), but there is no test evidence proving migration works (no migrateToOrgPassphrase hits under tests/). Per your rule, missing evidence => NOT FIXED.

Issue 2 (Org Table): FIXED  
Evidence:

- Editable UI controls exist for name/type/parent selector (not raw parent ID): OrgSetupPage.svelte (line 381), OrgSetupPage.svelte (line 383), OrgSetupPage.svelte (line 388), OrgSetupPage.svelte (line 390).
- Validation in service: cycle prevention OrgService.js (line 109), parent/type combinations OrgService.js (line 117), same-org constraint OrgService.js (line 104).
- Tests cover edit + invalid cases: orgEditableTable.test.js (line 43), orgEditableTable.test.js (line 69), orgEditableTable.test.js (line 126), orgEditableTable.test.js (line 158), orgEditableTable.test.js (line 189).

Issue 3 (NLP): FIXED  
Evidence:

- Incremental run auto-ingests CRM/ticket notes: NLPService.js (line 111), NLPService.js (line 118), NLPService.js (line 361).
- CRM/ticket ingestion + dedupe via sourceId: NLPService.js (line 375), NLPService.js (line 376), NLPService.js (line 398), NLPService.js (line 399).
- Tests prove auto-ingest, idempotency, and manual import coexistence: nlpAutoIngest.test.js (line 57), nlpAutoIngest.test.js (line 103), nlpAutoIngest.test.js (line 141), nlpAutoIngest.test.js (line 173).

FINAL:

FAIL (Issue 1 is NOT FIXED)
