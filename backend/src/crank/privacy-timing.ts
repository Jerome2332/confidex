/**
 * Privacy Timing Utilities
 *
 * Provides anti-correlation timing features to prevent traffic analysis attacks
 * on the confidential DEX. Key features:
 *
 * 1. Random delays between operations (0-500ms)
 * 2. Batch shuffling for order matching
 * 3. Dummy operation injection
 * 4. Coarse timestamp rounding
 */

import { randomBytes } from 'crypto';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Maximum random delay in milliseconds.
 * This value is tuned to:
 * - Provide meaningful traffic analysis resistance
 * - Not significantly impact user-perceived latency
 */
export const MAX_RANDOM_DELAY_MS = 500;

/**
 * Minimum batch size for shuffling.
 * Orders are held until this batch size is reached or timeout expires.
 */
export const MIN_BATCH_SIZE = 3;

/**
 * Maximum time to wait for batch formation in milliseconds.
 * After this timeout, orders are processed even if batch size < MIN_BATCH_SIZE.
 */
export const BATCH_TIMEOUT_MS = 2000;

/**
 * Probability of injecting a dummy operation (0-1).
 * Dummy operations help mask the actual operation count.
 */
export const DUMMY_OPERATION_PROBABILITY = 0.1;

/**
 * Timestamp coarseness for events (in seconds).
 * Events are rounded to this granularity (1 hour = 3600s).
 */
export const TIMESTAMP_COARSENESS_SECONDS = 3600;

// =============================================================================
// RANDOM DELAY
// =============================================================================

/**
 * Generate a cryptographically secure random delay.
 *
 * Uses crypto.randomBytes to ensure unpredictability.
 *
 * @param maxMs Maximum delay in milliseconds (default: MAX_RANDOM_DELAY_MS)
 * @returns Random delay in milliseconds
 */
export function generateRandomDelay(maxMs: number = MAX_RANDOM_DELAY_MS): number {
  // Use 4 bytes for a 32-bit random value
  const bytes = randomBytes(4);
  const randomValue = bytes.readUInt32BE(0);
  // Scale to [0, maxMs]
  return Math.floor((randomValue / 0xFFFFFFFF) * maxMs);
}

/**
 * Sleep for a random duration with anti-correlation delay.
 *
 * @param maxMs Maximum delay in milliseconds
 * @returns Promise that resolves after the random delay
 */
export async function randomDelayedSleep(maxMs: number = MAX_RANDOM_DELAY_MS): Promise<number> {
  const delay = generateRandomDelay(maxMs);
  await new Promise(resolve => setTimeout(resolve, delay));
  return delay;
}

// =============================================================================
// BATCH SHUFFLING
// =============================================================================

/**
 * Fisher-Yates shuffle with cryptographic randomness.
 *
 * Shuffles an array in-place using secure random numbers.
 * This prevents any correlation between order arrival and processing order.
 *
 * @param array Array to shuffle
 * @returns The same array, shuffled in-place
 */
export function secureShuffleInPlace<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    // Generate random index [0, i]
    const bytes = randomBytes(4);
    const randomValue = bytes.readUInt32BE(0);
    const j = Math.floor((randomValue / 0xFFFFFFFF) * (i + 1));

    // Swap elements
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Create a shuffled copy of an array.
 *
 * @param array Array to shuffle
 * @returns New shuffled array
 */
export function secureShuffle<T>(array: readonly T[]): T[] {
  const copy = [...array];
  return secureShuffleInPlace(copy);
}

// =============================================================================
// TIMESTAMP COARSENING
// =============================================================================

/**
 * Round a timestamp to the nearest coarse interval.
 *
 * This prevents timing correlation attacks by making all events
 * within the same hour indistinguishable.
 *
 * @param timestamp Unix timestamp in seconds
 * @param granularitySeconds Coarseness granularity (default: 1 hour)
 * @returns Coarse timestamp
 */
export function coarsenTimestamp(
  timestamp: number,
  granularitySeconds: number = TIMESTAMP_COARSENESS_SECONDS
): number {
  return Math.floor(timestamp / granularitySeconds) * granularitySeconds;
}

/**
 * Get current time as a coarse timestamp.
 *
 * @param granularitySeconds Coarseness granularity (default: 1 hour)
 * @returns Coarse current timestamp
 */
export function getCoarseTimestamp(
  granularitySeconds: number = TIMESTAMP_COARSENESS_SECONDS
): number {
  const now = Math.floor(Date.now() / 1000);
  return coarsenTimestamp(now, granularitySeconds);
}

// =============================================================================
// DUMMY OPERATIONS
// =============================================================================

/**
 * Determine whether to inject a dummy operation.
 *
 * @param probability Probability of injection (0-1)
 * @returns True if a dummy operation should be injected
 */
export function shouldInjectDummy(
  probability: number = DUMMY_OPERATION_PROBABILITY
): boolean {
  const bytes = randomBytes(4);
  const randomValue = bytes.readUInt32BE(0) / 0xFFFFFFFF;
  return randomValue < probability;
}

// =============================================================================
// BATCH COLLECTOR
// =============================================================================

/**
 * Batch collector for anti-correlation order processing.
 *
 * Collects orders until either:
 * - MIN_BATCH_SIZE orders are collected
 * - BATCH_TIMEOUT_MS elapsed since first order
 *
 * Then shuffles and releases the batch.
 */
export class AntiCorrelationBatchCollector<T> {
  private batch: T[] = [];
  private timeout: NodeJS.Timeout | null = null;
  private resolvePromise: ((items: T[]) => void) | null = null;
  private rejectPromise: ((err: Error) => void) | null = null;

  constructor(
    private minBatchSize: number = MIN_BATCH_SIZE,
    private batchTimeoutMs: number = BATCH_TIMEOUT_MS,
    private onBatchReady?: (items: T[]) => void
  ) {}

  /**
   * Add an item to the batch.
   * If batch is full or timeout expires, triggers flush.
   */
  add(item: T): void {
    this.batch.push(item);

    // Start timeout on first item
    if (this.batch.length === 1 && !this.timeout) {
      this.timeout = setTimeout(() => this.flush(), this.batchTimeoutMs);
    }

    // Flush if batch is full
    if (this.batch.length >= this.minBatchSize) {
      this.flush();
    }
  }

  /**
   * Wait for the current batch to be ready.
   * Returns a promise that resolves with the shuffled batch.
   */
  async waitForBatch(): Promise<T[]> {
    if (this.batch.length >= this.minBatchSize) {
      return this.flush();
    }

    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  /**
   * Force flush the current batch.
   * Shuffles items before returning.
   */
  flush(): T[] {
    // Clear timeout
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    // Get and shuffle batch
    const items = secureShuffle(this.batch);
    this.batch = [];

    // Notify callback
    if (this.onBatchReady) {
      this.onBatchReady(items);
    }

    // Resolve waiting promise
    if (this.resolvePromise) {
      this.resolvePromise(items);
      this.resolvePromise = null;
      this.rejectPromise = null;
    }

    return items;
  }

  /**
   * Get current batch size.
   */
  get size(): number {
    return this.batch.length;
  }

  /**
   * Clear the batch without processing.
   */
  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.batch = [];

    if (this.rejectPromise) {
      this.rejectPromise(new Error('Batch cleared'));
      this.resolvePromise = null;
      this.rejectPromise = null;
    }
  }
}

// =============================================================================
// OPERATION WRAPPER
// =============================================================================

/**
 * Execute an operation with anti-correlation timing.
 *
 * 1. Waits a random delay before execution
 * 2. Optionally injects a dummy operation
 * 3. Executes the actual operation
 * 4. Waits a random delay after execution
 *
 * @param operation The operation to execute
 * @param options Timing options
 * @returns Result of the operation
 */
export async function withPrivacyTiming<T>(
  operation: () => Promise<T>,
  options: {
    preDelayMs?: number;
    postDelayMs?: number;
    injectDummy?: boolean;
    dummyOperation?: () => Promise<void>;
  } = {}
): Promise<T> {
  const {
    preDelayMs = MAX_RANDOM_DELAY_MS,
    postDelayMs = MAX_RANDOM_DELAY_MS / 2,
    injectDummy = false,
    dummyOperation,
  } = options;

  // Pre-operation delay
  if (preDelayMs > 0) {
    await randomDelayedSleep(preDelayMs);
  }

  // Optionally inject dummy operation
  if (injectDummy && shouldInjectDummy() && dummyOperation) {
    await dummyOperation();
  }

  // Execute actual operation
  const result = await operation();

  // Post-operation delay
  if (postDelayMs > 0) {
    await randomDelayedSleep(postDelayMs);
  }

  return result;
}

/**
 * Timing stats for monitoring and debugging.
 */
export interface TimingStats {
  totalDelay: number;
  preDelay: number;
  postDelay: number;
  operationTime: number;
  dummyInjected: boolean;
}

/**
 * Execute an operation with privacy timing and return detailed stats.
 */
export async function withPrivacyTimingStats<T>(
  operation: () => Promise<T>,
  options: {
    preDelayMs?: number;
    postDelayMs?: number;
    injectDummy?: boolean;
    dummyOperation?: () => Promise<void>;
  } = {}
): Promise<{ result: T; stats: TimingStats }> {
  const startTime = Date.now();
  const stats: TimingStats = {
    totalDelay: 0,
    preDelay: 0,
    postDelay: 0,
    operationTime: 0,
    dummyInjected: false,
  };

  const {
    preDelayMs = MAX_RANDOM_DELAY_MS,
    postDelayMs = MAX_RANDOM_DELAY_MS / 2,
    injectDummy = false,
    dummyOperation,
  } = options;

  // Pre-operation delay
  if (preDelayMs > 0) {
    stats.preDelay = await randomDelayedSleep(preDelayMs);
  }

  // Optionally inject dummy operation
  if (injectDummy && shouldInjectDummy() && dummyOperation) {
    stats.dummyInjected = true;
    await dummyOperation();
  }

  // Execute actual operation
  const opStart = Date.now();
  const result = await operation();
  stats.operationTime = Date.now() - opStart;

  // Post-operation delay
  if (postDelayMs > 0) {
    stats.postDelay = await randomDelayedSleep(postDelayMs);
  }

  stats.totalDelay = Date.now() - startTime - stats.operationTime;

  return { result, stats };
}
