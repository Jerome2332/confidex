/**
 * Analytics REST API Routes
 *
 * All endpoints return PUBLIC data only - no encrypted fields.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';
import { createCustomRateLimiter } from '../middleware/rate-limit.js';
import type { TimescaleClient } from './timescale-client.js';
import type {
  GlobalAnalyticsResponse,
  PairAnalyticsResponse,
  PerpMarketAnalyticsResponse,
  LiquidationAnalyticsResponse,
} from './types.js';

const log = createLogger('analytics-api');

// Analytics-specific rate limiter: 60 requests per minute per IP
// Lower than standard API because analytics queries can be expensive
const analyticsRateLimiter = createCustomRateLimiter(60, {
  message: 'Too many analytics requests. Please slow down.',
});

// =============================================================================
// Router Factory
// =============================================================================

/**
 * Create analytics router with injected TimescaleDB client
 */
export function createAnalyticsRouter(db: TimescaleClient): Router {
  const router = Router();

  // Apply rate limiting to all analytics routes
  router.use(analyticsRateLimiter);

  // Error handler wrapper
  const asyncHandler = (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ) => {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res, next).catch(next);
    };
  };

  // ===========================================================================
  // Global Analytics
  // ===========================================================================

  /**
   * GET /api/analytics/global
   * Returns exchange-wide metrics
   */
  router.get(
    '/global',
    asyncHandler(async (_req: Request, res: Response) => {
      const [snapshot, activity, liquidations] = await Promise.all([
        db.getLatestExchangeSnapshot(),
        db.getGlobalOrderActivity(24),
        db.getLiquidationStats(24),
      ]);

      const response: GlobalAnalyticsResponse = {
        exchange: {
          pairCount: snapshot?.pairCount ?? 0,
          orderCount: snapshot?.orderCount ?? 0,
          positionCount: snapshot?.positionCount ?? 0,
          marketCount: snapshot?.marketCount ?? 0,
        },
        activity24h: {
          ordersPlaced: activity.placed,
          ordersFilled: activity.filled,
          uniqueTraders: activity.uniqueTraders,
        },
        liquidations24h: {
          detected: liquidations.detected,
          executed: liquidations.executed,
          failed: liquidations.failed,
        },
        lastUpdated: new Date().toISOString(),
      };

      res.json(response);
    })
  );

  // ===========================================================================
  // Pair Analytics
  // ===========================================================================

  /**
   * GET /api/analytics/pairs
   * Returns activity for all pairs (last 24h)
   */
  router.get(
    '/pairs',
    asyncHandler(async (_req: Request, res: Response) => {
      // This would require a query that groups by pair
      // For now, return placeholder until indexer populates data
      res.json({
        pairs: [],
        lastUpdated: new Date().toISOString(),
      });
    })
  );

  /**
   * GET /api/analytics/pairs/:pairPda
   * Returns activity for a specific pair
   */
  router.get(
    '/pairs/:pairPda',
    asyncHandler(async (req: Request, res: Response) => {
      const { pairPda } = req.params;

      const [activity24h, activity1h] = await Promise.all([
        db.getOrderActivity(pairPda, 24),
        db.getOrderActivity(pairPda, 1),
      ]);

      const response: PairAnalyticsResponse = {
        pair: pairPda,
        activity24h: {
          ordersPlaced: activity24h.placed,
          ordersFilled: activity24h.matched,
          ordersCancelled: activity24h.cancelled,
          uniqueTraders: activity24h.uniqueTraders,
        },
        activity1h: {
          ordersPlaced: activity1h.placed,
          ordersFilled: activity1h.matched,
        },
      };

      res.json(response);
    })
  );

  /**
   * GET /api/analytics/pairs/:pairPda/hourly
   * Returns hourly activity buckets for a pair
   */
  router.get(
    '/pairs/:pairPda/hourly',
    asyncHandler(async (req: Request, res: Response) => {
      const { pairPda } = req.params;
      const hours = parseInt(req.query.hours as string, 10) || 24;

      const buckets = await db.getHourlyActivity(pairPda, Math.min(hours, 168)); // Max 7 days

      res.json({
        pair: pairPda,
        buckets: buckets.map((b) => ({
          time: b.bucket.toISOString(),
          ordersPlaced: b.ordersPlaced,
          ordersMatched: b.ordersMatched,
          ordersCancelled: b.ordersCancelled,
          uniqueTraders: b.uniqueTraders,
        })),
      });
    })
  );

  // ===========================================================================
  // Perp Market Analytics
  // ===========================================================================

  /**
   * GET /api/analytics/perps
   * Returns all perp markets with latest metrics
   */
  router.get(
    '/perps',
    asyncHandler(async (_req: Request, res: Response) => {
      const markets = await db.getAllPerpMarkets();

      const response = markets.map((m) => {
        const totalOi = m.totalLongOi + m.totalShortOi;
        const ratio = totalOi > 0n
          ? Number(m.totalLongOi * 10000n / totalOi) / 100
          : 50;

        return {
          marketAddress: m.marketAddress,
          openInterest: {
            totalLong: m.totalLongOi.toString(),
            totalShort: m.totalShortOi.toString(),
            longShortRatio: ratio,
          },
          positions: {
            total: m.positionCount,
            long: m.longPositionCount,
            short: m.shortPositionCount,
          },
          funding: {
            currentRateBps: m.currentFundingRateBps,
            lastUpdateTime: m.time.toISOString(),
          },
          markPrice: m.markPriceUsd?.toString() ?? null,
        };
      });

      res.json({
        markets: response,
        lastUpdated: new Date().toISOString(),
      });
    })
  );

  /**
   * GET /api/analytics/perps/:marketPda
   * Returns metrics for a specific perp market
   */
  router.get(
    '/perps/:marketPda',
    asyncHandler(async (req: Request, res: Response) => {
      const { marketPda } = req.params;

      const snapshot = await db.getLatestPerpMarketSnapshot(marketPda);

      if (!snapshot) {
        res.status(404).json({ error: 'Market not found' });
        return;
      }

      const totalOi = snapshot.totalLongOi + snapshot.totalShortOi;
      const ratio = totalOi > 0n
        ? Number(snapshot.totalLongOi * 10000n / totalOi) / 100
        : 50;

      const response: PerpMarketAnalyticsResponse = {
        marketAddress: snapshot.marketAddress,
        openInterest: {
          totalLong: snapshot.totalLongOi.toString(),
          totalShort: snapshot.totalShortOi.toString(),
          longShortRatio: ratio,
        },
        positions: {
          total: snapshot.positionCount,
          long: snapshot.longPositionCount,
          short: snapshot.shortPositionCount,
        },
        funding: {
          currentRateBps: snapshot.currentFundingRateBps,
          lastUpdateTime: snapshot.time.toISOString(),
        },
        markPrice: snapshot.markPriceUsd?.toString() ?? null,
      };

      res.json(response);
    })
  );

  // ===========================================================================
  // Liquidation Analytics
  // ===========================================================================

  /**
   * GET /api/analytics/liquidations
   * Returns recent liquidations and stats
   */
  router.get(
    '/liquidations',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string, 10) || 50;

      const [recent, stats24h] = await Promise.all([
        db.getRecentLiquidations(Math.min(limit, 100)),
        db.getLiquidationStats(24),
      ]);

      const response: LiquidationAnalyticsResponse = {
        recent: recent.map((l) => ({
          timestamp: l.time.toISOString(),
          market: l.market,
          side: l.side,
          eventType: l.eventType,
          signature: l.signature,
        })),
        stats24h: {
          detected: stats24h.detected,
          executed: stats24h.executed,
          failed: stats24h.failed,
        },
        statsTotal: {
          executed: stats24h.executed, // Would query total without time filter
        },
      };

      res.json(response);
    })
  );

  /**
   * GET /api/analytics/liquidations/market/:marketPda
   * Returns liquidations for a specific market
   */
  router.get(
    '/liquidations/market/:marketPda',
    asyncHandler(async (req: Request, res: Response) => {
      const { marketPda } = req.params;
      const hours = parseInt(req.query.hours as string, 10) || 24;

      // This would need a market-specific query
      const stats = await db.getLiquidationStats(hours);

      res.json({
        market: marketPda,
        stats: {
          detected: stats.detected,
          executed: stats.executed,
          failed: stats.failed,
        },
        hours,
      });
    })
  );

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /**
   * GET /api/analytics/health
   * Returns database health status
   */
  router.get(
    '/health',
    asyncHandler(async (_req: Request, res: Response) => {
      const health = await db.healthCheck();

      res.status(health.connected ? 200 : 503).json({
        status: health.connected ? 'healthy' : 'unhealthy',
        database: {
          connected: health.connected,
          latencyMs: health.latencyMs,
          poolSize: health.poolSize,
          idleConnections: health.idleConnections,
        },
        timestamp: new Date().toISOString(),
      });
    })
  );

  // ===========================================================================
  // Error Handler
  // ===========================================================================

  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ error: err.message }, 'Analytics API error');
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return router;
}
