import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** 404 handler for unmatched routes. */
export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Central error handler. Normalizes known error types (Mongoose validation,
 * cast errors, duplicate keys, JWT errors, ApiError) into the standard
 * `{ success: false, message, details? }` envelope.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid value for field "${err.path}"`;
  } else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = field ? `Duplicate value for "${field}"` : 'Duplicate key error';
    details = err.keyValue;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  if (statusCode >= 500) {
    logger.error(err.stack || err.message);
  }

  // In production, never leak internal 5xx error details to the client.
  const publicMessage =
    statusCode >= 500 && env.isProd ? 'Internal server error' : message;

  const body = { success: false, message: publicMessage };
  if (details) body.details = details;
  if (!env.isProd && statusCode >= 500) body.stack = err.stack;

  res.status(statusCode).json(body);
}

export default errorHandler;
