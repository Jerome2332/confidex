/**
 * Order Cache Subscriber
 *
 * WebSocket-based order cache invalidation for real-time cache updates.
 * Subscribes to order account changes and invalidates/updates cache entries
 * when orders are modified on-chain.
 *
 * Features:
 * - WebSocket subscription to program accounts
 * - Automatic reconnection with exponential backoff
 * - Cache hit/miss metrics for Prometheus
 * - Batch account refresh on reconnection
 */

import { Connection, PublicKey, AccountInfo, Commitment } from '@solana/web3.js';
import { logger } from '../lib/logger.js';
import { Gauge, Counter } from 'prom-client';
import { metricsRegistry } from '../routes/metrics.js';

const log = logger.crank;

// V5 order account size (366 bytes)
const ORDER_ACCOUNT_SIZE_V5 = 366;

// Prometheus metrics for cache performance
export const orderCacheSize = new Gauge({
  name: 'confidex_order_cache_size',
  help: 'Current size of the order cache',
  registers: [metricsRegistry],
});

export const orderCacheHits = new Counter({
  name: 'confidex_order_cache_hits_total',
  help: 'Total number of order cache hits',
  registers: [metricsRegistry],
});

export const orderCacheMisses = new Counter({
  name: 'confidex_order_cache_misses_total',
  help: 'Total number of order cache misses',
  registers: [metricsRegistry],
});

export const orderCacheInvalidations = new Counter({
  name: 'confidex_order_cache_invalidations_total',
  help: 'Total number of order cache invalidations via WebSocket',
  labelNames: ['reason'], // 'update', 'delete', 'reconnect'
  registers: [metricsRegistry],
});

export const orderCacheSubscriptionStatus = new Gauge({
  name: 'confidex_order_cache_subscription_status',
  help: 'WebSocket subscription status (1 = connected, 0 = disconnected)',
  registers: [metricsRegistry],
});

export interface CachedOrder {
  data: Buffer;
  slot: number;
  cachedAt: number;
}

export interface OrderCacheSubscriberConfig {
  /** Maximum cache TTL in milliseconds (default: 60000) */
  maxTtlMs: number;
  /** Whether to use WebSocket subscription (default: true) */
  enableWebSocket: boolean;
  /** Commitment level for subscription (default: 'confirmed') */
  commitment: Commitment;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts: number;
  /** Base reconnection delay in ms (default: 1000) */
  reconnectDelayMs: number;
}

const DEFAULT_CONFIG: OrderCacheSubscriberConfig = {
  maxTtlMs: 60_000,
  enableWebSocket: true,
  commitment: 'confirmed',
  maxReconnectAttempts: 10,
  reconnectDelayMs: 1000,
};

export class OrderCacheSubscriber {
  private connection: Connection;
  private programId: PublicKey;
  private config: OrderCacheSubscriberConfig;

  // Cache: orderPda -> CachedOrder
  private cache: Map<string, CachedOrder> = new Map();

  // Subscription management
  private subscriptionId: number | null = null;
  private isSubscribed: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Callbacks for cache updates
  private onOrderUpdated: ((pda: PublicKey, data: Buffer | null) => void) | null = null;

  constructor(
    connection: Connection,
    programId: PublicKey,
    config: Partial<OrderCacheSubscriberConfig> = {}
  ) {
    this.connection = connection;
    this.programId = programId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the cache subscriber with WebSocket subscription
   */
  async start(): Promise<void> {
    if (this.isSubscribed) {
      log.warn('Order cache subscriber already started');
      return;
    }

    log.info(
      {
        programId: this.programId.toString(),
        enableWebSocket: this.config.enableWebSocket,
      },
      'Starting order cache subscriber'
    );

    if (this.config.enableWebSocket) {
      await this.subscribe();
    }
  }

  /**
   * Stop the cache subscriber
   */
  stop(): void {
    log.info('Stopping order cache subscriber');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.subscriptionId !== null) {
      this.connection
        .removeProgramAccountChangeListener(this.subscriptionId)
        .catch((err) => log.error({ err }, 'Error removing subscription'));
      this.subscriptionId = null;
    }

    this.isSubscribed = false;
    orderCacheSubscriptionStatus.set(0);
  }

  /**
   * Subscribe to program account changes
   */
  private async subscribe(): Promise<void> {
    try {
      this.subscriptionId = this.connection.onProgramAccountChange(
        this.programId,
        (accountInfo, context) => {
          this.handleAccountChange(accountInfo, context.slot);
        },
        {
          commitment: this.config.commitment,
          filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
        }
      );

      this.isSubscribed = true;
      this.reconnectAttempts = 0;
      orderCacheSubscriptionStatus.set(1);

      log.info(
        { subscriptionId: this.subscriptionId },
        'WebSocket subscription established'
      );
    } catch (error) {
      log.error({ error }, 'Failed to establish WebSocket subscription');
      this.scheduleReconnect();
    }
  }

  /**
   * Handle account change from WebSocket
   */
  private handleAccountChange(
    accountInfo: { accountId: PublicKey; accountInfo: AccountInfo<Buffer> },
    slot: number
  ): void {
    const pda = accountInfo.accountId.toString();
    const data = accountInfo.accountInfo.data;

    // Check if account was deleted (empty data)
    if (data.length === 0) {
      this.invalidate(pda, 'delete');
      return;
    }

    // Update cache with new data
    const existing = this.cache.get(pda);
    if (existing && existing.slot >= slot) {
      // Ignore older updates
      return;
    }

    this.cache.set(pda, {
      data,
      slot,
      cachedAt: Date.now(),
    });

    orderCacheInvalidations.inc({ reason: 'update' });
    orderCacheSize.set(this.cache.size);

    log.debug({ pda: pda.slice(0, 12), slot }, 'Order cache updated via WebSocket');

    // Notify callback if registered
    if (this.onOrderUpdated) {
      this.onOrderUpdated(accountInfo.accountId, data);
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      log.error(
        { attempts: this.reconnectAttempts },
        'Max reconnection attempts reached, giving up'
      );
      return;
    }

    const delay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    log.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Scheduling reconnection'
    );

    this.reconnectTimer = setTimeout(async () => {
      await this.subscribe();

      // Invalidate entire cache on reconnect as we may have missed updates
      this.invalidateAll('reconnect');
    }, delay);
  }

  /**
   * Get cached order data
   */
  get(pda: string): CachedOrder | null {
    const cached = this.cache.get(pda);

    if (!cached) {
      orderCacheMisses.inc();
      return null;
    }

    // Check TTL
    if (Date.now() - cached.cachedAt > this.config.maxTtlMs) {
      this.cache.delete(pda);
      orderCacheSize.set(this.cache.size);
      orderCacheMisses.inc();
      return null;
    }

    orderCacheHits.inc();
    return cached;
  }

  /**
   * Set cache entry (used when fetching from RPC)
   */
  set(pda: string, data: Buffer, slot: number): void {
    const existing = this.cache.get(pda);
    if (existing && existing.slot >= slot) {
      // Don't overwrite with older data
      return;
    }

    this.cache.set(pda, {
      data,
      slot,
      cachedAt: Date.now(),
    });
    orderCacheSize.set(this.cache.size);
  }

  /**
   * Invalidate a cache entry
   */
  invalidate(pda: string, reason: 'update' | 'delete' | 'reconnect' = 'update'): void {
    if (this.cache.delete(pda)) {
      orderCacheInvalidations.inc({ reason });
      orderCacheSize.set(this.cache.size);

      log.debug({ pda: pda.slice(0, 12), reason }, 'Order cache entry invalidated');

      // Notify callback for deletions
      if (reason === 'delete' && this.onOrderUpdated) {
        this.onOrderUpdated(new PublicKey(pda), null);
      }
    }
  }

  /**
   * Invalidate all cache entries
   */
  invalidateAll(reason: 'update' | 'delete' | 'reconnect' = 'reconnect'): void {
    const count = this.cache.size;
    this.cache.clear();
    orderCacheSize.set(0);

    // Record as single invalidation event
    orderCacheInvalidations.inc({ reason });

    log.info({ count, reason }, 'Order cache cleared');
  }

  /**
   * Register callback for order updates
   */
  onUpdate(callback: (pda: PublicKey, data: Buffer | null) => void): void {
    this.onOrderUpdated = callback;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    isSubscribed: boolean;
    reconnectAttempts: number;
    oldestCachedAt: number | null;
    newestCachedAt: number | null;
  } {
    let oldestCachedAt: number | null = null;
    let newestCachedAt: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldestCachedAt === null || entry.cachedAt < oldestCachedAt) {
        oldestCachedAt = entry.cachedAt;
      }
      if (newestCachedAt === null || entry.cachedAt > newestCachedAt) {
        newestCachedAt = entry.cachedAt;
      }
    }

    return {
      size: this.cache.size,
      isSubscribed: this.isSubscribed,
      reconnectAttempts: this.reconnectAttempts,
      oldestCachedAt,
      newestCachedAt,
    };
  }

  /**
   * Check if subscription is active
   */
  isActive(): boolean {
    return this.isSubscribed;
  }
}

/**
 * Create order cache subscriber from environment
 */
export function createOrderCacheSubscriberFromEnv(
  connection: Connection,
  programId: PublicKey
): OrderCacheSubscriber {
  const config: Partial<OrderCacheSubscriberConfig> = {
    maxTtlMs: parseInt(process.env.ORDER_CACHE_TTL_MS || '60000', 10),
    enableWebSocket: process.env.ORDER_CACHE_WEBSOCKET !== 'false',
    commitment: (process.env.ORDER_CACHE_COMMITMENT as Commitment) || 'confirmed',
    maxReconnectAttempts: parseInt(
      process.env.ORDER_CACHE_MAX_RECONNECTS || '10',
      10
    ),
    reconnectDelayMs: parseInt(process.env.ORDER_CACHE_RECONNECT_DELAY_MS || '1000', 10),
  };

  return new OrderCacheSubscriber(connection, programId, config);
}
