'use client';

/**
 * React Query-based Order Book Hook
 *
 * Optimized version of use-order-book.ts using React Query for:
 * - Automatic caching and deduplication
 * - Background refetching
 * - Stale-while-revalidate pattern
 * - Automatic garbage collection
 * - Error retry with exponential backoff
 *
 * This hook replaces manual caching with React Query's built-in cache.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection } from '@solana/wallet-adapter-react';
import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIDEX_PROGRAM_ID, SOL_USDC_PAIR_PDA } from '@/lib/constants';

// V5 order account size (366 bytes) - see CLAUDE.md for format
const ORDER_ACCOUNT_SIZE_V5 = 366;

// Query key factory for order book queries
export const orderBookKeys = {
  all: ['orderBook'] as const,
  pair: (pairPda: string) => [...orderBookKeys.all, pairPda] as const,
};

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
  depthIndicator: number;
  isEncrypted: boolean;
}

export interface OrderBookData {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  totalAsks: number;
  totalBids: number;
  lastUpdate: Date;
}

interface ParsedOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  status: OrderStatus;
  isEncrypted: true;
}

/**
 * Parse V5 order account data (366 bytes)
 */
function parseV5Order(data: Uint8Array): ParsedOrder | null {
  if (data.length !== ORDER_ACCOUNT_SIZE_V5) {
    return null;
  }

  const maker = new PublicKey(data.slice(8, 40));
  const pair = new PublicKey(data.slice(40, 72));
  const side = data[72] as Side;
  const status = data[266] as OrderStatus;

  return {
    maker,
    pair,
    side,
    status,
    isEncrypted: true,
  };
}

/**
 * Fetch order book data from on-chain
 */
async function fetchOrderBook(
  connection: Connection,
  targetPair: PublicKey
): Promise<OrderBookData> {
  // Fetch all V5 orders from the DEX program
  const accounts = await connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
    filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
  });

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

  // Since prices are encrypted, show single "Encrypted" level per side
  const asks: OrderBookLevel[] =
    askCount > 0
      ? [
          {
            price: -1,
            orderCount: askCount,
            depthIndicator: 50,
            isEncrypted: true,
          },
        ]
      : [];

  const bids: OrderBookLevel[] =
    bidCount > 0
      ? [
          {
            price: -1,
            orderCount: bidCount,
            depthIndicator: 50,
            isEncrypted: true,
          },
        ]
      : [];

  return {
    asks,
    bids,
    totalAsks: askCount,
    totalBids: bidCount,
    lastUpdate: new Date(),
  };
}

export interface UseOrderBookQueryOptions {
  /** Pair PDA to fetch order book for (defaults to SOL/USDC) */
  pairPda?: PublicKey;
  /** Refetch interval in milliseconds (default: 15000) */
  refetchInterval?: number;
  /** Whether to enable the query (default: true) */
  enabled?: boolean;
}

/**
 * React Query-based order book hook
 *
 * Benefits over manual implementation:
 * - Automatic request deduplication (multiple components share same query)
 * - Built-in caching with configurable stale time
 * - Automatic background refetching
 * - Error retry with exponential backoff
 * - Memory management with garbage collection
 * - DevTools support for debugging
 */
export function useOrderBookQuery(options: UseOrderBookQueryOptions = {}) {
  const { pairPda, refetchInterval = 15000, enabled = true } = options;
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  const targetPair = pairPda || new PublicKey(SOL_USDC_PAIR_PDA);
  const pairKey = targetPair.toString();

  const query = useQuery({
    queryKey: orderBookKeys.pair(pairKey),
    queryFn: () => fetchOrderBook(connection, targetPair),
    enabled: enabled && !!connection,
    refetchInterval,
    // Keep previous data while fetching new data (stale-while-revalidate)
    placeholderData: (previousData) => previousData,
    // Custom retry logic for rate limiting
    retry: (failureCount, error) => {
      // Don't retry on rate limit errors, let backoff handle it
      if (error instanceof Error && error.message.includes('429')) {
        return false;
      }
      return failureCount < 2;
    },
    // Specific stale time for order book (more aggressive than default)
    staleTime: 10_000,
  });

  // Prefetch helper for preloading other pairs
  const prefetchPair = async (otherPairPda: PublicKey) => {
    await queryClient.prefetchQuery({
      queryKey: orderBookKeys.pair(otherPairPda.toString()),
      queryFn: () => fetchOrderBook(connection, otherPairPda),
      staleTime: 10_000,
    });
  };

  // Invalidate cache (force refetch)
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: orderBookKeys.pair(pairKey) });
  };

  return {
    asks: query.data?.asks ?? [],
    bids: query.data?.bids ?? [],
    totalAsks: query.data?.totalAsks ?? 0,
    totalBids: query.data?.totalBids ?? 0,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    lastUpdate: query.data?.lastUpdate ?? null,
    isFetching: query.isFetching,
    isStale: query.isStale,
    refresh,
    prefetchPair,
  };
}

/**
 * Hook to prefetch order book data for a pair
 * Useful for preloading data on hover or navigation anticipation
 */
export function usePrefetchOrderBook() {
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  return async (pairPda: PublicKey) => {
    await queryClient.prefetchQuery({
      queryKey: orderBookKeys.pair(pairPda.toString()),
      queryFn: () => fetchOrderBook(connection, pairPda),
      staleTime: 10_000,
    });
  };
}

/**
 * Hook to get cached order book data without triggering a fetch
 * Useful for reading data that may have been prefetched
 */
export function useOrderBookCache(pairPda?: PublicKey) {
  const queryClient = useQueryClient();
  const targetPair = pairPda || new PublicKey(SOL_USDC_PAIR_PDA);

  return queryClient.getQueryData<OrderBookData>(
    orderBookKeys.pair(targetPair.toString())
  );
}
