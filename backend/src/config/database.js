import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Tracks whether the connected MongoDB deployment supports multi-document
 * transactions (i.e. it is a replica set or mongos). Services can read this
 * flag to decide whether to open a session/transaction or fall back to
 * best-effort sequential writes.
 */
let transactionsSupported = false;

export const supportsTransactions = () => transactionsSupported;

async function detectTransactionSupport() {
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    // `setName` is present on replica set members; `msg === 'isdbgrid'` for mongos.
    transactionsSupported = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch {
    transactionsSupported = false;
  }

  if (transactionsSupported) {
    logger.info('MongoDB supports multi-document transactions.');
  } else {
    logger.warn(
      'MongoDB is standalone — multi-document transactions are unavailable. ' +
      'Falling back to best-effort sequential writes. Use a replica set in production.'
    );
  }
}

export async function connectDatabase(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected.');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  logger.info(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  await detectTransactionSupport();

  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed.');
}

/**
 * Run `work(session)` inside a MongoDB multi-document transaction.
 *
 * This REQUIRES a replica set / mongos. If transactions are unavailable we do
 * NOT silently fall back to unsafe sequential writes — callers that need
 * atomicity (all financial writes) must surface a clear configuration error.
 * Use `supportsTransactions()` to decide before calling.
 *
 * Transient transaction / write-conflict errors are retried a bounded number
 * of times, as recommended by the MongoDB driver.
 *
 * @param {(session: import('mongoose').ClientSession) => Promise<any>} work
 * @param {{ maxRetries?: number }} [opts]
 */
export async function withTransaction(work, { maxRetries = 3 } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (err) {
      const transient =
        err?.errorLabels?.includes('TransientTransactionError') ||
        err?.errorLabels?.includes('UnknownTransactionCommitResult');
      if (transient && attempt < maxRetries) {
        attempt += 1;
        continue;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
}

export default connectDatabase;
