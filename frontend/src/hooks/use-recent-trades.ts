'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Logs } from '@solana/web3.js';
import { CONFIDEX_PROGRAM_ID } from '@/lib/constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('recent-trades');

export interface Trade {
  id: string;
  price: number;
  side: 'buy' | 'sell';
  time: Date;
  signature: string;
}

/**
 * Hook to subscribe to settlement events and build a recent trades list
 * Listens to DEX program logs for "Orders settled" events
 */
export function useRecentTrades(limit = 50) {
  const { connection } = useConnection();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isListening, setIsListening] = useState(false);
  const subscriptionRef = useRef<number | null>(null);
  const tradeIdCounter = useRef(0);

  // Parse settlement event from logs
  const parseTradeFromLogs = useCallback((logs: string[], signature: string): Trade | null => {
    for (const logLine of logs) {
      // Look for settlement log pattern:
      // "Settlement: X base tokens, Y quote tokens"
      // or "Orders settled: buy=... sell=..."
      if (logLine.includes('Settlement:') || logLine.includes('Orders settled')) {
        // Extract price if available from logs
        // The actual price would be: quote_amount / base_amount
        // For now, we'll use a placeholder since the actual amounts are encrypted

        // Try to extract fill info from log
        const fillMatch = logLine.match(/fill_amount=(\d+)/);
        const priceMatch = logLine.match(/price=(\d+\.?\d*)/);

        const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

        // Determine side from log context
        // If log mentions "buy_fully_filled=true" first, taker was buyer
        const isBuyerTaker = logLine.includes('buy_fully_filled=true');

        tradeIdCounter.current += 1;

        return {
          id: `${signature.slice(0, 8)}-${tradeIdCounter.current}`,
          price,
          side: isBuyerTaker ? 'buy' : 'sell',
          time: new Date(),
          signature,
        };
      }

      // Also check for OrderSettled event
      if (logLine.includes('OrderSettled')) {
        tradeIdCounter.current += 1;

        // Parse event data if available
        const priceMatch = logLine.match(/execution_price[=:]?\s*(\d+)/);
        const price = priceMatch ? Number(priceMatch[1]) / 1_000_000 : 0;

        return {
          id: `${signature.slice(0, 8)}-${tradeIdCounter.current}`,
          price,
          side: Math.random() > 0.5 ? 'buy' : 'sell', // Placeholder until we parse actual event
          time: new Date(),
          signature,
        };
      }
    }

    return null;
  }, []);

  // Start listening to settlement events
  const startListening = useCallback(() => {
    if (subscriptionRef.current !== null || !connection) {
      return;
    }

    log.debug('Starting trade subscription for DEX program');

    subscriptionRef.current = connection.onLogs(
      CONFIDEX_PROGRAM_ID,
      (logsResult: Logs) => {
        if (logsResult.err) {
          return; // Skip failed transactions
        }

        const trade = parseTradeFromLogs(logsResult.logs, logsResult.signature);
        if (trade) {
          log.debug('New trade detected', { tradeId: trade.id, price: trade.price });

          setTrades(prev => {
            const newTrades = [trade, ...prev];
            // Keep only the most recent trades
            return newTrades.slice(0, limit);
          });
        }
      },
      'confirmed'
    );

    setIsListening(true);
    log.debug('Trade subscription started');
  }, [connection, parseTradeFromLogs, limit]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (subscriptionRef.current !== null && connection) {
      connection.removeOnLogsListener(subscriptionRef.current);
      subscriptionRef.current = null;
      setIsListening(false);
      log.debug('Trade subscription stopped');
    }
  }, [connection]);

  // Auto-start on mount
  useEffect(() => {
    startListening();

    return () => {
      stopListening();
    };
  }, [startListening, stopListening]);

  // Clear old trades (optional: keep only last 24 hours)
  useEffect(() => {
    const interval = setInterval(() => {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      setTrades(prev => prev.filter(t => t.time.getTime() > oneDayAgo));
    }, 60 * 1000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  return {
    trades,
    isListening,
    startListening,
    stopListening,
    tradesCount: trades.length,
  };
}
