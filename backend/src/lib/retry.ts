/**
 * Retry Utilities
 *
 * Implements exponential backoff with jitter for reliable network operations.
 * Provides classification of retryable vs non-retryable errors.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay between retries (default: 30000ms = 30s) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Random jitter factor 0-1 (default: 0.1 = 10%) */
  jitterFactor?: number;
  /** Maximum total time for all retries (default: 30000ms = 30s) */
  maxTimeMs?: number;
  /** Callback invoked before each retry */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: Error) => boolean;
}

export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'isRetryable'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  maxTimeMs: 30000,
};

/**
 * Patterns that indicate retryable network/transient errors
 */
const RETRYABLE_PATTERNS = [
  // Network errors
  'timeout',
  'timed out',
  'etimedout',
  'econnreset',
  'econnrefused',
  'enotfound',
  'enetunreach',
  'socket hang up',
  'connection',
  'network',
  // RPC/rate limiting
  'rate limit',
  '429',
  '503',
  'service unavailable',
  'too many requests',
  // Solana-specific retryable
  'blockhash not found',
  'node is behind',
  'slot was skipped',
  'block not available',
];

/**
 * Patterns that indicate fatal/non-retryable errors
 */
const FATAL_PATTERNS = [
  // Program errors
  'custom program error',
  'instruction error',
  'program error',
  // Account errors
  'account not found',
  'invalid account owner',
  'account already exists',
  // Balance errors
  'insufficient',
  'not enough',
  // Authorization
  'unauthorized',
  'invalid signature',
  'signature verification failed',
  // Data errors
  'invalid data',
  'deserialization',
  'serialization',
];

/**
 * Check if an error is retryable based on error message patterns
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Check for fatal patterns first (they take priority)
  for (const pattern of FATAL_PATTERNS) {
    if (message.includes(pattern)) {
      return false;
    }
  }

  // Check for retryable patterns
  for (const pattern of RETRYABLE_PATTERNS) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Check if error is a Solana-specific fatal error that should never be retried
 */
export function isSolanaFatalError(error: Error): boolean {
  const message = error.message.toLowerCase();

  const solanaFatalPatterns = [
    'insufficient funds',
    'account not found',
    'invalid account owner',
    'invalid account data',
    'custom program error',
    'instruction error',
    'lamport balance below rent',
  ];

  return solanaFatalPatterns.some(pattern => message.includes(pattern));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number
): number {
  // Exponential backoff: initialDelay * multiplier^attempt
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter: ±jitterFactor% of the delay
  const jitterRange = cappedDelay * jitterFactor;
  const jitter = (Math.random() - 0.5) * 2 * jitterRange;

  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 *
 * Features:
 * - Exponential backoff with configurable multiplier
 * - Random jitter to prevent thundering herd
 * - Maximum time limit across all retries
 * - Distinguishes between retryable and non-retryable errors
 * - Detailed result including attempt count and total time
 *
 * @param fn Function to execute
 * @param options Retry configuration options
 * @returns Result object with success status, value/error, and metadata
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier,
    jitterFactor,
    maxTimeMs,
  } = { ...DEFAULT_OPTIONS, ...options };

  const isRetryableFn = options.isRetryable ?? isRetryableError;
  const onRetry = options.onRetry;

  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check if we've exceeded max time
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxTimeMs) {
      return {
        success: false,
        error: lastError ?? new Error('Retry timeout exceeded'),
        attempts: attempt,
        totalTimeMs: elapsed,
      };
    }

    try {
      const value = await fn();
      return {
        success: true,
        value,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (!isRetryableFn(lastError)) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalTimeMs: Date.now() - startTime,
        };
      }

      // Don't delay after last attempt
      if (attempt < maxAttempts - 1) {
        const delay = calculateDelay(
          attempt,
          initialDelayMs,
          maxDelayMs,
          backoffMultiplier,
          jitterFactor
        );

        // Check if delay would exceed max time
        const remainingTime = maxTimeMs - (Date.now() - startTime);
        if (delay > remainingTime) {
          return {
            success: false,
            error: lastError,
            attempts: attempt + 1,
            totalTimeMs: Date.now() - startTime,
          };
        }

        // Invoke callback before retry
        if (onRetry) {
          onRetry(lastError, attempt + 1, delay);
        }

        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: lastError ?? new Error('All retry attempts failed'),
    attempts: maxAttempts,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Simple retry wrapper that throws on failure
 *
 * @param fn Function to execute
 * @param options Retry configuration options
 * @returns The function result
 * @throws The last error if all retries fail
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const result = await withRetry(fn, options);

  if (!result.success) {
    throw result.error;
  }

  return result.value as T;
}

/**
 * Create a retryable version of a function
 *
 * @param fn Function to wrap
 * @param options Default retry options for this function
 * @returns Wrapped function that retries on failure
 */
export function withRetryWrapper<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<RetryResult<TResult>> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}
