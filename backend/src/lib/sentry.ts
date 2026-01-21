/**
 * Sentry Error Tracking Integration
 *
 * Provides centralized error tracking and monitoring for:
 * - Uncaught exceptions
 * - Unhandled promise rejections
 * - Express request errors
 * - Manual error captures
 *
 * Configuration:
 * - SENTRY_DSN: Sentry DSN (required for production)
 * - SENTRY_ENVIRONMENT: Environment name (default: NODE_ENV)
 * - SENTRY_RELEASE: Release version (default: package version)
 * - SENTRY_TRACES_SAMPLE_RATE: Sampling rate for traces (default: 0.1)
 */

import * as Sentry from '@sentry/node';
import type { Express, Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

const log = logger.metrics;

// Check if Sentry is configured
const SENTRY_DSN = process.env.SENTRY_DSN;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Initialize Sentry error tracking
 */
export function initSentry(): boolean {
  if (!SENTRY_DSN) {
    if (IS_PRODUCTION) {
      log.warn('SENTRY_DSN not configured - error tracking disabled in production');
    } else {
      log.info('Sentry disabled in development (no DSN configured)');
    }
    return false;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || process.env.npm_package_version || '0.1.0',

      // Performance monitoring
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

      // Additional options
      maxBreadcrumbs: 50,
      attachStacktrace: true,

      // Filter out sensitive data
      beforeSend(event) {
        // Redact sensitive headers
        if (event.request?.headers) {
          const headers = event.request.headers as Record<string, string>;
          if (headers.authorization) {
            headers.authorization = '[REDACTED]';
          }
          if (headers['x-api-key']) {
            headers['x-api-key'] = '[REDACTED]';
          }
        }

        // Redact sensitive data in extras
        if (event.extra) {
          const sensitiveKeys = ['privateKey', 'secretKey', 'password', 'secret'];
          for (const key of sensitiveKeys) {
            if (key in event.extra) {
              event.extra[key] = '[REDACTED]';
            }
          }
        }

        return event;
      },

      // Ignore common non-errors
      ignoreErrors: [
        // Network errors
        'Network request failed',
        'Failed to fetch',
        // User cancellations
        'User rejected the request',
        'User denied transaction signature',
        // Rate limiting
        'Too many requests',
      ],

      // Integrations
      integrations: [
        // Enable HTTP tracing
        Sentry.httpIntegration(),
      ],
    });

    log.info({ environment: process.env.NODE_ENV }, 'Sentry initialized');
    return true;
  } catch (error) {
    log.error({ error }, 'Failed to initialize Sentry');
    return false;
  }
}

/**
 * Express error handler middleware for Sentry
 */
export function sentryErrorHandler(): ReturnType<typeof Sentry.expressErrorHandler> {
  return Sentry.expressErrorHandler();
}

/**
 * Express request handler middleware for Sentry (adds request context)
 */
export function sentryRequestHandler() {
  return Sentry.expressIntegration().setupOnce as unknown as (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void;
}

/**
 * Setup Sentry for an Express app
 */
export function setupSentryForExpress(app: Express): void {
  if (!SENTRY_DSN) return;

  // The request handler must be the first middleware
  Sentry.setupExpressErrorHandler(app);

  log.info('Sentry Express middleware configured');
}

/**
 * Capture an exception manually
 */
export function captureException(
  error: Error | unknown,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    user?: { id: string; email?: string; username?: string };
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  }
): string | undefined {
  if (!SENTRY_DSN) {
    log.error({ error }, 'Error captured (Sentry disabled)');
    return undefined;
  }

  return Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }

    if (context?.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, value);
      }
    }

    if (context?.user) {
      scope.setUser(context.user);
    }

    if (context?.level) {
      scope.setLevel(context.level);
    }

    return Sentry.captureException(error);
  });
}

/**
 * Capture a message manually
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): string | undefined {
  if (!SENTRY_DSN) {
    log.info({ message, level }, 'Message captured (Sentry disabled)');
    return undefined;
  }

  return Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }

    if (context?.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, value);
      }
    }

    return Sentry.captureMessage(message, level);
  });
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'
): void {
  if (!SENTRY_DSN) return;

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Set user context
 */
export function setUser(user: { id: string; email?: string; username?: string } | null): void {
  if (!SENTRY_DSN) return;
  Sentry.setUser(user);
}

/**
 * Set tag for current scope
 */
export function setTag(key: string, value: string): void {
  if (!SENTRY_DSN) return;
  Sentry.setTag(key, value);
}

/**
 * Create a transaction for performance monitoring
 */
export function startTransaction(
  name: string,
  op: string
): Sentry.Span | undefined {
  if (!SENTRY_DSN) return undefined;

  return Sentry.startInactiveSpan({
    name,
    op,
    forceTransaction: true,
  });
}

/**
 * Flush pending events before shutdown
 */
export async function flushSentry(timeout = 2000): Promise<boolean> {
  if (!SENTRY_DSN) return true;

  try {
    return await Sentry.flush(timeout);
  } catch (error) {
    log.error({ error }, 'Failed to flush Sentry events');
    return false;
  }
}

/**
 * Close Sentry client
 */
export async function closeSentry(): Promise<void> {
  if (!SENTRY_DSN) return;

  try {
    await Sentry.close(2000);
    log.info('Sentry closed');
  } catch (error) {
    log.error({ error }, 'Failed to close Sentry');
  }
}

// Export Sentry for advanced usage
export { Sentry };
