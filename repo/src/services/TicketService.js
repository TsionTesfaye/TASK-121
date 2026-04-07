import { TicketRepository, TicketEventRepository } from '../repositories/implementations/TicketRepository.js';
import { CustomerRepository } from '../repositories/implementations/CustomerRepository.js';
import { OrgRepository } from '../repositories/implementations/OrgRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { eventDispatcherService } from './EventDispatcherService.js';
import { generateId } from '../utils/idGenerator.js';
import {
  ROLES,
  TICKET_STATUSES,
  TICKET_EVENT_TYPES,
  VALIDATION,
  EVENT_TYPES,
  ORG_NODE_TYPES,
} from '../utils/constants.js';
import { orgService } from './OrgService.js';
import { isValidTicketPriority } from '../utils/validation.js';

/** Terminal states that cannot be transitioned out of. */
const TERMINAL_STATES = new Set([TICKET_STATUSES.CLOSED]);

/** Valid forward transitions. */
const TRANSITIONS = new Map([
  [TICKET_STATUSES.OPEN, [TICKET_STATUSES.IN_PROGRESS, TICKET_STATUSES.CLOSED]],
  [TICKET_STATUSES.IN_PROGRESS, [TICKET_STATUSES.RESOLVED, TICKET_STATUSES.CLOSED]],
  [TICKET_STATUSES.RESOLVED, [TICKET_STATUSES.CLOSED]],
  [TICKET_STATUSES.CLOSED, []],
]);

export class TicketService {
  constructor() {
    this._ticketRepo = new TicketRepository();
    this._eventRepo = new TicketEventRepository();
    this._customerRepo = new CustomerRepository();
    this._orgRepo = new OrgRepository();
  }

  /**
   * Creates a new after-sales ticket.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ customerId: string; orderId?: string; organizationId: string; storeId: string; subject: string; description: string; category: string; priority: string; actorId: string; slaHours?: number }} params
   * @returns {Promise<object>}
   */
  async createTicket({ customerId, orderId, organizationId, storeId, subject, description, category, priority, actorId, slaHours = VALIDATION.DEFAULT_TICKET_SLA_HOURS }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, storeId);

    // Validate store node exists and belongs to the organization.
    const storeNode = await this._orgRepo.findById(storeId);
    if (!storeNode) throw new Error(`Store '${storeId}' not found.`);
    if (storeNode.type !== ORG_NODE_TYPES.STORE && storeNode.type !== ORG_NODE_TYPES.COMPANY) {
      throw new Error(`Node '${storeId}' is of type '${storeNode.type}', expected 'store'.`);
    }
    if (storeNode.organizationId !== organizationId) {
      throw new Error('Store does not belong to the specified organization.');
    }

    if (!subject?.trim()) throw new Error('Subject is required.');
    if (!description?.trim()) throw new Error('Description is required.');
    if (!category?.trim()) throw new Error('Category is required.');
    if (!isValidTicketPriority(priority)) throw new Error(`Invalid priority: '${priority}'. Valid: low, medium, high`);

    // Validate customer exists and belongs to the same organization.
    if (customerId) {
      const customer = await this._customerRepo.findById(customerId);
      if (!customer) throw new Error(`Customer '${customerId}' not found.`);
      if (customer.organizationId !== organizationId) {
        throw new Error('Customer does not belong to this organization.');
      }
    }

    const now = Date.now();
    const ticket = {
      id: generateId(),
      customerId,
      orderId: orderId ?? null,
      organizationId,
      storeId,
      subject,
      description,
      category,
      priority,
      status: TICKET_STATUSES.OPEN,
      slaDueAt: now + slaHours * 60 * 60 * 1000,
      isOverdue: false,
      assignedTo: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      closedBy: null,
    };

    await this._ticketRepo.create(ticket);
    await this._appendEvent({ ticketId: ticket.id, type: TICKET_EVENT_TYPES.CREATED, actorId });
    await auditService.log({ actorId, action: 'create_ticket', entityType: 'ticket', entityId: ticket.id });

    return ticket;
  }

  /**
   * Assigns a ticket to an agent.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} ticketId
   * @param {string} assigneeId
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async assignTicket(ticketId, assigneeId, actorId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const ticket = await this._getOrThrow(ticketId);
    await this._assertOrgScope(actor, ticket.storeId);
    this._assertNotTerminal(ticket);

    const updated = { ...ticket, assignedTo: assigneeId, status: TICKET_STATUSES.IN_PROGRESS, updatedAt: Date.now() };
    await this._ticketRepo.update(ticketId, updated);
    await this._appendEvent({ ticketId, type: TICKET_EVENT_TYPES.ASSIGNED, actorId, comment: `Assigned to ${assigneeId}` });
    await auditService.log({ actorId, action: 'assign_ticket', entityType: 'ticket', entityId: ticketId, metadata: { assigneeId } });

    // Notify the assignee via EventDispatcher.
    await eventDispatcherService.dispatch({
      organizationId: ticket.organizationId,
      eventType: EVENT_TYPES.TICKET_ASSIGNED,
      sourceId: ticketId,
      actorId,
      vars: { ticketId, subject: ticket.subject, assigneeId },
      recipientUserIds: [assigneeId],
      title: 'Ticket assigned to you',
      body: `Ticket "${ticket.subject}" has been assigned to you.`,
    });

    return updated;
  }

  /**
   * Transitions a ticket to a new status.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} ticketId
   * @param {string} newStatus
   * @param {string} actorId
   * @param {string} [comment]
   * @returns {Promise<object>}
   */
  async transitionTicket(ticketId, newStatus, actorId, comment) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const ticket = await this._getOrThrow(ticketId);
    await this._assertOrgScope(actor, ticket.storeId);
    this._assertNotTerminal(ticket);

    const allowed = TRANSITIONS.get(ticket.status) ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${ticket.status} → ${newStatus}. Allowed: ${allowed.join(', ')}`);
    }

    const now = Date.now();
    const patch = { status: newStatus, updatedAt: now };
    if (newStatus === TICKET_STATUSES.RESOLVED) patch.resolvedAt = now;
    if (newStatus === TICKET_STATUSES.CLOSED) patch.closedBy = actorId;

    const updated = { ...ticket, ...patch };
    await this._ticketRepo.update(ticketId, updated);
    await this._appendEvent({ ticketId, type: newStatus, actorId, comment });
    await auditService.log({ actorId, action: 'transition_ticket', entityType: 'ticket', entityId: ticketId, metadata: { from: ticket.status, to: newStatus } });

    // Notify assignee of status change via EventDispatcher.
    if (ticket.assignedTo && ticket.assignedTo !== actorId) {
      await eventDispatcherService.dispatch({
        organizationId: ticket.organizationId,
        eventType: EVENT_TYPES.TICKET_STATUS_CHANGED,
        sourceId: ticketId,
        actorId,
        vars: { ticketId, subject: ticket.subject, newStatus },
        recipientUserIds: [ticket.assignedTo],
        title: `Ticket ${newStatus.replace('_', ' ')}`,
        body: `Ticket "${ticket.subject}" is now ${newStatus.replace('_', ' ')}.`,
      });
    }

    return updated;
  }

  /**
   * Evaluates all open/in-progress tickets against their SLA due times.
   * Marks overdue tickets and appends an overdue event.
   *
   * @returns {Promise<object[]>}  Tickets newly marked overdue.
   */
  async evaluateOverdue() {
    const nowMs = Date.now();
    const due = await this._ticketRepo.findDueForOverdueCheck(nowMs);

    const results = [];
    for (const ticket of due) {
      const updated = { ...ticket, isOverdue: true, updatedAt: nowMs };
      await this._ticketRepo.update(ticket.id, updated);
      await this._appendEvent({ ticketId: ticket.id, type: TICKET_EVENT_TYPES.OVERDUE, actorId: 'system' });

      // Dispatch SLA deadline notification to assignee (non-fatal).
      if (ticket.assignedTo) {
        await eventDispatcherService.dispatch({
          organizationId: ticket.organizationId,
          eventType: EVENT_TYPES.DEADLINE_APPROACHING,
          sourceId: ticket.id,
          actorId: 'system',
          vars: { ticketId: ticket.id, subject: ticket.subject, status: 'overdue' },
          recipientUserIds: [ticket.assignedTo],
          title: 'Ticket SLA overdue',
          body: `Ticket "${ticket.subject}" has exceeded its SLA deadline.`,
        });
      }

      results.push(updated);
    }
    return results;
  }

  /**
   * Returns all overdue tickets.
   * Requires: any authenticated user.
   *
   * @returns {Promise<object[]>}
   */
  async getOverdue() {
    const actor = this._requireRole(ROLES.STORE_MANAGER, ROLES.REVIEWER);
    const all = await this._ticketRepo.findOverdue();
    // Non-admin users only see overdue tickets within their org scope.
    if (actor.role === ROLES.ADMINISTRATOR) return all;
    const scoped = [];
    for (const t of all) {
      const inScope = await orgService.isInScope(actor, t.storeId);
      if (inScope) scoped.push(t);
    }
    return scoped;
  }

  /**
   * Returns ticket with its full event history.
   * Requires: any authenticated user within the ticket's organization.
   *
   * @param {string} ticketId
   * @returns {Promise<{ ticket: object; events: object[] }>}
   */
  async getTicketDetail(ticketId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER, ROLES.REVIEWER);
    const ticket = await this._getOrThrow(ticketId);
    await this._assertOrgScope(actor, ticket.storeId);
    const events = await this._eventRepo.findByTicket(ticketId);
    return { ticket, events: events.sort((a, b) => a.createdAt - b.createdAt) };
  }

  /**
   * Returns all tickets for a customer.
   * Requires: any authenticated user.
   *
   * @param {string} customerId
   * @returns {Promise<object[]>}
   */
  async getByCustomer(customerId, _organizationId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER, ROLES.REVIEWER);
    // Derive org scope from actual ticket data — ignore caller-provided orgId.
    const tickets = await this._ticketRepo.findByCustomer(customerId);
    if (actor.role === ROLES.ADMINISTRATOR) return tickets;
    const scoped = [];
    for (const t of tickets) {
      const inScope = await orgService.isInScope(actor, t.storeId);
      if (inScope) scoped.push(t);
    }
    return scoped;
  }

  /**
   * Returns all tickets for a store.
   * Requires: any authenticated user within the store's organization.
   *
   * @param {string} storeId
   * @returns {Promise<object[]>}
   */
  async getByStore(storeId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER, ROLES.REVIEWER);
    await this._assertOrgScope(actor, storeId);
    return this._ticketRepo.findByStore(storeId);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  async _getOrThrow(id) {
    const t = await this._ticketRepo.findById(id);
    if (!t) throw new Error(`Ticket '${id}' not found.`);
    return t;
  }

  _assertNotTerminal(ticket) {
    if (TERMINAL_STATES.has(ticket.status)) {
      throw new Error(`Ticket '${ticket.id}' is in terminal state '${ticket.status}' and cannot be modified.`);
    }
  }

  async _appendEvent({ ticketId, type, actorId, comment = '' }) {
    const event = {
      id: generateId(),
      ticketId,
      type,
      comment,
      actorId,
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

export const ticketService = new TicketService();
