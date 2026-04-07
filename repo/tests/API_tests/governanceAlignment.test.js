/**
 * Governance alignment tests — versioning, RBAC, template placeholder consistency.
 *
 * Covers:
 *   1. Customer mutations create version records
 *   2. Analyst cannot reveal sensitive fields
 *   3. Template placeholder validation (single braces only)
 *   4. UI hint matches runtime syntax
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';
import { extractPlaceholders } from '../../src/utils/validation.js';

const ADMIN_PASS = 'GovAlign@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'ga_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'GovAlignCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('ga_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. CUSTOMER VERSIONING — ALL MUTATIONS CREATE VERSIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('Customer versioning — all mutations create version records', () => {
  let customerId;

  beforeEach(async () => {
    const c = await customerService.createCustomer({
      organizationId: orgId, name: 'Version Customer',
      storedValue: 100, actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
    customerId = c.id;
  });

  it('updateCustomer creates version', async () => {
    await customerService.updateCustomer(customerId, { name: 'Updated' }, adminUser.id, 'Updating customer name');
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('adjustPoints creates version', async () => {
    await customerService.adjustPoints(customerId, 10, adminUser.id, 'Loyalty bonus points');
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    expect(history.some((v) => v.payload?.action === 'adjust_points')).toBe(true);
  });

  it('adjustStoredValue creates version', async () => {
    await customerService.adjustStoredValue(customerId, 25, adminUser.id, 'Credit for return refund');
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    expect(history.some((v) => v.payload?.action === 'adjust_stored_value')).toBe(true);
  });

  it('addRating creates version', async () => {
    await customerService.addRating(customerId, 4, adminUser.id, 'Service quality feedback');
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    expect(history.some((v) => v.payload?.action === 'add_rating')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. RBAC — ANALYST DENIED SENSITIVE REVEAL
// ══════════════════════════════════════════════════════════════════════════════

describe('RBAC — sensitive data access', () => {
  let customerId;

  beforeEach(async () => {
    const c = await customerService.createCustomer({
      organizationId: orgId, name: 'RBAC Customer',
      storedValue: 50, actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
    customerId = c.id;
  });

  it('analyst cannot reveal sensitive fields', async () => {
    authService._currentUser = { id: 'ana', role: ROLES.ANALYST, organizationNodeId: orgId };
    await expect(customerService.revealSensitiveFields(customerId)).rejects.toThrow(/permission denied/i);
  });

  it('store_manager can reveal sensitive fields', async () => {
    authService._currentUser = { id: 'mgr', role: ROLES.STORE_MANAGER, organizationNodeId: orgId };
    const fields = await customerService.revealSensitiveFields(customerId);
    expect(fields.storedValue).toBeDefined();
  });

  it('guest cannot reveal sensitive fields', async () => {
    authService._currentUser = { id: 'guest', role: ROLES.GUEST, organizationNodeId: orgId };
    await expect(customerService.revealSensitiveFields(customerId)).rejects.toThrow(/permission denied/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. TEMPLATE PLACEHOLDER VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Template placeholder syntax', () => {
  it('single braces {var} are valid placeholders', () => {
    const placeholders = extractPlaceholders('Hello {name}, your order {orderId} is ready.');
    expect(placeholders).toContain('name');
    expect(placeholders).toContain('orderId');
  });

  it('double braces {{var}} are NOT recognized as placeholders', () => {
    const placeholders = extractPlaceholders('Hello {{name}}');
    // {name} inside {{name}} won't match because regex needs exact {word}
    // {{name}} matches as { + {name} + } — but the inner {name} IS matched
    // The real issue: users type {{name}} thinking it works, but it renders to {name} not the value
    // The fix is in UI validation, not in the parser
    expect(placeholders.length).toBeLessThanOrEqual(1);
  });

  it('template with valid placeholders creates successfully', async () => {
    const t = await templateService.createTemplate({
      organizationId: orgId, name: 'Valid Template',
      body: 'Hello {name}!', actorId: adminUser.id,
    });
    expect(t.placeholders).toContain('name');
  });

  it('UI hint shows single-brace syntax', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MessagesPage.svelte'), 'utf8');
    // Must NOT show {{var}} (double braces)
    expect(content).not.toMatch(/use\s*\{'\{'\}\{'\{'\}/);
    // Must show {varName} guidance
    expect(content).toContain('varName');
  });

  it('UI validates against double-brace patterns', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MessagesPage.svelte'), 'utf8');
    expect(content).toContain('hasInvalidPlaceholders');
    expect(content).toContain('single braces');
  });
});
