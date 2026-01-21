/**
 * Environment Variable Validation
 *
 * Validates required environment variables at startup.
 * Fails fast in production if critical vars are missing.
 */

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

/**
 * Validate required environment variables
 * Exits process in production if required vars are missing
 */
export function validateEnv(): void {
  const env = process.env.NODE_ENV || 'development';
  const required = REQUIRED_ENV_VARS[env as keyof RequiredEnvVars] || REQUIRED_ENV_VARS.development;

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`[ENV] Missing required environment variables:`);
    missing.forEach((key) => console.error(`  - ${key}`));

    if (env === 'production') {
      console.error('[ENV] FATAL: Cannot start in production with missing variables');
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

  // Log successful validation
  console.log(`[ENV] Environment validation passed (${env} mode)`);
}

/**
 * Get environment variable with default value
 */
export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return defaultValue;
  }
  return value;
}

/**
 * Get environment variable as number
 */
export function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return defaultValue;
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return num;
}

/**
 * Get environment variable as boolean
 */
export function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}
