import {
  NotificationChannelRepository,
  NotificationSubscriptionRepository,
  MessageQueueRepository,
  NotificationRepository,
} from '../repositories/implementations/NotificationRepository.js';
import { templateService } from './TemplateService.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { orgService } from './OrgService.js';
import { generateId, generateIdempotencyKey } from '../utils/idGenerator.js';
import { ROLES, QUEUE_STATUSES, RETRY_SCHEDULE_MINUTES, MAX_RETRIES } from '../utils/constants.js';

export class NotificationService {
  constructor() {
    this._channelRepo = new NotificationChannelRepository();
    this._subscriptionRepo = new NotificationSubscriptionRepository();
    this._queueRepo = new MessageQueueRepository();
    this._notifRepo = new NotificationRepository();
  }

  // ── Channel configuration ─────────────────────────────────────────────────────

  /**
   * Creates or updates a notification channel.
   * Only 'in_app' channels are supported in the offline runtime.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; name: string; type?: string; isEnabled?: boolean }} params
   * @returns {Promise<object>}
   */
  async upsertChannel({ organizationId, name, type = 'in_app', isEnabled = true }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    const ALLOWED_CHANNEL_TYPES = ['in_app'];
    if (!ALLOWED_CHANNEL_TYPES.includes(type)) {
      throw new Error(`Invalid channel type '${type}'. Only '${ALLOWED_CHANNEL_TYPES.join(', ')}' is supported in the offline runtime.`);
    }

    if (!name?.trim()) throw new Error('Channel name is required.');

    const channel = {
      id: generateId(),
      organizationId,
      name,
      type,
      isEnabled,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return this._channelRepo.upsert(channel);
  }

  /**
   * Subscribes a user to an event type on a channel.
   * Requires: any authenticated user.
   *
   * @param {{ userId: string; channelId: string; eventType: string; filters?: object }} params
   * @returns {Promise<object>}
   */
  async subscribe({ userId, channelId, eventType, organizationId, filters = {} }) {
    const actor = this._requireAuth();

    if (!eventType?.trim()) throw new Error('Event type is required.');

    // Guest users cannot create subscriptions.
    if (actor.role === ROLES.GUEST) throw new Error('Permission denied: guests cannot subscribe.');

    // RBAC: non-admin users can only subscribe for themselves.
    if (actor.role !== ROLES.ADMINISTRATOR && actor.id !== userId) {
      throw new Error('Permission denied: you can only subscribe for yourself.');
    }

    // Org scope: non-admin users can only subscribe within their own org.
    const resolvedOrgId = organizationId ?? actor.organizationNodeId ?? null;
    if (resolvedOrgId) {
      await this._assertOrgScope(actor, resolvedOrgId);
    }

    // Channel validation: if channelId provided, it must exist and be enabled.
    if (channelId) {
      const channel = await this._channelRepo.findById(channelId);
      if (!channel) throw new Error(`Channel '${channelId}' not found.`);
      if (channel.isEnabled === false) throw new Error(`Channel '${channelId}' is disabled.`);
    }

    const sub = {
      id: generateId(),
      userId,
      channelId,
      eventType,
      organizationId: resolvedOrgId,
      filters,
      isEnabled: true,
    };
    return this._subscriptionRepo.upsert(sub);
  }

  // ── Queueing ──────────────────────────────────────────────────────────────────

  /**
   * Queues a notification message for a recipient.
   * Deduplicates using an idempotency key derived from the source event.
   * Requires: any authenticated user.
   *
   * @param {{ organizationId: string; recipientUserId: string; templateId: string; channelId: string | null; vars?: Record<string, string>; eventSourceKey: string }} params
   * @returns {Promise<object>}
   */
  async enqueue({ organizationId, recipientUserId, templateId, channelId, vars = {}, eventSourceKey }) {
    const actor = this._requireAuthOrSystem();

    if (!eventSourceKey?.trim()) throw new Error('eventSourceKey is required for deduplication.');
    if (!templateId) throw new Error('templateId is required. All notifications must be template-backed.');

    // Guest users cannot enqueue.
    if (actor.role === ROLES.GUEST) throw new Error('Permission denied: guests cannot enqueue notifications.');

    // Org scope: non-admin actors must be within the target organization.
    if (organizationId) {
      await this._assertOrgScope(actor, organizationId);
    }

    const idempotencyKey = generateIdempotencyKey(eventSourceKey);

    // Deduplication: skip if an identical key already exists in non-failed state.
    const existing = await this._queueRepo.findAll();
    const duplicate = existing.find(
      (item) => item.idempotencyKey === idempotencyKey && item.status !== QUEUE_STATUSES.FAILED,
    );
    if (duplicate) return duplicate;

    let renderedBody;
    try {
      renderedBody = await templateService.renderTemplate(templateId, vars);
    } catch (err) {
      // Only missing-placeholder errors produce a Draft (they may be resolved later).
      // Hard constraint violations (compact overflow, etc.) must propagate.
      if (!err.message.startsWith('Missing template variables')) throw err;
      // Template rendering failure creates a Draft item for manual review.
      const draftItem = {
        id: generateId(),
        organizationId,
        recipientUserId,
        templateId,
        channelId,
        payload: vars,
        renderedBody: null,
        status: QUEUE_STATUSES.DRAFT,
        retryCount: 0,
        nextRetryAt: null,
        failureReason: err.message,
        idempotencyKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return this._queueRepo.create(draftItem);
    }

    const item = {
      id: generateId(),
      organizationId,
      recipientUserId,
      templateId,
      channelId,
      payload: vars,
      renderedBody,
      status: QUEUE_STATUSES.QUEUED,
      retryCount: 0,
      nextRetryAt: Date.now(), // process immediately
      failureReason: null,
      idempotencyKey,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return this._queueRepo.create(item);
  }

  // ── Direct in-app notification ────────────────────────────────────────────────

  /**
   * Creates an in-app notification directly for a user — no template required.
   * Used by other services (OrderService, TicketService) to notify on state changes.
   *
   * @param {string} userId  Recipient user ID.
   * @param {{ type?: string; title: string; body: string }} params
   * @returns {Promise<object>}
   */
  async notifyUser(userId, { type = 'system', title, body }) {
    if (!userId) throw new Error('userId is required.');
    if (!title?.trim()) throw new Error('Notification title is required.');
    if (!body?.trim()) throw new Error('Notification body is required.');

    const notification = {
      id: generateId(),
      userId,
      type,
      title,
      body,
      read: false,
      createdAt: Date.now(),
    };

    await this._notifRepo.create(notification);
    await auditService.log({
      actorId: 'system',
      action: 'notification_sent',
      entityType: 'notification',
      entityId: notification.id,
      metadata: { userId, type },
    });

    return notification;
  }

  // ── Queue processing ──────────────────────────────────────────────────────────

  /**
   * Processes all queue items due for delivery.
   * Called by SchedulerService (single-tab leader only).
   *
   * @returns {Promise<{ sent: number; failed: number }>}
   */
  async processDueItems() {
    const due = await this._queueRepo.findDueForRetry(Date.now());
    let sent = 0;
    let failed = 0;

    for (const item of due) {
      try {
        await this._deliverItem(item);
        await this._queueRepo.update(item.id, {
          ...item,
          status: QUEUE_STATUSES.SENT,
          updatedAt: Date.now(),
        });
        sent++;
      } catch (err) {
        await this._handleDeliveryFailure(item, err.message);
        failed++;
      }
    }

    return { sent, failed };
  }

  /**
   * Re-queues a Draft item after its missing variables have been resolved.
   * Re-renders the template with updated vars and transitions Draft → Queued.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} itemId
   * @param {Record<string, string>} updatedVars  Corrected template variables.
   * @returns {Promise<object>}
   */
  async requeueDraft(itemId, updatedVars) {
    this._requireRole(ROLES.STORE_MANAGER);

    const item = await this._queueRepo.findById(itemId);
    if (!item) throw new Error(`Queue item '${itemId}' not found.`);
    if (item.status !== QUEUE_STATUSES.DRAFT) {
      throw new Error(`Only Draft items can be requeued. Current status: ${item.status}`);
    }

    // Re-render with corrected variables.
    const renderedBody = await templateService.renderTemplate(item.templateId, updatedVars);

    const updated = {
      ...item,
      payload: updatedVars,
      renderedBody,
      status: QUEUE_STATUSES.QUEUED,
      failureReason: null,
      nextRetryAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._queueRepo.update(itemId, updated);
    await auditService.log({
      actorId: authService.getCurrentUser()?.id ?? 'system',
      action: 'requeue_draft',
      entityType: 'messageQueue',
      entityId: itemId,
    });

    return updated;
  }

  // ── Inbox ─────────────────────────────────────────────────────────────────────

  /**
   * Returns all notifications for a user, newest first.
   * Requires: any authenticated user (own inbox only).
   *
   * @param {string} userId
   * @returns {Promise<object[]>}
   */
  async getInbox(userId) {
    const actor = this._requireAuth();
    // Non-admin users can only view their own inbox.
    if (actor.role !== ROLES.ADMINISTRATOR && actor.id !== userId) {
      throw new Error('Permission denied: you can only view your own inbox.');
    }
    const notifications = await this._notifRepo.findByUser(userId);
    return notifications.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Marks a notification as read.
   * Requires: any authenticated user (own notification only).
   *
   * @param {string} notificationId
   * @returns {Promise<void>}
   */
  async markRead(notificationId) {
    const actor = this._requireAuth();
    const notif = await this._notifRepo.findById(notificationId);
    if (!notif) throw new Error('Notification not found.');
    if (actor.role !== ROLES.ADMINISTRATOR && actor.id !== notif.userId) {
      throw new Error('Permission denied: you can only mark your own notifications as read.');
    }
    await this._notifRepo.update(notificationId, { ...notif, read: true });
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────────

  /**
   * Returns all enabled subscriptions for a given event type, scoped by organization.
   * Subscriptions without an organizationId are included only when no orgId filter is passed.
   * Used by EventDispatcherService to route dispatched events.
   * Requires: any authenticated user.
   *
   * @param {string} eventType
   * @param {string | null} organizationId  When provided, filters to matching org subscriptions only.
   * @returns {Promise<object[]>}
   */
  async getSubscriptionsByEventType(eventType, organizationId = null) {
    this._requireAuthOrSystem();
    const all = await this._subscriptionRepo.findAll();
    return all.filter((s) => {
      if (s.eventType !== eventType || s.isEnabled === false) return false;
      // Org-scope filter: if both caller and subscription have an orgId they must match.
      if (organizationId && s.organizationId && s.organizationId !== organizationId) return false;
      return true;
    });
  }

  /**
   * Returns all subscriptions for a user.
   * Non-admin users can only view their own subscriptions.
   * Requires: any authenticated user.
   *
   * @param {string} userId
   * @returns {Promise<object[]>}
   */
  async getSubscriptions(userId) {
    const actor = this._requireAuth();
    // RBAC: non-admin users can only view their own subscriptions.
    if (actor.role !== ROLES.ADMINISTRATOR && actor.id !== userId) {
      throw new Error('Permission denied: you can only view your own subscriptions.');
    }
    const all = await this._subscriptionRepo.findAll();
    return all.filter((s) => s.userId === userId);
  }

  /**
   * Deletes a subscription.
   * Non-admin users can only delete their own subscriptions.
   * Requires: any authenticated user.
   *
   * @param {string} subscriptionId
   * @param {string} actorId
   * @returns {Promise<void>}
   */
  async deleteSubscription(subscriptionId, actorId) {
    const actor = this._requireAuth();
    if (actor.role === ROLES.GUEST) throw new Error('Permission denied: guests cannot delete subscriptions.');
    const sub = await this._subscriptionRepo.findById(subscriptionId);
    if (!sub) throw new Error(`Subscription '${subscriptionId}' not found.`);
    if (actor.role !== ROLES.ADMINISTRATOR && actor.id !== sub.userId) {
      throw new Error('Permission denied: you can only delete your own subscriptions.');
    }
    await this._subscriptionRepo.delete(subscriptionId);
    await auditService.log({ actorId, action: 'delete_subscription', entityType: 'subscription', entityId: subscriptionId });
  }

  // ── Queue reads ───────────────────────────────────────────────────────────────

  /**
   * Returns all message queue items for an organization.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getQueueByOrg(organizationId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);
    const all = await this._queueRepo.findAll();
    return all.filter((item) => item.organizationId === organizationId);
  }

  /**
   * Returns all channels for an organization.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getChannels(organizationId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);
    return this._channelRepo.findByOrg(organizationId);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Materialises a queue item into the recipient's in-app notification inbox.
   * "Sent" in an offline system means: written to local notifications store.
   * @param {object} item
   */
  async _deliverItem(item) {
    if (!item.renderedBody) throw new Error('Cannot deliver item with no rendered body.');

    const notification = {
      id: generateId(),
      userId: item.recipientUserId,
      type: 'queue_delivery',
      title: 'New message',
      body: item.renderedBody,
      read: false,
      createdAt: Date.now(),
    };

    await this._notifRepo.create(notification);
    await auditService.log({
      actorId: 'system',
      action: 'notification_sent',
      entityType: 'messageQueue',
      entityId: item.id,
    });
  }

  /**
   * Increments retry count and schedules next attempt, or marks as Failed.
   * Retry schedule: 1 min, 5 min, 15 min → then Failed.
   *
   * @param {object} item
   * @param {string} reason
   */
  async _handleDeliveryFailure(item, reason) {
    const newRetryCount = item.retryCount + 1;

    if (newRetryCount > MAX_RETRIES) {
      await this._queueRepo.update(item.id, {
        ...item,
        status: QUEUE_STATUSES.FAILED,
        retryCount: newRetryCount,
        failureReason: reason,
        nextRetryAt: null,
        updatedAt: Date.now(),
      });
    } else {
      const delayMinutes = RETRY_SCHEDULE_MINUTES[newRetryCount - 1] ?? RETRY_SCHEDULE_MINUTES.at(-1);
      const nextRetryAt = Date.now() + delayMinutes * 60_000;
      await this._queueRepo.update(item.id, {
        ...item,
        retryCount: newRetryCount,
        failureReason: reason,
        nextRetryAt,
        updatedAt: Date.now(),
      });
    }
  }

  async _assertOrgScope(actor, targetOrgId) {
    if (actor.role === ROLES.ADMINISTRATOR) return;
    if (!actor.organizationNodeId) throw new Error('Actor has no organization assigned.');
    const inScope = await orgService.isInScope(actor, targetOrgId);
    if (!inScope) throw new Error('Scope violation: you can only access data within your assigned organization.');
  }

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

  /**
   * Returns the current user or a system actor placeholder.
   * Used by methods that may be called by the scheduler without a logged-in user.
   */
  _requireAuthOrSystem() {
    const user = authService.getCurrentUser();
    if (user) return user;
    // System actor — used by scheduler-triggered paths (processDueItems, evaluateOverdue).
    return { id: 'system', role: ROLES.ADMINISTRATOR, organizationNodeId: null };
  }
}

export const notificationService = new NotificationService();
