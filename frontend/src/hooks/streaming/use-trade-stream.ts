/**
 * Trade stream hook
 *
 * Subscribes to real-time trade events.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSharedWebSocket } from './use-websocket';
import type { TradeEvent, UseStreamOptions } from './types';

// =============================================================================
// Hook
// =============================================================================

/**
 * Subscribe to trade events for a trading pair
 *
 * Returns real-time trade executions.
 * All data is PUBLIC - no encrypted amounts or prices.
 *
 * @example
 * ```tsx
 * const { events, tradeCount } = useTradeStream(pairPda);
 *
 * return <div>Recent trades: {tradeCount}</div>;
 * ```
 */
export function useTradeStream(
  pairPda?: string,
  options: UseStreamOptions<TradeEvent> = {}
) {
  const { maxEvents = 100, filter, onEvent } = options;

  const { isConnected, subscribe, unsubscribe, on } = useSharedWebSocket();
  const [events, setEvents] = useState<TradeEvent[]>([]);

  // Handle incoming events
  const handleEvent = useCallback(
    (event: TradeEvent) => {
      // Apply custom filter if provided
      if (filter && !filter(event)) return;

      // Call event callback
      onEvent?.(event);

      // Add to events buffer
      setEvents((prev) => {
        const next = [event, ...prev];
        return next.slice(0, maxEvents);
      });
    },
    [filter, maxEvents, onEvent]
  );

  // Subscribe to trade events
  useEffect(() => {
    if (!isConnected) return;

    // Subscribe to channel
    subscribe('trades', pairPda);

    // Listen for events
    const cleanup = on<TradeEvent>('trade_executed', handleEvent);

    return () => {
      unsubscribe('trades', pairPda);
      cleanup();
    };
  }, [isConnected, pairPda, subscribe, unsubscribe, on, handleEvent]);

  // Clear events buffer
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // Get unique traders from recent trades
  const getUniqueTraders = useCallback(() => {
    const traders = new Set<string>();
    events.forEach((e) => {
      traders.add(e.buyer);
      traders.add(e.seller);
    });
    return Array.from(traders);
  }, [events]);

  return {
    // Events
    events,
    latestTrade: events[0] ?? null,
    tradeCount: events.length,

    // Computed
    uniqueTraders: getUniqueTraders(),

    // State
    isConnected,
    pairPda,

    // Actions
    clearEvents,
  };
}

// =============================================================================
// Aggregation Hook
// =============================================================================

interface TradeAggregation {
  readonly tradeCount: number;
  readonly uniqueBuyers: number;
  readonly uniqueSellers: number;
  readonly lastTradeTime: number | null;
}

/**
 * Get aggregated trade statistics
 *
 * Provides summary statistics from the trade stream.
 */
export function useTradeAggregation(
  pairPda?: string,
  windowMs: number = 60000 // 1 minute
): TradeAggregation {
  const { events } = useTradeStream(pairPda, { maxEvents: 1000 });
  const [aggregation, setAggregation] = useState<TradeAggregation>({
    tradeCount: 0,
    uniqueBuyers: 0,
    uniqueSellers: 0,
    lastTradeTime: null,
  });

  useEffect(() => {
    const now = Date.now();
    const windowStart = now - windowMs;

    const recentEvents = events.filter((e) => e.timestamp >= windowStart);

    const buyers = new Set<string>();
    const sellers = new Set<string>();

    recentEvents.forEach((e) => {
      buyers.add(e.buyer);
      sellers.add(e.seller);
    });

    setAggregation({
      tradeCount: recentEvents.length,
      uniqueBuyers: buyers.size,
      uniqueSellers: sellers.size,
      lastTradeTime: recentEvents[0]?.timestamp ?? null,
    });
  }, [events, windowMs]);

  return aggregation;
}
