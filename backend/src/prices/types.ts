/**
 * Price feed types for Pyth Network integration
 */

// =============================================================================
// Price Data Types
// =============================================================================

/**
 * Parsed price data from Pyth oracle
 */
export interface PriceData {
  /** Price as a bigint (scaled by 10^expo) */
  readonly price: bigint;
  /** Confidence interval as a bigint */
  readonly conf: bigint;
  /** Price exponent (usually negative, e.g., -8 means 8 decimal places) */
  readonly expo: number;
  /** Publish time in milliseconds */
  readonly publishTime: number;
  /** EMA (exponential moving average) price */
  readonly emaPrice: bigint;
  /** EMA confidence */
  readonly emaConf: bigint;
}

/**
 * Price feed configuration
 */
export interface PriceFeedConfig {
  /** Pyth price feed ID (hex string without 0x prefix) */
  readonly feedId: string;
  /** Human-readable symbol (e.g., 'SOL/USD') */
  readonly symbol: string;
  /** Optional: custom staleness threshold in ms */
  readonly maxStalenessMs?: number;
}

/**
 * Price with metadata
 */
export interface PriceWithMeta {
  readonly feedId: string;
  readonly symbol: string;
  readonly data: PriceData;
  readonly receivedAt: number;
  readonly isStale: boolean;
}

// =============================================================================
// Pyth SSE Response Types
// =============================================================================

/**
 * Raw price update from Pyth SSE stream
 */
export interface PythPriceUpdate {
  readonly id: string;
  readonly price: {
    readonly price: string;
    readonly conf: string;
    readonly expo: number;
    readonly publish_time: number;
  };
  readonly ema_price?: {
    readonly price: string;
    readonly conf: string;
    readonly expo: number;
    readonly publish_time: number;
  };
}

/**
 * Raw SSE message from Pyth Hermes
 */
export interface PythSSEMessage {
  readonly binary?: {
    readonly encoding: string;
    readonly data: string[];
  };
  readonly parsed?: PythPriceUpdate[];
}

// =============================================================================
// Client Events
// =============================================================================

/**
 * Price update callback
 */
export type PriceUpdateCallback = (feedId: string, price: PriceData) => void;

/**
 * Connection status callback
 */
export type ConnectionStatusCallback = (connected: boolean, error?: Error) => void;

// =============================================================================
// Known Price Feed IDs
// =============================================================================

/**
 * Common Pyth price feed IDs (mainnet)
 */
export const PYTH_FEED_IDS = {
  // Crypto
  SOL_USD: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC_USD: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH_USD: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  USDC_USD: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT_USD: '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',

  // Commodities
  GOLD_USD: '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',

  // Forex
  EUR_USD: 'a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b',
} as const;

/**
 * Default price feeds to subscribe to
 */
export const DEFAULT_PRICE_FEEDS: PriceFeedConfig[] = [
  { feedId: PYTH_FEED_IDS.SOL_USD, symbol: 'SOL/USD' },
  { feedId: PYTH_FEED_IDS.BTC_USD, symbol: 'BTC/USD' },
  { feedId: PYTH_FEED_IDS.ETH_USD, symbol: 'ETH/USD' },
];

// =============================================================================
// Type Guards
// =============================================================================

export function isPythSSEMessage(data: unknown): data is PythSSEMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  return Array.isArray(msg.parsed) || msg.binary !== undefined;
}

export function isPythPriceUpdate(data: unknown): data is PythPriceUpdate {
  if (typeof data !== 'object' || data === null) return false;
  const update = data as Record<string, unknown>;
  return typeof update.id === 'string' && typeof update.price === 'object';
}
