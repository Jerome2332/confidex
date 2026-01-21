/**
 * Timeout Utilities
 *
 * Provides timeout wrappers for async operations.
 */

import { NetworkError, ErrorCode } from './errors.js';

// =============================================================================
// Timeout Error
// =============================================================================

export class TimeoutError extends NetworkError {
  readonly timeoutMs: number;
  readonly operation?: string;

  constructor(timeoutMs: number, operation?: string) {
    const message = operation
      ? `Operation "${operation}" timed out after ${timeoutMs}ms`
      : `Operation timed out after ${timeoutMs}ms`;

    super(message, ErrorCode.CONNECTION_TIMEOUT, undefined, {
      timeoutMs,
      operation,
    });

    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }
}

// =============================================================================
// withTimeout
// =============================================================================

export interface WithTimeoutOptions {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Optional operation name for error messages */
  operation?: string;
  /** Optional abort signal to cancel the operation */
  signal?: AbortSignal;
}

/**
 * Wrap an async operation with a timeout
 *
 * @example
 * const result = await withTimeout(
 *   fetch('https://api.example.com/data'),
 *   { timeoutMs: 5000, operation: 'fetch data' }
 * );
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: WithTimeoutOptions
): Promise<T> {
  const { timeoutMs, operation, signal } = options;

  // If already aborted, reject immediately
  if (signal?.aborted) {
    throw new TimeoutError(0, operation);
  }

  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(timeoutMs, operation));
    }, timeoutMs);
  });

  // Handle external abort signal
  let abortHandler: (() => void) | undefined;
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        abortHandler = () => {
          reject(new TimeoutError(0, operation));
        };
        signal.addEventListener('abort', abortHandler);
      })
    : null;

  try {
    const promises: Promise<T | never>[] = [promise, timeoutPromise];
    if (abortPromise) {
      promises.push(abortPromise);
    }

    return await Promise.race(promises);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (abortHandler && signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

// =============================================================================
// withTimeoutFn
// =============================================================================

/**
 * Create a timeout-wrapped version of an async function
 *
 * @example
 * const fetchWithTimeout = withTimeoutFn(
 *   async (url: string) => fetch(url),
 *   { timeoutMs: 5000, operation: 'fetch' }
 * );
 * const result = await fetchWithTimeout('https://api.example.com');
 */
export function withTimeoutFn<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: WithTimeoutOptions
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return withTimeout(fn(...args), options);
  };
}

// =============================================================================
// Timeout Decorator (for class methods)
// =============================================================================

/**
 * Decorator to add timeout to async class methods
 *
 * @example
 * class ApiClient {
 *   @Timeout(5000, 'fetchUser')
 *   async fetchUser(id: string): Promise<User> {
 *     return fetch(`/users/${id}`).then(r => r.json());
 *   }
 * }
 */
export function Timeout(timeoutMs: number, operation?: string) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;

    if (!originalMethod) {
      return descriptor;
    }

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return withTimeout(originalMethod.apply(this, args) as Promise<unknown>, {
        timeoutMs,
        operation: operation || propertyKey,
      });
    } as T;

    return descriptor;
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Create a promise that resolves after a delay
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TimeoutError(0, 'delay'));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    if (signal) {
      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(new TimeoutError(0, 'delay'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}

/**
 * Create a promise that rejects after a delay
 * Useful for setting deadlines
 */
export function deadline(ms: number, operation?: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(ms, operation));
    }, ms);
  });
}

/**
 * Race an operation against a deadline
 *
 * @example
 * const result = await raceDeadline(
 *   fetch('https://api.example.com'),
 *   5000,
 *   'API request'
 * );
 */
export async function raceDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
  operation?: string
): Promise<T> {
  return Promise.race([promise, deadline(deadlineMs, operation)]);
}

/**
 * Create a timeout-aware fetch wrapper
 *
 * @example
 * const response = await fetchWithTimeout('https://api.example.com', {
 *   method: 'GET',
 *   timeoutMs: 5000,
 * });
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs: number }
): Promise<Response> {
  const { timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(timeoutMs, `fetch ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// Default Timeouts
// =============================================================================

export const DEFAULT_TIMEOUTS = {
  /** RPC request timeout */
  RPC: 30_000,
  /** Transaction confirmation timeout */
  TRANSACTION: 60_000,
  /** MPC computation timeout */
  MPC_COMPUTATION: 120_000,
  /** MPC callback timeout */
  MPC_CALLBACK: 30_000,
  /** HTTP request timeout */
  HTTP: 10_000,
  /** Healthcheck timeout */
  HEALTHCHECK: 5_000,
} as const;
