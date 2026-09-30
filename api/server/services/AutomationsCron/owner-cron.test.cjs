'use strict';

const { normalizeOwner, isOwnerOf, toView, capabilities } = require('./owner-cron.cjs');

const mine = {
  id: 'c1',
  name: 'mine',
  targetType: 'session_todo',
  userId: 'user-alice',
  conv: '11111111-1111-4111-8111-111111111111',
  payload: { text: 'hello' },
  status: 'active',
  history: [],
};
const other = { ...mine, id: 'c2', userId: 'user-bob' };
const legacy = { ...mine, id: 'c3', userId: null };

test('owner normalization is strict', () => {
  expect(normalizeOwner('{{MCP_USER_ID}}')).toBe('');
  expect(normalizeOwner('bad owner')).toBe('');
  expect(normalizeOwner('user-alice')).toBe('user-alice');
});

test('all target types are scoped by stored owner', () => {
  expect(isOwnerOf(mine, 'user-alice')).toBe(true);
  expect(isOwnerOf(other, 'user-alice')).toBe(false);
  expect(isOwnerOf(legacy, 'user-alice')).toBe(false);
});

test('view exposes safe payload and never binding values', () => {
  const view = toView({
    ...mine,
    secretBindings: [
      { id: 'b', vault: 'v', item: 'i', field: 'f', destination: 'env', key: 'X', value: 'do-not-leak' },
    ],
  });
  expect(view.payload.text).toBe('hello');
  expect(view.secret_bindings[0].value).toBeUndefined();
  expect(JSON.stringify(view).includes('do-not-leak')).toBe(false);
});

test('capabilities match route actions', () => {
  const user = capabilities('user-alice');
  expect(user.sources.cron.commands).toEqual({
    list: true,
    status: true,
    create: true,
    pause: true,
    resume: true,
    cancel: true,
    run_now: true,
  });
  expect(user.sources.cron.action_types.session_todo).toBe(true);
  expect(user.sources.cron.action_types.script).toBe(false);
  const host = capabilities('user-alice', { isHost: true });
  expect(host.sources.cron.action_types.script).toBe(true);
  expect(host.sources.cron.action_types.webhook).toBe(true);
});
