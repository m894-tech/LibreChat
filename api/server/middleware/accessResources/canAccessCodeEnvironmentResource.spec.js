const { ResourceType, PermissionBits } = require('librechat-data-provider');

jest.mock('./canAccessResource', () => ({
  canAccessResource: jest.fn((options) => options),
}));

const { canAccessResource } = require('./canAccessResource');
const { canAccessCodeEnvironmentResource } = require('./canAccessCodeEnvironmentResource');

describe('canAccessCodeEnvironmentResource', () => {
  beforeEach(() => {
    canAccessResource.mockClear();
  });

  it('requires a numeric requiredPermission', () => {
    expect(() => canAccessCodeEnvironmentResource({})).toThrow(
      'canAccessCodeEnvironmentResource: requiredPermission is required and must be a number',
    );
  });

  it('delegates to canAccessResource with CODE_ENVIRONMENT and environmentId', () => {
    const middleware = canAccessCodeEnvironmentResource({
      requiredPermission: PermissionBits.VIEW,
    });

    expect(canAccessResource).toHaveBeenCalledWith({
      resourceType: ResourceType.CODE_ENVIRONMENT,
      requiredPermission: PermissionBits.VIEW,
      resourceIdParam: 'environmentId',
    });
    expect(middleware).toEqual({
      resourceType: ResourceType.CODE_ENVIRONMENT,
      requiredPermission: PermissionBits.VIEW,
      resourceIdParam: 'environmentId',
    });
  });
});
