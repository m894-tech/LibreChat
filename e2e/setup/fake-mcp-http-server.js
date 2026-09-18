#!/usr/bin/env node

/**
 * Streamable-HTTP MCP fixture for Session MCP selection and the allowlist-override
 * e2e spec.
 *
 * Unlike the stdio `fake-mcp-server.js`, this one is reachable over a URL so it
 * exercises the `mcpSettings.allowedDomains` check (stdio transports skip it). The
 * e2e YAML allowlists this origin so steering / tool-context specs can select it;
 * `mcp-allowlist-override.spec.ts` still proves admin overrides by installing a
 * restrictive override that drops the origin, then restoring it.
 *
 * Mirrors the stateful streamable-HTTP pattern in
 * packages/api/src/mcp/__tests__/helpers/oauthTestServer.ts (without OAuth).
 */

const http = require('http');
const { randomUUID } = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const PORT = parseInt(process.env.E2E_MCP_HTTP_PORT || '8765', 10);
const HOST = '127.0.0.1';

function createMcpServer() {
  const server = new McpServer({ name: 'e2e-http', version: '1.0.0' });
  server.registerTool(
    'http_ping',
    {
      description: 'Returns a deterministic value for LibreChat allowlist-override e2e tests.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: 'E2E HTTP MCP pong' }],
    }),
  );
  return server;
}

/** @type {Map<string, InstanceType<typeof StreamableHTTPServerTransport>>} */
const sessions = new Map();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health endpoint so Playwright's `webServer` can detect readiness.
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (url.pathname !== '/mcp') {
    res.writeHead(404);
    res.end();
    return;
  }

  const sid = req.headers['mcp-session-id'];
  let transport = typeof sid === 'string' ? sessions.get(sid) : undefined;
  if (!transport) {
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    const mcp = createMcpServer();
    await mcp.connect(transport);
  }

  await transport.handleRequest(req, res);

  if (transport.sessionId && !sessions.has(transport.sessionId)) {
    sessions.set(transport.sessionId, transport);
    transport.onclose = () => sessions.delete(transport.sessionId);
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[e2e] fake HTTP MCP server listening on http://${HOST}:${PORT}/mcp`);
});
