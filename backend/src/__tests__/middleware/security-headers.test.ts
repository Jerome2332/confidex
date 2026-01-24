import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { securityHeaders, apiSecurityHeaders } from '../../middleware/security-headers.js';

describe('securityHeaders middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let headers: Record<string, string>;

  beforeEach(() => {
    headers = {};
    mockReq = {};
    mockRes = {
      setHeader: vi.fn((name: string, value: string) => {
        headers[name] = value;
        return mockRes as Response;
      }),
      removeHeader: vi.fn((name: string) => {
        delete headers[name];
        return mockRes as Response;
      }),
    };
    mockNext = vi.fn();
  });

  describe('default configuration', () => {
    it('should set X-Content-Type-Options header', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('should set X-Frame-Options header', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['X-Frame-Options']).toBe('DENY');
    });

    it('should set X-XSS-Protection header', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    });

    it('should set Content-Security-Policy header', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Content-Security-Policy']).toBeDefined();
      expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    });

    it('should set Referrer-Policy header', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('should set Permissions-Policy header', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Permissions-Policy']).toBeDefined();
      expect(headers['Permissions-Policy']).toContain('camera=()');
      expect(headers['Permissions-Policy']).toContain('microphone=()');
    });

    it('should remove X-Powered-By header', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.removeHeader).toHaveBeenCalledWith('X-Powered-By');
    });

    it('should call next()', () => {
      const middleware = securityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('HSTS configuration', () => {
    it('should set HSTS header when enabled', () => {
      const middleware = securityHeaders({ enableHsts: true });
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Strict-Transport-Security']).toBeDefined();
      expect(headers['Strict-Transport-Security']).toContain('max-age=');
    });

    it('should not set HSTS header when disabled', () => {
      const middleware = securityHeaders({ enableHsts: false });
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Strict-Transport-Security']).toBeUndefined();
    });

    it('should include subdomains when configured', () => {
      const middleware = securityHeaders({
        enableHsts: true,
        hstsIncludeSubdomains: true,
      });
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Strict-Transport-Security']).toContain('includeSubDomains');
    });

    it('should respect custom max-age', () => {
      const middleware = securityHeaders({
        enableHsts: true,
        hstsMaxAge: 86400,
      });
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Strict-Transport-Security']).toContain('max-age=86400');
    });
  });

  describe('custom CSP configuration', () => {
    it('should allow custom CSP directives', () => {
      const middleware = securityHeaders({
        csp: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'", 'https://cdn.example.com'],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://api.example.com'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      });
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
      expect(headers['Content-Security-Policy']).toContain('https://cdn.example.com');
      expect(headers['Content-Security-Policy']).toContain('https://api.example.com');
    });
  });

  describe('apiSecurityHeaders preset', () => {
    it('should use restrictive CSP for API-only backend', () => {
      const middleware = apiSecurityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
      expect(headers['Content-Security-Policy']).toContain("script-src 'none'");
      expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    });

    it('should still set all security headers', () => {
      const middleware = apiSecurityHeaders();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });
  });
});
