/**
 * Pyth Hermes SSE Client
 *
 * Connects to Pyth Network's Hermes service for real-time price streaming.
 * Uses Server-Sent Events (SSE) for efficient one-way price updates.
 *
 * Key features:
 * - Automatic reconnection with exponential backoff
 * - Price staleness detection
 * - In-memory price cache
 * - Event-driven price updates
 */

import { EventSource } from 'eventsource';
import { createLogger } from '../lib/logger.js';
import { withRetry } from '../lib/retry.js';
import type { PriceConfig } from './config.js';
import type {
  PriceData,
  PriceFeedConfig,
  PriceWithMeta,
  PythSSEMessage,
  PythPriceUpdate,
  PriceUpdateCallback,
  ConnectionStatusCallback,
} from './types.js';

const log = createLogger('pyth');

// =============================================================================
// Pyth Hermes Client
// =============================================================================

export class PythHermesClient {
  private eventSource: EventSource | null = null;
  private priceCache: Map<string, PriceWithMeta> = new Map();
  private feedSymbols: Map<string, string> = new Map();
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onPriceUpdate: PriceUpdateCallback | null = null;
  private onConnectionStatus: ConnectionStatusCallback | null = null;
  private isShuttingDown = false;

  constructor(
    private feeds: PriceFeedConfig[],
    private config: PriceConfig
  ) {
    // Build feed ID to symbol mapping
    for (const feed of feeds) {
      this.feedSymbols.set(feed.feedId, feed.symbol);
    }
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connect to Pyth Hermes SSE stream
   */
  async connect(
    onPriceUpdate?: PriceUpdateCallback,
    onConnectionStatus?: ConnectionStatusCallback
  ): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    this.onPriceUpdate = onPriceUpdate ?? null;
    this.onConnectionStatus = onConnectionStatus ?? null;

    const feedIds = this.feeds.map((f) => f.feedId);
    const url = this.buildStreamUrl(feedIds);

    log.info(
      {
        feedCount: this.feeds.length,
        feeds: this.feeds.map((f) => f.symbol),
        url: url.replace(/ids\[\]=.+/, 'ids[]=...'), // Truncate for logging
      },
      'Connecting to Pyth Hermes SSE'
    );

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          this.eventSource?.close();
          reject(new Error('Connection timeout'));
        }
      }, this.config.hermes.connectionTimeoutMs);

      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        log.info('Pyth Hermes SSE connected');
        this.onConnectionStatus?.(true);
        resolve();
      };

      this.eventSource.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.eventSource.onerror = (error) => {
        clearTimeout(connectionTimeout);
        const err = new Error('SSE connection error');
        log.error({ error }, 'Pyth Hermes SSE error');
        this.isConnected = false;
        this.onConnectionStatus?.(false, err);

        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }

        // Reject only on initial connection
        if (this.reconnectAttempts === 0) {
          reject(err);
        }
      };
    });
  }

  /**
   * Build the SSE stream URL with feed IDs
   */
  private buildStreamUrl(feedIds: string[]): string {
    const baseUrl = `${this.config.hermes.url}${this.config.hermes.streamEndpoint}`;
    const params = feedIds.map((id) => `ids[]=${id}`).join('&');
    return `${baseUrl}?${params}&parsed=true&allow_unordered=true&benchmarks_only=false`;
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isShuttingDown) return;

    if (this.reconnectAttempts >= this.config.hermes.maxReconnectAttempts) {
      log.error(
        { attempts: this.reconnectAttempts },
        'Max reconnection attempts reached, giving up'
      );
      return;
    }

    // Exponential backoff with jitter
    const baseDelay = this.config.hermes.reconnectDelayMs;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), 60000);
    const jitter = Math.random() * 1000;

    this.reconnectAttempts++;

    log.info(
      {
        attempt: this.reconnectAttempts,
        delayMs: Math.round(delay + jitter),
      },
      'Scheduling Pyth Hermes reconnection'
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.connect(this.onPriceUpdate ?? undefined, this.onConnectionStatus ?? undefined);
      } catch (error) {
        log.warn({ error }, 'Reconnection attempt failed');
        // Will trigger another reconnect via onerror handler
      }
    }, delay + jitter);
  }

  /**
   * Disconnect from Pyth Hermes
   */
  disconnect(): void {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnected = false;
    log.info('Pyth Hermes client disconnected');
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Handle incoming SSE message
   */
  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data) as PythSSEMessage;

      if (!parsed.parsed || parsed.parsed.length === 0) {
        return;
      }

      for (const update of parsed.parsed) {
        this.processPriceUpdate(update);
      }
    } catch (err) {
      log.warn({ error: err, data: data.slice(0, 100) }, 'Failed to parse Pyth SSE message');
    }
  }

  /**
   * Process a single price update
   */
  private processPriceUpdate(update: PythPriceUpdate): void {
    const feedId = update.id;
    const symbol = this.feedSymbols.get(feedId);

    if (!symbol) {
      // Ignore updates for feeds we're not tracking
      return;
    }

    const priceData: PriceData = {
      price: BigInt(update.price.price),
      conf: BigInt(update.price.conf),
      expo: update.price.expo,
      publishTime: update.price.publish_time * 1000, // Convert to ms
      emaPrice: update.ema_price ? BigInt(update.ema_price.price) : BigInt(0),
      emaConf: update.ema_price ? BigInt(update.ema_price.conf) : BigInt(0),
    };

    const now = Date.now();
    const isStale = now - priceData.publishTime > this.config.validation.maxStalenessMs;

    const priceWithMeta: PriceWithMeta = {
      feedId,
      symbol,
      data: priceData,
      receivedAt: now,
      isStale,
    };

    // Update cache
    this.priceCache.set(feedId, priceWithMeta);

    // Notify callback
    if (this.onPriceUpdate && !isStale) {
      this.onPriceUpdate(feedId, priceData);
    }

    log.trace(
      {
        symbol,
        price: this.formatPrice(priceData),
        stale: isStale,
      },
      'Price update received'
    );
  }

  // ===========================================================================
  // Price Access Methods
  // ===========================================================================

  /**
   * Get the latest price for a feed
   * Returns null if no price available or price is stale
   */
  getPrice(feedId: string): PriceData | null {
    const cached = this.priceCache.get(feedId);

    if (!cached) {
      return null;
    }

    // Check staleness
    const now = Date.now();
    const maxStaleness =
      this.feeds.find((f) => f.feedId === feedId)?.maxStalenessMs ??
      this.config.validation.maxStalenessMs;

    if (now - cached.data.publishTime > maxStaleness) {
      log.warn(
        {
          feedId,
          symbol: cached.symbol,
          age: now - cached.data.publishTime,
          maxStaleness,
        },
        'Stale price detected'
      );
      return null;
    }

    return cached.data;
  }

  /**
   * Get price with metadata
   */
  getPriceWithMeta(feedId: string): PriceWithMeta | null {
    return this.priceCache.get(feedId) ?? null;
  }

  /**
   * Get price by symbol (e.g., 'SOL/USD')
   */
  getPriceBySymbol(symbol: string): PriceData | null {
    for (const [feedId, sym] of this.feedSymbols.entries()) {
      if (sym === symbol) {
        return this.getPrice(feedId);
      }
    }
    return null;
  }

  /**
   * Convert price to u64 with specified decimal places
   * Useful for on-chain price comparisons
   */
  getPriceAsU64(feedId: string, decimals: number = 6): bigint | null {
    const price = this.getPrice(feedId);
    if (!price) return null;

    // Pyth prices have negative exponent, convert to target decimals
    // e.g., price = 123456789, expo = -8 means $1.23456789
    // To convert to 6 decimals: 123456789 * 10^(6 + (-8)) = 123456789 / 100 = 1234567
    const adjustedExpo = decimals + price.expo;

    if (adjustedExpo >= 0) {
      return price.price * BigInt(10 ** adjustedExpo);
    } else {
      return price.price / BigInt(10 ** -adjustedExpo);
    }
  }

  /**
   * Get all cached prices
   */
  getAllPrices(): Map<string, PriceWithMeta> {
    return new Map(this.priceCache);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Format price for logging/display
   */
  formatPrice(price: PriceData): string {
    const value = Number(price.price) * Math.pow(10, price.expo);
    return `$${value.toFixed(Math.abs(price.expo))}`;
  }

  /**
   * Check if client is connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get connection stats
   */
  getStats(): {
    connected: boolean;
    feedCount: number;
    cachedPriceCount: number;
    reconnectAttempts: number;
    stalePriceCount: number;
  } {
    const now = Date.now();
    let stalePriceCount = 0;

    for (const cached of this.priceCache.values()) {
      if (now - cached.data.publishTime > this.config.validation.maxStalenessMs) {
        stalePriceCount++;
      }
    }

    return {
      connected: this.isConnected,
      feedCount: this.feeds.length,
      cachedPriceCount: this.priceCache.size,
      reconnectAttempts: this.reconnectAttempts,
      stalePriceCount,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create and connect a Pyth Hermes client
 */
export async function createPythClient(
  feeds: PriceFeedConfig[],
  config: PriceConfig,
  onPriceUpdate?: PriceUpdateCallback,
  onConnectionStatus?: ConnectionStatusCallback
): Promise<PythHermesClient> {
  const client = new PythHermesClient(feeds, config);

  await withRetry(
    async () => {
      await client.connect(onPriceUpdate, onConnectionStatus);
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      isRetryable: (error: Error) => {
        // Retry on connection errors, not on configuration errors
        return error.message.includes('timeout') || error.message.includes('connection');
      },
    }
  );

  return client;
}
