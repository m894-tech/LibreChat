import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createGenerationBudget } from '../generation-budget';
let db: mongoose.Connection;
let rs: MongoMemoryReplSet;
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  db = await mongoose.createConnection(rs.getUri('budget')).asPromise();
});
afterAll(async () => {
  await db.close();
  await rs.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
});
it('reserves one bounded amount for concurrent duplicate job identity', async () => {
  const b = await createGenerationBudget({ connection: db, monthlyAllowance: 10, requestUnits: 6 });
  const r = await Promise.allSettled([b.reserve('j1', 'p1'), b.reserve('j1', 'p1')]);
  expect(r.filter((x) => x.status === 'fulfilled').length).toBeGreaterThan(0);
  await b.reserve('j1', 'p1');
  const rows = await db.collection('design_generation_allowances').find({}).toArray();
  expect(rows[0].reserved).toBe(6);
  expect(await db.collection('design_generation_reservations').countDocuments()).toBe(1);
});
it('prevents two distinct requests overspending remaining allowance', async () => {
  const b = await createGenerationBudget({ connection: db, monthlyAllowance: 10, requestUnits: 6 });
  const r = await Promise.allSettled([b.reserve('a', 'u'), b.reserve('b', 'u')]);
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
});
it('uncertainty holds funds, consumed settlement idempotent, release explicit', async () => {
  const b = await createGenerationBudget({ connection: db, monthlyAllowance: 10, requestUnits: 6 });
  await b.reserve('a', 'u');
  await b.settle('a', 'uncertain');
  await expect(b.reserve('b', 'u')).rejects.toMatchObject({ status: 429 });
  await b.settle('a', 'consumed');
  await b.settle('a', 'consumed');
  expect(
    (await db.collection('design_generation_allowances').findOne({ principalId: 'u' }))!.spent,
  ).toBe(6);
});
it('default-zero allowance refuses paid work', async () => {
  const b = await createGenerationBudget({ connection: db, monthlyAllowance: 0, requestUnits: 1 });
  await expect(b.reserve('a', 'u')).rejects.toMatchObject({ status: 429 });
});

it('allows only one provider dispatch across duplicate wrappers and refuses consumed replay', async () => {
  const b = await createGenerationBudget({ connection: db, monthlyAllowance: 10, requestUnits: 1 });
  await b.reserve('a', 'u');
  const claims = await Promise.allSettled([b.claimDispatch('a', 'u'), b.claimDispatch('a', 'u')]);
  expect(claims.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  await b.settle('a', 'consumed');
  await b.reserve('a', 'u');
  await expect(b.claimDispatch('a', 'u')).rejects.toMatchObject({ status: 409 });
});

it('invalid settlement state cannot decrement allowance', async () => {
  const b = await createGenerationBudget({ connection: db, monthlyAllowance: 10, requestUnits: 1 });
  await b.reserve('a', 'u');
  await expect(b.settle('a', 'reserved' as any)).rejects.toMatchObject({ status: 422 });
  expect(
    (await db.collection('design_generation_allowances').findOne({ principalId: 'u' }))!.reserved,
  ).toBe(1);
});
it('admission preflight reads allowance without reserving and defaults fail-closed', async () => {
  const b = await createGenerationBudget({ connection: db, monthlyAllowance: 1, requestUnits: 1 });
  await b.preflight('u');
  expect(await db.collection('design_generation_reservations').countDocuments()).toBe(0);
  await b.reserve('a', 'u');
  await expect(b.preflight('u')).rejects.toMatchObject({ status: 429 });
});
