const express = require('express');
const request = require('supertest');

const calls = [];
const record = (name) => (_req, _res, next) => {
  calls.push(name);
  next();
};
const respond = (name) => (_req, res) => {
  calls.push(name);
  res.status(200).json({ handler: name });
};

jest.mock('./middleware', () => ({
  checkAgentPermission: record('checkAgentPermission'),
  checkAgentTriggerPermission: record('checkAgentTriggerPermission'),
  checkResponseAgentPermission: record('checkResponseAgentPermission'),
  preAuthTenantMiddleware: record('preAuthTenantMiddleware'),
  requireRemoteAgentAuth: record('requireRemoteAgentAuth'),
  checkRemoteAgentsFeature: record('checkRemoteAgentsFeature'),
}));
jest.mock('~/server/middleware', () => ({
  configMiddleware: (_req, _res, next) => next(),
  agentEventUserLimiter: (_req, _res, next) => next(),
}));
jest.mock('@librechat/api', () => ({
  reportLocatorTraversalFailure: jest.fn(),
  createMessageFilterPii: () => (_req, _res, next) => next(),
  createAgentTriggerIngressHandlers: () => ({
    enqueueEvent: respond('enqueueEvent'),
    getEvent: respond('getEvent'),
  }),
  createAgentEventBindingHandlers: () => ({
    register: respond('register'),
    resolve: (_req, _res, next) => next(),
  }),
}));
jest.mock('~/server/services/Agents/triggers', () => ({
  enqueueAgentTrigger: jest.fn(),
  getAgentTriggerDeliveryStatus: jest.fn(),
}));
jest.mock('~/models', () => ({}));
jest.mock('~/server/controllers/agents/openai', () => ({
  OpenAIChatCompletionController: respond('OpenAIChatCompletionController'),
  ListModelsController: respond('ListModelsController'),
  GetModelController: respond('GetModelController'),
}));
jest.mock('~/server/controllers/agents/responses', () => ({
  createResponse: respond('createResponse'),
  getResponse: respond('getResponse'),
  listModels: respond('listModels'),
}));

const openaiRouter = require('./openai');
const responsesRouter = require('./responses');

const routerStack = [
  'preAuthTenantMiddleware',
  'requireRemoteAgentAuth',
  'checkRemoteAgentsFeature',
];

const mount = (path, router) => express().use(path, router);

describe('remote agent route access wiring', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('gates GET /v1/models/:model behind checkAgentPermission', async () => {
    await request(mount('/v1', openaiRouter)).get('/v1/models/agent_abc').expect(200, {
      handler: 'GetModelController',
    });

    expect(calls).toEqual([...routerStack, 'checkAgentPermission', 'GetModelController']);
  });

  it('leaves the GET /v1/models list ungated, since the controller filters by ACL', async () => {
    await request(mount('/v1', openaiRouter)).get('/v1/models').expect(200, {
      handler: 'ListModelsController',
    });

    expect(calls).toEqual([...routerStack, 'ListModelsController']);
  });

  it('gates GET /v1/responses/:id behind checkResponseAgentPermission', async () => {
    await request(mount('/v1/responses', responsesRouter))
      .get('/v1/responses/resp_123')
      .expect(200, { handler: 'getResponse' });

    expect(calls).toEqual([...routerStack, 'checkResponseAgentPermission', 'getResponse']);
  });

  it('keeps GET /v1/responses/models on the list handler, ahead of the :id route', async () => {
    await request(mount('/v1/responses', responsesRouter))
      .get('/v1/responses/models')
      .expect(200, { handler: 'listModels' });

    expect(calls).toEqual([...routerStack, 'listModels']);
  });
});
