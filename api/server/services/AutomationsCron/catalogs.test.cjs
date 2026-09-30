'use strict';

const assert = require('node:assert/strict');

jest.mock('~/server/services/AutomationsCron/mcpHost.cjs', () => ({
  isMcpHostUser: (id) => id === 'host',
  filterMcpServersForUser: (_id, servers) => [...servers],
  isWriteExecTool: (name) => /write|shell/.test(name),
}));

const { buildCatalogs } = require('./catalogs.cjs');

test('catalog excludes blocked servers and write tools', async () => {
  const out = await buildCatalogs({
    owner: 'host',
    mcpTools: {
      servers: {
        shell: { name: 'shell', tools: [{ name: 'read' }] },
        search: {
          name: 'Search',
          authenticated: true,
          tools: [{ name: 'search_web', description: 'r' }, { name: 'write_item' }],
        },
      },
    },
    skills: [
      { _id: '1', name: 'daily', displayTitle: 'Daily', version: 2, userInvocable: true },
      { _id: '2', name: 'hidden', userInvocable: false },
    ],
    scripts: ['ok.sh'],
    nativeProfiles: ['safe'],
  });

  assert.deepEqual(out.mcp.servers.map((x) => x.name), ['search']);
  assert.equal(out.mcp.servers[0].tools[1].available_for_automation, false);
  assert.deepEqual(out.skills.map((x) => x.name), ['daily']);
  assert.deepEqual(out.scripts, ['ok.sh']);
  assert.equal(out.secret_bindings.supported, true);
});

test('non-host has no scripts or secret binding', async () => {
  const out = await buildCatalogs({
    owner: 'guest',
    mcpTools: { servers: {} },
    skills: [],
    scripts: ['x'],
    nativeProfiles: [],
  });

  assert.deepEqual(out.scripts, []);
  assert.equal(out.secret_bindings.supported, false);
});
