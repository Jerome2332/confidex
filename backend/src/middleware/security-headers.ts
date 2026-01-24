import type { Request, Response, NextFunction } from 'express';

/**
 * Security headers middleware implementing OWASP recommended headers.
 *
 * Headers applied:
 * - Strict-Transport-Security (HSTS): Forces HTTPS
 * - X-Content-Type-Options: Prevents MIME sniffing
 * - X-Frame-Options: Prevents clickjacking
 * - X-XSS-Protection: Legacy XSS filter (still useful for older browsers)
 * - Content-Security-Policy: Controls resource loading
 * - Referrer-Policy: Controls referrer information
 * - Permissions-Policy: Controls browser features
 */

interface SecurityHeadersConfig {
  /** Enable HSTS (should only be true in production with HTTPS) */
  enableHsts: boolean;
  /** HSTS max-age in seconds (default: 1 year) */
  hstsMaxAge: number;
  /** Include subdomains in HSTS */
  hstsIncludeSubdomains: boolean;
  /** Content Security Policy directives */
  csp: {
    defaultSrc: string[];
    scriptSrc: string[];
    styleSrc: string[];
    imgSrc: string[];
    connectSrc: string[];
    fontSrc: string[];
    objectSrc: string[];
    frameSrc: string[];
    frameAncestors: string[];
  };
}

const defaultConfig: SecurityHeadersConfig = {
  enableHsts: process.env.NODE_ENV === 'production',
  hstsMaxAge: 31536000, // 1 year
  hstsIncludeSubdomains: true,
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for some UI frameworks
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: [
      "'self'",
      'https://*.helius-rpc.com',
      'https://*.solana.com',
      'wss://*.helius-rpc.com',
    ],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
};

function buildCspHeader(csp: SecurityHeadersConfig['csp']): string {
  const directives = [
    `default-src ${csp.defaultSrc.join(' ')}`,
    `script-src ${csp.scriptSrc.join(' ')}`,
    `style-src ${csp.styleSrc.join(' ')}`,
    `img-src ${csp.imgSrc.join(' ')}`,
    `connect-src ${csp.connectSrc.join(' ')}`,
    `font-src ${csp.fontSrc.join(' ')}`,
    `object-src ${csp.objectSrc.join(' ')}`,
    `frame-src ${csp.frameSrc.join(' ')}`,
    `frame-ancestors ${csp.frameAncestors.join(' ')}`,
    'base-uri \'self\'',
    'form-action \'self\'',
  ];

  return directives.join('; ');
}

export function securityHeaders(config: Partial<SecurityHeadersConfig> = {}) {
  const mergedConfig: SecurityHeadersConfig = {
    ...defaultConfig,
    ...config,
    csp: {
      ...defaultConfig.csp,
      ...config.csp,
    },
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Strict-Transport-Security (HSTS)
    // Only set in production with HTTPS to avoid issues during development
    if (mergedConfig.enableHsts) {
      const hstsValue = mergedConfig.hstsIncludeSubdomains
        ? `max-age=${mergedConfig.hstsMaxAge}; includeSubDomains`
        : `max-age=${mergedConfig.hstsMaxAge}`;
      res.setHeader('Strict-Transport-Security', hstsValue);
    }

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Legacy XSS protection (still useful for IE)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Content Security Policy
    res.setHeader('Content-Security-Policy', buildCspHeader(mergedConfig.csp));

    // Referrer Policy - don't leak referrer to external sites
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions Policy - disable unnecessary browser features
    res.setHeader(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
    );

    // Remove X-Powered-By header (Express sets this by default)
    res.removeHeader('X-Powered-By');

    next();
  };
}

// Pre-configured for API-only backend (no browser UI)
export function apiSecurityHeaders() {
  return securityHeaders({
    csp: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'none'"],
      imgSrc: ["'none'"],
      connectSrc: ["'self'"],
      fontSrc: ["'none'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  });
}
