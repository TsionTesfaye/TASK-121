# Verdict Two

Issue 1 (Encryption): FIXED  
Evidence:

Evidence:

- Passphrase-only key derivation in app code:  
  AuthService.js (line 571)  
  AuthService.js (line 613)
- Login/unlock/password-change do not derive encryption key from login password:  
  AuthService.js (line 118)  
  AuthService.js (line 263)  
  AuthService.js (line 444)
- Migration is now test-covered end-to-end (legacy simulation + migration + post-migration decrypt):  
  encryptionMigration.test.js (line 79)  
  encryptionMigration.test.js (line 100)  
  encryptionMigration.test.js (line 336)
- Cross-user / wrong-passphrase / lock-logout behavior remains test-covered:  
  orgPassphrase.test.js (line 96)  
  orgPassphrase.test.js (line 160)  
  orgPassphrase.test.js (line 174)

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

PASS
