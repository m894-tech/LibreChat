import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
export interface DesignMongoHarness {
  connection: mongoose.Connection;
  replSet: MongoMemoryReplSet;
}
export async function startDesignMongo(): Promise<DesignMongoHarness> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return {
    replSet,
    connection: await mongoose.createConnection(replSet.getUri('review')).asPromise(),
  };
}
export async function stopDesignMongo(h?: DesignMongoHarness): Promise<void> {
  if (h) {
    await h.connection.close();
    await h.replSet.stop();
  }
}
export async function resetDesignMongo(c: mongoose.Connection): Promise<void> {
  await c.dropDatabase();
}
