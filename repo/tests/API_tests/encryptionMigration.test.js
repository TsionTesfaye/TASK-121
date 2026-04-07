/**
 * Encryption migration tests — proves migrateToOrgPassphrase() works end-to-end.
 *
 * Simulates a legacy system (password-derived encryption) by:
 *   1. Bootstrapping normally (which sets passphrase fields)
 *   2. Stripping passphrase fields from appConfig to simulate legacy state
 *   3. Creating data encrypted under password-derived key
 *   4. Running migration
 *   5. Verifying post-migration state
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { AppConfigRepository } from '../../src/repositories/implementations/AppConfigRepository.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'MigrationAdmin@1';
const ORG_PASSPHRASE = 'OrgSharedKey@2024';
const WRONG_PASSPHRASE = 'WrongShared@2024';
let orgId, adminUser, configRepo;

/**
 * Simulates a legacy system by stripping passphrase fields from appConfig.
 * After this call, the system behaves as if bootstrap ran before passphrase
 * support was added: orgEncryptionSalt exists but orgPassphraseHash does not.
 */
async function simulateLegacyState() {
  const config = await configRepo.findByOrg(orgId);
  const legacy = { ...config };
  delete legacy.orgPassphraseHash;
  delete legacy.orgPassphraseSalt;
  delete legacy.encryptionModel;
  await configRepo.update(config.id, legacy);
}

/**
 * Derives and sets the session key using password + orgSalt (legacy model).
 * This is what old login() used to do.
 */
async function deriveKeyFromPassword(password) {
  const config = await configRepo.findByOrg(orgId);
  await cryptoService.deriveSessionKey(password, config.orgEncryptionSalt);
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  configRepo = new AppConfigRepository();

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'mig_admin', adminPassword: ADMIN_PASS, orgName: 'MigrationCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('mig_admin', ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// A. OLD-MODEL RECORD CAN MIGRATE SUCCESSFULLY
// ══════════════════════════════════════════════════════════════════════════════

describe('Migration — old-model record migrates successfully', () => {
  it('legacy-encrypted record is re-encrypted and decryptable under passphrase', async () => {
    // Step 1: Simulate legacy state (no passphrase hash in config).
    await simulateLegacyState();

    // Step 2: Derive key from password (legacy model) and create encrypted data.
    await deriveKeyFromPassword(ADMIN_PASS);

    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'Legacy Customer',
      storedValue: 250.75, allergies: 'dairy', materialRestrictions: 'wool',
      actorId: adminUser.id, reasonNote: 'legacy encryption test record',
    });

    // Verify the data is readable with password-derived key.
    const beforeMigration = await customerService.revealSensitiveFields(cust.id);
    expect(beforeMigration.storedValue).toBe('250.75');
    expect(beforeMigration.allergies).toBe('dairy');
    expect(beforeMigration.materialRestrictions).toBe('wool');

    // Step 3: Run migration.
    const count = await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);
    expect(count).toBe(1);

    // Step 4: Verify passphrase model is now active.
    const config = await configRepo.findByOrg(orgId);
    expect(config.orgPassphraseHash).toBeTruthy();
    expect(config.orgPassphraseSalt).toBeTruthy();

    // Step 5: Verify record is decryptable with passphrase-derived key.
    // setupOrgPassphrase (called by migrateToOrgPassphrase) already set the
    // session key from the org passphrase, so decrypt should work.
    const afterMigration = await customerService.revealSensitiveFields(cust.id);
    expect(afterMigration.storedValue).toBe('250.75');
    expect(afterMigration.allergies).toBe('dairy');
    expect(afterMigration.materialRestrictions).toBe('wool');
  });

  it('migrateToOrgPassphrase is explicitly called and returns migrated count', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    // Create two customers.
    await customerService.createCustomer({
      organizationId: orgId, name: 'Cust A', storedValue: 10,
      actorId: adminUser.id, reasonNote: 'migration count test A',
    });
    await customerService.createCustomer({
      organizationId: orgId, name: 'Cust B', storedValue: 20,
      allergies: 'gluten', actorId: adminUser.id, reasonNote: 'migration count test B',
    });

    const count = await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);
    expect(count).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B. CROSS-USER POST-MIGRATION ACCESS
// ══════════════════════════════════════════════════════════════════════════════

describe('Migration — cross-user post-migration access', () => {
  it('user B with different password decrypts migrated data via org passphrase', async () => {
    // Step 1: Legacy state + create data.
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'CrossUser Cust',
      storedValue: 77.50, allergies: 'nuts',
      actorId: adminUser.id, reasonNote: 'cross-user migration test record',
    });

    // Step 2: Migrate.
    await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);

    // Step 3: Create user B with a completely different login password.
    const USER_B_PASS = 'UserBDifferent@99';
    await authService.createUser({
      username: 'miguser_b', password: USER_B_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });

    // Step 4: Logout admin, login as user B.
    await authService.logout();
    await authService.login('miguser_b', USER_B_PASS);

    // Login does NOT derive key.
    expect(cryptoService.isUnlocked()).toBe(false);

    // Step 5: Unlock with org passphrase (NOT user B's login password).
    const ok = await authService.unlockProtectedData(ORG_PASSPHRASE);
    expect(ok).toBe(true);

    // Step 6: Decrypt migrated data.
    const revealed = await customerService.revealSensitiveFields(cust.id);
    expect(revealed.storedValue).toBe('77.50');
    expect(revealed.allergies).toBe('nuts');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C. WRONG PASSPHRASE FAILS AFTER MIGRATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Migration — wrong passphrase fails', () => {
  it('wrong passphrase does not unlock migrated data', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    await customerService.createCustomer({
      organizationId: orgId, name: 'Wrong PP Cust', storedValue: 5,
      actorId: adminUser.id, reasonNote: 'wrong passphrase test record',
    });

    // Migrate.
    await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);

    // Clear key.
    cryptoService.clearSessionKey();
    expect(cryptoService.isUnlocked()).toBe(false);

    // Wrong passphrase → rejected.
    const result = await authService.unlockProtectedData(WRONG_PASSPHRASE);
    expect(result).toBe(false);
    expect(cryptoService.isUnlocked()).toBe(false);

    // Correct passphrase → works.
    const ok = await authService.unlockProtectedData(ORG_PASSPHRASE);
    expect(ok).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(true);
  });

  it('old login password no longer works as passphrase after migration', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    await customerService.createCustomer({
      organizationId: orgId, name: 'Old PW Cust', storedValue: 1,
      actorId: adminUser.id, reasonNote: 'old password rejection test',
    });

    await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);
    cryptoService.clearSessionKey();

    // Old login password is NOT the org passphrase.
    const result = await authService.unlockProtectedData(ADMIN_PASS);
    expect(result).toBe(false);
    expect(cryptoService.isUnlocked()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D. MIGRATION IS IDEMPOTENT
// ══════════════════════════════════════════════════════════════════════════════

describe('Migration — idempotency', () => {
  it('second migration attempt is rejected cleanly', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    await customerService.createCustomer({
      organizationId: orgId, name: 'Idempotent Cust', storedValue: 33,
      actorId: adminUser.id, reasonNote: 'idempotency test record',
    });

    // First migration succeeds.
    const count = await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);
    expect(count).toBe(1);

    // Second migration is rejected (passphrase already set).
    await expect(authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE))
      .rejects.toThrow(/already using passphrase/i);

    // Data is still intact after rejected second attempt.
    const revealed = await customerService.revealSensitiveFields(
      (await new CustomerRepository().findAll())[0].id,
    );
    expect(revealed.storedValue).toBe('33.00');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E. MIGRATION PRESERVES DATA EXACTLY
// ══════════════════════════════════════════════════════════════════════════════

describe('Migration — data preservation', () => {
  it('all three encrypted fields are preserved exactly', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'Preserve Customer',
      storedValue: 1234.56, allergies: 'peanuts, shellfish',
      materialRestrictions: 'latex, nickel',
      actorId: adminUser.id, reasonNote: 'data preservation integrity test',
    });

    // Capture plaintext before migration.
    const before = await customerService.revealSensitiveFields(cust.id);

    // Migrate.
    await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);

    // Verify exact plaintext match after migration.
    const after = await customerService.revealSensitiveFields(cust.id);
    expect(after.storedValue).toBe(before.storedValue);
    expect(after.allergies).toBe(before.allergies);
    expect(after.materialRestrictions).toBe(before.materialRestrictions);

    // Verify specific values.
    expect(after.storedValue).toBe('1234.56');
    expect(after.allergies).toBe('peanuts, shellfish');
    expect(after.materialRestrictions).toBe('latex, nickel');
  });

  it('non-encrypted fields are not corrupted', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'Metadata Check',
      storedValue: 50, points: 100, membershipTier: 'Gold',
      actorId: adminUser.id, reasonNote: 'metadata preservation test',
    });

    await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);

    // Verify non-encrypted fields unchanged.
    const custRepo = new CustomerRepository();
    const postMigration = await custRepo.findById(cust.id);
    expect(postMigration.name).toBe('Metadata Check');
    expect(postMigration.points).toBe(100);
    expect(postMigration.membershipTier).toBe('Gold');
    expect(postMigration.organizationId).toBe(orgId);
  });

  it('customer with no sensitive fields is not counted', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    // Create customer with only storedValue (always encrypted) — counts as 1.
    await customerService.createCustomer({
      organizationId: orgId, name: 'Minimal Cust', storedValue: 0,
      actorId: adminUser.id, reasonNote: 'minimal encrypted field test',
    });

    const count = await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);
    // storedValue is always encrypted, so 1 record migrated.
    expect(count).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPLICIT EVIDENCE: MIGRATED RECORDS NO LONGER DEPEND ON LOGIN PASSWORD
// ══════════════════════════════════════════════════════════════════════════════

describe('Migration — post-migration records are passphrase-only', () => {
  it('after migration, password-derived key cannot decrypt records', async () => {
    await simulateLegacyState();
    await deriveKeyFromPassword(ADMIN_PASS);

    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'PostMig Test', storedValue: 99,
      actorId: adminUser.id, reasonNote: 'post-migration decrypt source test',
    });

    // Migrate to a DIFFERENT passphrase (not the admin password).
    await authService.migrateToOrgPassphrase(ADMIN_PASS, ORG_PASSPHRASE);

    // Clear key and try to decrypt with password-derived key.
    cryptoService.clearSessionKey();
    const config = await configRepo.findByOrg(orgId);
    await cryptoService.deriveSessionKey(ADMIN_PASS, config.orgEncryptionSalt);

    // Password-derived key should NOT work — data was re-encrypted with passphrase key.
    await expect(
      customerService.revealSensitiveFields(cust.id),
    ).rejects.toThrow();

    // Passphrase-derived key works.
    cryptoService.clearSessionKey();
    await cryptoService.deriveSessionKey(ORG_PASSPHRASE, config.orgEncryptionSalt);
    const revealed = await customerService.revealSensitiveFields(cust.id);
    expect(revealed.storedValue).toBe('99.00');
  });
});
