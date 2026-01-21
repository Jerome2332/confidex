import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { adminAuth, optionalAuth, createApiKeyAuth } from '../../middleware/auth.js';

// Mock request/response/next
function createMockReq(headers: Record<string, string> = {}): Partial<Request> {
  return {
    headers,
    ip: '127.0.0.1',
    path: '/admin/test',
  };
}

function createMockRes(): Partial<Response> & { statusCode: number; body: unknown } {
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(data: unknown) {
      this.body = data;
      return this as Response;
    },
  };
  return res;
}

describe('Auth Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('adminAuth', () => {
    it('rejects requests without API key', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      adminAuth(req as Request, res as Response, next as NextFunction);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: 'Unauthorized',
        message: 'API key required. Provide X-API-Key header.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects requests with invalid API key', () => {
      process.env.ADMIN_API_KEY = 'correct-key';

      // Re-import to get fresh module with new env
      const req = createMockReq({ 'x-api-key': 'wrong-key' });
      const res = createMockRes();
      const next = vi.fn();

      adminAuth(req as Request, res as Response, next as NextFunction);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: 'Forbidden',
        message: 'Invalid API key',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts requests with valid API key in development', () => {
      process.env.NODE_ENV = 'development';
      // Without ADMIN_API_KEY set, should use dev fallback

      const req = createMockReq({ 'x-api-key': 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION' });
      const res = createMockRes();
      const next = vi.fn();

      adminAuth(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect((req as Request).isAdmin).toBe(true);
    });

    it('sets isAdmin flag on successful auth', () => {
      // Use development fallback key since ADMIN_API_KEY is read at module load time
      process.env.NODE_ENV = 'development';

      const req = createMockReq({ 'x-api-key': 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION' });
      const res = createMockRes();
      const next = vi.fn();

      adminAuth(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect((req as Request).isAdmin).toBe(true);
    });
  });

  describe('optionalAuth', () => {
    it('allows requests without API key', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      optionalAuth(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect((req as Request).isAdmin).toBe(false);
    });

    it('sets isAdmin=true with valid API key', () => {
      process.env.NODE_ENV = 'development';

      const req = createMockReq({ 'x-api-key': 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION' });
      const res = createMockRes();
      const next = vi.fn();

      optionalAuth(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect((req as Request).isAdmin).toBe(true);
    });

    it('sets isAdmin=false with invalid API key', () => {
      process.env.ADMIN_API_KEY = 'correct-key';

      const req = createMockReq({ 'x-api-key': 'wrong-key' });
      const res = createMockRes();
      const next = vi.fn();

      optionalAuth(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect((req as Request).isAdmin).toBe(false);
    });
  });

  describe('createApiKeyAuth', () => {
    it('creates a scoped API key validator', () => {
      process.env.WEBHOOK_API_KEY = 'webhook-secret';

      const webhookAuth = createApiKeyAuth('WEBHOOK_API_KEY', 'Webhook');

      const req = createMockReq({ 'x-api-key': 'webhook-secret' });
      const res = createMockRes();
      const next = vi.fn();

      webhookAuth(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('rejects when scoped key is missing', () => {
      const webhookAuth = createApiKeyAuth('WEBHOOK_API_KEY', 'Webhook');

      const req = createMockReq({ 'x-api-key': 'some-key' });
      const res = createMockRes();
      const next = vi.fn();

      webhookAuth(req as Request, res as Response, next as NextFunction);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        error: 'Internal Server Error',
        message: 'Authentication not configured',
      });
    });

    it('rejects invalid scoped key', () => {
      process.env.WEBHOOK_API_KEY = 'correct-webhook-key';

      const webhookAuth = createApiKeyAuth('WEBHOOK_API_KEY', 'Webhook');

      const req = createMockReq({ 'x-api-key': 'wrong-key' });
      const res = createMockRes();
      const next = vi.fn();

      webhookAuth(req as Request, res as Response, next as NextFunction);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: 'Forbidden',
        message: 'Invalid Webhook API key',
      });
    });
  });
});
