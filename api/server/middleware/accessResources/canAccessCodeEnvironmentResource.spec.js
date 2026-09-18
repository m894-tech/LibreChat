const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  ResourceType,
  PrincipalType,
  PrincipalModel,
  PermissionBits,
} = require('librechat-data-provider');
const { canAccessCodeEnvironmentResource } = require('./canAccessCodeEnvironmentResource');
const { User, Role, AclEntry, CodeEnvironment } = require('~/db/models');

describe('canAccessCodeEnvironmentResource middleware', () => {
  let mongoServer;
  let req;
  let res;
  let next;
  let viewer;
  let owner;
  let environment;

  const grant = (principalId, permBits) =>
    AclEntry.create({
      principalType: PrincipalType.USER,
      principalId,
      principalModel: PrincipalModel.USER,
      resourceType: ResourceType.CODE_ENVIRONMENT,
      resourceId: environment._id,
      permBits,
      grantedBy: owner._id,
    });

  const run = (requiredPermission) =>
    canAccessCodeEnvironmentResource({ requiredPermission })(req, res, next);

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await Role.create({ name: 'plain-role', permissions: {} });
    [viewer, owner] = await User.create([
      { email: 'viewer@example.com', name: 'Viewer', username: 'viewer', role: 'plain-role' },
      { email: 'owner@example.com', name: 'Owner', username: 'owner', role: 'plain-role' },
    ]);
    environment = await CodeEnvironment.create({
      environmentId: 'code-env-public-id',
      name: 'Shared runner',
      type: 'attached',
      baseURL: 'https://runner.example.com',
      controlPlaneId: 'cp-1',
      createdBy: owner._id,
    });

    req = {
      user: { id: viewer._id.toString(), role: viewer.role },
      params: { environmentId: environment.environmentId },
    };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  it('throws when requiredPermission is missing', () => {
    expect(() => canAccessCodeEnvironmentResource({})).toThrow(
      'canAccessCodeEnvironmentResource: requiredPermission is required and must be a number',
    );
  });

  it('returns 404 when the environmentId does not exist', async () => {
    req.params.environmentId = 'missing-env';

    await run(PermissionBits.VIEW);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Not Found',
      message: 'codeEnvironment not found',
    });
  });

  it('returns 403 when the user holds no ACL entry on the environment', async () => {
    await grant(owner._id, PermissionBits.VIEW | PermissionBits.EDIT | PermissionBits.DELETE);

    await run(PermissionBits.VIEW);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      message: 'Insufficient permissions to access this codeEnvironment',
    });
  });

  it('passes VIEW through the resolved document _id and records it on the request', async () => {
    await grant(viewer._id, PermissionBits.VIEW);

    await run(PermissionBits.VIEW);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.resourceAccess).toEqual(
      expect.objectContaining({
        resourceType: ResourceType.CODE_ENVIRONMENT,
        resourceId: environment._id,
        customResourceId: environment.environmentId,
        permission: PermissionBits.VIEW,
      }),
    );
  });

  it('denies EDIT and DELETE to a VIEW-only grant', async () => {
    await grant(viewer._id, PermissionBits.VIEW);

    await run(PermissionBits.EDIT);
    await run(PermissionBits.DELETE);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenNthCalledWith(1, 403);
    expect(res.status).toHaveBeenNthCalledWith(2, 403);
  });

  it('passes EDIT and DELETE when the grant carries those bits', async () => {
    await grant(viewer._id, PermissionBits.VIEW | PermissionBits.EDIT | PermissionBits.DELETE);

    await run(PermissionBits.EDIT);
    await run(PermissionBits.DELETE);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });
});
