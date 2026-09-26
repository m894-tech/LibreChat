import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createDesignRuntime } from '../runtime';
let db: mongoose.Connection;
let rs: MongoMemoryReplSet;
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(rs.getUri('runtime')).asPromise();
});
afterAll(async () => {
  await db.close();
  await rs.stop();
});
it('disabled runtime does not touch credentials or initialize provider', async () => {
  const resolve = jest.fn();
  const runtime = await createDesignRuntime(db, { enabled: false }, resolve);
  const app = express();
  app.use(runtime.router);
  const r = await request(app).get('/projects');
  expect(r.status).toBe(404);
  expect(resolve).not.toHaveBeenCalled();
  await runtime.stop();
});
it('manual runtime exposes no generation by default', async () => {
  const resolve = jest.fn();
  const runtime = await createDesignRuntime(db, { enabled: true }, resolve);
  const app = express();
  app.use((req, res, next) => {
    (req as any).user = { id: 'owner' };
    next();
  });
  app.use(runtime.router);
  const r = await request(app).get('/capabilities');
  expect(r.status).toBe(200);
  expect(r.body.imageGeneration).toBe(false);
  expect(r.body.textProposal).toBe(false);
  expect(resolve).not.toHaveBeenCalled();
  await runtime.stop();
});
