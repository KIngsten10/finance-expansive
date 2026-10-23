import { Router } from 'express';
import mongoose from 'mongoose';
import { sendSuccess } from '../utils/apiResponse.js';
import { supportsTransactions } from '../config/database.js';

const router = Router();

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/**
 * GET /api/health
 * Liveness/readiness probe. Reports server uptime and database status.
 */
router.get('/', (req, res) => {
  sendSuccess(res, {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      state: DB_STATES[mongoose.connection.readyState] ?? 'unknown',
      transactionsSupported: supportsTransactions(),
    },
  });
});

export default router;
