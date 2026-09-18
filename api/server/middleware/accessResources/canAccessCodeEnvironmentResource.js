const { ResourceType } = require('librechat-data-provider');
const { canAccessResource } = require('./canAccessResource');

/**
 * Code-environment middleware factory. Route params carry Mongo ObjectIds, so
 * no id resolver is required (unlike agents).
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
  });
};

module.exports = {
  canAccessCodeEnvironmentResource,
};
