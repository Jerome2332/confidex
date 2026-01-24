/**
 * Order stream hook
 *
 * Subscribes to real-time order events for a trading pair.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSharedWebSocket } from './use-websocket';
import type { OrderEvent, UseStreamOptions } from './types';

// =============================================================================
// Hook
// =============================================================================

/**
 * Subscribe to order events for a trading pair
 *
 * Returns real-time order placements, cancellations, and fills.
 * All data is PUBLIC - no encrypted amounts or prices.
 *
 * @example
 * ```tsx
 * const { events, isConnected, clearEvents } = useOrderStream(pairPda);
 *
 * return (
 *   <ul>
 *     {events.map((e) => (
 *       <li key={e.orderId}>{e.type} - {e.side}</li>
 *     ))}
 *   </ul>
 * );
 * ```
 */
export function useOrderStream(
  pairPda?: string,
  options: UseStreamOptions<OrderEvent> = {}
) {
  const { maxEvents = 100, filter, onEvent } = options;

  const { isConnected, subscribe, unsubscribe, on } = useSharedWebSocket();
  const [events, setEvents] = useState<OrderEvent[]>([]);

  // Handle incoming events
  const handleEvent = useCallback(
    (event: OrderEvent) => {
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

  // Subscribe to order events
  useEffect(() => {
    if (!isConnected) return;

    // Subscribe to channel
    subscribe('orders', pairPda);

    // Listen for events
    const cleanup = on<OrderEvent>('order_update', handleEvent);

    return () => {
      unsubscribe('orders', pairPda);
      cleanup();
    };
  }, [isConnected, pairPda, subscribe, unsubscribe, on, handleEvent]);

  // Clear events buffer
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // Get events by type
  const getEventsByType = useCallback(
    (type: OrderEvent['type']) => {
      return events.filter((e) => e.type === type);
    },
    [events]
  );

  // Get events by side
  const getEventsBySide = useCallback(
    (side: 'buy' | 'sell') => {
      return events.filter((e) => e.side === side);
    },
    [events]
  );

  return {
    // Events
    events,
    latestEvent: events[0] ?? null,
    eventCount: events.length,

    // Filtered views
    placements: getEventsByType('order_placed'),
    cancellations: getEventsByType('order_cancelled'),
    matches: getEventsByType('order_matched'),
    fills: getEventsByType('order_filled'),

    // By side
    buyEvents: getEventsBySide('buy'),
    sellEvents: getEventsBySide('sell'),

    // State
    isConnected,
    pairPda,

    // Actions
    clearEvents,
    getEventsByType,
    getEventsBySide,
  };
}

// =============================================================================
// Convenience Hooks
// =============================================================================

/**
 * Get only order placements
 */
export function useOrderPlacements(
  pairPda?: string,
  options: Omit<UseStreamOptions<OrderEvent>, 'filter'> = {}
) {
  return useOrderStream(pairPda, {
    ...options,
    filter: (e) => e.type === 'order_placed',
  });
}

/**
 * Get only order fills
 */
export function useOrderFills(
  pairPda?: string,
  options: Omit<UseStreamOptions<OrderEvent>, 'filter'> = {}
) {
  return useOrderStream(pairPda, {
    ...options,
    filter: (e) => e.type === 'order_filled' || e.type === 'order_matched',
  });
}

/**
 * Get only cancellations
 */
export function useOrderCancellations(
  pairPda?: string,
  options: Omit<UseStreamOptions<OrderEvent>, 'filter'> = {}
) {
  return useOrderStream(pairPda, {
    ...options,
    filter: (e) => e.type === 'order_cancelled',
  });
}
