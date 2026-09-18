import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { PermissionBits } from 'librechat-data-provider';
import type { ResponseAgentAccessDependencies } from './middleware';
import {
  createCheckAgentTriggerAccess,
  createCheckRemoteAgentAccess,
  createCheckResponseAgentAccess,
} from './middleware';

describe('createCheckRemoteAgentAccess', () => {
  it('preserves model-based authorization for existing remote agent routes', async () => {
    const getAgent = jest.fn(async () => ({ _id: new Types.ObjectId() }));
    const checkAccess = createCheckRemoteAgentAccess({
      getAgent,
      getEffectivePermissions: jest.fn(async () => PermissionBits.VIEW),
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { user: { id: new Types.ObjectId().toString(), role: 'USER' } });
      next();
    });
    app.post('/chat', checkAccess, (_req, res) => {
      res.status(204).send();
    });

    const response = await request(app).post('/chat').send({ model: 'agent-1' });

    expect(response.status).toBe(204);
    expect(getAgent).toHaveBeenCalledWith({ id: 'agent-1' });
  });
});

describe('createCheckAgentTriggerAccess', () => {
  it('authorizes the actual event target instead of a top-level model field', async () => {
    const getAgent = jest.fn(async () => ({ _id: new Types.ObjectId() }));
    const getEffectivePermissions = jest.fn(async () => PermissionBits.VIEW);
    const checkAccess = createCheckAgentTriggerAccess({ getAgent, getEffectivePermissions });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { user: { id: new Types.ObjectId().toString(), role: 'USER' } });
      next();
    });
    app.post('/events', checkAccess, (_req, res) => {
      res.status(204).send();
    });

    const response = await request(app)
      .post('/events')
      .send({
        model: 'decoy-agent',
        target: { agentId: 'target-agent' },
      });

    expect(response.status).toBe(204);
    expect(getAgent).toHaveBeenCalledWith({ id: 'target-agent' });
    expect(getAgent).not.toHaveBeenCalledWith({ id: 'decoy-agent' });
  });

  it('does not fall back to model when the event target is absent', async () => {
    const getAgent = jest.fn(async () => ({ _id: new Types.ObjectId() }));
    const checkAccess = createCheckAgentTriggerAccess({
      getAgent,
      getEffectivePermissions: jest.fn(async () => PermissionBits.VIEW),
    });
    const app = express();
    app.use(express.json());
    app.post('/events', checkAccess, (_req, res) => {
      res.status(204).send();
    });

    const response = await request(app).post('/events').send({ model: 'decoy-agent' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('missing_model');
    expect(getAgent).not.toHaveBeenCalled();
  });
});

describe('createCheckResponseAgentAccess', () => {
  const userId = new Types.ObjectId().toString();
  const agentRecord = { _id: new Types.ObjectId() };

  const buildApp = (overrides: Partial<ResponseAgentAccessDependencies>) => {
    const deps: ResponseAgentAccessDependencies = {
      getConvo: jest.fn(async () => ({ agent_id: 'agent-1' })),
      getAgent: jest.fn(async () => agentRecord),
      getEffectivePermissions: jest.fn(async () => PermissionBits.VIEW),
      ...overrides,
    };
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { user: { id: userId, role: 'USER' } });
      next();
    });
    app.get('/responses/:id', createCheckResponseAgentAccess(deps), (req, res) => {
      const { agentPermissions } = req as { agentPermissions?: number };
      res.status(200).json({ agentPermissions });
    });
    return { app, deps };
  };

  it('returns 404 when the conversation does not belong to the caller', async () => {
    const { app, deps } = buildApp({ getConvo: jest.fn(async () => null) });

    const response = await request(app).get('/responses/resp-1');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('response_not_found');
    expect(deps.getConvo).toHaveBeenCalledWith(userId, 'resp-1');
    expect(deps.getAgent).not.toHaveBeenCalled();
  });

  it('returns 403 when the conversation agent no longer grants remote VIEW', async () => {
    const { app, deps } = buildApp({ getEffectivePermissions: jest.fn(async () => 0) });

    const response = await request(app).get('/responses/resp-1');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('access_denied');
    expect(deps.getAgent).toHaveBeenCalledWith({ id: 'agent-1' });
  });

  it('passes through with the agent permissions attached when VIEW is granted', async () => {
    const { app, deps } = buildApp({});

    const response = await request(app).get('/responses/resp-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ agentPermissions: PermissionBits.VIEW });
    expect(deps.getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ userId, resourceId: agentRecord._id }),
    );
  });

  it('passes through a conversation that has no agent to gate', async () => {
    const { app, deps } = buildApp({ getConvo: jest.fn(async () => ({})) });

    const response = await request(app).get('/responses/resp-1');

    expect(response.status).toBe(200);
    expect(deps.getAgent).not.toHaveBeenCalled();
  });

  it('returns 404 when the conversation agent has been deleted', async () => {
    const { app } = buildApp({ getAgent: jest.fn(async () => null) });

    const response = await request(app).get('/responses/resp-1');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('model_not_found');
  });
});
