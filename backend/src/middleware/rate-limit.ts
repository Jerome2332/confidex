/**
 * Rate Limiting Middleware
 *
 * In-memory rate limiter with sliding window approach.
 * For production with multiple instances, consider Redis-based solution.
 */

import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests per window */
  maxRequests: number;
  /** Custom key generator (default: IP address) */
  keyGenerator?: (req: Request) => string;
  /** Custom handler when rate limit exceeded */
  handler?: (req: Request, res: Response, options: RateLimitOptions) => void;
  /** Don't count failed requests (4xx/5xx) toward limit */
  skipFailedRequests?: boolean;
  /** Don't count successful requests toward limit */
  skipSuccessfulRequests?: boolean;
  /** Message to show when rate limited */
  message?: string;
}

/**
 * Create a rate limiter middleware
 */
export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.ip || req.socket.remoteAddress || 'unknown',
    handler = defaultHandler,
    skipFailedRequests = false,
    skipSuccessfulRequests = false,
    message = 'Too many requests, please try again later.',
  } = options;

  const store = new Map<string, RateLimitEntry>();

  // Cleanup expired entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 60000); // Cleanup every minute

  // Prevent the interval from keeping the process alive
  cleanupInterval.unref?.();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry = store.get(key);

    // Reset if window expired
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };
      store.set(key, entry);
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count - 1));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    // Check if rate limited
    if (entry.count >= maxRequests) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      handler(req, res, { ...options, message });
      return;
    }

    // Increment counter before request
    entry.count++;

    // Handle skip options by decrementing after response
    if (skipFailedRequests || skipSuccessfulRequests) {
      const originalEnd = res.end.bind(res);
      res.end = function (this: Response, ...args: Parameters<typeof originalEnd>) {
        if (
          (skipFailedRequests && res.statusCode >= 400) ||
          (skipSuccessfulRequests && res.statusCode < 400)
        ) {
          entry!.count = Math.max(0, entry!.count - 1);
        }
        return originalEnd(...args);
      } as typeof originalEnd;
    }

    next();
  };
}

/**
 * Default rate limit exceeded handler
 */
function defaultHandler(req: Request, res: Response, options: RateLimitOptions): void {
  res.status(429).json({
    error: 'Too Many Requests',
    message: options.message,
    retryAfter: Math.ceil(options.windowMs / 1000),
  });
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const rateLimiters = {
  /**
   * Standard API rate limit: 100 requests per minute
   */
  standard: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
  }),

  /**
   * Strict rate limit: 10 requests per minute
   * For admin endpoints and expensive operations
   */
  strict: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
  }),

  /**
   * Auth rate limit: 5 attempts per 15 minutes
   * Only counts failed attempts
   */
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    skipSuccessfulRequests: true,
    message: 'Too many authentication attempts. Please try again later.',
  }),

  /**
   * Proof generation rate limit: 5 per minute
   * ZK proof generation is computationally expensive
   */
  prove: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    message: 'Proof generation is computationally expensive. Please wait before trying again.',
  }),

  /**
   * Webhook rate limit: 200 per minute
   * Higher limit for automated systems
   */
  webhook: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 200,
  }),

  /**
   * Health check: very permissive - 1000 per minute
   */
  health: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 1000,
  }),
};

/**
 * Create a custom rate limiter with specific settings
 */
export function createCustomRateLimiter(
  requestsPerMinute: number,
  options?: Partial<RateLimitOptions>
): ReturnType<typeof createRateLimiter> {
  return createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: requestsPerMinute,
    ...options,
  });
}
