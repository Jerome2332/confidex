/**
 * Structured Logger for Confidex Backend
 *
 * Production-ready logging with:
 * - Structured JSON format for log aggregation
 * - Log levels (trace, debug, info, warn, error, fatal)
 * - Request ID correlation
 * - Performance timing
 * - Sensitive data redaction
 */

import pino from 'pino';

// Determine environment
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Fields to redact from logs
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'password',
  'privateKey',
  'secret',
  'secretKey',
  'encryptedData',
  '*.password',
  '*.privateKey',
  '*.secret',
];

// Create the base logger
const baseLogger = pino({
  level: logLevel,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: 'confidex-backend',
      version: process.env.npm_package_version || '0.1.0',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // In development, use pino-pretty for readable output
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  }),
});

// Use pino's built-in Logger type
type Logger = pino.Logger;

/**
 * Create a namespaced logger
 */
export function createLogger(namespace: string): Logger {
  return baseLogger.child({ namespace });
}

/**
 * Pre-configured loggers for common namespaces
 */
export const logger = {
  // Core services
  crank: createLogger('crank'),
  mpc: createLogger('mpc'),
  settlement: createLogger('settlement'),
  matching: createLogger('matching'),

  // Infrastructure
  db: createLogger('db'),
  rpc: createLogger('rpc'),
  http: createLogger('http'),

  // Security
  auth: createLogger('auth'),
  rate_limit: createLogger('rate-limit'),

  // Monitoring
  metrics: createLogger('metrics'),
  health: createLogger('health'),

  // ZK proofs
  prover: createLogger('prover'),
  blacklist: createLogger('blacklist'),

  // V6 Async MPC services
  position: createLogger('position'),
  margin: createLogger('margin'),
  liquidation: createLogger('liquidation'),
};

/**
 * Request logger middleware for Express
 */
export function requestLogger() {
  const httpLogger = logger.http;

  return (req: any, res: any, next: any) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();

    // Attach request ID to request object
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    // Create request-scoped logger
    req.log = httpLogger.child({
      requestId,
      method: req.method,
      path: req.path,
      ip: req.ip || req.connection.remoteAddress,
    });

    // Log request start
    req.log.info({ query: req.query }, 'Request started');

    // Log response on finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      req.log[level](
        {
          statusCode: res.statusCode,
          duration,
          contentLength: res.get('Content-Length'),
        },
        'Request completed'
      );
    });

    next();
  };
}

/**
 * Performance timing utility
 */
export function createTimer(label: string, log: Logger = baseLogger) {
  const startTime = process.hrtime.bigint();

  return {
    /** End timer and log duration */
    end: (extraData?: Record<string, unknown>) => {
      const endTime = process.hrtime.bigint();
      const durationNs = Number(endTime - startTime);
      const durationMs = durationNs / 1_000_000;

      log.debug({ label, durationMs, ...extraData }, `Timer: ${label}`);
      return durationMs;
    },
  };
}

/**
 * Error serializer for consistent error logging
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: isDevelopment ? error.stack : undefined,
      ...(error as any).code && { code: (error as any).code },
      ...(error as any).statusCode && { statusCode: (error as any).statusCode },
    };
  }
  return { message: String(error) };
}

// Export base logger for direct use
export { baseLogger };
export type { Logger };
export default logger;
