import { TemplateRepository } from '../repositories/implementations/TemplateRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { ROLES } from '../utils/constants.js';
import { orgService } from './OrgService.js';
import {
  extractPlaceholders,
  validatePlaceholders,
  validateCompactNoticeLength,
  renderTemplate,
} from '../utils/validation.js';

/**
 * TemplateService — notification template management with placeholder enforcement.
 *
 * RBAC:
 *   - create/update/delete → ADMINISTRATOR or STORE_MANAGER
 *   - reads / render       → any authenticated user
 */
export class TemplateService {
  constructor() {
    this._repo = new TemplateRepository();
  }

  /**
   * Creates a new message template.
   * Validates declared placeholders match those found in the body.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; name: string; body: string; isCompact?: boolean; actorId: string }} params
   * @returns {Promise<object>}
   */
  async createTemplate({ organizationId, name, body, isCompact = false, actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    if (!name?.trim()) throw new Error('Template name is required.');
    if (!body?.trim()) throw new Error('Template body is required.');

    const detectedPlaceholders = extractPlaceholders(body);

    const template = {
      id: generateId(),
      organizationId,
      name,
      body,
      placeholders: detectedPlaceholders,
      isCompact,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._repo.create(template);
    await auditService.log({ actorId, action: 'create_template', entityType: 'template', entityId: template.id });
    return template;
  }

  /**
   * Updates a template.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} templateId
   * @param {{ name?: string; body?: string; isCompact?: boolean }} data
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async updateTemplate(templateId, data, actorId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const existing = await this._repo.findById(templateId);
    if (!existing) throw new Error('Template not found.');
    await this._assertOrgScope(actor, existing.organizationId);

    const newBody = data.body ?? existing.body;
    const detectedPlaceholders = extractPlaceholders(newBody);

    const updated = {
      ...existing,
      ...data,
      body: newBody,
      placeholders: detectedPlaceholders,
      updatedAt: Date.now(),
    };

    await this._repo.update(templateId, updated);
    await auditService.log({ actorId, action: 'update_template', entityType: 'template', entityId: templateId });
    return updated;
  }

  /**
   * Renders a template body with the given variable substitutions.
   * Validates that all placeholders are resolved and compact limit is respected.
   * Requires: any authenticated user.
   *
   * @param {string} templateId
   * @param {Record<string, string>} vars
   * @returns {Promise<string>}
   */
  async renderTemplate(templateId, vars) {
    const user = authService.getCurrentUser();
    // Allow system-initiated rendering (scheduler/dispatcher) without login.
    const actor = user ?? { id: 'system', role: ROLES.ADMINISTRATOR, organizationNodeId: null };

    const template = await this._repo.findById(templateId);
    if (!template) throw new Error('Template not found.');

    // Org isolation: non-admin users cannot render templates from foreign orgs.
    await this._assertOrgScope(actor, template.organizationId);

    const phCheck = validatePlaceholders(template.placeholders, vars);
    if (!phCheck.valid) {
      throw new Error(`Missing template variables: ${phCheck.missing.join(', ')}`);
    }

    const rendered = renderTemplate(template.body, vars);

    if (template.isCompact) {
      const lenCheck = validateCompactNoticeLength(rendered);
      if (!lenCheck.valid) throw new Error(lenCheck.error);
    }

    return rendered;
  }

  /**
   * Deletes a template.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} templateId
   * @param {string} actorId
   * @returns {Promise<void>}
   */
  async deleteTemplate(templateId, actorId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const existing = await this._repo.findById(templateId);
    if (!existing) throw new Error('Template not found.');
    await this._assertOrgScope(actor, existing.organizationId);

    await this._repo.delete(templateId);
    await auditService.log({ actorId, action: 'delete_template', entityType: 'template', entityId: templateId });
  }

  /**
   * Returns all templates for an organization.
   * Requires: any authenticated user.
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
   * Returns a template by ID.
   * Requires: any authenticated user (own org only).
   *
   * @param {string} templateId
   * @returns {Promise<object | null>}
   */
  async getById(templateId) {
    const actor = this._requireAuth();
    const template = await this._repo.findById(templateId);
    if (template) await this._assertOrgScope(actor, template.organizationId);
    return template;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

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

  _requireAuth() {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    return user;
  }

  async _assertOrgScope(actor, targetOrgId) {
    if (actor.role === ROLES.ADMINISTRATOR) return;
    if (!actor.organizationNodeId) throw new Error('Actor has no organization assigned.');
    const inScope = await orgService.isInScope(actor, targetOrgId);
    if (!inScope) throw new Error('Scope violation: you can only access data within your assigned organization.');
  }
}

export const templateService = new TemplateService();
