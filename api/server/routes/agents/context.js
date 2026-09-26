const express = require('express');
const {
  generateCheckAccess,
  skipAgentCheck,
  requireContextEstimateEnabled,
  createContextEstimateLimiter,
} = require('@librechat/api');
const { PermissionTypes, Permissions, PermissionBits } = require('librechat-data-provider');
const {
  configMiddleware,
  validateConvoAccess,
  buildEndpointOption,
  canAccessAgentFromBody,
} = require('~/server/middleware');
const { initializeClient } = require('~/server/services/Endpoints/agents');
const ContextEstimateController = require('~/server/controllers/agents/estimate');
const { getRoleByName } = require('~/models');

const router = express.Router();

const checkAgentAccess = generateCheckAccess({
  permissionType: PermissionTypes.AGENTS,
  permissions: [Permissions.USE],
  skipCheck: skipAgentCheck,
  getRoleByName,
});
const checkAgentResourceAccess = canAccessAgentFromBody({
  requiredPermission: PermissionBits.VIEW,
});

/**
 * @route POST /estimate
 * @desc Dry-run estimate of the next request's context (context counter v2 §6).
 *       Shares the chat route's agent/conversation guards and `buildEndpointOption`
 *       so the agent, model spec and files resolve exactly as for a real turn.
 *       Never calls the model, tools, compression or a paid tokenizer.
 * @access Private
 */
router.post(
  '/estimate',
  configMiddleware,
  requireContextEstimateEnabled,
  createContextEstimateLimiter(),
  checkAgentAccess,
  checkAgentResourceAccess,
  validateConvoAccess,
  buildEndpointOption,
  async (req, res, next) => {
    await ContextEstimateController(req, res, next, initializeClient);
  },
);

module.exports = router;
