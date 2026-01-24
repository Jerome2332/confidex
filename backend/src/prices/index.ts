/**
 * Prices Module
 *
 * Provides Pyth Network price streaming and caching for the Confidex DEX.
 */

// Configuration
export { loadPriceConfig, parsePriceFeedsFromEnv, PYTH_FEED_IDS, DEFAULT_PRICE_FEEDS } from './config.js';
export type { PriceConfig } from './config.js';

// Pyth Client
export { PythHermesClient, createPythClient } from './pyth-hermes-client.js';

// Price Cache
export { PriceCache, initPriceCache, getPriceCache } from './price-cache.js';

// Types
export type {
  PriceData,
  PriceFeedConfig,
  PriceWithMeta,
  PythSSEMessage,
  PythPriceUpdate,
  PriceUpdateCallback,
  ConnectionStatusCallback,
} from './types.js';

export { isPythSSEMessage, isPythPriceUpdate } from './types.js';
