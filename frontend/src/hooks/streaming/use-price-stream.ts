/**
 * Price stream hook
 *
 * Subscribes to real-time Pyth oracle price updates.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSharedWebSocket } from './use-websocket';
import type { PriceEvent, UseStreamOptions } from './types';

// =============================================================================
// Types
// =============================================================================

export interface ParsedPrice {
  readonly feedId: string;
  readonly symbol: string;
  readonly price: number;
  readonly confidence: number;
  readonly publishTime: Date;
  readonly isStale: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const STALENESS_THRESHOLD_MS = 30000; // 30 seconds

// =============================================================================
// Utilities
// =============================================================================

/**
 * Parse price event into human-readable format
 */
function parsePrice(event: PriceEvent): ParsedPrice {
  const priceValue = BigInt(event.price);
  const confValue = BigInt(event.confidence);
  const multiplier = 10 ** Math.abs(event.expo);

  // Handle negative exponent (most common case)
  const price = event.expo < 0 ? Number(priceValue) / multiplier : Number(priceValue) * multiplier;
  const confidence = event.expo < 0 ? Number(confValue) / multiplier : Number(confValue) * multiplier;

  const publishTime = new Date(event.publishTime * 1000);
  const isStale = Date.now() - publishTime.getTime() > STALENESS_THRESHOLD_MS;

  return {
    feedId: event.feedId,
    symbol: event.symbol,
    price,
    confidence,
    publishTime,
    isStale,
  };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Subscribe to price updates from Pyth oracle
 *
 * Returns real-time price updates for specified feed(s).
 *
 * @example
 * ```tsx
 * const { prices, getPrice } = usePriceStream(['SOL/USD', 'BTC/USD']);
 *
 * const solPrice = getPrice('SOL/USD');
 * return <div>SOL: ${solPrice?.price.toFixed(2)}</div>;
 * ```
 */
export function usePriceStream(
  symbols?: string[],
  options: UseStreamOptions<PriceEvent> = {}
) {
  const { filter, onEvent } = options;

  const { isConnected, subscribe, unsubscribe, on } = useSharedWebSocket();
  const [prices, setPrices] = useState<Map<string, ParsedPrice>>(new Map());
  const [history, setHistory] = useState<PriceEvent[]>([]);

  // Handle incoming events
  const handleEvent = useCallback(
    (event: PriceEvent) => {
      // Filter by symbol if specified
      if (symbols && !symbols.includes(event.symbol)) return;

      // Apply custom filter if provided
      if (filter && !filter(event)) return;

      // Call event callback
      onEvent?.(event);

      // Parse and update price map
      const parsed = parsePrice(event);
      setPrices((prev) => {
        const next = new Map(prev);
        next.set(event.symbol, parsed);
        return next;
      });

      // Add to history (keep last 100)
      setHistory((prev) => [event, ...prev].slice(0, 100));
    },
    [symbols, filter, onEvent]
  );

  // Subscribe to price events
  useEffect(() => {
    if (!isConnected) return;

    // Subscribe to channel
    subscribe('prices');

    // Listen for events
    const cleanup = on<PriceEvent>('price_update', handleEvent);

    return () => {
      unsubscribe('prices');
      cleanup();
    };
  }, [isConnected, subscribe, unsubscribe, on, handleEvent]);

  // Get price for a specific symbol
  const getPrice = useCallback(
    (symbol: string): ParsedPrice | null => {
      return prices.get(symbol) ?? null;
    },
    [prices]
  );

  // Get all prices as array
  const getPricesArray = useCallback((): ParsedPrice[] => {
    return Array.from(prices.values());
  }, [prices]);

  // Check if any price is stale
  const hasStalePrice = useCallback((): boolean => {
    return Array.from(prices.values()).some((p) => p.isStale);
  }, [prices]);

  // Clear all prices
  const clearPrices = useCallback(() => {
    setPrices(new Map());
    setHistory([]);
  }, []);

  return {
    // Prices
    prices,
    pricesArray: getPricesArray(),
    priceCount: prices.size,

    // History
    history,

    // State
    isConnected,
    hasStalePrice: hasStalePrice(),

    // Actions
    getPrice,
    clearPrices,
  };
}

// =============================================================================
// Single Price Hook
// =============================================================================

/**
 * Subscribe to a single price feed
 *
 * Convenience hook for tracking one symbol.
 *
 * @example
 * ```tsx
 * const { price, isStale, priceFormatted } = usePrice('SOL/USD');
 * ```
 */
export function usePrice(symbol: string) {
  const { prices, isConnected } = usePriceStream([symbol]);
  const price = prices.get(symbol) ?? null;

  return {
    // Price data
    price,
    priceValue: price?.price ?? null,
    confidence: price?.confidence ?? null,
    publishTime: price?.publishTime ?? null,
    isStale: price?.isStale ?? true,

    // Formatted strings
    priceFormatted: price ? `$${price.price.toFixed(2)}` : null,
    confidenceFormatted: price ? `+/-${price.confidence.toFixed(4)}` : null,

    // State
    isConnected,
    hasPrice: price !== null,
  };
}
