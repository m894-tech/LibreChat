const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  generateCheckAccess,
  preAuthTenantMiddleware,
  createRequireApiKeyAuth,
  createRemoteAgentAuth,
  createAgentManagementAuth,
  createCheckAgentTriggerAccess,
  createCheckRemoteAgentAccess,
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
 */
const checkResponseAgentPermission = async (req, res, next) => {
  const userId = req.user?.id;
  const responseId = req.params?.id;

  if (!userId) {
    return res.status(401).json({
      error: {
        message: 'Authentication required',
        type: 'invalid_request_error',
        code: 'unauthorized',
      },
    });
  }

  if (!responseId) {
    return res.status(400).json({
      error: {
        message: 'Response ID is required',
        type: 'invalid_request_error',
        code: 'missing_response_id',
      },
    });
  }

  try {
    const conversation = await db.getConvo(userId, responseId);
    if (!conversation) {
      return res.status(404).json({
        error: {
          message: `Response not found: ${responseId}`,
          type: 'invalid_request_error',
          code: 'response_not_found',
        },
      });
    }

    const agentId = conversation.agent_id || conversation.agentId || conversation.model;
    if (!agentId) {
      return next();
    }

    req.params.model = agentId;
    return checkAgentPermission(req, res, next);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  checkAgentPermission,
  checkAgentTriggerPermission,
  checkResponseAgentPermission,
  preAuthTenantMiddleware,
  requireRemoteAgentAuth,
  requireAgentManagementAuth,
  checkRemoteAgentsFeature,
};
