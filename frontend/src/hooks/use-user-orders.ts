'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { CONFIDEX_PROGRAM_ID, SOL_USDC_PAIR_PDA, TRADING_PAIRS } from '@/lib/constants';
import { useOrderStore, Order, OrderStatus as StoreOrderStatus } from '@/stores/order-store';
import { createLogger } from '@/lib/logger';

const log = createLogger('use-user-orders');

// V5 order account size (366 bytes) - see CLAUDE.md for format
const ORDER_ACCOUNT_SIZE_V5 = 366;

// Rate limiting configuration
const MIN_FETCH_INTERVAL_MS = 10000; // Minimum 10 seconds between fetches
const DEFAULT_REFRESH_INTERVAL_MS = 15000; // Default 15 second polling
const BACKOFF_MULTIPLIER = 2;
const MAX_BACKOFF_MS = 60000; // Max 60 second backoff

// Order status enum matching on-chain
enum OnChainOrderStatus {
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

// Order type enum
enum OrderType {
  Limit = 0,
  Market = 1,
}

export interface OnChainOrder {
  pubkey: PublicKey;
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  encryptedFilled: Uint8Array;
  status: OnChainOrderStatus;
  createdAtHour: bigint;
  orderId: Uint8Array;
  orderNonce: bigint;
  isMatching: boolean;
}

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
 */
function parseV5Order(pubkey: PublicKey, data: Uint8Array): OnChainOrder | null {
  if (data.length !== ORDER_ACCOUNT_SIZE_V5) {
    return null;
  }

  const maker = new PublicKey(data.slice(8, 40));
  const pair = new PublicKey(data.slice(40, 72));
  const side = data[72] as Side;
  const orderType = data[73] as OrderType;
  const encryptedAmount = data.slice(74, 138);
  const encryptedPrice = data.slice(138, 202);
  const encryptedFilled = data.slice(202, 266);
  const status = data[266] as OnChainOrderStatus;

  // Extract created_at_hour (u64 little-endian)
  const createdAtView = new DataView(data.buffer, data.byteOffset + 267, 8);
  const createdAtHour = createdAtView.getBigUint64(0, true);

  const orderId = data.slice(275, 291);

  // Extract order_nonce (u64 little-endian)
  const nonceView = new DataView(data.buffer, data.byteOffset + 291, 8);
  const orderNonce = nonceView.getBigUint64(0, true);

  const isMatching = data[332] === 1;

  return {
    pubkey,
    maker,
    pair,
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    encryptedFilled,
    status,
    createdAtHour,
    orderId,
    orderNonce,
    isMatching,
  };
}

/**
 * Map on-chain order status to store status
 */
function mapOnChainStatus(status: OnChainOrderStatus, isMatching: boolean): StoreOrderStatus {
  if (isMatching) return 'pending';

  switch (status) {
    case OnChainOrderStatus.Active:
      return 'open';
    case OnChainOrderStatus.Filled:
      return 'filled';
    case OnChainOrderStatus.Cancelled:
      return 'cancelled';
    case OnChainOrderStatus.Expired:
      return 'cancelled';
    case OnChainOrderStatus.Matching:
      return 'pending';
    default:
      return 'open';
  }
}

/**
 * Convert on-chain order to store format
 */
function toStoreOrder(order: OnChainOrder): Order {
  // Find the pair config based on pair PDA
  const pairPda = order.pair.toBase58();
  let pairName = 'SOL/USDC';
  let baseMint = TRADING_PAIRS[0].baseMint;
  let quoteMint = TRADING_PAIRS[0].quoteMint;

  // For now we only have SOL/USDC, but this allows for future pairs
  if (pairPda === SOL_USDC_PAIR_PDA) {
    pairName = 'SOL/USDC';
    baseMint = TRADING_PAIRS[0].baseMint;
    quoteMint = TRADING_PAIRS[0].quoteMint;
  }

  return {
    id: order.pubkey.toBase58(),
    orderNonce: order.orderNonce,
    maker: order.maker,
    pair: pairName,
    baseMint,
    quoteMint,
    side: order.side === Side.Buy ? 'buy' : 'sell',
    type: order.orderType === OrderType.Limit ? 'limit' : 'market',
    encryptedAmount: order.encryptedAmount,
    encryptedPrice: order.encryptedPrice,
    encryptedFilled: order.encryptedFilled,
    status: mapOnChainStatus(order.status, order.isMatching),
    createdAt: new Date(Number(order.createdAtHour) * 3600 * 1000), // Convert hours to ms
    filledPercent: 0, // Can't determine without MPC decryption
  };
}

/**
 * Hook to fetch the current user's open orders from on-chain
 * Syncs with the order store to provide persistence across refreshes
 */
export function useUserOrders(refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { openOrders, addOrder, removeOrder } = useOrderStore();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [onChainOrders, setOnChainOrders] = useState<OnChainOrder[]>([]);

  // Track if component is mounted
  const mountedRef = useRef(true);

  // Track last fetch time and backoff for rate limiting
  const lastFetchRef = useRef<number>(0);
  const backoffRef = useRef<number>(refreshIntervalMs);
  const fetchInProgressRef = useRef<boolean>(false);

  // Track which orders we've synced to avoid duplicates
  const syncedOrdersRef = useRef<Set<string>>(new Set());

  const fetchUserOrders = useCallback(async (force = false) => {
    if (!connection || !publicKey) {
      setIsLoading(false);
      return;
    }

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

    fetchInProgressRef.current = true;
    lastFetchRef.current = now;
    setIsLoading(true);

    try {
      log.debug('Fetching user orders', { maker: publicKey.toBase58() });

      // Fetch all V5 orders and filter by maker
      // Note: We could optimize this with a memcmp filter on maker, but the offset (8)
      // would need the discriminator, which we don't know exactly
      const accounts = await connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [
          { dataSize: ORDER_ACCOUNT_SIZE_V5 },
          // Filter by maker pubkey at offset 8
          {
            memcmp: {
              offset: 8,
              bytes: publicKey.toBase58(),
            },
          },
        ],
      });

      // Reset backoff on success
      backoffRef.current = refreshIntervalMs;

      // Parse orders
      const parsedOrders: OnChainOrder[] = [];
      for (const { pubkey, account } of accounts) {
        const order = parseV5Order(pubkey, account.data as Uint8Array);
        if (order) {
          parsedOrders.push(order);
        }
      }

      log.debug('Fetched user orders', {
        count: parsedOrders.length,
        activeCount: parsedOrders.filter(o => o.status === OnChainOrderStatus.Active).length,
      });

      if (mountedRef.current) {
        setOnChainOrders(parsedOrders);
        setIsLoading(false);
        setError(null);
        setLastUpdate(new Date());

        // Sync active orders with the store
        const activeOrders = parsedOrders.filter(
          o => o.status === OnChainOrderStatus.Active || o.status === OnChainOrderStatus.Matching
        );

        // Get current order IDs in store
        const storeOrderIds = new Set(openOrders.map(o => o.id));

        // Add new orders that aren't in the store
        for (const order of activeOrders) {
          const orderId = order.pubkey.toBase58();
          if (!storeOrderIds.has(orderId) && !syncedOrdersRef.current.has(orderId)) {
            syncedOrdersRef.current.add(orderId);
            addOrder(toStoreOrder(order));
            log.debug('Added order to store from chain', { orderId });
          }
        }

        // Remove orders from store that are no longer active on-chain
        const activeOrderIds = new Set(activeOrders.map(o => o.pubkey.toBase58()));
        for (const storeOrder of openOrders) {
          if (!activeOrderIds.has(storeOrder.id)) {
            // Order is in store but not active on-chain - might be filled/cancelled
            // Only remove if we're sure it came from on-chain (has orderNonce)
            if (storeOrder.orderNonce !== undefined) {
              // Check if the order exists at all (might be filled/cancelled)
              const onChainOrder = parsedOrders.find(o => o.pubkey.toBase58() === storeOrder.id);
              if (onChainOrder && onChainOrder.status !== OnChainOrderStatus.Active) {
                removeOrder(storeOrder.id);
                syncedOrdersRef.current.delete(storeOrder.id);
                log.debug('Removed completed order from store', {
                  orderId: storeOrder.id,
                  status: OnChainOrderStatus[onChainOrder.status],
                });
              }
            }
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to fetch user orders';

      // Check if it's a rate limit error (429)
      const is429 = errMsg.includes('429') || errMsg.includes('Too many requests');

      if (is429) {
        // Increase backoff on rate limit
        backoffRef.current = Math.min(backoffRef.current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
        log.warn('Rate limited, backing off', { backoffMs: backoffRef.current });
      } else {
        log.error('Error fetching user orders', { error: errMsg });
      }

      if (mountedRef.current) {
        setError(is429 ? 'Rate limited - retrying soon' : errMsg);
        setIsLoading(false);
      }
    } finally {
      fetchInProgressRef.current = false;
    }
  }, [connection, publicKey, refreshIntervalMs, openOrders, addOrder, removeOrder]);

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true;

    if (!connected || !publicKey) {
      setIsLoading(false);
      setOnChainOrders([]);
      return;
    }

    // Initial fetch after a short delay
    const initialDelay = setTimeout(() => {
      fetchUserOrders();
    }, 500);

    // Set up polling interval with dynamic backoff
    const pollInterval = setInterval(() => {
      fetchUserOrders();
    }, Math.max(refreshIntervalMs, backoffRef.current));

    return () => {
      mountedRef.current = false;
      clearTimeout(initialDelay);
      clearInterval(pollInterval);
    };
  }, [connected, publicKey?.toBase58(), refreshIntervalMs]);

  // Expose refresh trigger that bypasses rate limiting
  const refresh = useCallback(() => {
    fetchUserOrders(true);
  }, [fetchUserOrders]);

  return {
    orders: onChainOrders,
    activeOrders: onChainOrders.filter(
      o => o.status === OnChainOrderStatus.Active || o.status === OnChainOrderStatus.Matching
    ),
    isLoading,
    error,
    lastUpdate,
    refresh,
  };
}
