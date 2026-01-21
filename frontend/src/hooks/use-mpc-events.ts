'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Logs } from '@solana/web3.js';
import { BorshCoder, Program, EventParser } from '@coral-xyz/anchor';

import { createLogger } from '@/lib/logger';

const log = createLogger('mpc-events');

// Program IDs
const DEX_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
  '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);

// Event types emitted by the DEX after MPC callbacks
export interface PriceCompareCompleteEvent {
  requestId: Uint8Array;
  buyOrder: PublicKey;
  sellOrder: PublicKey;
  pricesMatch: boolean;
  timestamp: bigint;
}

export interface OrdersMatchedEvent {
  requestId: Uint8Array;
  buyOrder: PublicKey;
  sellOrder: PublicKey;
  buyFullyFilled: boolean;
  sellFullyFilled: boolean;
  timestamp: bigint;
}

// Computation completed event from MXE
export interface ComputationCompletedEvent {
  requestId: Uint8Array;
  success: boolean;
  resultSize: number;
  timestamp: bigint;
}

type MpcEventCallback = (event: PriceCompareCompleteEvent | OrdersMatchedEvent | ComputationCompletedEvent) => void;

interface PendingComputation {
  requestId: string; // hex encoded
  type: 'compare' | 'fill';
  buyOrder: string;
  sellOrder: string;
  createdAt: number;
  status: 'pending' | 'completed' | 'failed';
  result?: {
    pricesMatch?: boolean;
    buyFullyFilled?: boolean;
    sellFullyFilled?: boolean;
  };
}

interface UseMpcEventsReturn {
  pendingComputations: PendingComputation[];
  isListening: boolean;
  trackComputation: (requestId: Uint8Array, type: 'compare' | 'fill', buyOrder: string, sellOrder: string) => void;
  onPriceCompareComplete: (callback: (event: PriceCompareCompleteEvent) => void) => () => void;
  onOrdersMatched: (callback: (event: OrdersMatchedEvent) => void) => () => void;
  startListening: () => void;
  stopListening: () => void;
}

/**
 * Hook for subscribing to MPC computation events
 * Tracks pending computations and provides callbacks for results
 */
export function useMpcEvents(): UseMpcEventsReturn {
  const { connection } = useConnection();
  const [pendingComputations, setPendingComputations] = useState<PendingComputation[]>([]);
  const [isListening, setIsListening] = useState(false);
  const subscriptionRef = useRef<number | null>(null);

  // Event callback refs
  const priceCompareCallbacks = useRef<Set<(event: PriceCompareCompleteEvent) => void>>(new Set());
  const ordersMatchedCallbacks = useRef<Set<(event: OrdersMatchedEvent) => void>>(new Set());

  // Track a new computation
  const trackComputation = useCallback((
    requestId: Uint8Array,
    type: 'compare' | 'fill',
    buyOrder: string,
    sellOrder: string
  ) => {
    const requestIdHex = Buffer.from(requestId).toString('hex');

    setPendingComputations(prev => [
      ...prev,
      {
        requestId: requestIdHex,
        type,
        buyOrder,
        sellOrder,
        createdAt: Date.now(),
        status: 'pending',
      }
    ]);

    log.debug('Tracking computation', { requestId: requestIdHex.slice(0, 16), type });
  }, []);

  // Parse logs for events
  const parseEventFromLogs = useCallback((logs: string[]): void => {
    // Look for specific log patterns from our program
    for (const logLine of logs) {
      // PriceCompareComplete event pattern
      if (logLine.includes('MPC compare result')) {
        const match = logLine.match(/request\s+\[([^\]]+)\].*prices_match=(\w+)/);
        if (match) {
          const requestIdStr = match[1];
          const pricesMatch = match[2] === 'true';
          log.debug('Parsed PriceCompareComplete', { pricesMatch });

          // Update pending computation
          setPendingComputations(prev =>
            prev.map(comp => {
              if (comp.status === 'pending' && comp.type === 'compare') {
                return {
                  ...comp,
                  status: 'completed',
                  result: { pricesMatch }
                };
              }
              return comp;
            })
          );

          // Invoke registered callbacks
          const event: PriceCompareCompleteEvent = {
            requestId: new Uint8Array(Buffer.from(requestIdStr, 'hex')),
            buyOrder: PublicKey.default,
            sellOrder: PublicKey.default,
            pricesMatch,
            timestamp: BigInt(Date.now()),
          };
          priceCompareCallbacks.current.forEach(cb => {
            try {
              cb(event);
            } catch (err) {
              log.error('Error in priceCompareComplete callback', { error: err });
            }
          });
        }
      }

      // OrdersMatched event pattern
      if (logLine.includes('MPC fill result')) {
        const match = logLine.match(/buy_filled=(\w+).*sell_filled=(\w+)/);
        if (match) {
          const buyFullyFilled = match[1] === 'true';
          const sellFullyFilled = match[2] === 'true';
          log.debug('Parsed OrdersMatched', { buyFullyFilled, sellFullyFilled });

          // Update pending computation
          setPendingComputations(prev =>
            prev.map(comp => {
              if (comp.status === 'pending' && comp.type === 'fill') {
                return {
                  ...comp,
                  status: 'completed',
                  result: { buyFullyFilled, sellFullyFilled }
                };
              }
              return comp;
            })
          );

          // Invoke registered callbacks
          const event: OrdersMatchedEvent = {
            requestId: new Uint8Array(32),
            buyOrder: PublicKey.default,
            sellOrder: PublicKey.default,
            buyFullyFilled,
            sellFullyFilled,
            timestamp: BigInt(Date.now()),
          };
          ordersMatchedCallbacks.current.forEach(cb => {
            try {
              cb(event);
            } catch (err) {
              log.error('Error in ordersMatched callback', { error: err });
            }
          });
        }
      }
    }
  }, []);

  // Start listening to program logs
  const startListening = useCallback(() => {
    if (subscriptionRef.current !== null) {
      log.debug('Already listening');
      return;
    }

    log.debug('Starting log subscription for program', { programId: DEX_PROGRAM_ID.toString() });

    subscriptionRef.current = connection.onLogs(
      DEX_PROGRAM_ID,
      (logs: Logs) => {
        if (logs.err) {
          log.warn('Transaction failed', { signature: logs.signature, error: logs.err });
          return;
        }

        parseEventFromLogs(logs.logs);
      },
      'confirmed'
    );

    setIsListening(true);
    log.debug('Log subscription started', { subscriptionId: subscriptionRef.current });
  }, [connection, parseEventFromLogs]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (subscriptionRef.current !== null) {
      connection.removeOnLogsListener(subscriptionRef.current);
      subscriptionRef.current = null;
      setIsListening(false);
      log.debug('Log subscription stopped');
    }
  }, [connection]);

  // Register callback for price compare events
  const onPriceCompareComplete = useCallback((callback: (event: PriceCompareCompleteEvent) => void) => {
    priceCompareCallbacks.current.add(callback);

    // Return unsubscribe function
    return () => {
      priceCompareCallbacks.current.delete(callback);
    };
  }, []);

  // Register callback for orders matched events
  const onOrdersMatched = useCallback((callback: (event: OrdersMatchedEvent) => void) => {
    ordersMatchedCallbacks.current.add(callback);

    // Return unsubscribe function
    return () => {
      ordersMatchedCallbacks.current.delete(callback);
    };
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current !== null) {
        connection.removeOnLogsListener(subscriptionRef.current);
      }
    };
  }, [connection]);

  // Auto-cleanup old pending computations (> 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      setPendingComputations(prev =>
        prev.filter(comp =>
          comp.createdAt > fiveMinutesAgo || comp.status !== 'pending'
        )
      );
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  return {
    pendingComputations,
    isListening,
    trackComputation,
    onPriceCompareComplete,
    onOrdersMatched,
    startListening,
    stopListening,
  };
}

/**
 * Helper to format request ID for display
 */
export function formatRequestId(requestId: Uint8Array | string): string {
  const hex = typeof requestId === 'string'
    ? requestId
    : Buffer.from(requestId).toString('hex');
  return `${hex.slice(0, 8)}...${hex.slice(-8)}`;
}

/**
 * Helper to check if a computation is still pending
 */
export function isComputationPending(computation: PendingComputation): boolean {
  return computation.status === 'pending';
}

/**
 * Helper to estimate time remaining for a computation
 * Based on average MPC execution time of ~500ms
 */
export function estimateTimeRemaining(computation: PendingComputation): number {
  if (computation.status !== 'pending') return 0;

  const elapsed = Date.now() - computation.createdAt;
  const estimatedTotal = 2000; // 2 seconds average
  return Math.max(0, estimatedTotal - elapsed);
}
