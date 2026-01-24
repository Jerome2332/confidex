/**
 * Analytics types
 *
 * PRIVACY: All types here represent PUBLIC on-chain data only.
 * No encrypted fields should ever appear in analytics.
 */

// =============================================================================
// Configuration
// =============================================================================

export interface AnalyticsConfig {
  /** PostgreSQL/TimescaleDB connection URL */
  readonly databaseUrl: string;
  /** Connection pool size */
  readonly poolSize: number;
  /** Connection timeout in ms */
  readonly connectionTimeoutMs: number;
  /** Idle timeout in ms */
  readonly idleTimeoutMs: number;
  /** Enable query logging */
  readonly logQueries: boolean;
  /** Snapshot interval in ms */
  readonly snapshotIntervalMs: number;
}

// =============================================================================
// Snapshot Types
// =============================================================================

/**
 * Exchange-wide snapshot (global KPIs)
 */
export interface ExchangeSnapshot {
  readonly time: Date;
  readonly pairCount: number;
  readonly orderCount: number;
  readonly positionCount: number;
  readonly marketCount: number;
}

/**
 * Perpetual market snapshot
 */
export interface PerpMarketSnapshot {
  readonly time: Date;
  readonly marketAddress: string;
  readonly totalLongOi: bigint;
  readonly totalShortOi: bigint;
  readonly positionCount: number;
  readonly longPositionCount: number;
  readonly shortPositionCount: number;
  readonly currentFundingRateBps: number | null;
  readonly markPriceUsd: bigint | null;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Order event for analytics
 */
export interface OrderEventRecord {
  readonly time: Date;
  readonly eventType: 'placed' | 'cancelled' | 'matched' | 'filled';
  readonly signature: string;
  readonly orderId: string;
  readonly maker: string;
  readonly pair: string;
  readonly side: 'buy' | 'sell';
  readonly slot?: number;
}

/**
 * Trade event for analytics
 */
export interface TradeEventRecord {
  readonly time: Date;
  readonly signature: string;
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  readonly buyer: string;
  readonly seller: string;
  readonly pair: string;
  readonly slot?: number;
}

/**
 * Liquidation event for analytics
 */
export interface LiquidationEventRecord {
  readonly time: Date;
  readonly signature: string | null;
  readonly positionId: string;
  readonly market: string;
  readonly side: 'long' | 'short';
  readonly owner: string;
  readonly liquidator: string | null;
  readonly eventType: 'detected' | 'executed' | 'failed';
  readonly slot?: number;
}

/**
 * Funding rate history record
 */
export interface FundingRateRecord {
  readonly time: Date;
  readonly marketAddress: string;
  readonly fundingRateBps: number;
  readonly longOi: bigint | null;
  readonly shortOi: bigint | null;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Global analytics response
 */
export interface GlobalAnalyticsResponse {
  readonly exchange: {
    readonly pairCount: number;
    readonly orderCount: number;
    readonly positionCount: number;
    readonly marketCount: number;
  };
  readonly activity24h: {
    readonly ordersPlaced: number;
    readonly ordersFilled: number;
    readonly uniqueTraders: number;
  };
  readonly liquidations24h: {
    readonly detected: number;
    readonly executed: number;
    readonly failed: number;
  };
  readonly lastUpdated: string;
}

/**
 * Pair analytics response
 */
export interface PairAnalyticsResponse {
  readonly pair: string;
  readonly activity24h: {
    readonly ordersPlaced: number;
    readonly ordersFilled: number;
    readonly ordersCancelled: number;
    readonly uniqueTraders: number;
  };
  readonly activity1h: {
    readonly ordersPlaced: number;
    readonly ordersFilled: number;
  };
}

/**
 * Perp market analytics response
 */
export interface PerpMarketAnalyticsResponse {
  readonly marketAddress: string;
  readonly openInterest: {
    readonly totalLong: string; // BigInt as string
    readonly totalShort: string;
    readonly longShortRatio: number;
  };
  readonly positions: {
    readonly total: number;
    readonly long: number;
    readonly short: number;
  };
  readonly funding: {
    readonly currentRateBps: number | null;
    readonly lastUpdateTime: string | null;
  };
  readonly markPrice: string | null;
}

/**
 * Liquidation analytics response
 */
export interface LiquidationAnalyticsResponse {
  readonly recent: Array<{
    readonly timestamp: string;
    readonly market: string;
    readonly side: string;
    readonly eventType: string;
    readonly signature: string | null;
  }>;
  readonly stats24h: {
    readonly detected: number;
    readonly executed: number;
    readonly failed: number;
  };
  readonly statsTotal: {
    readonly executed: number;
  };
}

/**
 * Hourly activity aggregation
 */
export interface HourlyActivityBucket {
  readonly bucket: Date;
  readonly pair: string;
  readonly ordersPlaced: number;
  readonly ordersMatched: number;
  readonly ordersCancelled: number;
  readonly uniqueTraders: number;
}

// =============================================================================
// Query Parameters
// =============================================================================

export interface TimeRangeParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly limit?: number;
}

export interface PairQueryParams extends TimeRangeParams {
  readonly pair: string;
}

export interface MarketQueryParams extends TimeRangeParams {
  readonly market: string;
}
