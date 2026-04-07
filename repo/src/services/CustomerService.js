import { CustomerRepository } from '../repositories/implementations/CustomerRepository.js';
import { MasterDataRepository } from '../repositories/implementations/MasterDataRepository.js';
import { cryptoService } from './CryptoService.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { eventDispatcherService } from './EventDispatcherService.js';
import { generateId } from '../utils/idGenerator.js';
import {
  validateAllergyField,
  validateStoredValue,
  validatePoints,
  validateRating,
  validateReasonNote,
  isValidMembershipTier,
} from '../utils/validation.js';
import { ROLES, MEMBERSHIP_TIERS, EVENT_TYPES } from '../utils/constants.js';
import { orgService } from './OrgService.js';

export class CustomerService {
  constructor() {
    this._repo = new CustomerRepository();
  }

  /**
   * Creates a new customer record with encrypted sensitive fields.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   * Scope: actor must have access to the target organizationId.
   *
   * @param {{ organizationId: string; name: string; membershipTier?: string; points?: number; storedValue?: number; allergies?: string; materialRestrictions?: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async createCustomer({ organizationId, name, membershipTier = MEMBERSHIP_TIERS.BRONZE, points = 0, storedValue = 0, allergies = '', materialRestrictions = '', actorId, reasonNote = '' }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    if (!name?.trim()) throw new Error('Customer name is required.');
    if (!isValidMembershipTier(membershipTier)) throw new Error(`Invalid membership tier: ${membershipTier}`);

    const allergyCheck = validateAllergyField(allergies);
    if (!allergyCheck.valid) throw new Error(`Allergies: ${allergyCheck.error}`);

    const mrCheck = validateAllergyField(materialRestrictions);
    if (!mrCheck.valid) throw new Error(`Material restrictions: ${mrCheck.error}`);

    const svCheck = validateStoredValue(storedValue);
    if (!svCheck.valid) throw new Error(svCheck.error);

    const ptCheck = validatePoints(points);
    if (!ptCheck.valid) throw new Error(ptCheck.error);

    if (!cryptoService.isUnlocked()) throw new Error('Session is locked. Please unlock to create customers with encrypted fields.');

    const encAllergies = allergies ? await cryptoService.encrypt(allergies) : null;
    const encMR = materialRestrictions ? await cryptoService.encrypt(materialRestrictions) : null;
    const encSV = await cryptoService.encrypt(String(storedValue.toFixed(2)));

    const customer = {
      id: generateId(),
      organizationId,
      name,
      membershipTier,
      points,
      storedValueCiphertext: encSV.ciphertext,
      storedValueIv: encSV.iv,
      allergiesCiphertext: encAllergies?.ciphertext ?? null,
      allergiesIv: encAllergies?.iv ?? null,
      materialRestrictionsCiphertext: encMR?.ciphertext ?? null,
      materialRestrictionsIv: encMR?.iv ?? null,
      ratingAverage: 0,
      ratingCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._repo.create(customer);
    await this._createCustomerVersion(customer.id, organizationId, { name, membershipTier, points }, reasonNote, actorId);
    await auditService.log({ actorId, action: 'create_customer', entityType: 'customer', entityId: customer.id, metadata: { reasonNote } });
    return customer;
  }

  /**
   * Updates non-sensitive customer fields.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} customerId
   * @param {{ name?: string; membershipTier?: string }} data
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async updateCustomer(customerId, data, actorId, reasonNote = '') {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);

    if (data.membershipTier && !isValidMembershipTier(data.membershipTier)) {
      throw new Error(`Invalid membership tier: ${data.membershipTier}`);
    }

    const updated = { ...customer, ...data, updatedAt: Date.now() };
    await this._repo.update(customerId, updated);
    await this._createCustomerVersion(customerId, customer.organizationId, { name: updated.name, membershipTier: updated.membershipTier }, reasonNote, actorId);
    await auditService.log({ actorId, action: 'update_customer', entityType: 'customer', entityId: customerId, metadata: { reasonNote } });
    return updated;
  }

  /**
   * Adjusts stored value by delta (positive = credit, negative = debit).
   * Blocks negative balance.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} customerId
   * @param {number} delta
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async adjustStoredValue(customerId, delta, actorId, reasonNote = '') {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    if (!cryptoService.isUnlocked()) throw new Error('Session is locked. Cannot access encrypted stored value.');

    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);

    const currentStr = await cryptoService.decrypt(customer.storedValueCiphertext, customer.storedValueIv);
    const current = parseFloat(currentStr);
    const newValue = Math.round((current + delta) * 100) / 100;

    const svCheck = validateStoredValue(newValue);
    if (!svCheck.valid) throw new Error(svCheck.error);

    const encSV = await cryptoService.encrypt(String(newValue.toFixed(2)));
    const updated = { ...customer, storedValueCiphertext: encSV.ciphertext, storedValueIv: encSV.iv, updatedAt: Date.now() };
    await this._repo.update(customerId, updated);
    await this._createCustomerVersion(customerId, customer.organizationId, { action: 'adjust_stored_value', delta }, reasonNote, actorId);
    await auditService.log({ actorId, action: 'adjust_stored_value', entityType: 'customer', entityId: customerId, metadata: { delta, reasonNote } });
    return updated;
  }

  /**
   * Adjusts points balance.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} customerId
   * @param {number} delta  Positive or negative integer.
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async adjustPoints(customerId, delta, actorId, reasonNote = '') {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);

    if (!Number.isInteger(delta)) throw new Error('Points delta must be an integer.');

    const newPoints = customer.points + delta;
    const ptCheck = validatePoints(newPoints);
    if (!ptCheck.valid) throw new Error(ptCheck.error);

    const updated = { ...customer, points: newPoints, updatedAt: Date.now() };
    await this._repo.update(customerId, updated);
    await this._createCustomerVersion(customerId, customer.organizationId, { action: 'adjust_points', delta, points: newPoints }, reasonNote, actorId);
    await auditService.log({ actorId, action: 'adjust_points', entityType: 'customer', entityId: customerId, metadata: { delta, reasonNote } });
    return updated;
  }

  /**
   * Adds a service rating for the customer.
   * Updates running average and count.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} customerId
   * @param {number} rating  Integer 1–5.
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async addRating(customerId, rating, actorId, reasonNote = '') {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const ratingCheck = validateRating(rating);
    if (!ratingCheck.valid) throw new Error(ratingCheck.error);

    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);

    const newCount = customer.ratingCount + 1;
    const newAverage = (customer.ratingAverage * customer.ratingCount + rating) / newCount;
    const updated = { ...customer, ratingAverage: Math.round(newAverage * 10) / 10, ratingCount: newCount, updatedAt: Date.now() };
    await this._repo.update(customerId, updated);
    await this._createCustomerVersion(customerId, customer.organizationId, { action: 'add_rating', rating, ratingAverage: updated.ratingAverage }, reasonNote, actorId);
    await auditService.log({ actorId, action: 'add_rating', entityType: 'customer', entityId: customerId, metadata: { rating, reasonNote } });

    // Dispatch grading event (non-fatal).
    await eventDispatcherService.dispatch({
      organizationId: customer.organizationId,
      eventType: EVENT_TYPES.GRADING_COMPLETED,
      sourceId: customerId,
      actorId,
      vars: { customerId, customerName: customer.name, rating: String(rating), newAverage: String(updated.ratingAverage) },
      title: 'Customer rating added',
      body: `${customer.name} received a rating of ${rating} (new avg: ${updated.ratingAverage}).`,
    }).catch(() => {});

    return updated;
  }

  /**
   * Decrypts and returns sensitive fields for display.
   * Requires an unlocked session.
   * Requires: ADMINISTRATOR, STORE_MANAGER, or ANALYST role.
   *
   * @param {string} customerId
   * @returns {Promise<{ storedValue: string; allergies: string | null; materialRestrictions: string | null }>}
   */
  async revealSensitiveFields(customerId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    if (!cryptoService.isUnlocked()) throw new Error('Session is locked. Please unlock to access sensitive data.');

    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);

    const storedValue = await cryptoService.decrypt(customer.storedValueCiphertext, customer.storedValueIv);
    const allergies = customer.allergiesCiphertext
      ? await cryptoService.decrypt(customer.allergiesCiphertext, customer.allergiesIv)
      : null;
    const materialRestrictions = customer.materialRestrictionsCiphertext
      ? await cryptoService.decrypt(customer.materialRestrictionsCiphertext, customer.materialRestrictionsIv)
      : null;

    return { storedValue, allergies, materialRestrictions };
  }

  /**
   * Returns masked placeholders for sensitive fields.
   * Requires: any authenticated user.
   *
   * @param {string} customerId
   * @returns {Promise<{ storedValue: string; allergies: string; materialRestrictions: string }>}
   */
  async getMaskedFields(customerId) {
    const actor = this._requireAuth();

    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);

    return {
      storedValue: cryptoService.maskValue(''),
      allergies: customer.allergiesCiphertext ? cryptoService.maskValue('') : null,
      materialRestrictions: customer.materialRestrictionsCiphertext ? cryptoService.maskValue('') : null,
    };
  }

  /**
   * Returns all customers for an organization.
   * Scope-enforced for non-admin users.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getByOrg(organizationId) {
    const actor = this._requireAuth();
    await this._assertOrgScope(actor, organizationId);
    return this._repo.findByOrg(organizationId);
  }

  /**
   * Returns a single customer by ID.
   * @param {string} customerId
   * @returns {Promise<object | null>}
   */
  async getById(customerId) {
    const actor = this._requireAuth();
    const customer = await this._repo.findById(customerId);
    if (customer) await this._assertOrgScope(actor, customer.organizationId);
    return customer;
  }

  // ── Version history ──────────────────────────────────────────────────────────

  /**
   * Snapshots the current customer state as a new published version.
   * Deactivates any previous active version for this customer.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ customerId: string; organizationId: string; reasonNote: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async publishCustomerVersion({ customerId, organizationId, reasonNote, actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    const nextVersion = history.length > 0 ? history[0].versionNumber + 1 : 1;

    // Deactivate current active version for this customer.
    const currentActive = history.find((v) => v.isActive);
    if (currentActive) {
      await mdRepo.update(currentActive.id, { ...currentActive, isActive: false });
    }

    const newVersion = {
      id: generateId(),
      organizationId,
      entityType: 'customer',
      entityId: customerId,
      versionNumber: nextVersion,
      payload: {
        name: customer.name,
        membershipTier: customer.membershipTier,
        points: customer.points,
      },
      reasonNote,
      isActive: true,
      createdBy: actorId,
      createdAt: Date.now(),
    };

    await mdRepo.create(newVersion);

    await auditService.log({
      actorId,
      action: 'publish_customer_version',
      entityType: 'customer',
      entityId: customerId,
      metadata: { versionNumber: nextVersion, organizationId },
    });

    return newVersion;
  }

  /**
   * Returns the full version history for a customer, newest first.
   * Requires: any authenticated user.
   *
   * @param {string} customerId
   * @returns {Promise<object[]>}
   */
  async getCustomerVersionHistory(customerId) {
    const actor = this._requireAuth();
    // Resolve org from the customer record — never trust caller-provided orgId.
    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);
    const mdRepo = new MasterDataRepository();
    return mdRepo.findVersionHistory(customerId);
  }

  /**
   * Returns the currently active version snapshot for a customer, or null.
   * Requires: any authenticated user within the customer's org.
   *
   * @param {string} customerId
   * @returns {Promise<object | null>}
   */
  async getActiveCustomerVersion(customerId) {
    const actor = this._requireAuth();
    const customer = await this._repo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');
    await this._assertOrgScope(actor, customer.organizationId);
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    return history.find((v) => v.isActive) ?? null;
  }

  /**
   * Creates a customer version record (RECORD HISTORY model: one active per entityId).
   */
  async _createCustomerVersion(customerId, organizationId, payload, reasonNote, actorId) {
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    for (const v of history) {
      if (v.isActive) await mdRepo.update(v.id, { ...v, isActive: false });
    }
    const nextVersion = history.length > 0 ? history[0].versionNumber + 1 : 1;
    await mdRepo.create({
      id: generateId(), organizationId, entityType: 'customer', entityId: customerId,
      versionNumber: nextVersion, payload, reasonNote, isActive: true,
      createdBy: actorId, createdAt: Date.now(),
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Requires authentication and at least one of the given roles.
   * ADMINISTRATOR always passes. Returns the current user.
   *
   * @param {...string} allowedRoles
   * @returns {object}
   */
  _requireRole(...allowedRoles) {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    authService.requireUnlocked();
    if (user.role === ROLES.ADMINISTRATOR) return user;
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      throw new Error(`Permission denied. Required role(s): ${allowedRoles.join(', ')}`);
    }
    return user;
  }

  /** Requires authentication only. Returns the current user. */
  _requireAuth() {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    return user;
  }

  /**
   * For non-admin actors: verifies the target org is within their accessible subtree.
   * @param {object} actor
   * @param {string} targetOrgId
   */
  async _assertOrgScope(actor, targetOrgId) {
    if (actor.role === ROLES.ADMINISTRATOR) return;
    if (!actor.organizationNodeId) throw new Error('Actor has no organization assigned.');
    const inScope = await orgService.isInScope(actor, targetOrgId);
    if (!inScope) throw new Error('Scope violation: you can only access data within your assigned organization.');
  }
}

export const customerService = new CustomerService();
