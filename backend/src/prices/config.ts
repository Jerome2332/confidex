/**
 * Price feed configuration
 */

import { z } from 'zod';
import type { PriceFeedConfig } from './types.js';
import { PYTH_FEED_IDS, DEFAULT_PRICE_FEEDS } from './types.js';

// =============================================================================
// Configuration Schema
// =============================================================================

const PriceConfigSchema = z.object({
  enabled: z.boolean().default(false),

  // Pyth Hermes configuration
  hermes: z.object({
    url: z.string().url().default('https://hermes.pyth.network'),
    streamEndpoint: z.string().default('/v2/updates/price/stream'),
    reconnectDelayMs: z.number().int().positive().default(5000),
    maxReconnectAttempts: z.number().int().min(0).default(10),
    connectionTimeoutMs: z.number().int().positive().default(30000),
  }),

  // Price validation
  validation: z.object({
    maxStalenessMs: z.number().int().positive().default(30000), // 30 seconds
    minConfidenceRatio: z.number().positive().default(0.01), // 1% max confidence interval
  }),

  // Price broadcasting
  broadcast: z.object({
    enabled: z.boolean().default(true),
    throttleMs: z.number().int().min(0).default(100), // Throttle broadcasts
  }),
});

export type PriceConfig = z.infer<typeof PriceConfigSchema>;

// =============================================================================
// Configuration Loader
// =============================================================================

/**
 * Load price feed configuration from environment variables
 */
export function loadPriceConfig(): PriceConfig {
  const rawConfig = {
    enabled: process.env.PRICE_STREAMING_ENABLED === 'true',

    hermes: {
      url: process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network',
      streamEndpoint: process.env.PYTH_STREAM_ENDPOINT || '/v2/updates/price/stream',
      reconnectDelayMs: parseInt(process.env.PYTH_RECONNECT_DELAY_MS || '5000', 10),
      maxReconnectAttempts: parseInt(process.env.PYTH_MAX_RECONNECT_ATTEMPTS || '10', 10),
      connectionTimeoutMs: parseInt(process.env.PYTH_CONNECTION_TIMEOUT_MS || '30000', 10),
    },

    validation: {
      maxStalenessMs: parseInt(process.env.PRICE_MAX_STALENESS_MS || '30000', 10),
      minConfidenceRatio: parseFloat(process.env.PRICE_MIN_CONFIDENCE_RATIO || '0.01'),
    },

    broadcast: {
      enabled: process.env.PRICE_BROADCAST_ENABLED !== 'false',
      throttleMs: parseInt(process.env.PRICE_BROADCAST_THROTTLE_MS || '100', 10),
    },
  };

  return PriceConfigSchema.parse(rawConfig);
}

// =============================================================================
// Feed Configuration Helpers
// =============================================================================

/**
 * Parse price feeds from environment variable
 * Format: "SOL_USD,BTC_USD,ETH_USD" or custom "feedId:symbol,feedId:symbol"
 */
export function parsePriceFeedsFromEnv(): PriceFeedConfig[] {
  const feedsEnv = process.env.PRICE_FEEDS;

  if (!feedsEnv) {
    return DEFAULT_PRICE_FEEDS;
  }

  const feeds: PriceFeedConfig[] = [];

  for (const entry of feedsEnv.split(',')) {
    const trimmed = entry.trim();

    // Check if it's a known feed alias (e.g., "SOL_USD")
    if (trimmed in PYTH_FEED_IDS) {
      const feedId = PYTH_FEED_IDS[trimmed as keyof typeof PYTH_FEED_IDS];
      feeds.push({
        feedId,
        symbol: trimmed.replace('_', '/'),
      });
      continue;
    }

    // Check if it's a custom format (feedId:symbol)
    if (trimmed.includes(':')) {
      const [feedId, symbol] = trimmed.split(':');
      if (feedId && symbol) {
        feeds.push({ feedId: feedId.trim(), symbol: symbol.trim() });
      }
      continue;
    }

    // Try to match against known feed IDs by symbol
    const symbolKey = trimmed.toUpperCase().replace('/', '_');
    if (symbolKey in PYTH_FEED_IDS) {
      const feedId = PYTH_FEED_IDS[symbolKey as keyof typeof PYTH_FEED_IDS];
      feeds.push({
        feedId,
        symbol: trimmed.includes('/') ? trimmed : trimmed.replace('_', '/'),
      });
    }
  }

  return feeds.length > 0 ? feeds : DEFAULT_PRICE_FEEDS;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_PRICE_CONFIG: PriceConfig = {
  enabled: false,
  hermes: {
    url: 'https://hermes.pyth.network',
    streamEndpoint: '/v2/updates/price/stream',
    reconnectDelayMs: 5000,
    maxReconnectAttempts: 10,
    connectionTimeoutMs: 30000,
  },
  validation: {
    maxStalenessMs: 30000,
    minConfidenceRatio: 0.01,
  },
  broadcast: {
    enabled: true,
    throttleMs: 100,
  },
};

// Re-export feed IDs for convenience
export { PYTH_FEED_IDS, DEFAULT_PRICE_FEEDS };
