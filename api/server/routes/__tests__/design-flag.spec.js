/**
 * Design workspace flag and R2+ stub coverage.
 * Flag OFF: router returns 404 for capabilities and does not construct a runtime
 * (no index/migration side effects). Flag ON: capabilities 200 with expected shape.
 * R2+ routes always return 501 {error:'not_implemented', feature}.
 */
const express = require('express');
const http = require('http');

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    });
}

function loadFreshDesignRouter() {
  jest.resetModules();
  return require('../design');
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        async close() {
          await new Promise((r) => server.close(r));
          if (typeof app.close === 'function') {
            await app.close();
          }
        },
      });
    });
  });
}

async function request(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, body, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('design workspace flag and R2+ stubs', () => {
  it('returns 404 for GET /capabilities when M894_DESIGN_WORKSPACE is off', async () => {
    await withEnv('M894_DESIGN_WORKSPACE', undefined, async () => {
      const designRouter = loadFreshDesignRouter();
      const app = express();
      app.use('/api/design', designRouter);
      const { port, close } = await listen(app);
      try {
        const res = await request(port, 'GET', '/api/design/capabilities');
        expect(res.status).toBe(404);
        expect(res.json).toEqual({ code: 'not_found' });
      } finally {
        await close();
      }
    });
  });

  it('does not create a design runtime when the flag is off', async () => {
    await withEnv('M894_DESIGN_WORKSPACE', '0', async () => {
      jest.resetModules();
      const api = require('@librechat/api');
      const spy = jest.spyOn(api, 'createDesignRuntime');
      const designRouter = require('../design');
      const app = express();
      app.use('/api/design', designRouter);
      const { port, close } = await listen(app);
      try {
        await request(port, 'GET', '/api/design/capabilities');
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
        await close();
      }
    });
  });

  it('returns 200 capabilities shape when M894_DESIGN_WORKSPACE=1', async () => {
    await withEnv('M894_DESIGN_WORKSPACE', '1', async () => {
      jest.resetModules();
      const { createDesignRouter } = require('@librechat/api');
      const router = createDesignRouter({
        connection: {},
        enabled: true,
        service: {
          store: { connection: {} },
          listProjects: async () => [],
          listSystems: () => [],
        },
      });
      const app = express();
      app.use((req, _res, next) => {
        req.user = { id: 'user-flag-on-000000000001' };
        next();
      });
      app.use('/api/design', router);
      const { port, close } = await listen(app);
      try {
        const res = await request(port, 'GET', '/api/design/capabilities');
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({
          presentationSend: false,
          inpaint: false,
          imageUpload: true,
          proposals: true,
          restore: true,
          exports: expect.arrayContaining(['source', 'png-client', 'source-package']),
        });
      } finally {
        await close();
      }
    });
  });

  it('returns 404 for R2+ stubs when the flag is off (not 501)', async () => {
    await withEnv('M894_DESIGN_WORKSPACE', undefined, async () => {
      const designRouter = loadFreshDesignRouter();
      const app = express();
      app.use('/api/design', designRouter);
      const { port, close } = await listen(app);
      try {
        const res = await request(port, 'POST', '/api/design/documents/doc1/inpaint');
        expect(res.status).toBe(404);
        expect(res.json).toEqual({ code: 'not_found' });
      } finally {
        await close();
      }
    });
  });

  it.each([
    ['POST', '/api/design/documents/doc1/inpaint', 'inpaint'],
    ['POST', '/api/design/documents/doc1/outpaint', 'outpaint'],
    ['GET', '/api/design/documents/doc1/image-edit-jobs', 'inpaint'],
    ['POST', '/api/design/documents/doc1/raster-office-export', 'pptx_export'],
    ['GET', '/api/design/documents/doc1/approval', 'approvals'],
    ['POST', '/api/design/documents/doc1/research', 'refero'],
    ['POST', '/api/design/documents/doc1/send-presentation', 'presenton'],
  ])('returns 501 for R2+ %s %s', async (method, path, feature) => {
    await withEnv('M894_DESIGN_WORKSPACE', '1', async () => {
      const designRouter = loadFreshDesignRouter();
      const app = express();
      app.use('/api/design', designRouter);
      const { port, close } = await listen(app);
      try {
        const res = await request(port, method, path);
        expect(res.status).toBe(501);
        expect(res.json).toEqual({ error: 'not_implemented', feature });
      } finally {
        await close();
      }
    });
  });
});
