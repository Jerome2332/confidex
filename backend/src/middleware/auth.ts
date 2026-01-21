/**
 * Authentication Middleware
 *
 * API key-based authentication for admin routes.
 * Uses timing-safe comparison to prevent timing attacks.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Admin API key (should be set via environment variable)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// Check for production without API key
if (!ADMIN_API_KEY && process.env.NODE_ENV === 'production') {
  console.error('[AUTH] FATAL: ADMIN_API_KEY not set in production!');
  process.exit(1);
}

// Development fallback (never use in production)
const DEV_API_KEY = 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION';

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Ensure both strings have same length for timing-safe comparison
  // If lengths differ, we still need to do a comparison to avoid timing leak
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Admin authentication middleware
 * Requires X-API-Key header with valid admin key
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Provide X-API-Key header.',
    });
    return;
  }

  const validKey = ADMIN_API_KEY || (process.env.NODE_ENV !== 'production' ? DEV_API_KEY : '');

  if (!validKey || !timingSafeEqual(apiKey, validKey)) {
    // Log failed auth attempts (but not the key itself)
    console.warn(`[AUTH] Failed admin auth attempt from IP: ${req.ip}, Path: ${req.path}`);

    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key',
    });
    return;
  }

  // Mark request as authenticated
  req.isAdmin = true;
  next();
}

/**
 * Optional authentication middleware
 * Allows unauthenticated access but adds admin context if authenticated
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (apiKey) {
    const validKey = ADMIN_API_KEY || DEV_API_KEY;
    req.isAdmin = validKey ? timingSafeEqual(apiKey, validKey) : false;
  } else {
    req.isAdmin = false;
  }

  next();
}

/**
 * Create a scoped API key validator for specific operations
 * Useful for per-route or per-feature API keys
 */
export function createApiKeyAuth(keyEnvVar: string, keyName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = req.headers['x-api-key'] as string;
    const validKey = process.env[keyEnvVar];

    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: `${keyName} API key required`,
      });
      return;
    }

    if (!validKey) {
      console.error(`[AUTH] ${keyEnvVar} not configured`);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication not configured',
      });
      return;
    }

    if (!timingSafeEqual(apiKey, validKey)) {
      console.warn(`[AUTH] Failed ${keyName} auth from IP: ${req.ip}`);
      res.status(403).json({
        error: 'Forbidden',
        message: `Invalid ${keyName} API key`,
      });
      return;
    }

    next();
  };
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean;
    }
  }
}
