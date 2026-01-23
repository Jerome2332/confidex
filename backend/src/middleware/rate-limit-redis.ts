/**
 * Redis-based Rate Limiting Middleware
 *
 * Production-ready rate limiter using Redis for distributed state.
 * Supports horizontal scaling with consistent rate limiting across instances.
 *
 * Features:
 * - Sliding window algorithm for accurate rate limiting
 * - Atomic Redis operations for consistency
 * - Graceful fallback to in-memory when Redis unavailable
 * - Cluster-aware for Redis Cluster deployments
 */

import { Request, Response, NextFunction } from 'express';
import { createClient, RedisClientType } from 'redis';
import { logger } from '../lib/logger.js';

const log = logger.rateLimit || logger.http;

interface RedisRateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests per window */
  maxRequests: number;
  /** Redis key prefix */
  prefix?: string;
  /** Custom key generator (default: IP address) */
  keyGenerator?: (req: Request) => string;
  /** Custom handler when rate limit exceeded */
  handler?: (req: Request, res: Response, options: RedisRateLimitOptions) => void;
  /** Message to show when rate limited */
  message?: string;
  /** Skip counting failed requests */
  skipFailedRequests?: boolean;
  /** Skip counting successful requests */
  skipSuccessfulRequests?: boolean;
}

interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  decrement(key: string): Promise<void>;
  isHealthy(): boolean;
}

// In-memory fallback store
class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetAt: number }>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.resetAt <= now) {
          this.store.delete(key);
        }
      }
    }, 60000);
    this.cleanupInterval.unref?.();
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.store.set(key, entry);
    }

    entry.count++;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async decrement(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry && entry.count > 0) {
      entry.count--;
    }
  }

  isHealthy(): boolean {
    return true;
  }
}

// Redis store implementation
class RedisStore implements RateLimitStore {
  private client: RedisClientType;
  private healthy = false;
  private prefix: string;

  constructor(redisUrl: string, prefix: string) {
    this.prefix = prefix;
    this.client = createClient({ url: redisUrl });

    this.client.on('error', (err) => {
      log.error({ err }, 'Redis rate limiter error');
      this.healthy = false;
    });

    this.client.on('ready', () => {
      log.info('Redis rate limiter connected');
      this.healthy = true;
    });

    this.client.on('reconnecting', () => {
      log.warn('Redis rate limiter reconnecting');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      log.error({ err }, 'Failed to connect to Redis for rate limiting');
      throw err;
    }
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const redisKey = `${this.prefix}:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Use sorted set for sliding window
    // Score = timestamp, Member = unique request ID
    const requestId = `${now}:${Math.random().toString(36).substr(2, 9)}`;

    const multi = this.client.multi();

    // Remove expired entries
    multi.zRemRangeByScore(redisKey, 0, windowStart);

    // Add current request
    multi.zAdd(redisKey, { score: now, value: requestId });

    // Count requests in window
    multi.zCard(redisKey);

    // Set expiry on the key
    multi.expire(redisKey, Math.ceil(windowMs / 1000) + 1);

    const results = await multi.exec();
    const count = results[2] as number;

    return {
      count,
      resetAt: now + windowMs,
    };
  }

  async decrement(key: string): Promise<void> {
    const redisKey = `${this.prefix}:${key}`;
    // Remove most recent entry
    await this.client.zPopMax(redisKey);
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}

// Global stores
let redisStore: RedisStore | null = null;
const memoryStore = new MemoryStore();

/**
 * Initialize Redis connection for rate limiting
 */
export async function initRedisRateLimiter(redisUrl?: string): Promise<void> {
  const url = redisUrl || process.env.REDIS_URL;

  if (!url) {
    log.warn('REDIS_URL not configured, using in-memory rate limiting');
    return;
  }

  try {
    redisStore = new RedisStore(url, 'confidex:ratelimit');
    await redisStore.connect();
    log.info('Redis rate limiter initialized');
  } catch (err) {
    log.error({ err }, 'Failed to initialize Redis rate limiter, falling back to memory');
    redisStore = null;
  }
}

/**
 * Get active store (Redis if healthy, otherwise memory)
 */
function getStore(): RateLimitStore {
  if (redisStore && redisStore.isHealthy()) {
    return redisStore;
  }
  return memoryStore;
}

/**
 * Default rate limit exceeded handler
 */
function defaultHandler(req: Request, res: Response, options: RedisRateLimitOptions): void {
  res.status(429).json({
    error: 'Too Many Requests',
    message: options.message || 'Too many requests, please try again later.',
    retryAfter: Math.ceil(options.windowMs / 1000),
  });
}

/**
 * Create a Redis-backed rate limiter middleware
 */
export function createRedisRateLimiter(options: RedisRateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    prefix = 'rl',
    keyGenerator = (req) => req.ip || req.socket.remoteAddress || 'unknown',
    handler = defaultHandler,
    skipFailedRequests = false,
    skipSuccessfulRequests = false,
    message,
  } = options;

  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const store = getStore();
    const key = `${prefix}:${keyGenerator(req)}`;

    try {
      const { count, resetAt } = await store.increment(key, windowMs);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

      // Check if rate limited
      if (count > maxRequests) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter);
        handler(req, res, { ...options, message });
        return;
      }

      // Handle skip options
      if (skipFailedRequests || skipSuccessfulRequests) {
        const originalEnd = res.end.bind(res);
        res.end = function (this: Response, ...args: Parameters<typeof originalEnd>) {
          const shouldDecrement =
            (skipFailedRequests && res.statusCode >= 400) ||
            (skipSuccessfulRequests && res.statusCode < 400);

          if (shouldDecrement) {
            store.decrement(key).catch((err) => {
              log.error({ err }, 'Failed to decrement rate limit counter');
            });
          }
          return originalEnd(...args);
        } as typeof originalEnd;
      }

      next();
    } catch (err) {
      // On error, allow the request but log the issue
      log.error({ err }, 'Rate limiter error, allowing request');
      next();
    }
  };
}

/**
 * Pre-configured Redis-backed rate limiters
 */
export const redisRateLimiters = {
  /**
   * Standard API rate limit: 100 requests per minute
   */
  standard: createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
    prefix: 'std',
  }),

  /**
   * Strict rate limit: 10 requests per minute
   */
  strict: createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
    prefix: 'strict',
  }),

  /**
   * Auth rate limit: 5 attempts per 15 minutes
   */
  auth: createRedisRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    prefix: 'auth',
    skipSuccessfulRequests: true,
    message: 'Too many authentication attempts. Please try again later.',
  }),

  /**
   * Proof generation rate limit: 5 per minute
   */
  prove: createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    prefix: 'prove',
    message: 'Proof generation is computationally expensive. Please wait before trying again.',
  }),

  /**
   * Webhook rate limit: 200 per minute
   */
  webhook: createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 200,
    prefix: 'webhook',
  }),

  /**
   * Health check: very permissive
   */
  health: createRedisRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 1000,
    prefix: 'health',
  }),
};

/**
 * Cleanup function for graceful shutdown
 */
export async function closeRedisRateLimiter(): Promise<void> {
  if (redisStore) {
    await redisStore.disconnect();
    log.info('Redis rate limiter disconnected');
  }
}
