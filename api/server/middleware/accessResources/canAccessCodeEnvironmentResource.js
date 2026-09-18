const { ResourceType } = require('librechat-data-provider');
const { canAccessResource } = require('./canAccessResource');
const { findCodeEnvironmentByEnvironmentId } = require('~/models');

/**
 * Code-environment middleware factory. Routes carry the public `environmentId` string while
 * ACL entries are keyed by the document `_id`, so the id is resolved the same way the registry
 * handlers resolve it before their own permission check.
 *
 * @param {Object} options
 * @param {number} options.requiredPermission - Permission bit (1=view, 2=edit, 4=delete, 8=share)
 * @param {string} [options.resourceIdParam='environmentId']
 * @returns {Function} Express middleware
 */
const canAccessCodeEnvironmentResource = (options) => {
  const { requiredPermission, resourceIdParam = 'environmentId' } = options;

  if (!requiredPermission || typeof requiredPermission !== 'number') {
    throw new Error(
      'canAccessCodeEnvironmentResource: requiredPermission is required and must be a number',
    );
  }

  return canAccessResource({
    resourceType: ResourceType.CODE_ENVIRONMENT,
    requiredPermission,
    resourceIdParam,
    idResolver: findCodeEnvironmentByEnvironmentId,
  });
};

module.exports = {
  canAccessCodeEnvironmentResource,
};
