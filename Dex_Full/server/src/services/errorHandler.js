/**
 * Dex v2 - Error Handler Middleware
 * Centralized error handling with structured logging and graceful recovery.
 * @version 2.0.0
 */

const logger = require('../utils/logger');

class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
          super(message);
          this.statusCode = statusCode;
          this.isOperational = isOperational;
          this.timestamp = new Date().toISOString();
          Error.captureStackTrace(this, this.constructor);
    }
}

const errorCodes = {
    VALIDATION_ERROR: { status: 400, message: 'Invalid request data' },
    AUTH_REQUIRED: { status: 401, message: 'Authentication required' },
    FORBIDDEN: { status: 403, message: 'Access denied' },
    NOT_FOUND: { status: 404, message: 'Resource not found' },
    RATE_LIMITED: { status: 429, message: 'Too many requests' },
    INTERNAL: { status: 500, message: 'Internal server error' },
    SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' }
};

function errorHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    const isOperational = err.isOperational !== undefined ? err.isOperational : false;

  logger.error({
        message: err.message,
        statusCode,
        stack: err.stack,
        path: req.originalUrl,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        isOperational
  });

  if (!isOperational) {
        process.emit('unhandledError', err);
  }

  const response = {
        success: false,
        error: {
                message: isOperational ? err.message : 'An unexpected error occurred',
                code: statusCode
        }
  };

  if (process.env.NODE_ENV === 'development') {
        response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

function asyncWrapper(fn) {
    return (req, res, next) => {
          Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = { AppError, errorCodes, errorHandler, asyncWrapper };