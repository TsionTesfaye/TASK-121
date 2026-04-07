import { OrderRepository, OrderEventRepository } from '../repositories/implementations/OrderRepository.js';
import { CustomerRepository } from '../repositories/implementations/CustomerRepository.js';
import { OrgRepository } from '../repositories/implementations/OrgRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { eventDispatcherService } from './EventDispatcherService.js';
import { generateId } from '../utils/idGenerator.js';
import { ROLES, ORDER_STATUSES, ORDER_TRANSITIONS, EVENT_TYPES, ORG_NODE_TYPES } from '../utils/constants.js';
import { orgService } from './OrgService.js';

/** States for which a notification is sent on transition. */
const NOTIFY_ON_STATUS = new Set([
  ORDER_STATUSES.IN_PROGRESS,
  ORDER_STATUSES.READY,
  ORDER_STATUSES.COMPLETED,
  ORDER_STATUSES.CANCELED,
]);

/** Terminal states that cannot be transitioned out of. */
const TERMINAL_STATES = new Set([ORDER_STATUSES.COMPLETED, ORDER_STATUSES.CANCELED]);

export class OrderService {
  constructor() {
    this._orderRepo = new OrderRepository();
    this._eventRepo = new OrderEventRepository();
    this._customerRepo = new CustomerRepository();
    this._orgRepo = new OrgRepository();
  }

  /**
   * Creates a new order for a customer.
   * Reads customer allergy/restriction flags and attaches them to the order.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ customerId: string; organizationId: string; storeId: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async createOrder({ customerId, organizationId, storeId, items = [], actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, storeId);

    if (!Array.isArray(items)) throw new Error('Items must be an array.');

    // Validate store exists, is of type 'store', and belongs to the organization.
    const storeNode = await this._orgRepo.findById(storeId);
    if (!storeNode) throw new Error(`Store '${storeId}' not found.`);
    if (storeNode.type !== ORG_NODE_TYPES.STORE && storeNode.type !== ORG_NODE_TYPES.COMPANY) {
      throw new Error(`Node '${storeId}' is of type '${storeNode.type}', expected 'store'.`);
    }
    if (storeNode.organizationId !== organizationId) {
      throw new Error('Store does not belong to the specified organization.');
    }

    const customer = await this._customerRepo.findById(customerId);
    if (!customer) throw new Error('Customer not found.');

    // Tenant isolation: customer must belong to the same organization as the order.
    if (customer.organizationId !== organizationId) {
      throw new Error('Customer does not belong to this organization.');
    }

    // Build restriction flags as warning metadata (non-blocking).
    const restrictionFlags = {
      hasAllergies: customer.allergiesCiphertext !== null,
      hasMaterialRestrictions: customer.materialRestrictionsCiphertext !== null,
      // Decrypted values are loaded by UI on demand (masked by default).
    };

    const order = {
      id: generateId(),
      customerId,
      organizationId,
      storeId,
      items,
      status: ORDER_STATUSES.DRAFT,
      restrictionFlags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._orderRepo.create(order);
    await this._appendEvent({ orderId: order.id, type: 'created', actorId });
    await auditService.log({ actorId, action: 'create_order', entityType: 'order', entityId: order.id });

    return order;
  }

  /**
   * Transitions an order to the next status.
   * Validates the transition is legal. Triggers notifications on key state changes.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} orderId
   * @param {string} newStatus
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async transitionOrder(orderId, newStatus, actorId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const order = await this._orderRepo.findById(orderId);
    if (!order) throw new Error('Order not found.');
    await this._assertOrgScope(actor, order.storeId);

    if (TERMINAL_STATES.has(order.status)) {
      throw new Error(`Order ${orderId} is in terminal state '${order.status}' and cannot be transitioned.`);
    }

    const allowed = ORDER_TRANSITIONS.get(order.status) ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${order.status} → ${newStatus}. Allowed: ${allowed.join(', ')}`,
      );
    }

    const updated = { ...order, status: newStatus, updatedAt: Date.now() };
    await this._orderRepo.update(orderId, updated);
    await this._appendEvent({ orderId, type: 'status_changed', actorId, metadata: { from: order.status, to: newStatus } });
    await auditService.log({ actorId, action: 'transition_order', entityType: 'order', entityId: orderId, metadata: { from: order.status, to: newStatus } });

    // Notify actor on significant state changes via EventDispatcher.
    if (NOTIFY_ON_STATUS.has(newStatus)) {
      const label = {
        [ORDER_STATUSES.IN_PROGRESS]: 'now in progress',
        [ORDER_STATUSES.READY]: 'ready for pickup',
        [ORDER_STATUSES.COMPLETED]: 'completed',
        [ORDER_STATUSES.CANCELED]: 'canceled',
      }[newStatus];
      await eventDispatcherService.dispatch({
        organizationId: order.organizationId,
        eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
        sourceId: orderId,
        actorId,
        vars: { orderId, status: newStatus, label },
        recipientUserIds: [actorId],
        title: `Order ${newStatus.replace('_', ' ')}`,
        body: `Order ${orderId} is ${label}.`,
      });
    }

    return updated;
  }

  /**
   * Returns all orders for a customer.
   * Requires: any authenticated user.
   *
   * @param {string} customerId
   * @returns {Promise<object[]>}
   */
  async getByCustomer(customerId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    const customer = await this._customerRepo.findById(customerId);
    if (!customer) return [];
    await this._assertOrgScope(actor, customer.organizationId);
    return this._orderRepo.findByCustomer(customerId);
  }

  /**
   * Returns a single order with its events.
   * Requires: any authenticated user within the order's organization.
   *
   * @param {string} orderId
   * @returns {Promise<{ order: object; events: object[] } | null>}
   */
  async getOrderDetail(orderId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    const order = await this._orderRepo.findById(orderId);
    if (!order) return null;
    await this._assertOrgScope(actor, order.storeId);
    const events = await this._eventRepo.findByOrder(orderId);
    return { order, events };
  }

  /**
   * Returns all orders for a store.
   * Requires: any authenticated user.
   *
   * @param {string} storeId
   * @returns {Promise<object[]>}
   */
  async getByStore(storeId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, storeId);
    return this._orderRepo.findByStore(storeId);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  async _appendEvent({ orderId, type, actorId, metadata = {} }) {
    const event = {
      id: generateId(),
      orderId,
      type,
      actorId,
      metadata,
      createdAt: Date.now(),
    };
    return this._eventRepo.create(event);
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

  async _assertOrgScope(actor, targetOrgId) {
    if (actor.role === ROLES.ADMINISTRATOR) return;
    if (!actor.organizationNodeId) throw new Error('Actor has no organization assigned.');
    const inScope = await orgService.isInScope(actor, targetOrgId);
    if (!inScope) throw new Error('Scope violation: you can only access data within your assigned organization.');
  }
}

export const orderService = new OrderService();
