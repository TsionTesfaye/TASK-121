import { OrgRepository } from '../repositories/implementations/OrgRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { ROLES, ORG_NODE_TYPES, VALID_PARENT_CHILD } from '../utils/constants.js';

/**
 * OrgService — organization hierarchy management.
 *
 * RBAC:
 *   - createNode, updateNode, deleteNode → ADMINISTRATOR only
 *   - reads → any authenticated user
 */
export class OrgService {
  constructor() {
    this._repo = new OrgRepository();
  }

  /**
   * Creates a new organization hierarchy node.
   * Validates single-parent constraint and valid parent-child type pairing.
   * Requires: ADMINISTRATOR role.
   *
   * @param {{ parentId: string | null; type: string; name: string; organizationId: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async createNode({ parentId, type, name, organizationId, actorId }) {
    this._requireRole(ROLES.ADMINISTRATOR);

    if (!name?.trim()) throw new Error('Node name is required.');
    if (!Object.values(ORG_NODE_TYPES).includes(type)) {
      throw new Error(`Invalid node type: '${type}'. Valid: ${Object.values(ORG_NODE_TYPES).join(', ')}`);
    }

    if (parentId) {
      const parent = await this._repo.findById(parentId);
      if (!parent) throw new Error('Parent node not found.');
      if (!this.validateParentChildType(parent.type, type)) {
        throw new Error(`Invalid parent-child combination: ${parent.type} → ${type}`);
      }
      // Cross-link prevention: parent must belong to the same organization.
      if (parent.organizationId !== organizationId) {
        throw new Error('Cannot create a child node under a parent from a different organization.');
      }
    } else if (type !== ORG_NODE_TYPES.COMPANY) {
      throw new Error('Only company nodes may have no parent.');
    }

    const node = {
      id: generateId(),
      parentId: parentId ?? null,
      type,
      name,
      organizationId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._repo.create(node);
    await auditService.log({ actorId, action: 'create_org_node', entityType: 'org', entityId: node.id, metadata: { type, name } });
    return node;
  }

  /**
   * Updates a node's name, type, and/or parent.
   * Validates hierarchy constraints: no cycles, valid parent-child type pairings,
   * same organization, and existing children compatibility when changing type.
   * Requires: ADMINISTRATOR role.
   *
   * @param {string} nodeId
   * @param {{ name?: string; type?: string; parentId?: string | null }} data
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async updateNode(nodeId, { name, type, parentId }, actorId) {
    this._requireRole(ROLES.ADMINISTRATOR);

    const node = await this._repo.findById(nodeId);
    if (!node) throw new Error('Node not found.');

    const updates = { ...node, updatedAt: Date.now() };

    if (name !== undefined) {
      if (!name?.trim()) throw new Error('Node name is required.');
      updates.name = name;
    }

    const newType = type !== undefined ? type : node.type;
    const newParentId = parentId !== undefined ? parentId : node.parentId;

    // Type validation
    if (type !== undefined && type !== node.type) {
      if (!Object.values(ORG_NODE_TYPES).includes(type)) {
        throw new Error(`Invalid node type: '${type}'. Valid: ${Object.values(ORG_NODE_TYPES).join(', ')}`);
      }
    }

    // Parent change validation
    if (parentId !== undefined && parentId !== node.parentId) {
      if (parentId) {
        const newParent = await this._repo.findById(parentId);
        if (!newParent) throw new Error('New parent node not found.');
        if (newParent.organizationId !== node.organizationId) {
          throw new Error('Cannot move node to a different organization.');
        }
        // Cycle check: new parent must NOT be in the subtree of this node
        const subtree = await this._getSubtreeInternal(nodeId);
        if (subtree.some((n) => n.id === parentId)) {
          throw new Error('Cannot set parent: would create a cycle in the hierarchy.');
        }
      }
    }

    // Validate parent-child type pairing with effective values
    if (newParentId) {
      const effectiveParent = await this._repo.findById(newParentId);
      if (effectiveParent && !this.validateParentChildType(effectiveParent.type, newType)) {
        throw new Error(`Invalid parent-child combination: ${effectiveParent.type} → ${newType}`);
      }
    } else if (newType !== ORG_NODE_TYPES.COMPANY) {
      throw new Error('Only company nodes may have no parent.');
    }

    // If type changed, ensure existing children are still valid
    if (type !== undefined && type !== node.type) {
      const children = await this._repo.findByParent(nodeId);
      for (const child of children) {
        if (!this.validateParentChildType(newType, child.type)) {
          throw new Error(`Changing type to '${newType}' would invalidate child '${child.name}' of type '${child.type}'.`);
        }
      }
    }

    updates.type = newType;
    updates.parentId = newParentId ?? null;

    await this._repo.update(nodeId, updates);
    await auditService.log({ actorId, action: 'update_org_node', entityType: 'org', entityId: nodeId, metadata: { name: updates.name, type: newType } });
    return updates;
  }

  /**
   * Deletes a leaf node. Rejects deletion if the node has children.
   * Requires: ADMINISTRATOR role.
   *
   * @param {string} nodeId
   * @param {string} actorId
   * @returns {Promise<void>}
   */
  async deleteNode(nodeId, actorId) {
    this._requireRole(ROLES.ADMINISTRATOR);

    const children = await this._repo.findByParent(nodeId);
    if (children.length > 0) throw new Error('Cannot delete a node with children. Delete child nodes first.');

    await this._repo.delete(nodeId);
    await auditService.log({ actorId, action: 'delete_org_node', entityType: 'org', entityId: nodeId });
  }

  /**
   * Returns the full tree for an organization as a flat array.
   * Requires: any authenticated user.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getTree(organizationId) {
    const actor = this._requireAuth();
    // Admin 'all' query: return every node in the system.
    if (organizationId === 'all' && actor.role === ROLES.ADMINISTRATOR) {
      return this._repo.findAll();
    }
    await this._assertOrgScope(actor, organizationId);
    return this._repo.findByOrganization(organizationId);
  }

  /**
   * Returns all nodes in the subtree rooted at nodeId (inclusive).
   * Requires: any authenticated user.
   *
   * @param {string} nodeId
   * @returns {Promise<object[]>}
   */
  async getSubtree(nodeId) {
    const actor = this._requireAuth();
    // Scope check: non-admin must have nodeId within their accessible subtree.
    // Cannot call _assertOrgScope here (it uses getSubtree internally).
    // Instead, do a direct scope check.
    if (actor.role !== ROLES.ADMINISTRATOR) {
      if (!actor.organizationNodeId) throw new Error('Actor has no organization assigned.');
      const actorSubtree = await this._getSubtreeInternal(actor.organizationNodeId);
      if (!actorSubtree.some((n) => n.id === nodeId)) {
        throw new Error('Scope violation: you can only access data within your assigned organization.');
      }
    }
    return this._getSubtreeInternal(nodeId);
  }

  /**
   * Returns all node IDs the given user is allowed to access
   * (all nodes in the subtree rooted at user.organizationNodeId).
   * Requires: any authenticated user.
   *
   * @param {{ organizationNodeId: string }} user
   * @returns {Promise<string[]>}
   */
  async getScopedNodeIds(user) {
    this._requireAuth();
    if (!user.organizationNodeId) return [];
    // Use internal method to avoid scope-check recursion
    // (isInScope → getScopedNodeIds → getSubtree → _assertOrgScope → isInScope).
    const subtree = await this._getSubtreeInternal(user.organizationNodeId);
    return subtree.map((n) => n.id);
  }

  /**
   * Returns true if targetOrgId is within the actor's accessible subtree.
   * Administrators can access everything.
   * Falls back to direct equality when the org hierarchy is not yet seeded
   * (subtree returns empty).
   * @param {object} actor
   * @param {string} targetOrgId
   * @returns {Promise<boolean>}
   */
  async isInScope(actor, targetOrgId) {
    if (actor.role === ROLES.ADMINISTRATOR) return true;
    if (!actor.organizationNodeId) return false;

    // Check descendants (user can access their own subtree).
    const scopedIds = await this.getScopedNodeIds(actor);

    // Also check ancestors: a store user can access data owned by their root company.
    // Walk up from the user's node to the root, collecting ancestor IDs.
    const ancestorIds = [];
    let current = await this._repo.findById(actor.organizationNodeId);
    while (current) {
      ancestorIds.push(current.id);
      if (current.organizationId && current.organizationId !== current.id) {
        ancestorIds.push(current.organizationId);
      }
      if (!current.parentId || current.parentId === current.id) break;
      current = await this._repo.findById(current.parentId);
    }

    const allAccessible = new Set([...scopedIds, ...ancestorIds]);

    if (allAccessible.size === 0) return actor.organizationNodeId === targetOrgId;
    return allAccessible.has(targetOrgId);
  }

  /**
   * Validates that childType is a valid child of parentType.
   * @param {string} parentType
   * @param {string} childType
   * @returns {boolean}
   */
  validateParentChildType(parentType, childType) {
    return VALID_PARENT_CHILD.get(parentType) === childType;
  }

  /**
   * Internal BFS subtree traversal — no auth/scope checks.
   * Used by getSubtree (after its own scope check) and by isInScope/getScopedNodeIds.
   * @param {string} rootId
   * @returns {Promise<object[]>}
   */
  async _getSubtreeInternal(rootId) {
    const result = [];
    const root = await this._repo.findById(rootId);
    if (!root) return result;
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);
      const children = await this._repo.findByParent(current.id);
      queue.push(...children);
    }
    return result;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  _requireRole(...allowedRoles) {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
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
    const inScope = await this.isInScope(actor, targetOrgId);
    if (!inScope) throw new Error('Scope violation: you can only access data within your assigned organization.');
  }
}

export const orgService = new OrgService();
