# PRD-007: Security Hardening

**Status:** Draft
**Priority:** CRITICAL
**Complexity:** Medium
**Estimated Effort:** 2-3 days

---

## Executive Summary

Multiple security gaps exist including CORS misconfiguration, API key exposure risks, missing CSP headers, and unprotected admin routes. This PRD implements comprehensive security hardening across the application stack.

---

## Problem Statement

Current security vulnerabilities:

1. **Permissive CORS** - Accepts requests from any origin
2. **Missing Security Headers** - No CSP, no X-Frame-Options
3. **Unprotected Admin Routes** - No authentication on crank control
4. **No Rate Limiting** - API endpoints vulnerable to abuse
5. **Potential Secret Exposure** - Environment files not properly secured

---

## Scope

### In Scope
- Harden CORS with strict origin whitelist
- Add CSP and security headers to Next.js
- Implement admin route authentication
- Add rate limiting on expensive endpoints
- Secure environment variable handling

### Out of Scope
- Full security audit
- WAF deployment
- DDoS protection (infrastructure level)

---

## Implementation Plan

### Task 1: Harden CORS Configuration

**Files to Modify:**
- `backend/src/index.ts`

**Step 1.1: Strict CORS Whitelist**

```typescript
// backend/src/index.ts

import express from 'express';
import cors from 'cors';

const app = express();

// Allowed origins - strict whitelist
const ALLOWED_ORIGINS = [
  // Production
  'https://app.confidex.exchange',
  'https://confidex.exchange',

  // Staging
  'https://staging.confidex.exchange',

  // Development (only if NODE_ENV !== 'production')
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000']
    : []),
];

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman in dev)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        // In production, reject requests without origin
        callback(new Error('Origin required'), false);
      } else {
        callback(null, true);
      }
      return;
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Rejected request from origin: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed`), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// Handle CORS errors
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.message.includes('not allowed')) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Cross-origin request not allowed',
    });
    return;
  }
  next(err);
});
```

---

### Task 2: Add Security Headers to Next.js

**Files to Modify:**
- `frontend/next.config.js`

**Step 2.1: Comprehensive Security Headers**

```javascript
// frontend/next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... existing config

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Content Security Policy
          {
            key: 'Content-Security-Policy',
            value: buildCSP(),
          },
          // Prevent clickjacking
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // Prevent MIME type sniffing
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Enable XSS filter
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          // Control referrer information
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // HTTP Strict Transport Security
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // Permissions Policy (formerly Feature-Policy)
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
          },
        ],
      },
    ];
  },
};

function buildCSP() {
  const directives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'", // Required for Next.js
      "'unsafe-eval'",   // Required for Next.js in dev
      'https://va.vercel-scripts.com',
    ],
    'style-src': [
      "'self'",
      "'unsafe-inline'", // Required for styled-components/emotion
    ],
    'img-src': [
      "'self'",
      'data:',
      'https:',
      'blob:',
    ],
    'font-src': [
      "'self'",
      'https://fonts.gstatic.com',
    ],
    'connect-src': [
      "'self'",
      // Solana RPC
      'https://api.devnet.solana.com',
      'https://api.mainnet-beta.solana.com',
      'https://*.helius-rpc.com',
      'wss://*.helius-rpc.com',
      // Backend API
      'https://api.confidex.exchange',
      process.env.NODE_ENV !== 'production' ? 'http://localhost:3001' : '',
      // Wallet adapters
      'https://phantom.app',
      'https://solflare.com',
      // Analytics (if used)
      'https://va.vercel-scripts.com',
    ].filter(Boolean),
    'frame-src': [
      "'self'",
      'https://phantom.app',
      'https://solflare.com',
    ],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      return `${key} ${values.join(' ')}`;
    })
    .join('; ');
}

module.exports = nextConfig;
```

---

### Task 3: Admin Route Authentication

**New Files:**
- `backend/src/middleware/auth.ts`
- `backend/src/routes/admin/index.ts`

**Step 3.1: API Key Authentication Middleware**

```typescript
// backend/src/middleware/auth.ts

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Admin API key (should be set via environment variable)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY && process.env.NODE_ENV === 'production') {
  console.error('[AUTH] ADMIN_API_KEY not set in production!');
  process.exit(1);
}

// Development fallback (never use in production)
const DEV_API_KEY = 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION';

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Admin authentication middleware
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required',
    });
    return;
  }

  const validKey = ADMIN_API_KEY || (process.env.NODE_ENV !== 'production' ? DEV_API_KEY : '');

  if (!validKey || !timingSafeEqual(apiKey, validKey)) {
    // Log failed auth attempts
    console.warn(`[AUTH] Failed admin auth attempt from ${req.ip}`);

    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key',
    });
    return;
  }

  next();
}

/**
 * Optional authentication - allows unauthenticated access but adds user context if authenticated
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (apiKey) {
    const validKey = ADMIN_API_KEY || DEV_API_KEY;
    req.isAdmin = validKey && timingSafeEqual(apiKey, validKey);
  } else {
    req.isAdmin = false;
  }

  next();
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean;
    }
  }
}
```

**Step 3.2: Protected Admin Routes**

```typescript
// backend/src/routes/admin/index.ts

import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { CrankService } from '../../crank/index.js';

export function createAdminRouter(crankService: CrankService): Router {
  const router = Router();

  // Apply admin authentication to all routes in this router
  router.use(adminAuth);

  /**
   * GET /admin/crank/status
   * Get crank service status and metrics
   */
  router.get('/crank/status', (req, res) => {
    const status = crankService.getStatus();
    res.json(status);
  });

  /**
   * POST /admin/crank/start
   * Start the crank service
   */
  router.post('/crank/start', async (req, res) => {
    try {
      await crankService.start();
      res.json({ success: true, message: 'Crank service started' });
    } catch (err) {
      res.status(500).json({
        error: 'Failed to start crank',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /admin/crank/stop
   * Stop the crank service
   */
  router.post('/crank/stop', async (req, res) => {
    try {
      await crankService.stop();
      res.json({ success: true, message: 'Crank service stopped' });
    } catch (err) {
      res.status(500).json({
        error: 'Failed to stop crank',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /admin/crank/pause
   * Pause crank polling (keeps service running)
   */
  router.post('/crank/pause', (req, res) => {
    crankService.pause();
    res.json({ success: true, message: 'Crank polling paused' });
  });

  /**
   * POST /admin/crank/resume
   * Resume crank polling
   */
  router.post('/crank/resume', (req, res) => {
    crankService.resume();
    res.json({ success: true, message: 'Crank polling resumed' });
  });

  /**
   * POST /admin/exchange/pause
   * Pause the exchange (requires on-chain transaction)
   */
  router.post('/exchange/pause', async (req, res) => {
    // This would trigger an on-chain transaction to pause the exchange
    res.status(501).json({ error: 'Not implemented' });
  });

  /**
   * GET /admin/logs
   * Get recent logs (limited)
   */
  router.get('/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    // Return recent logs from memory buffer
    res.json({ logs: [], limit });
  });

  return router;
}
```

**Step 3.3: Register Admin Routes**

```typescript
// backend/src/index.ts

import { createAdminRouter } from './routes/admin/index.js';

// ... after creating crankService

// Admin routes (protected)
app.use('/admin', createAdminRouter(crankService));

// Ensure health endpoint is NOT behind auth
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});
```

---

### Task 4: Rate Limiting

**New Files:**
- `backend/src/middleware/rate-limit.ts`

**Step 4.1: Rate Limiter Implementation**

```typescript
// backend/src/middleware/rate-limit.ts

import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (req: Request) => string;
  handler?: (req: Request, res: Response) => void;
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
}

/**
 * In-memory rate limiter
 * For production, consider Redis-based solution
 */
export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.ip || 'unknown',
    handler = (req, res) => {
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(windowMs / 1000)} seconds.`,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    },
    skipFailedRequests = false,
    skipSuccessfulRequests = false,
  } = options;

  const store = new Map<string, RateLimitEntry>();

  // Cleanup expired entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 60000);

  return (req: Request, res: Response, next: NextFunction) => {
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

    // Check limit
    if (entry.count >= maxRequests) {
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));

      handler(req, res);
      return;
    }

    // Increment counter
    entry.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    // Handle skip options
    if (skipFailedRequests || skipSuccessfulRequests) {
      const originalSend = res.send;
      res.send = function (body) {
        if (
          (skipFailedRequests && res.statusCode >= 400) ||
          (skipSuccessfulRequests && res.statusCode < 400)
        ) {
          entry!.count--;
        }
        return originalSend.call(this, body);
      };
    }

    next();
  };
}

/**
 * Pre-configured rate limiters
 */
export const rateLimiters = {
  // Standard API: 100 requests per minute
  standard: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
  }),

  // Strict: 10 requests per minute (for expensive operations)
  strict: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
  }),

  // Auth: 5 attempts per 15 minutes
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    skipSuccessfulRequests: true,
  }),

  // Proof generation: 5 per minute
  prove: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Proof generation is computationally expensive. Please wait before trying again.',
        retryAfter: 60,
      });
    },
  }),

  // Webhook: 200 per minute (higher for automated systems)
  webhook: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 200,
  }),
};
```

**Step 4.2: Apply Rate Limiting to Routes**

```typescript
// backend/src/index.ts

import { rateLimiters } from './middleware/rate-limit.js';

// Apply standard rate limiting to all routes
app.use(rateLimiters.standard);

// Apply strict rate limiting to expensive endpoints
app.post('/api/prove', rateLimiters.prove, async (req, res) => {
  // ... proof generation logic
});

// Webhook endpoints get higher limits
app.post('/api/webhooks/helius', rateLimiters.webhook, async (req, res) => {
  // ... webhook handling
});

// Admin routes already behind auth, but also rate limit
app.use('/admin', rateLimiters.strict);
```

---

### Task 5: Environment Variable Security

**Step 5.1: Update .gitignore**

```bash
# .gitignore

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
.env*.local

# Never commit these
*.pem
*.key
*-keypair.json
secrets/
keys/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
```

**Step 5.2: Create Environment Template**

```bash
# backend/.env.example

# Server Configuration
NODE_ENV=development
PORT=3001

# RPC Endpoints (replace with your own)
CRANK_RPC_PRIMARY=https://api.devnet.solana.com
CRANK_RPC_SECONDARY=
CRANK_RPC_TERTIARY=

# Program IDs
CONFIDEX_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
MXE_PROGRAM_ID=DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM

# Crank Configuration
CRANK_ENABLED=true
CRANK_WALLET_PATH=./keys/crank-wallet.json
CRANK_POLLING_INTERVAL_MS=5000
CRANK_USE_ASYNC_MPC=true

# Admin Authentication (generate with: openssl rand -hex 32)
ADMIN_API_KEY=

# Alerting (optional)
SLACK_WEBHOOK_URL=
ALERT_WEBHOOK_URL=

# Database
CRANK_DB_PATH=./data/crank.db
```

**Step 5.3: Validate Required Environment Variables**

```typescript
// backend/src/config/env.ts

interface RequiredEnvVars {
  development: string[];
  production: string[];
}

const REQUIRED_ENV_VARS: RequiredEnvVars = {
  development: [
    'CONFIDEX_PROGRAM_ID',
    'MXE_PROGRAM_ID',
  ],
  production: [
    'NODE_ENV',
    'CONFIDEX_PROGRAM_ID',
    'MXE_PROGRAM_ID',
    'ADMIN_API_KEY',
    'CRANK_RPC_PRIMARY',
  ],
};

export function validateEnv(): void {
  const env = process.env.NODE_ENV || 'development';
  const required = REQUIRED_ENV_VARS[env as keyof RequiredEnvVars] || REQUIRED_ENV_VARS.development;

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`[ENV] Missing required environment variables:`);
    missing.forEach((key) => console.error(`  - ${key}`));

    if (env === 'production') {
      process.exit(1);
    } else {
      console.warn('[ENV] Continuing in development mode with missing variables');
    }
  }

  // Warn about insecure defaults
  if (process.env.ADMIN_API_KEY === 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION') {
    if (env === 'production') {
      console.error('[ENV] FATAL: Using development API key in production!');
      process.exit(1);
    } else {
      console.warn('[ENV] Using development API key - DO NOT USE IN PRODUCTION');
    }
  }
}
```

**Step 5.4: Secret Scanning Pre-commit Hook**

```bash
#!/usr/bin/env sh
# .husky/pre-commit (add to existing)

# Check for potential secrets
echo "Checking for potential secrets..."

PATTERNS=(
  "PRIVATE_KEY"
  "SECRET_KEY"
  "API_KEY=sk-"
  "BEGIN RSA PRIVATE KEY"
  "BEGIN EC PRIVATE KEY"
  "password\s*=\s*['\"][^'\"]+['\"]"
)

FOUND_SECRETS=0

for pattern in "${PATTERNS[@]}"; do
  if git diff --cached --name-only -z | xargs -0 grep -l -E "$pattern" 2>/dev/null; then
    echo "WARNING: Potential secret found matching pattern: $pattern"
    FOUND_SECRETS=1
  fi
done

# Check for .env files being committed
if git diff --cached --name-only | grep -E "^\.env(\..+)?$" | grep -v ".example$"; then
  echo "ERROR: Attempting to commit .env file!"
  FOUND_SECRETS=1
fi

# Check for keypair files
if git diff --cached --name-only | grep -E "\-keypair\.json$"; then
  echo "ERROR: Attempting to commit Solana keypair file!"
  FOUND_SECRETS=1
fi

if [ $FOUND_SECRETS -eq 1 ]; then
  echo ""
  echo "Potential secrets detected. Please review and remove before committing."
  echo "If this is a false positive, you can bypass with: git commit --no-verify"
  exit 1
fi

echo "No secrets detected."
```

---

### Task 6: Input Validation

**New Files:**
- `backend/src/middleware/validation.ts`

```typescript
// backend/src/middleware/validation.ts

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

/**
 * Validate request body against Zod schema
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Validate query parameters
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
      return;
    }

    req.query = result.data as any;
    next();
  };
}

// Common validation schemas
export const schemas = {
  // Public key validation
  publicKey: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid public key'),

  // Hex string validation
  hexString: (length?: number) =>
    length
      ? z.string().regex(new RegExp(`^[0-9a-fA-F]{${length * 2}}$`), `Must be ${length} bytes hex`)
      : z.string().regex(/^[0-9a-fA-F]+$/, 'Must be valid hex'),

  // Transaction signature
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/, 'Invalid transaction signature'),

  // Amount (positive integer)
  amount: z.number().int().positive(),

  // Price (positive number)
  price: z.number().positive(),

  // Pagination
  pagination: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

// Example: Proof request validation
export const proveRequestSchema = z.object({
  address: schemas.publicKey,
  blacklistRoot: schemas.hexString(32),
  merklePath: z.array(schemas.hexString(32)).length(20),
  pathIndices: z.array(z.boolean()).length(20),
});
```

---

## Acceptance Criteria

- [ ] **CORS**
  - [ ] Only whitelisted origins accepted
  - [ ] Unknown origins logged and rejected
  - [ ] Credentials properly handled
  - [ ] Preflight requests cached

- [ ] **Security Headers**
  - [ ] CSP header present on all pages
  - [ ] X-Frame-Options set to DENY
  - [ ] HSTS enabled with includeSubDomains
  - [ ] X-Content-Type-Options set to nosniff

- [ ] **Admin Authentication**
  - [ ] All /admin routes require X-API-Key header
  - [ ] Invalid keys return 403
  - [ ] Failed auth attempts logged
  - [ ] Timing-safe comparison used

- [ ] **Rate Limiting**
  - [ ] Standard endpoints: 100 req/min
  - [ ] Prove endpoint: 5 req/min
  - [ ] Admin endpoints: 10 req/min
  - [ ] Rate limit headers returned

- [ ] **Secrets Management**
  - [ ] No .env files in git
  - [ ] Keypair files in .gitignore
  - [ ] Pre-commit hook detects secrets
  - [ ] Environment validation on startup

---

## Security Testing

```bash
# Test CORS
curl -H "Origin: https://evil.com" -I https://api.confidex.exchange/health

# Test missing API key
curl -X POST https://api.confidex.exchange/admin/crank/status

# Test rate limiting
for i in {1..15}; do curl -s -o /dev/null -w "%{http_code}\n" https://api.confidex.exchange/health; done

# Check security headers
curl -I https://app.confidex.exchange | grep -E "^(Content-Security-Policy|X-Frame-Options|Strict-Transport-Security)"

# Scan for secrets in git history
git log -p | grep -E "(PRIVATE_KEY|SECRET_KEY|password=)"
```

---

## References

- [OWASP Security Headers](https://owasp.org/www-project-secure-headers/)
- [CSP Reference](https://content-security-policy.com/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Solana Security Guidelines](https://docs.solana.com/developing/programming-model/security)
