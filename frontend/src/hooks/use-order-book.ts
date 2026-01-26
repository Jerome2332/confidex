'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { CONFIDEX_PROGRAM_ID, SOL_USDC_PAIR_PDA } from '@/lib/constants';

// V5 order account size (366 bytes) - see CLAUDE.md for format
// V5 removed plaintext fields (amount_plaintext, price_plaintext, filled_plaintext)
const ORDER_ACCOUNT_SIZE_V5 = 366;

// Rate limiting configuration
const MIN_FETCH_INTERVAL_MS = 10000; // Minimum 10 seconds between fetches
const DEFAULT_REFRESH_INTERVAL_MS = 15000; // Default 15 second polling
const BACKOFF_MULTIPLIER = 2;
const MAX_BACKOFF_MS = 60000; // Max 60 second backoff

// Order status enum matching on-chain
enum OrderStatus {
  Active = 0,
  Filled = 1,
  Cancelled = 2,
  Expired = 3,
  Matching = 4,
}

// Order side enum
enum Side {
  Buy = 0,
  Sell = 1,
}

export interface OrderBookLevel {
  price: number;
  orderCount: number;
  depthIndicator: number; // 0-100, visual depth representation
  isEncrypted: boolean;
}

interface ParsedOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  status: OrderStatus;
  // V5 orders have fully encrypted prices/amounts (V2 encryption format)
  // We can only know that an order exists, not its price or amount
  isEncrypted: true;
}

// Simple in-memory cache
interface CachedData {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  timestamp: number;
}

let orderBookCache: CachedData | null = null;
const CACHE_TTL_MS = 10000; // Cache valid for 10 seconds

/**
 * Parse V5 order account data (366 bytes)
 * V5 format removes plaintext fields for privacy hardening
 * See CLAUDE.md for full field layout
 *
 * V5 Order Layout:
 *   0-7:    discriminator (8)
 *   8-39:   maker (32)
 *   40-71:  pair (32)
 *   72:     side (1)
 *   73:     order_type (1)
 *   74-137: encrypted_amount (64) - V2 format: [nonce|ciphertext|ephemeral_pubkey]
 *   138-201: encrypted_price (64) - V2 format: [nonce|ciphertext|ephemeral_pubkey]
 *   202-265: encrypted_filled (64)
 *   266:    status (1)
 *   267-274: created_at_hour (8)
 *   275-290: order_id (16)
 *   291-298: order_nonce (8)
 *   299:    eligibility_proof_verified (1)
 *   300-331: pending_match_request (32)
 *   332:    is_matching (1)
 *   333:    bump (1)
 *   334-365: ephemeral_pubkey (32)
 *
 * NOTE: V5 orders use V2 encryption (64 bytes fully encrypted).
 * We cannot read price/amount without MPC decryption.
 * This function only extracts metadata (side, status, pair) for counting orders.
 */
function parseV5Order(data: Uint8Array): ParsedOrder | null {
  if (data.length !== ORDER_ACCOUNT_SIZE_V5) {
    return null;
  }

  // Offsets based on V5 order format
  const maker = new PublicKey(data.slice(8, 40));
  const pair = new PublicKey(data.slice(40, 72));
  const side = data[72] as Side;
  const status = data[266] as OrderStatus;

  // V5 orders have fully encrypted prices/amounts
  // We can only know that an order exists, not its price or amount

  return {
    maker,
    pair,
    side,
    status,
    isEncrypted: true,
  };
}

/**
 * Hook to fetch real order book data from on-chain orders
 * Includes rate limiting and caching to avoid 429 errors from public RPC
 */
export function useOrderBook(pairPubkey?: PublicKey, refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS) {
  const { connection } = useConnection();
  const [asks, setAsks] = useState<OrderBookLevel[]>([]);
  const [bids, setBids] = useState<OrderBookLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Use default pair if none provided
  const targetPair = pairPubkey || new PublicKey(SOL_USDC_PAIR_PDA);

  // Track if component is mounted
  const mountedRef = useRef(true);

  // Track last fetch time and backoff for rate limiting
  const lastFetchRef = useRef<number>(0);
  const backoffRef = useRef<number>(refreshIntervalMs);
  const fetchInProgressRef = useRef<boolean>(false);

  const fetchOrders = useCallback(async (force = false) => {
    if (!connection) return;

    // Prevent concurrent fetches
    if (fetchInProgressRef.current) {
      return;
    }

    // Rate limiting: ensure minimum interval between fetches
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchRef.current;
    if (!force && timeSinceLastFetch < MIN_FETCH_INTERVAL_MS) {
      return;
    }

    // Check cache first
    if (!force && orderBookCache && (now - orderBookCache.timestamp) < CACHE_TTL_MS) {
      if (mountedRef.current) {
        setAsks(orderBookCache.asks);
        setBids(orderBookCache.bids);
        setLoading(false);
        setError(null);
      }
      return;
    }

    fetchInProgressRef.current = true;
    lastFetchRef.current = now;

    try {
      // Fetch all V5 (366 byte) orders from the DEX program
      const accounts = await connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
      });

      // Reset backoff on success
      backoffRef.current = refreshIntervalMs;

      // Count orders by side (prices are encrypted, cannot group by price)
      let askCount = 0;
      let bidCount = 0;

      for (const { account } of accounts) {
        const order = parseV5Order(account.data as Uint8Array);
        if (!order) continue;

        // Only include orders for the target pair
        if (!order.pair.equals(targetPair)) continue;

        // Only include active orders
        if (order.status !== OrderStatus.Active) continue;

        if (order.side === Side.Buy) {
          bidCount++;
        } else {
          askCount++;
        }
      }

      // Since prices are encrypted, we show a single "Encrypted" level per side
      // with the count of orders at that level
      const processedAsks: OrderBookLevel[] = askCount > 0 ? [{
        price: -1, // Sentinel value indicating encrypted
        orderCount: askCount,
        depthIndicator: 50, // Default depth since we can't know amounts
        isEncrypted: true,
      }] : [];

      const processedBids: OrderBookLevel[] = bidCount > 0 ? [{
        price: -1, // Sentinel value indicating encrypted
        orderCount: bidCount,
        depthIndicator: 50, // Default depth since we can't know amounts
        isEncrypted: true,
      }] : [];

      // Update cache
      orderBookCache = {
        asks: processedAsks,
        bids: processedBids,
        timestamp: Date.now(),
      };

      if (mountedRef.current) {
        setAsks(processedAsks);
        setBids(processedBids);
        setLoading(false);
        setError(null);
        setLastUpdate(new Date());
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to fetch orders';

      // Check if it's a rate limit error (429)
      const is429 = errMsg.includes('429') || errMsg.includes('Too many requests');

      if (is429) {
        // Increase backoff on rate limit
        backoffRef.current = Math.min(backoffRef.current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
        console.warn(`[useOrderBook] Rate limited, backing off to ${backoffRef.current}ms`);
      } else {
        console.error('[useOrderBook] Error fetching orders:', err);
      }

      if (mountedRef.current) {
        // Only show error if we don't have cached data
        if (!orderBookCache) {
          setError(is429 ? 'Rate limited - using cached data' : errMsg);
        }
        setLoading(false);
      }
    } finally {
      fetchInProgressRef.current = false;
    }
  }, [connection, targetPair, refreshIntervalMs]);

  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch after a short delay to avoid immediate rate limiting
    const initialDelay = setTimeout(() => {
      fetchOrders();
    }, 500);

    // Set up polling interval with dynamic backoff
    const pollInterval = setInterval(() => {
      fetchOrders();
    }, Math.max(refreshIntervalMs, backoffRef.current));

    return () => {
      mountedRef.current = false;
      clearTimeout(initialDelay);
      clearInterval(pollInterval);
    };
  }, [fetchOrders, refreshIntervalMs]);

  return {
    asks,
    bids,
    loading,
    error,
    lastUpdate,
    refresh: () => fetchOrders(true), // Force refresh bypasses cache
  };
}
