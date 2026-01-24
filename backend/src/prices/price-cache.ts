/**
 * Price Cache Service
 *
 * Centralized price caching with staleness tracking and event emission.
 * Integrates with the event broadcaster for real-time price updates.
 */

import { createLogger } from '../lib/logger.js';
import type { EventBroadcaster } from '../streaming/event-broadcaster.js';
import type { PriceData, PriceFeedConfig, PriceWithMeta } from './types.js';

const log = createLogger('price-cache');

// =============================================================================
// Price Cache
// =============================================================================

export class PriceCache {
  private cache: Map<string, PriceWithMeta> = new Map();
  private feedSymbols: Map<string, string> = new Map();
  private lastBroadcast: Map<string, number> = new Map();
  private broadcaster: EventBroadcaster | null = null;
  private broadcastThrottleMs: number;

  constructor(
    feeds: PriceFeedConfig[],
    options: {
      broadcaster?: EventBroadcaster;
      broadcastThrottleMs?: number;
    } = {}
  ) {
    // Build feed ID to symbol mapping
    for (const feed of feeds) {
      this.feedSymbols.set(feed.feedId, feed.symbol);
    }

    this.broadcaster = options.broadcaster ?? null;
    this.broadcastThrottleMs = options.broadcastThrottleMs ?? 100;
  }

  /**
   * Set the event broadcaster (can be set after construction)
   */
  setBroadcaster(broadcaster: EventBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /**
   * Update a price in the cache
   */
  update(feedId: string, price: PriceData, maxStalenessMs: number = 30000): void {
    const symbol = this.feedSymbols.get(feedId);
    if (!symbol) {
      log.warn({ feedId }, 'Unknown feed ID in price update');
      return;
    }

    const now = Date.now();
    const isStale = now - price.publishTime > maxStalenessMs;

    const priceWithMeta: PriceWithMeta = {
      feedId,
      symbol,
      data: price,
      receivedAt: now,
      isStale,
    };

    this.cache.set(feedId, priceWithMeta);

    // Broadcast price update (throttled)
    if (this.broadcaster && !isStale) {
      const lastBroadcastTime = this.lastBroadcast.get(feedId) ?? 0;
      if (now - lastBroadcastTime >= this.broadcastThrottleMs) {
        this.broadcaster.priceUpdate({
          feedId,
          symbol,
          price: price.price.toString(),
          confidence: price.conf.toString(),
          publishTime: price.publishTime,
        });
        this.lastBroadcast.set(feedId, now);
      }
    }
  }

  /**
   * Get price by feed ID
   */
  get(feedId: string): PriceWithMeta | null {
    return this.cache.get(feedId) ?? null;
  }

  /**
   * Get price by symbol
   */
  getBySymbol(symbol: string): PriceWithMeta | null {
    for (const [feedId, sym] of this.feedSymbols.entries()) {
      if (sym === symbol) {
        return this.cache.get(feedId) ?? null;
      }
    }
    return null;
  }

  /**
   * Get price data only (without metadata)
   */
  getPriceData(feedId: string): PriceData | null {
    const cached = this.cache.get(feedId);
    return cached?.data ?? null;
  }

  /**
   * Get all cached prices
   */
  getAll(): Map<string, PriceWithMeta> {
    return new Map(this.cache);
  }

  /**
   * Check if a price is stale
   */
  isStale(feedId: string, maxStalenessMs: number = 30000): boolean {
    const cached = this.cache.get(feedId);
    if (!cached) return true;

    return Date.now() - cached.data.publishTime > maxStalenessMs;
  }

  /**
   * Get price as u64 for on-chain comparisons
   */
  getPriceAsU64(feedId: string, decimals: number = 6): bigint | null {
    const cached = this.cache.get(feedId);
    if (!cached || cached.isStale) return null;

    const price = cached.data;
    const adjustedExpo = decimals + price.expo;

    if (adjustedExpo >= 0) {
      return price.price * BigInt(10 ** adjustedExpo);
    } else {
      return price.price / BigInt(10 ** -adjustedExpo);
    }
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.lastBroadcast.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalPrices: number;
    stalePrices: number;
    freshPrices: number;
    oldestPriceAge: number;
  } {
    const now = Date.now();
    let stalePrices = 0;
    let oldestAge = 0;

    for (const cached of this.cache.values()) {
      const age = now - cached.data.publishTime;
      if (cached.isStale) {
        stalePrices++;
      }
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      totalPrices: this.cache.size,
      stalePrices,
      freshPrices: this.cache.size - stalePrices,
      oldestPriceAge: oldestAge,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalPriceCache: PriceCache | null = null;

/**
 * Initialize the global price cache
 */
export function initPriceCache(
  feeds: PriceFeedConfig[],
  options?: {
    broadcaster?: EventBroadcaster;
    broadcastThrottleMs?: number;
  }
): PriceCache {
  globalPriceCache = new PriceCache(feeds, options);
  return globalPriceCache;
}

/**
 * Get the global price cache instance
 */
export function getPriceCache(): PriceCache | null {
  return globalPriceCache;
}
