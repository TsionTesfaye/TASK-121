/**
 * EventDispatcherService
 *
 * Routes business events to notification recipients via the message queue.
 * Every notification is template-backed — the dispatcher resolves a system
 * template for the event type from SYSTEM_TEMPLATES and passes its ID to
 * NotificationService.enqueue().  No body-only bypass is allowed.
 *
 * Delivery paths (both template-backed, both through the queue):
 *   1. Subscription path — org-scoped subscribers receive a templated queue item.
 *   2. Direct path — explicit recipientUserIds receive a templated queue item.
 *
 * All delivery failures are non-fatal and recorded in the audit log.
 */

import { TemplateRepository } from '../repositories/implementations/TemplateRepository.js';
import { notificationService } from './NotificationService.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { EVENT_TYPES, SYSTEM_TEMPLATES } from '../utils/constants.js';

export class EventDispatcherService {
  constructor() {
    this._templateRepo = new TemplateRepository();
  }

  /**
   * Resolves the templateId for a given event type and organization.
   * Looks up the system template by its well-known name from SYSTEM_TEMPLATES.
   * If the caller already provided an explicit templateId it is returned as-is.
   *
   * @param {string | null} explicitTemplateId
   * @param {string} eventType
   * @param {string} organizationId
   * @returns {Promise<string | null>}
   */
  async _resolveTemplateId(explicitTemplateId, eventType, organizationId) {
    if (explicitTemplateId) return explicitTemplateId;

    const systemDef = SYSTEM_TEMPLATES[eventType];
    if (!systemDef) return null;

    const template = await this._templateRepo.findByName(systemDef.name, organizationId);
    return template?.id ?? null;
  }

  /**
   * Dispatches a business event.
   *
   * Template resolution: if the caller provides a templateId it is used directly.
   * Otherwise the dispatcher resolves the system template for the event type.
   * If no template can be resolved the event is logged but not enqueued.
   *
   * The caller passes title + body as template variables ({title}, {body}) so
   * the system template can render them.
   *
   * @param {{
   *   organizationId: string;
   *   eventType: string;
   *   sourceId: string;
   *   actorId: string;
   *   vars?: Record<string, string>;
   *   templateId?: string | null;
   *   recipientUserIds?: string[] | null;
   *   title?: string;
   *   body?: string;
   * }} params
   * @returns {Promise<void>}
   */
  async dispatch({
    organizationId,
    eventType,
    sourceId,
    actorId,
    vars = {},
    templateId = null,
    recipientUserIds = null,
    title,
    body,
  }) {
    const eventSourceKey = `${eventType}:${sourceId}:${actorId}:${Date.now()}`;

    // Resolve a template — explicit > system template lookup.
    const resolvedTemplateId = await this._resolveTemplateId(templateId, eventType, organizationId);

    // Merge title + body into vars so system templates can reference them.
    const mergedVars = { ...vars };
    if (title) mergedVars.title = title;
    if (body) mergedVars.body = body;

    if (!resolvedTemplateId) {
      // No template available — log and skip (no body-only bypass).
      await auditService.log({
        actorId,
        action: 'dispatch_no_template',
        entityType: 'event',
        entityId: sourceId,
        metadata: { eventType, organizationId },
      }).catch(() => {});
      return;
    }

    // ── Subscription-based delivery (queue path) ─────────────────────────────
    try {
      const subscriptions = await notificationService.getSubscriptionsByEventType(eventType, organizationId);
      for (const sub of subscriptions) {
        try {
          await notificationService.enqueue({
            organizationId,
            recipientUserId: sub.userId,
            templateId: resolvedTemplateId,
            channelId: sub.channelId,
            vars: mergedVars,
            eventSourceKey: `${eventSourceKey}:sub:${sub.userId}`,
          });
        } catch (err) {
          await auditService.log({
            actorId,
            action: 'dispatch_enqueue_failed',
            entityType: 'event',
            entityId: sourceId,
            metadata: { eventType, userId: sub.userId, error: err.message },
          }).catch(() => {});
        }
      }
    } catch (err) {
      await auditService.log({
        actorId,
        action: 'dispatch_subscription_lookup_failed',
        entityType: 'event',
        entityId: sourceId,
        metadata: { eventType, error: err.message },
      }).catch(() => {});
    }

    // ── Direct delivery (explicit recipients, queue path) ────────────────────
    if (recipientUserIds?.length) {
      for (const userId of recipientUserIds) {
        try {
          await notificationService.enqueue({
            organizationId,
            recipientUserId: userId,
            templateId: resolvedTemplateId,
            channelId: null,
            vars: mergedVars,
            eventSourceKey: `${eventSourceKey}:direct:${userId}`,
          });
        } catch (err) {
          await auditService.log({
            actorId,
            action: 'dispatch_enqueue_direct_failed',
            entityType: 'event',
            entityId: sourceId,
            metadata: { eventType, userId, error: err.message },
          }).catch(() => {});
        }
      }
    }
  }

  /**
   * Broadcasts an organization-wide announcement.
   *
   * @param {{ organizationId: string; title: string; body: string; actorId: string; recipientUserIds?: string[] }} params
   * @returns {Promise<void>}
   */
  async announce({ organizationId, title, body, actorId, recipientUserIds = [] }) {
    return this.dispatch({
      organizationId,
      eventType: EVENT_TYPES.ANNOUNCEMENT,
      sourceId: `announcement:${Date.now()}`,
      actorId,
      vars: { title, body },
      recipientUserIds: recipientUserIds.length > 0 ? recipientUserIds : null,
      title,
      body,
    });
  }

  _requireAuth() {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    return user;
  }
}

export const eventDispatcherService = new EventDispatcherService();
