import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import apiRouter from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { csrfProtection } from './middleware/csrf.js';

/**
 * Builds and configures the Express application WITHOUT starting a listener.
 * Exported so integration tests can import it directly (via supertest).
 */
export function createApp() {
  const app = express();

  // Security headers.
  app.use(helmet());

  // CORS — only the configured origins may call the API with credentials.
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    })
  );

  // Body parsing with a sane size limit.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Parse cookies so cookie-based auth + CSRF can read them.
  app.use(cookieParser());

  // Request logging (skip noise in tests).
  if (env.nodeEnv !== 'test') {
    app.use(morgan(env.isProd ? 'combined' : 'dev'));
  }

  // Basic rate limiting on the API surface.
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // CSRF protection for state-changing requests on cookie sessions (no-op for
  // safe methods and for bearer-token / unauthenticated requests).
  app.use('/api', csrfProtection);

  // Routes.
  app.use('/api', apiRouter);

  // 404 + error handling (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
