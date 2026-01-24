/**
 * Sentry Error Tracking Integration
 *
 * Provides error capture with structured context for Sentry.
 * This is a stub implementation that logs to console.
 *
 * To enable full Sentry integration:
 * 1. Install: pnpm add @sentry/nextjs
 * 2. Set NEXT_PUBLIC_SENTRY_DSN in .env.local
 * 3. Run: npx @sentry/wizard@latest -i nextjs
 * 4. Replace this file with the generated instrumentation
 *
 * This stub allows error tracking calls to exist in the codebase
 * without requiring Sentry to be installed during development.
 */

interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: {
    id?: string;
    wallet?: string;
  };
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
}

/**
 * Capture an exception to error tracking
 *
 * Currently logs to console. When Sentry is enabled, this will
 * send errors to the Sentry dashboard.
 *
 * @example
 * ```ts
 * import { captureException } from '@/lib/sentry';
 *
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   captureException(error, {
 *     tags: { component: 'OrderForm' },
 *     extra: { orderId: '123' }
 *   });
 * }
 * ```
 */
export function captureException(
  error: Error | unknown,
  context?: CaptureContext
): void {
  // In development, always log errors with context
  if (process.env.NODE_ENV === 'development') {
    console.error('[captureException]', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...context,
    });
    return;
  }

  // In production without Sentry DSN, log minimal info
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    console.error('[Error]', error instanceof Error ? error.message : String(error));
    return;
  }

  // When NEXT_PUBLIC_SENTRY_DSN is set, Sentry should be initialized
  // via sentry.client.config.ts and sentry.server.config.ts
  // This function will be replaced by the full Sentry implementation
  // after running: npx @sentry/wizard@latest -i nextjs
  console.warn('[Sentry] DSN is set but Sentry SDK is not installed. Run: pnpm add @sentry/nextjs');
}

/**
 * Capture a message (for non-exception events)
 */
export function captureMessage(
  message: string,
  context?: CaptureContext
): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('[captureMessage]', { message, ...context });
    return;
  }

  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  console.warn('[Sentry] DSN is set but Sentry SDK is not installed. Run: pnpm add @sentry/nextjs');
}

/**
 * Set user context for all subsequent error captures
 */
export function setUser(
  user: { id?: string; wallet?: string } | null
): void {
  if (process.env.NODE_ENV === 'development' && user) {
    console.log('[setUser]', user);
  }
  // No-op until Sentry is installed
}

/**
 * Add breadcrumb for debugging context
 */
export function addBreadcrumb(
  breadcrumb: {
    category?: string;
    message: string;
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
    data?: Record<string, unknown>;
  }
): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('[breadcrumb]', breadcrumb);
  }
  // No-op until Sentry is installed
}
