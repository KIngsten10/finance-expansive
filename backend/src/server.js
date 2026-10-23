import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function start() {
  try {
    await connectDatabase();

    const app = createApp();
    const server = app.listen(env.port, () => {
      logger.info(`Server running in ${env.nodeEnv} mode on http://localhost:${env.port}`);
      logger.info(`Health check: http://localhost:${env.port}/api/health`);
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await disconnectDatabase();
        process.exit(0);
      });
      // Force exit if cleanup hangs.
      setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
