/**
 * TimescaleDB Client
 *
 * Manages connection pool and provides typed query methods for analytics.
 */

import { Pool, QueryResult, QueryResultRow } from 'pg';
import { createLogger } from '../lib/logger.js';
import type { AnalyticsConfig } from './types.js';
import type {
  ExchangeSnapshot,
  PerpMarketSnapshot,
  OrderEventRecord,
  TradeEventRecord,
  LiquidationEventRecord,
  FundingRateRecord,
  HourlyActivityBucket,
} from './types.js';

const log = createLogger('timescale');

// =============================================================================
// TimescaleDB Client
// =============================================================================

export class TimescaleClient {
  private pool: Pool;
  private isConnected = false;

  constructor(private config: AnalyticsConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.poolSize,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      idleTimeoutMillis: config.idleTimeoutMs,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      log.error({ error: err.message }, 'TimescaleDB pool error');
    });
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Initialize connection and verify database
   */
  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();

      // Verify TimescaleDB extension
      const result = await client.query(
        "SELECT extname FROM pg_extension WHERE extname = 'timescaledb'"
      );

      if (result.rows.length === 0) {
        log.warn('TimescaleDB extension not found, some features may not work');
      }

      client.release();
      this.isConnected = true;
      log.info('TimescaleDB client connected');
    } catch (error) {
      log.error({ error }, 'Failed to connect to TimescaleDB');
      throw error;
    }
  }

  /**
   * Close all connections
   */
  async disconnect(): Promise<void> {
    await this.pool.end();
    this.isConnected = false;
    log.info('TimescaleDB client disconnected');
  }

  /**
   * Execute a query with logging
   */
  private async query<T extends QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();

    try {
      const result = await this.pool.query<T>(sql, params);

      if (this.config.logQueries) {
        log.debug(
          {
            sql: sql.slice(0, 100),
            duration: Date.now() - start,
            rows: result.rowCount,
          },
          'Query executed'
        );
      }

      return result;
    } catch (error) {
      log.error(
        {
          sql: sql.slice(0, 100),
          error: (error as Error).message,
          duration: Date.now() - start,
        },
        'Query failed'
      );
      throw error;
    }
  }

  // ===========================================================================
  // Exchange Snapshots
  // ===========================================================================

  /**
   * Insert exchange snapshot
   */
  async insertExchangeSnapshot(snapshot: ExchangeSnapshot): Promise<void> {
    await this.query(
      `INSERT INTO exchange_snapshots (time, pair_count, order_count, position_count, market_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (time) DO UPDATE SET
         pair_count = EXCLUDED.pair_count,
         order_count = EXCLUDED.order_count,
         position_count = EXCLUDED.position_count,
         market_count = EXCLUDED.market_count`,
      [
        snapshot.time,
        snapshot.pairCount,
        snapshot.orderCount,
        snapshot.positionCount,
        snapshot.marketCount,
      ]
    );
  }

  /**
   * Get latest exchange snapshot
   */
  async getLatestExchangeSnapshot(): Promise<ExchangeSnapshot | null> {
    const result = await this.query<{
      time: Date;
      pair_count: string;
      order_count: string;
      position_count: string;
      market_count: string;
    }>(
      `SELECT time, pair_count, order_count, position_count, market_count
       FROM exchange_snapshots
       ORDER BY time DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      time: row.time,
      pairCount: parseInt(row.pair_count, 10),
      orderCount: parseInt(row.order_count, 10),
      positionCount: parseInt(row.position_count, 10),
      marketCount: parseInt(row.market_count, 10),
    };
  }

  // ===========================================================================
  // Order Events
  // ===========================================================================

  /**
   * Insert order event
   */
  async insertOrderEvent(event: OrderEventRecord): Promise<void> {
    await this.query(
      `INSERT INTO order_events (time, event_type, signature, order_id, maker, pair, side, slot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (time, signature) DO NOTHING`,
      [
        event.time,
        event.eventType,
        event.signature,
        event.orderId,
        event.maker,
        event.pair,
        event.side,
        event.slot ?? null,
      ]
    );
  }

  /**
   * Get order activity for a pair
   */
  async getOrderActivity(
    pair: string,
    hours: number = 24
  ): Promise<{
    placed: number;
    matched: number;
    cancelled: number;
    uniqueTraders: number;
  }> {
    // Validate hours to prevent injection (must be positive integer)
    const safeHours = Math.max(1, Math.min(Math.floor(hours), 8760)); // Max 1 year

    const result = await this.query<{
      placed: string;
      matched: string;
      cancelled: string;
      unique_traders: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'placed') as placed,
         COUNT(*) FILTER (WHERE event_type = 'matched') as matched,
         COUNT(*) FILTER (WHERE event_type = 'cancelled') as cancelled,
         COUNT(DISTINCT maker) as unique_traders
       FROM order_events
       WHERE pair = $1 AND time > NOW() - ($2 || ' hours')::INTERVAL`,
      [pair, safeHours.toString()]
    );

    const row = result.rows[0] || { placed: '0', matched: '0', cancelled: '0', unique_traders: '0' };
    return {
      placed: parseInt(row.placed, 10),
      matched: parseInt(row.matched, 10),
      cancelled: parseInt(row.cancelled, 10),
      uniqueTraders: parseInt(row.unique_traders, 10),
    };
  }

  /**
   * Get global order activity
   */
  async getGlobalOrderActivity(hours: number = 24): Promise<{
    placed: number;
    filled: number;
    uniqueTraders: number;
  }> {
    // Validate hours to prevent injection (must be positive integer)
    const safeHours = Math.max(1, Math.min(Math.floor(hours), 8760)); // Max 1 year

    const result = await this.query<{
      placed: string;
      filled: string;
      unique_traders: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'placed') as placed,
         COUNT(*) FILTER (WHERE event_type IN ('matched', 'filled')) as filled,
         COUNT(DISTINCT maker) as unique_traders
       FROM order_events
       WHERE time > NOW() - ($1 || ' hours')::INTERVAL`,
      [safeHours.toString()]
    );

    const row = result.rows[0] || { placed: '0', filled: '0', unique_traders: '0' };
    return {
      placed: parseInt(row.placed, 10),
      filled: parseInt(row.filled, 10),
      uniqueTraders: parseInt(row.unique_traders, 10),
    };
  }

  // ===========================================================================
  // Trade Events
  // ===========================================================================

  /**
   * Insert trade event
   */
  async insertTradeEvent(event: TradeEventRecord): Promise<void> {
    await this.query(
      `INSERT INTO trade_events (time, signature, buy_order_id, sell_order_id, buyer, seller, pair, slot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (time, signature) DO NOTHING`,
      [
        event.time,
        event.signature,
        event.buyOrderId,
        event.sellOrderId,
        event.buyer,
        event.seller,
        event.pair,
        event.slot ?? null,
      ]
    );
  }

  // ===========================================================================
  // Perp Market Snapshots
  // ===========================================================================

  /**
   * Insert perp market snapshot
   */
  async insertPerpMarketSnapshot(snapshot: PerpMarketSnapshot): Promise<void> {
    await this.query(
      `INSERT INTO perp_market_snapshots
         (time, market_address, total_long_oi, total_short_oi, position_count,
          long_position_count, short_position_count, current_funding_rate_bps, mark_price_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (time, market_address) DO UPDATE SET
         total_long_oi = EXCLUDED.total_long_oi,
         total_short_oi = EXCLUDED.total_short_oi,
         position_count = EXCLUDED.position_count,
         long_position_count = EXCLUDED.long_position_count,
         short_position_count = EXCLUDED.short_position_count,
         current_funding_rate_bps = EXCLUDED.current_funding_rate_bps,
         mark_price_usd = EXCLUDED.mark_price_usd`,
      [
        snapshot.time,
        snapshot.marketAddress,
        snapshot.totalLongOi.toString(),
        snapshot.totalShortOi.toString(),
        snapshot.positionCount,
        snapshot.longPositionCount,
        snapshot.shortPositionCount,
        snapshot.currentFundingRateBps,
        snapshot.markPriceUsd?.toString() ?? null,
      ]
    );
  }

  /**
   * Get latest perp market snapshot
   */
  async getLatestPerpMarketSnapshot(market: string): Promise<PerpMarketSnapshot | null> {
    const result = await this.query<{
      time: Date;
      market_address: string;
      total_long_oi: string;
      total_short_oi: string;
      position_count: number;
      long_position_count: number;
      short_position_count: number;
      current_funding_rate_bps: number | null;
      mark_price_usd: string | null;
    }>(
      `SELECT * FROM perp_market_snapshots
       WHERE market_address = $1
       ORDER BY time DESC
       LIMIT 1`,
      [market]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      time: row.time,
      marketAddress: row.market_address,
      totalLongOi: BigInt(row.total_long_oi),
      totalShortOi: BigInt(row.total_short_oi),
      positionCount: row.position_count,
      longPositionCount: row.long_position_count,
      shortPositionCount: row.short_position_count,
      currentFundingRateBps: row.current_funding_rate_bps,
      markPriceUsd: row.mark_price_usd ? BigInt(row.mark_price_usd) : null,
    };
  }

  /**
   * Get all markets with latest snapshots
   */
  async getAllPerpMarkets(): Promise<PerpMarketSnapshot[]> {
    const result = await this.query<{
      time: Date;
      market_address: string;
      total_long_oi: string;
      total_short_oi: string;
      position_count: number;
      long_position_count: number;
      short_position_count: number;
      current_funding_rate_bps: number | null;
      mark_price_usd: string | null;
    }>(
      `SELECT DISTINCT ON (market_address)
         time, market_address, total_long_oi, total_short_oi, position_count,
         long_position_count, short_position_count, current_funding_rate_bps, mark_price_usd
       FROM perp_market_snapshots
       ORDER BY market_address, time DESC`
    );

    return result.rows.map((row) => ({
      time: row.time,
      marketAddress: row.market_address,
      totalLongOi: BigInt(row.total_long_oi),
      totalShortOi: BigInt(row.total_short_oi),
      positionCount: row.position_count,
      longPositionCount: row.long_position_count,
      shortPositionCount: row.short_position_count,
      currentFundingRateBps: row.current_funding_rate_bps,
      markPriceUsd: row.mark_price_usd ? BigInt(row.mark_price_usd) : null,
    }));
  }

  // ===========================================================================
  // Liquidation Events
  // ===========================================================================

  /**
   * Insert liquidation event
   */
  async insertLiquidationEvent(event: LiquidationEventRecord): Promise<void> {
    await this.query(
      `INSERT INTO liquidation_events
         (time, signature, position_id, market, side, owner, liquidator, event_type, slot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (time, position_id, event_type) DO NOTHING`,
      [
        event.time,
        event.signature,
        event.positionId,
        event.market,
        event.side,
        event.owner,
        event.liquidator,
        event.eventType,
        event.slot ?? null,
      ]
    );
  }

  /**
   * Get liquidation stats
   */
  async getLiquidationStats(hours: number = 24): Promise<{
    detected: number;
    executed: number;
    failed: number;
  }> {
    // Validate hours to prevent injection (must be positive integer)
    const safeHours = Math.max(1, Math.min(Math.floor(hours), 8760)); // Max 1 year

    const result = await this.query<{
      detected: string;
      executed: string;
      failed: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'detected') as detected,
         COUNT(*) FILTER (WHERE event_type = 'executed') as executed,
         COUNT(*) FILTER (WHERE event_type = 'failed') as failed
       FROM liquidation_events
       WHERE time > NOW() - ($1 || ' hours')::INTERVAL`,
      [safeHours.toString()]
    );

    const row = result.rows[0] || { detected: '0', executed: '0', failed: '0' };
    return {
      detected: parseInt(row.detected, 10),
      executed: parseInt(row.executed, 10),
      failed: parseInt(row.failed, 10),
    };
  }

  /**
   * Get recent liquidations
   */
  async getRecentLiquidations(limit: number = 50): Promise<LiquidationEventRecord[]> {
    const result = await this.query<{
      time: Date;
      signature: string | null;
      position_id: string;
      market: string;
      side: string;
      owner: string;
      liquidator: string | null;
      event_type: string;
      slot: string | null;
    }>(
      `SELECT time, signature, position_id, market, side, owner, liquidator, event_type, slot
       FROM liquidation_events
       ORDER BY time DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      time: row.time,
      signature: row.signature,
      positionId: row.position_id,
      market: row.market,
      side: row.side as 'long' | 'short',
      owner: row.owner,
      liquidator: row.liquidator,
      eventType: row.event_type as 'detected' | 'executed' | 'failed',
      slot: row.slot ? parseInt(row.slot, 10) : undefined,
    }));
  }

  // ===========================================================================
  // Continuous Aggregates
  // ===========================================================================

  /**
   * Get hourly activity from continuous aggregate
   */
  async getHourlyActivity(
    pair: string,
    hours: number = 24
  ): Promise<HourlyActivityBucket[]> {
    // Validate hours to prevent injection (must be positive integer)
    const safeHours = Math.max(1, Math.min(Math.floor(hours), 8760)); // Max 1 year

    const result = await this.query<{
      bucket: Date;
      pair: string;
      orders_placed: string;
      orders_matched: string;
      orders_cancelled: string;
      unique_traders: string;
    }>(
      `SELECT bucket, pair, orders_placed, orders_matched, orders_cancelled, unique_traders
       FROM hourly_trading_activity
       WHERE pair = $1 AND bucket > NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY bucket DESC`,
      [pair, safeHours.toString()]
    );

    return result.rows.map((row) => ({
      bucket: row.bucket,
      pair: row.pair,
      ordersPlaced: parseInt(row.orders_placed, 10),
      ordersMatched: parseInt(row.orders_matched, 10),
      ordersCancelled: parseInt(row.orders_cancelled, 10),
      uniqueTraders: parseInt(row.unique_traders, 10),
    }));
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /**
   * Check database health
   */
  async healthCheck(): Promise<{
    connected: boolean;
    latencyMs: number;
    poolSize: number;
    idleConnections: number;
  }> {
    const start = Date.now();

    try {
      await this.pool.query('SELECT 1');

      return {
        connected: true,
        latencyMs: Date.now() - start,
        poolSize: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
      };
    } catch {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        poolSize: 0,
        idleConnections: 0,
      };
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a TimescaleDB client instance
 */
export function createTimescaleClient(config: AnalyticsConfig): TimescaleClient {
  return new TimescaleClient(config);
}
