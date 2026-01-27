/**
 * Environment Variable Validation
 *
 * Zod-based validation with type coercion, range checking, and detailed error messages.
 * Validates required environment variables at startup and fails fast in production.
 */

import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';

// =============================================================================
// Custom Validators
// =============================================================================

/**
 * Validate that a string is a valid Solana public key (base58)
 */
const isValidPubkey = (value: string): boolean => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Zod refinement for Solana public keys
 */
const solanaAddress = z.string().refine(isValidPubkey, {
  message: 'Invalid Solana address (must be valid base58 public key)',
});

/**
 * Zod refinement for URLs
 */
const urlString = z.string().url({ message: 'Must be a valid URL' });

/**
 * Zod refinement for hex strings
 */
const hexString = z.string().regex(/^[0-9a-fA-F]+$/, {
  message: 'Must be a valid hexadecimal string',
});

// =============================================================================
// Environment Schema
// =============================================================================

/**
 * Complete environment variable schema with validation rules
 */
export const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server configuration
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),

  // RPC Configuration
  RPC_URL: urlString.optional(),
  CRANK_RPC_PRIMARY: urlString.optional(),
  CRANK_RPC_FALLBACK: urlString.optional(),
  HELIUS_API_KEY: z.string().optional(),

  // Program IDs (Solana addresses)
  CONFIDEX_PROGRAM_ID: solanaAddress.optional(),
  MXE_PROGRAM_ID: solanaAddress.optional(),
  ELIGIBILITY_VERIFIER_PROGRAM_ID: solanaAddress.optional(),

  // MXE Configuration
  MXE_X25519_PUBKEY: hexString.length(64).optional(),
  MPC_CLUSTER_OFFSET: z.coerce.number().int().min(0).max(1000).default(456),

  // Crank Configuration
  CRANK_ENABLED: z.coerce.boolean().default(true),
  CRANK_USE_REAL_MPC: z.coerce.boolean().default(false),
  CRANK_POLLING_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  CRANK_MAX_CONCURRENT_MATCHES: z.coerce.number().int().min(1).max(20).default(5),
  CRANK_WALLET_PATH: z.string().optional(),
  CRANK_WALLET_SECRET_KEY: z.string().optional(),

  // MPC Timeouts
  MPC_TIMEOUT_MS: z.coerce.number().int().min(30000).max(300000).default(120000),
  MPC_CALLBACK_TIMEOUT_MS: z.coerce.number().int().min(10000).max(60000).default(30000),

  // ShadowWire Configuration
  SHADOWWIRE_ENABLED: z.coerce.boolean().default(false),
  SHADOWWIRE_API_KEY: z.string().optional(),
  SHADOWWIRE_BASE_URL: urlString.optional(),
  SHADOWWIRE_TIMEOUT_MS: z.coerce.number().int().min(5000).max(60000).default(30000),

  // Circuit Breaker Settings
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(5),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().int().min(10000).max(300000).default(30000),

  // Security
  ADMIN_API_KEY: z.string().min(16).optional(),

  // Database
  DATABASE_PATH: z.string().default('./data/crank.db'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Alerts
  SLACK_WEBHOOK_URL: urlString.optional(),
  PAGERDUTY_ROUTING_KEY: z.string().optional(),
  ALERT_ENVIRONMENT: z.string().default('development'),

  // Analytics (optional)
  TIMESCALE_URL: urlString.optional(),

  // Light Protocol (ZK Compression)
  LIGHT_PROTOCOL_ENABLED: z.coerce.boolean().default(false),
})
  // Conditional validations
  .refine(
    (data) => !data.SHADOWWIRE_ENABLED || data.SHADOWWIRE_API_KEY,
    {
      message: 'SHADOWWIRE_API_KEY is required when SHADOWWIRE_ENABLED=true',
      path: ['SHADOWWIRE_API_KEY'],
    }
  )
  .refine(
    (data) => {
      // In production, require either RPC_URL or CRANK_RPC_PRIMARY
      if (data.NODE_ENV === 'production') {
        return data.RPC_URL || data.CRANK_RPC_PRIMARY;
      }
      return true;
    },
    {
      message: 'RPC_URL or CRANK_RPC_PRIMARY is required in production',
      path: ['RPC_URL'],
    }
  )
  .refine(
    (data) => {
      // In production, require ADMIN_API_KEY
      if (data.NODE_ENV === 'production') {
        return !!data.ADMIN_API_KEY;
      }
      return true;
    },
    {
      message: 'ADMIN_API_KEY is required in production',
      path: ['ADMIN_API_KEY'],
    }
  )
  .refine(
    (data) => {
      // Reject known insecure API key in production
      if (data.NODE_ENV === 'production') {
        return data.ADMIN_API_KEY !== 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION';
      }
      return true;
    },
    {
      message: 'Cannot use development API key in production',
      path: ['ADMIN_API_KEY'],
    }
  )
  .refine(
    (data) => {
      // In production, require program IDs
      if (data.NODE_ENV === 'production') {
        return data.CONFIDEX_PROGRAM_ID && data.MXE_PROGRAM_ID;
      }
      return true;
    },
    {
      message: 'CONFIDEX_PROGRAM_ID and MXE_PROGRAM_ID are required in production',
      path: ['CONFIDEX_PROGRAM_ID'],
    }
  );

/**
 * Type for validated environment
 */
export type ValidatedEnv = z.infer<typeof envSchema>;

// =============================================================================
// Validation Function
// =============================================================================

/**
 * Validate environment variables
 *
 * Parses and validates all environment variables against the schema.
 * In production, exits the process on validation failure.
 * In development, logs warnings but continues.
 *
 * @returns Validated and typed environment object
 */
export function validateEnvStrict(): ValidatedEnv {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues;
    const env = process.env.NODE_ENV || 'development';

    console.error('[ENV] Environment validation failed:');
    errors.forEach((issue) => {
      const path = issue.path.join('.');
      console.error(`  - ${path}: ${issue.message}`);
    });

    if (env === 'production') {
      console.error('[ENV] FATAL: Cannot start in production with invalid configuration');
      process.exit(1);
    } else {
      console.warn('[ENV] Continuing in development mode with validation errors');
      // Return partial result with defaults
      return envSchema.parse({
        ...process.env,
        NODE_ENV: 'development',
      });
    }
  }

  // Additional security warnings
  if (result.data.NODE_ENV !== 'production') {
    if (result.data.ADMIN_API_KEY === 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION') {
      console.warn('[ENV] Using development API key - DO NOT USE IN PRODUCTION');
    }
    if (result.data.CRANK_USE_REAL_MPC === false) {
      console.warn('[ENV] Using simulated MPC mode - not suitable for production');
    }
  }

  console.log(`[ENV] Environment validation passed (${result.data.NODE_ENV} mode)`);
  return result.data;
}

/**
 * Get a validated environment variable by key
 * Throws if the environment hasn't been validated yet
 */
let _validatedEnv: ValidatedEnv | null = null;

export function getValidatedEnv(): ValidatedEnv {
  if (!_validatedEnv) {
    _validatedEnv = validateEnvStrict();
  }
  return _validatedEnv;
}

/**
 * Check if a specific environment variable is set
 */
export function isEnvSet(key: keyof ValidatedEnv): boolean {
  const env = getValidatedEnv();
  const value = env[key];
  return value !== undefined && value !== null && value !== '';
}

/**
 * Get environment with defaults for specific use cases
 */
export function getCrankConfig(): {
  enabled: boolean;
  useRealMpc: boolean;
  pollingIntervalMs: number;
  maxConcurrentMatches: number;
  mpcTimeoutMs: number;
} {
  const env = getValidatedEnv();
  return {
    enabled: env.CRANK_ENABLED,
    useRealMpc: env.CRANK_USE_REAL_MPC,
    pollingIntervalMs: env.CRANK_POLLING_INTERVAL_MS,
    maxConcurrentMatches: env.CRANK_MAX_CONCURRENT_MATCHES,
    mpcTimeoutMs: env.MPC_TIMEOUT_MS,
  };
}

export function getShadowWireConfig(): {
  enabled: boolean;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  timeoutMs: number;
} {
  const env = getValidatedEnv();
  return {
    enabled: env.SHADOWWIRE_ENABLED,
    apiKey: env.SHADOWWIRE_API_KEY,
    baseUrl: env.SHADOWWIRE_BASE_URL,
    timeoutMs: env.SHADOWWIRE_TIMEOUT_MS,
  };
}

export function getCircuitBreakerConfig(): {
  failureThreshold: number;
  resetTimeoutMs: number;
} {
  const env = getValidatedEnv();
  return {
    failureThreshold: env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    resetTimeoutMs: env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  };
}
