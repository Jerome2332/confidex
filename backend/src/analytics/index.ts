/**
 * Analytics Module
 *
 * TimescaleDB-backed analytics for public metrics.
 * All data is PUBLIC - no encrypted fields are stored or returned.
 */

// Configuration
export { loadAnalyticsConfig, isAnalyticsEnabled, DEFAULT_ANALYTICS_CONFIG } from './config.js';

// Database Client
export { TimescaleClient, createTimescaleClient } from './timescale-client.js';

// REST API Routes
export { createAnalyticsRouter } from './routes.js';

// Types
export type {
  // Configuration
  AnalyticsConfig,
  // Database record types
  OrderEventRecord,
  TradeEventRecord,
  LiquidationEventRecord,
  FundingRateRecord,
  // Snapshot types
  ExchangeSnapshot,
  PerpMarketSnapshot,
  // Aggregation types
  HourlyActivityBucket,
  // API response types
  GlobalAnalyticsResponse,
  PairAnalyticsResponse,
  PerpMarketAnalyticsResponse,
  LiquidationAnalyticsResponse,
} from './types.js';
