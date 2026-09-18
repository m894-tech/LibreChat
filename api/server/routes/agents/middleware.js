const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  generateCheckAccess,
  preAuthTenantMiddleware,
  createRequireApiKeyAuth,
  createRemoteAgentAuth,
  createAgentManagementAuth,
  createCheckAgentTriggerAccess,
  createCheckRemoteAgentAccess,
  createCheckResponseAgentAccess,
} = require('@librechat/api');
const { getEffectivePermissions } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

const apiKeyMiddleware = createRequireApiKeyAuth({
  validateAgentApiKey: db.validateAgentApiKey,
  findUser: db.findUser,
  isPrincipalActive: db.isAgentTriggerPrincipalActive,
});

const requireRemoteAgentAuth = createRemoteAgentAuth({
  apiKeyMiddleware,
  findUser: db.findUser,
  getRolesByNames: db.findRolesByNames,
  updateUser: db.updateUser,
  isPrincipalActive: db.isAgentTriggerPrincipalActive,
  getAppConfig,
});

const requireAgentManagementAuth = createAgentManagementAuth({
  findUser: db.findUser,
  isPrincipalActive: db.isAgentTriggerPrincipalActive,
  getAppConfig,
});

const checkRemoteAgentsFeature = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName: db.getRoleByName,
});

const agentAccessDependencies = {
  getAgent: db.getAgent,
  getEffectivePermissions,
};

const checkAgentPermission = createCheckRemoteAgentAccess(agentAccessDependencies);
const checkAgentTriggerPermission = createCheckAgentTriggerAccess(agentAccessDependencies);

/**
 * GET /responses/:id is conversation-owner scoped. Also require REMOTE_AGENT VIEW
 * on the conversation's agent so share revocation cannot be bypassed via response id.
 * Conversations without an agent pass through (nothing to gate).
 */
const checkResponseAgentPermission = createCheckResponseAgentAccess({
  ...agentAccessDependencies,
  getConvo: db.getConvo,
});

module.exports = {
  checkAgentPermission,
  checkAgentTriggerPermission,
  checkResponseAgentPermission,
  preAuthTenantMiddleware,
  requireRemoteAgentAuth,
  requireAgentManagementAuth,
  checkRemoteAgentsFeature,
};
