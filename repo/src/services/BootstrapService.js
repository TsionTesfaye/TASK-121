/**
 * BootstrapService — first-run system initialization.
 *
 * Responsibilities:
 *   - detect whether the system has been initialized (any users exist)
 *   - create the first Administrator account and root organization node
 *   - record a bootstrap completion marker in appConfig
 *   - refuse re-initialization once any user exists
 *
 * IMPORTANT: This service is deliberately exempt from the standard RBAC
 * pattern because it executes before any user exists. It MUST NOT be
 * reachable once isBootstrapped() returns true.
 */

import { UserRepository } from '../repositories/implementations/UserRepository.js';
import { OrgRepository } from '../repositories/implementations/OrgRepository.js';
import { AppConfigRepository } from '../repositories/implementations/AppConfigRepository.js';
import { TemplateRepository } from '../repositories/implementations/TemplateRepository.js';
import { cryptoService } from './CryptoService.js';
import { auditService } from './AuditService.js';
import { generateId } from '../utils/idGenerator.js';
import { validatePassword, extractPlaceholders } from '../utils/validation.js';
import { ROLES, ORG_NODE_TYPES, SYSTEM_TEMPLATES } from '../utils/constants.js';

export class BootstrapService {
  constructor() {
    this._userRepo = new UserRepository();
    this._orgRepo = new OrgRepository();
    this._configRepo = new AppConfigRepository();
    this._templateRepo = new TemplateRepository();
  }

  /**
   * Returns true if at least one user account exists.
   * When false the system is in bootstrap mode.
   *
   * @returns {Promise<boolean>}
   */
  async isBootstrapped() {
    const count = await this._userRepo.count();
    return count > 0;
  }

  /**
   * Performs the one-time first-run setup:
   *   1. Validates all inputs.
   *   2. Creates the root company organization node.
   *   3. Creates the first Administrator user with a properly derived key.
   *   4. Stores the bootstrap completion record in appConfig.
   *   5. Sets up org passphrase for protected-data encryption.
   *
   * Throws if the system is already bootstrapped.
   *
   * @param {{ adminUsername: string; adminPassword: string; orgName: string; orgPassphrase?: string }} params
   * @returns {Promise<{ admin: object; org: object }>}
   */
  async bootstrap({ adminUsername, adminPassword, orgName, orgPassphrase }) {
    if (await this.isBootstrapped()) {
      throw new Error('System is already initialized. Bootstrap cannot be re-triggered.');
    }

    // Validate inputs before any writes.
    if (!adminUsername?.trim()) throw new Error('Administrator username is required.');
    if (!orgName?.trim()) throw new Error('Organization name is required.');

    const pwCheck = validatePassword(adminPassword);
    if (!pwCheck.valid) throw new Error(pwCheck.errors.join(' '));

    // 1. Create root organization node.
    const orgId = generateId();
    const org = {
      id: orgId,
      name: orgName.trim(),
      type: ORG_NODE_TYPES.COMPANY,
      parentId: null,
      organizationId: orgId,
      createdAt: Date.now(),
    };
    await this._orgRepo.create(org);

    // 2. Create first Administrator.
    const { hash, salt } = await cryptoService.hashNewPassword(adminPassword);
    const adminId = generateId();
    const adminUser = {
      id: adminId,
      username: adminUsername.trim(),
      passwordHash: hash,
      passwordSalt: salt,
      role: ROLES.ADMINISTRATOR,
      organizationNodeId: orgId,
      isActive: true,
      isGuest: false,
      guestExpiresAt: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      unlockAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this._userRepo.create(adminUser);

    // 3. Seed system notification templates for every event type.
    for (const def of Object.values(SYSTEM_TEMPLATES)) {
      await this._templateRepo.create({
        id: generateId(),
        organizationId: orgId,
        name: def.name,
        body: def.body,
        placeholders: extractPlaceholders(def.body),
        isCompact: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // 4. Mark bootstrap as completed + generate org-level encryption salt +
    //    set up passphrase-based encryption (org passphrase defaults to admin password).
    const orgSalt = cryptoService.generateOrgSalt();
    const effectivePassphrase = orgPassphrase ?? adminPassword;
    const { hash: ppHash, salt: ppSalt } = await cryptoService.hashNewPassword(effectivePassphrase);
    await this._configRepo.create({
      id: generateId(),
      organizationId: orgId,
      orgEncryptionSalt: orgSalt,
      orgPassphraseHash: ppHash,
      orgPassphraseSalt: ppSalt,
      encryptionModel: 'passphrase',
      bootstrappedAt: Date.now(),
      bootstrappedBy: adminId,
    });

    // 5. Wrap the org passphrase with the admin's login password so that
    //    login/unlock automatically restores data decryption capability.
    const wrappingSalt = cryptoService.generateOrgSalt();
    const wrapped = await cryptoService.wrapPassphrase(effectivePassphrase, adminPassword, wrappingSalt);
    await this._userRepo.update(adminId, {
      ...adminUser,
      wrappedOrgPassphrase: wrapped.ciphertext,
      wrappedOrgPassphraseIv: wrapped.iv,
      wrappingSalt,
      updatedAt: Date.now(),
    });

    // 6. Audit trail (does not require auth).
    await auditService.log({
      actorId: adminId,
      action: 'system_bootstrap',
      entityType: 'system',
      entityId: 'bootstrap',
      metadata: { orgId, adminId },
    });

    return { admin: adminUser, org };
  }
}

export const bootstrapService = new BootstrapService();
