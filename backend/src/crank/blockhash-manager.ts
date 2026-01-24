/**
 * Blockhash Manager
 *
 * Manages blockhash caching and pre-fetching for transaction submission.
 * Implements refresh strategy to ensure blockhashes are always fresh.
 */

import { Connection, Blockhash, BlockhashWithExpiryBlockHeight } from '@solana/web3.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../lib/timeout.js';
import { logger } from '../lib/logger.js';

const log = logger.crank;

export interface BlockhashManagerConfig {
  /** How often to refresh the blockhash (default: 30s = ~75 slots) */
  refreshIntervalMs?: number;
  /** Maximum age before considering blockhash stale (default: 60s) */
  maxAgeMs?: number;
  /** Number of blockhashes to pre-fetch (default: 2) */
  prefetchCount?: number;
  /** Timeout for getLatestBlockhash call (default: 5s) */
  fetchTimeoutMs?: number;
}

interface CachedBlockhash {
  blockhash: Blockhash;
  lastValidBlockHeight: number;
  fetchedAt: number;
  slot: number;
}

/**
 * Manages blockhash caching with automatic refresh
 */
export class BlockhashManager {
  private connection: Connection;
  private config: Required<BlockhashManagerConfig>;
  private cache: CachedBlockhash[] = [];
  private refreshTimer: NodeJS.Timeout | null = null;
  private currentSlot: number = 0;
  private isRefreshing: boolean = false;

  constructor(connection: Connection, config?: BlockhashManagerConfig) {
    this.connection = connection;
    this.config = {
      refreshIntervalMs: config?.refreshIntervalMs ?? 30_000,
      maxAgeMs: config?.maxAgeMs ?? 60_000,
      prefetchCount: config?.prefetchCount ?? 2,
      fetchTimeoutMs: config?.fetchTimeoutMs ?? 5_000,
    };
  }

  /**
   * Start automatic blockhash refresh
   */
  start(): void {
    if (this.refreshTimer) return;

    // Fetch initial blockhash
    this.refresh().catch((error) => {
      log.error({ error: error instanceof Error ? error.message : String(error) }, 'BlockhashManager initial fetch failed');
    });

    // Start refresh loop
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((error) => {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'BlockhashManager refresh failed');
      });
    }, this.config.refreshIntervalMs);

    log.info({ refreshIntervalMs: this.config.refreshIntervalMs }, 'BlockhashManager started');
  }

  /**
   * Stop automatic blockhash refresh
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      log.info('BlockhashManager stopped');
    }
  }

  /**
   * Refresh the blockhash cache
   */
  async refresh(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      // Fetch current slot
      const slot = await withTimeout(this.connection.getSlot(), {
        timeoutMs: this.config.fetchTimeoutMs,
        operation: 'get slot',
      });
      this.currentSlot = slot;

      // Fetch new blockhash
      const result = await withTimeout(
        this.connection.getLatestBlockhash('confirmed'),
        {
          timeoutMs: this.config.fetchTimeoutMs,
          operation: 'get blockhash',
        }
      );

      const cached: CachedBlockhash = {
        blockhash: result.blockhash,
        lastValidBlockHeight: result.lastValidBlockHeight,
        fetchedAt: Date.now(),
        slot,
      };

      // Add to cache (keep up to prefetchCount entries)
      this.cache.unshift(cached);
      if (this.cache.length > this.config.prefetchCount) {
        this.cache.pop();
      }

      // Remove stale entries
      this.pruneCache();

      log.debug({
        blockhash: result.blockhash.slice(0, 12),
        slot,
        validUntilHeight: result.lastValidBlockHeight,
      }, 'BlockhashManager refreshed blockhash');
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Remove stale entries from cache
   */
  private pruneCache(): void {
    const now = Date.now();
    this.cache = this.cache.filter((entry) => {
      const age = now - entry.fetchedAt;
      return age < this.config.maxAgeMs;
    });
  }

  /**
   * Get the freshest valid blockhash from cache
   */
  getCachedBlockhash(): BlockhashWithExpiryBlockHeight | null {
    this.pruneCache();

    if (this.cache.length === 0) {
      return null;
    }

    const entry = this.cache[0];
    return {
      blockhash: entry.blockhash,
      lastValidBlockHeight: entry.lastValidBlockHeight,
    };
  }

  /**
   * Get a blockhash, refreshing if necessary
   */
  async getBlockhash(forceRefresh = false): Promise<BlockhashWithExpiryBlockHeight> {
    if (forceRefresh) {
      await this.refresh();
    }

    const cached = this.getCachedBlockhash();
    if (cached) {
      return cached;
    }

    // Cache empty or stale, fetch new
    await this.refresh();

    const freshCached = this.getCachedBlockhash();
    if (!freshCached) {
      // Last resort: fetch directly
      return await withTimeout(
        this.connection.getLatestBlockhash('confirmed'),
        {
          timeoutMs: this.config.fetchTimeoutMs,
          operation: 'get blockhash (fallback)',
        }
      );
    }

    return freshCached;
  }

  /**
   * Get a blockhash with age guarantee
   */
  async getBlockhashWithMaxAge(maxAgeMs: number): Promise<BlockhashWithExpiryBlockHeight> {
    this.pruneCache();

    // Check if we have a fresh enough cached blockhash
    const now = Date.now();
    for (const entry of this.cache) {
      if (now - entry.fetchedAt <= maxAgeMs) {
        return {
          blockhash: entry.blockhash,
          lastValidBlockHeight: entry.lastValidBlockHeight,
        };
      }
    }

    // Need fresh blockhash
    await this.refresh();
    return this.getCachedBlockhash()!;
  }

  /**
   * Check if we have a valid cached blockhash
   */
  hasValidBlockhash(): boolean {
    this.pruneCache();
    return this.cache.length > 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    cacheSize: number;
    oldestAge: number | null;
    newestAge: number | null;
    currentSlot: number;
    isRefreshing: boolean;
  } {
    const now = Date.now();
    this.pruneCache();

    return {
      cacheSize: this.cache.length,
      oldestAge: this.cache.length > 0 ? now - this.cache[this.cache.length - 1].fetchedAt : null,
      newestAge: this.cache.length > 0 ? now - this.cache[0].fetchedAt : null,
      currentSlot: this.currentSlot,
      isRefreshing: this.isRefreshing,
    };
  }

  /**
   * Get the current slot
   */
  getCurrentSlot(): number {
    return this.currentSlot;
  }

  /**
   * Estimate remaining validity of a blockhash
   */
  estimateRemainingValidity(lastValidBlockHeight: number): {
    estimatedSlotsRemaining: number;
    estimatedMsRemaining: number;
    isLikelyValid: boolean;
  } {
    // Average slot time is ~400ms
    const SLOT_TIME_MS = 400;
    const currentHeight = this.currentSlot; // Approximation

    const slotsRemaining = lastValidBlockHeight - currentHeight;
    const msRemaining = slotsRemaining * SLOT_TIME_MS;

    return {
      estimatedSlotsRemaining: Math.max(0, slotsRemaining),
      estimatedMsRemaining: Math.max(0, msRemaining),
      isLikelyValid: slotsRemaining > 10, // Buffer of ~4 seconds
    };
  }

  /**
   * Wait for a fresher blockhash if current one is too old
   */
  async ensureFreshBlockhash(maxSlotAge = 150): Promise<BlockhashWithExpiryBlockHeight> {
    const cached = this.getCachedBlockhash();

    if (cached) {
      const validity = this.estimateRemainingValidity(cached.lastValidBlockHeight);
      if (validity.estimatedSlotsRemaining > maxSlotAge) {
        return cached;
      }
    }

    // Need fresher blockhash
    await this.refresh();
    return this.getCachedBlockhash()!;
  }
}

/**
 * Create a BlockhashManager from environment variables
 */
export function createBlockhashManagerFromEnv(connection: Connection): BlockhashManager {
  return new BlockhashManager(connection, {
    refreshIntervalMs: parseInt(process.env.BLOCKHASH_REFRESH_INTERVAL_MS || '30000', 10),
    maxAgeMs: parseInt(process.env.BLOCKHASH_MAX_AGE_MS || '60000', 10),
    prefetchCount: parseInt(process.env.BLOCKHASH_PREFETCH_COUNT || '2', 10),
    fetchTimeoutMs: parseInt(process.env.BLOCKHASH_FETCH_TIMEOUT_MS || '5000', 10),
  });
}
