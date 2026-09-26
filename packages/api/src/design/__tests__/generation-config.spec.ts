import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createDesignRouter } from '../http';
let db: mongoose.Connection;
let rs: MongoMemoryReplSet;
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(rs.getUri('caps')).asPromise();
});
afterAll(async () => {
  await db.close();
  await rs.stop();
});
it('does not contradict configured generation with unavailable reason', async () => {
  const app = express();
  app.use((req, res, next) => {
    (req as any).user = { id: 'owner' };
    next();
  });
  app.use(
    createDesignRouter({
      connection: db,
      enabled: true,
      generationReady: true,
      generationProvider: {
        capabilities: { textProposal: true, imageGeneration: false },
        submit: async () => {
          throw Error('Must not call');
        },
      },
      checkGenerationBudget: async () => {},
    }),
  );
  const r = await request(app).get('/capabilities');
  expect(r.body.textPrompt).toBe(true);
  expect(r.body.imageGenerate).toBe(false);
  expect(r.body.reason).not.toContain('not configured');
});
