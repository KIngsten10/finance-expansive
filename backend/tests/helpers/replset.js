import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';

/**
 * Starts an in-memory single-node MongoDB REPLICA SET and connects via the
 * app's own connectDatabase() so that supportsTransactions() reports true and
 * real multi-document transactions are exercised (not standalone writes).
 */
export async function startReplSet() {
  const replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDatabase(replset.getUri());
  return replset;
}

export async function stopReplSet(replset) {
  await disconnectDatabase();
  await replset?.stop();
}

/** Remove all documents from every collection between tests. */
export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
