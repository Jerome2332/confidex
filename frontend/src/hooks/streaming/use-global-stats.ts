/**
 * Global stats stream hook
 *
 * Subscribes to real-time exchange-wide statistics.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSharedWebSocket } from './use-websocket';
import type { GlobalStatsEvent, MarketStatsEvent, LiquidationEvent } from './types';

// =============================================================================
// Types
// =============================================================================

export interface GlobalStats {
  readonly pairCount: number;
  readonly orderCount: number;
  readonly positionCount: number;
  readonly marketCount: number;
  readonly lastUpdated: Date | null;
}

export interface MarketStats {
  readonly marketPda: string;
  readonly openInterestLong: bigint;
  readonly openInterestShort: bigint;
  readonly positionCount: number;
  readonly fundingRateBps?: number;
  readonly lastUpdated: Date;
}

export interface LiquidationStats {
  readonly totalDetected: number;
  readonly totalExecuted: number;
  readonly totalFailed: number;
  readonly recentLiquidations: LiquidationEvent[];
}

// =============================================================================
// Global Stats Hook
// =============================================================================

/**
 * Subscribe to global exchange statistics
 *
 * Returns real-time counts of pairs, orders, positions, and markets.
 *
 * @example
 * ```tsx
 * const { stats, isConnected } = useGlobalStats();
 *
 * return (
 *   <div>
 *     <p>Pairs: {stats.pairCount}</p>
 *     <p>Active Orders: {stats.orderCount}</p>
 *   </div>
 * );
 * ```
 */
export function useGlobalStats() {
  const { isConnected, subscribe, unsubscribe, on } = useSharedWebSocket();

  const [stats, setStats] = useState<GlobalStats>({
    pairCount: 0,
    orderCount: 0,
    positionCount: 0,
    marketCount: 0,
    lastUpdated: null,
  });

  // Handle incoming events
  const handleEvent = useCallback((event: GlobalStatsEvent) => {
    setStats({
      pairCount: event.pairCount,
      orderCount: event.orderCount,
      positionCount: event.positionCount,
      marketCount: event.marketCount,
      lastUpdated: new Date(event.timestamp),
    });
  }, []);

  // Subscribe to global stats
  useEffect(() => {
    if (!isConnected) return;

    subscribe('global');

    const cleanup = on<GlobalStatsEvent>('global_stats', handleEvent);

    return () => {
      unsubscribe('global');
      cleanup();
    };
  }, [isConnected, subscribe, unsubscribe, on, handleEvent]);

  return {
    stats,
    isConnected,
  };
}

// =============================================================================
// Market Stats Hook
// =============================================================================

/**
 * Subscribe to perp market statistics
 *
 * Returns real-time open interest and position counts per market.
 *
 * @example
 * ```tsx
 * const { markets, getMarket } = useMarketStats();
 * const solPerp = getMarket('SOL-PERP-PDA');
 * ```
 */
export function useMarketStats() {
  const { isConnected, subscribe, unsubscribe, on } = useSharedWebSocket();

  const [markets, setMarkets] = useState<Map<string, MarketStats>>(new Map());

  // Handle incoming events
  const handleEvent = useCallback((event: MarketStatsEvent) => {
    setMarkets((prev) => {
      const next = new Map(prev);
      next.set(event.marketPda, {
        marketPda: event.marketPda,
        openInterestLong: BigInt(event.openInterestLong),
        openInterestShort: BigInt(event.openInterestShort),
        positionCount: event.positionCount,
        fundingRateBps: event.fundingRateBps,
        lastUpdated: new Date(event.timestamp),
      });
      return next;
    });
  }, []);

  // Subscribe to market stats
  useEffect(() => {
    if (!isConnected) return;

    subscribe('markets');

    const cleanup = on<MarketStatsEvent>('market_stats', handleEvent);

    return () => {
      unsubscribe('markets');
      cleanup();
    };
  }, [isConnected, subscribe, unsubscribe, on, handleEvent]);

  // Get market stats for a specific market
  const getMarket = useCallback(
    (marketPda: string): MarketStats | null => {
      return markets.get(marketPda) ?? null;
    },
    [markets]
  );

  // Get all markets as array
  const getMarketsArray = useCallback((): MarketStats[] => {
    return Array.from(markets.values());
  }, [markets]);

  // Get total open interest across all markets
  const getTotalOpenInterest = useCallback((): { long: bigint; short: bigint } => {
    let long = BigInt(0);
    let short = BigInt(0);

    markets.forEach((m) => {
      long += m.openInterestLong;
      short += m.openInterestShort;
    });

    return { long, short };
  }, [markets]);

  return {
    markets,
    marketsArray: getMarketsArray(),
    marketCount: markets.size,
    totalOpenInterest: getTotalOpenInterest(),
    isConnected,
    getMarket,
  };
}

// =============================================================================
// Liquidation Stats Hook
// =============================================================================

/**
 * Subscribe to liquidation events
 *
 * Returns real-time liquidation detections and executions.
 *
 * @example
 * ```tsx
 * const { stats, recentLiquidations } = useLiquidationStats();
 *
 * return <div>Liquidations today: {stats.totalExecuted}</div>;
 * ```
 */
export function useLiquidationStats(maxEvents: number = 50) {
  const { isConnected, subscribe, unsubscribe, on } = useSharedWebSocket();

  const [stats, setStats] = useState<LiquidationStats>({
    totalDetected: 0,
    totalExecuted: 0,
    totalFailed: 0,
    recentLiquidations: [],
  });

  // Handle incoming events
  const handleEvent = useCallback(
    (event: LiquidationEvent) => {
      setStats((prev) => {
        const recentLiquidations = [event, ...prev.recentLiquidations].slice(0, maxEvents);

        return {
          totalDetected:
            prev.totalDetected + (event.type === 'liquidation_detected' ? 1 : 0),
          totalExecuted:
            prev.totalExecuted + (event.type === 'liquidation_executed' ? 1 : 0),
          totalFailed: prev.totalFailed + (event.type === 'liquidation_failed' ? 1 : 0),
          recentLiquidations,
        };
      });
    },
    [maxEvents]
  );

  // Subscribe to liquidation events
  useEffect(() => {
    if (!isConnected) return;

    subscribe('liquidations');

    const cleanup = on<LiquidationEvent>('liquidation_event', handleEvent);

    return () => {
      unsubscribe('liquidations');
      cleanup();
    };
  }, [isConnected, subscribe, unsubscribe, on, handleEvent]);

  // Get liquidations by type
  const getByType = useCallback(
    (type: LiquidationEvent['type']) => {
      return stats.recentLiquidations.filter((l) => l.type === type);
    },
    [stats.recentLiquidations]
  );

  // Get liquidations by market
  const getByMarket = useCallback(
    (marketPda: string) => {
      return stats.recentLiquidations.filter((l) => l.marketPda === marketPda);
    },
    [stats.recentLiquidations]
  );

  // Clear stats (for testing)
  const clearStats = useCallback(() => {
    setStats({
      totalDetected: 0,
      totalExecuted: 0,
      totalFailed: 0,
      recentLiquidations: [],
    });
  }, []);

  return {
    stats,
    recentLiquidations: stats.recentLiquidations,
    isConnected,
    getByType,
    getByMarket,
    clearStats,
  };
}
