'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    const id = req.get('x-user');
    if (!id) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = { id, role: 'USER' };
    return next();
  },
}));

jest.mock('~/server/services/AutomationsCron/mcpHost.cjs', () => ({
  isMcpHostUser: (id) => id === 'host',
  filterMcpServersForUser: (_id, servers) => [...servers],
  isWriteExecTool: () => false,
}));

jest.mock('~/server/services/AutomationsCron/catalogs.cjs', () => ({
  buildCatalogs: async () => ({
    mcp: { servers: [] },
    skills: [],
    scripts: [],
    native_profiles: [],
    secret_bindings: { supported: false, destinations: [] },
  }),
}));

jest.mock('~/server/controllers/mcp', () => ({
  getMCPTools: async (_req, res) => res.status(200).json({ servers: {} }),
}));

jest.mock('~/server/services/Endpoints/agents/skillDeps', () => ({
  getSkillDbMethods: () => ({ listSkillsByAccess: async () => ({ skills: [] }) }),
  withDeploymentSkillIds: (ids) => ids,
}));

jest.mock('~/server/services/PermissionService', () => ({
  findAccessibleResources: async () => [],
  findPubliclyAccessibleResources: async () => [],
}));

jest.mock('librechat-data-provider', () => ({
  ResourceType: { SKILL: 'skill' },
  PermissionBits: { VIEW: 1 },
}));

let dir;
let app;

const body = {
  name: 'Reminder',
  schedule: 'every 2d',
  timezone: 'Europe/Moscow',
  target_type: 'session_reminder',
  conv: '11111111-1111-4111-8111-111111111111',
  payload: { text: 'hello' },
};

async function writeCore() {
  const corePath = path.join(dir, 'cron-core.cjs');
  await fsp.writeFile(
    corePath,
    `const fs = require('node:fs');\nconst path = require('node:path');\nconst jobsFile = process.env.MCP_CRON_JOBS_FILE;\nconst sessionRoot = process.env.MCP_SESSION_ROOT;\nconst readJobs = () => { try { return JSON.parse(fs.readFileSync(jobsFile, 'utf8')); } catch { return []; } };\nconst writeJobs = (jobs) => fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2));\nconst toJob = (owner, input) => ({ id: 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2), name: input.name, targetType: input.target_type, userId: owner, conv: input.conv || '', payload: input.payload || {}, schedule: input.schedule, scheduleInfo: input.schedule, isRecurring: String(input.schedule || '').startsWith('every '), status: 'active', history: [], runCount: 0, tz: input.timezone || 'Europe/Moscow' });\nasync function createOwnedCronJob(owner, input, options = {}) { if ((input.target_type === 'script' || input.target_type === 'webhook') && !options.allowHostActions) throw new Error('forbidden_target'); const jobs = readJobs(); const job = toJob(owner, input); jobs.push(job); writeJobs(jobs); return job; }\nasync function mutateOwnedCronJob(owner, id, action) { const jobs = readJobs(); const job = jobs.find((item) => item.id === id && item.userId === owner); if (!job) return null; if (action === 'pause') job.status = 'paused'; if (action === 'resume') job.status = 'active'; if (action === 'cancel') job.status = 'cancelled'; writeJobs(jobs); return job; }\nasync function runOwnedCronJobNow(owner, id, key) { const jobs = readJobs(); const job = jobs.find((item) => item.id === id && item.userId === owner); if (!job) return null; job.history ||= []; const existing = job.history.find((item) => item.key === key); if (existing) return { duplicate: true, result: existing }; const result = { key, runId: 'run-1', runAt: new Date().toISOString(), trigger: 'manual', status: 'success', output: 'ok' }; job.history.push(result); job.runCount = (job.runCount || 0) + 1; writeJobs(jobs); const file = path.join(sessionRoot, 'users', owner, job.conv + '.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ text: job.payload.text || null })); return { duplicate: false, result }; }\nmodule.exports = { createOwnedCronJob, mutateOwnedCronJob, runOwnedCronJobNow };\n`,
  );
  process.env.MCP_CRON_CORE_PATH = corePath;
}

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'auto-route-'));
  process.env.MCP_CRON_DIR = dir;
  process.env.MCP_CRON_JOBS_FILE = path.join(dir, 'jobs.json');
  process.env.MCP_SESSION_ROOT = path.join(dir, 'session');
  await writeCore();
  const route = require('../../routes/automationsCron');
  app = express();
  app.use('/api/automations/cron', route);
});

afterAll(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const api = (method, url, user = 'alice') =>
  request(app)[method]('/api/automations/cron' + url).set('x-user', user);

test('requires authentication', async () => {
  assert.equal((await request(app).get('/api/automations/cron')).status, 401);
});

test('owner creates, lists and foreign user cannot read', async () => {
  const created = await api('post', '/').send(body);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.owned_by_user, true);
  const list = await api('get', '/');
  assert.equal(list.body.count, 1);
  assert.equal((await api('get', '/' + created.body.id, 'bob')).status, 404);
});

test('pause and resume enforce owner', async () => {
  const id = (await api('get', '/')).body.items[0].id;
  assert.equal((await api('post', `/${id}/actions/pause`, 'bob')).status, 404);
  assert.equal((await api('post', `/${id}/actions/pause`).send({})).body.status, 'paused');
  assert.equal((await api('post', `/${id}/actions/resume`).send({})).body.status, 'active');
});

test('manual run uses idempotency and writes owner-scoped session', async () => {
  const id = (await api('get', '/')).body.items[0].id;
  const key = 'same-key';
  const first = await api('post', `/${id}/runs`).set('Idempotency-Key', key).send({});
  assert.equal(first.status, 202, first.text);
  assert.equal(first.body.result.status, 'success');
  const second = await api('post', `/${id}/runs`).set('Idempotency-Key', key).send({});
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  const file = path.join(dir, 'session', 'users', 'alice', '11111111-1111-4111-8111-111111111111.json');
  assert.equal(fs.existsSync(file), true);
});

test('resume_conversation accepts every 2d interval', async () => {
  const response = await api('post', '/').send({
    ...body,
    name: 'Resume chat',
    target_type: 'resume_conversation',
    payload: { text: 'continue the thread' },
  });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.body.is_recurring, true);
});

test('host actions are forbidden to normal user', async () => {
  const response = await api('post', '/').send({
    ...body,
    target_type: 'script',
    conv: '',
    payload: { script: 'x.sh' },
  });
  assert.equal(response.status, 403);
});
