import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { createRateLimiter, rateLimiters, createCustomRateLimiter } from '../../middleware/rate-limit.js';

// Mock request/response/next
function createMockReq(ip = '127.0.0.1'): Partial<Request> {
  return {
    ip,
    socket: { remoteAddress: ip } as Request['socket'],
  };
}

function createMockRes(): Partial<Response> & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string | number>;
} {
  const res: Partial<Response> & {
    statusCode: number;
    body: unknown;
    headers: Record<string, string | number>;
  } = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(data: unknown) {
      this.body = data;
      return this as Response;
    },
    setHeader(key: string, value: string | number) {
      this.headers[key] = value;
      return this as Response;
    },
    end: vi.fn() as unknown as Response['end'],
  };
  return res;
}

describe('Rate Limit Middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('createRateLimiter', () => {
    it('allows requests under the limit', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      limiter(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(res.headers['X-RateLimit-Limit']).toBe(5);
      expect(res.headers['X-RateLimit-Remaining']).toBe(4);
    });

    it('blocks requests over the limit', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
      });

      const next = vi.fn();

      // First request
      limiter(createMockReq() as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Second request
      limiter(createMockReq() as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Third request - should be blocked
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(2); // Not incremented
      expect(res.statusCode).toBe(429);
      expect(res.body).toMatchObject({
        error: 'Too Many Requests',
      });
    });

    it('resets counter after window expires', () => {
      const limiter = createRateLimiter({
        windowMs: 1000,
        maxRequests: 1,
      });

      const next = vi.fn();

      // First request
      limiter(createMockReq() as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Second request - blocked
      limiter(createMockReq() as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Advance time past window
      vi.advanceTimersByTime(1100);

      // Third request - should work (new window)
      limiter(createMockReq() as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('uses custom key generator', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        keyGenerator: (req) => (req as Request & { userId?: string }).userId || 'anonymous',
      });

      const next = vi.fn();

      // Request from user1
      const req1 = { ...createMockReq(), userId: 'user1' };
      limiter(req1 as unknown as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Another request from user1 - blocked
      limiter(req1 as unknown as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Request from user2 - allowed (different key)
      const req2 = { ...createMockReq(), userId: 'user2' };
      limiter(req2 as unknown as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('uses custom handler', () => {
      const customHandler = vi.fn((req, res) => {
        res.status(503).json({ error: 'Custom rate limit message' });
      });

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        handler: customHandler,
      });

      const next = vi.fn();

      // First request
      limiter(createMockReq() as Request, createMockRes() as Response, next);

      // Second request - triggers custom handler
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);

      expect(customHandler).toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
    });

    it('sets rate limit headers', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      const res = createMockRes();
      const next = vi.fn();

      limiter(createMockReq() as Request, res as Response, next);

      expect(res.headers['X-RateLimit-Limit']).toBe(10);
      expect(res.headers['X-RateLimit-Remaining']).toBe(9);
      expect(res.headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('sets Retry-After header when rate limited', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
      });

      const next = vi.fn();

      // Exhaust limit
      limiter(createMockReq() as Request, createMockRes() as Response, next);

      // Trigger rate limit
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);

      expect(res.headers['Retry-After']).toBeDefined();
      expect(res.headers['X-RateLimit-Remaining']).toBe(0);
    });
  });

  describe('pre-configured limiters', () => {
    it('standard allows 100 requests per minute', () => {
      const limiter = rateLimiters.standard;
      const next = vi.fn();

      // Make 100 requests
      for (let i = 0; i < 100; i++) {
        limiter(createMockReq() as Request, createMockRes() as Response, next);
      }

      expect(next).toHaveBeenCalledTimes(100);

      // 101st should be blocked
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);
      expect(res.statusCode).toBe(429);
    });

    it('strict allows 10 requests per minute', () => {
      const limiter = rateLimiters.strict;
      const next = vi.fn();

      // Make 10 requests
      for (let i = 0; i < 10; i++) {
        limiter(createMockReq() as Request, createMockRes() as Response, next);
      }

      expect(next).toHaveBeenCalledTimes(10);

      // 11th should be blocked
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);
      expect(res.statusCode).toBe(429);
    });

    it('prove allows 5 requests per minute', () => {
      const limiter = rateLimiters.prove;
      const next = vi.fn();

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        limiter(createMockReq() as Request, createMockRes() as Response, next);
      }

      expect(next).toHaveBeenCalledTimes(5);

      // 6th should be blocked with custom message
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);
      expect(res.statusCode).toBe(429);
      expect(res.body).toMatchObject({
        message: expect.stringContaining('computationally expensive'),
      });
    });
  });

  describe('different IPs', () => {
    it('tracks rate limits per IP', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
      });

      const next = vi.fn();

      // Request from IP 1
      limiter(createMockReq('192.168.1.1') as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Request from IP 2
      limiter(createMockReq('192.168.1.2') as Request, createMockRes() as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Second request from IP 1 - blocked
      const res = createMockRes();
      limiter(createMockReq('192.168.1.1') as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(res.statusCode).toBe(429);
    });
  });

  describe('skipFailedRequests', () => {
    it('decrements count when request fails (4xx/5xx)', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        skipFailedRequests: true,
      });

      const next = vi.fn();

      // First request - succeeds, count = 1
      const res1 = createMockRes();
      limiter(createMockReq() as Request, res1 as Response, next);
      res1.statusCode = 200;
      (res1.end as any)(); // Simulate response end

      // Second request - fails with 400, count should be decremented back
      const res2 = createMockRes();
      limiter(createMockReq() as Request, res2 as Response, next);
      res2.statusCode = 400;
      (res2.end as any)(); // Simulate response end - should decrement

      // Third request - should work because failed request was decremented
      const res3 = createMockRes();
      limiter(createMockReq() as Request, res3 as Response, next);

      expect(next).toHaveBeenCalledTimes(3);
    });

    it('decrements count when request fails with 5xx', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        skipFailedRequests: true,
      });

      const next = vi.fn();

      // First request - server error
      const res1 = createMockRes();
      limiter(createMockReq() as Request, res1 as Response, next);
      res1.statusCode = 500;
      (res1.end as any)();

      // Second request - also server error
      const res2 = createMockRes();
      limiter(createMockReq() as Request, res2 as Response, next);
      res2.statusCode = 503;
      (res2.end as any)();

      // Third request - should work
      const res3 = createMockRes();
      limiter(createMockReq() as Request, res3 as Response, next);

      expect(next).toHaveBeenCalledTimes(3);
    });
  });

  describe('skipSuccessfulRequests', () => {
    it('decrements count when request succeeds (2xx/3xx)', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        skipSuccessfulRequests: true,
      });

      const next = vi.fn();

      // First request - succeeds with 200, should be decremented
      const res1 = createMockRes();
      limiter(createMockReq() as Request, res1 as Response, next);
      res1.statusCode = 200;
      (res1.end as any)();

      // Second request - succeeds, should be decremented
      const res2 = createMockRes();
      limiter(createMockReq() as Request, res2 as Response, next);
      res2.statusCode = 201;
      (res2.end as any)();

      // Third request - should work because successful requests are skipped
      const res3 = createMockRes();
      limiter(createMockReq() as Request, res3 as Response, next);

      expect(next).toHaveBeenCalledTimes(3);
    });

    it('does not decrement for failed requests', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        skipSuccessfulRequests: true,
      });

      const next = vi.fn();

      // First request - fails, should NOT be decremented
      const res1 = createMockRes();
      limiter(createMockReq() as Request, res1 as Response, next);
      res1.statusCode = 401;
      (res1.end as any)();

      // Second request - should be blocked because first (failed) request counted
      const res2 = createMockRes();
      limiter(createMockReq() as Request, res2 as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res2.statusCode).toBe(429);
    });
  });

  describe('createCustomRateLimiter', () => {
    it('creates limiter with specified requests per minute', () => {
      const limiter = createCustomRateLimiter(3);

      const next = vi.fn();

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        limiter(createMockReq() as Request, createMockRes() as Response, next);
      }

      expect(next).toHaveBeenCalledTimes(3);

      // 4th should be blocked
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);
      expect(res.statusCode).toBe(429);
    });

    it('allows additional options to be passed', () => {
      const customHandler = vi.fn((req, res) => {
        res.status(503).json({ error: 'Custom' });
      });

      const limiter = createCustomRateLimiter(1, {
        handler: customHandler,
        message: 'Custom message',
      });

      const next = vi.fn();

      // First request
      limiter(createMockReq() as Request, createMockRes() as Response, next);

      // Second request triggers custom handler
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);

      expect(customHandler).toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
    });

    it('uses 60 second window by default', () => {
      vi.useRealTimers(); // Need real timers for this check

      const limiter = createCustomRateLimiter(1);
      const res = createMockRes();
      const next = vi.fn();

      limiter(createMockReq() as Request, res as Response, next);

      // Check that reset header is set to ~60 seconds from now
      const resetTime = res.headers['X-RateLimit-Reset'] as number;
      const now = Math.ceil(Date.now() / 1000);
      expect(resetTime - now).toBeGreaterThanOrEqual(59);
      expect(resetTime - now).toBeLessThanOrEqual(61);

      vi.useFakeTimers();
    });
  });

  describe('edge cases', () => {
    it('handles request with no IP gracefully', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      const req = {
        ip: undefined,
        socket: { remoteAddress: undefined } as Request['socket'],
      };
      const res = createMockRes();
      const next = vi.fn();

      // Should use 'unknown' as key and not throw
      limiter(req as unknown as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
    });

    it('count does not go below zero when decrementing', () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        skipFailedRequests: true,
      });

      const next = vi.fn();

      // Make a request that fails
      const res = createMockRes();
      limiter(createMockReq() as Request, res as Response, next);
      res.statusCode = 500;
      (res.end as any)(); // Count should decrement from 1 to 0

      // Make another failed request - count should still be 0 (not negative)
      const res2 = createMockRes();
      limiter(createMockReq() as Request, res2 as Response, next);

      expect(next).toHaveBeenCalledTimes(2);
    });
  });
});
