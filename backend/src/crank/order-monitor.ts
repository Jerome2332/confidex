/**
 * Order Monitor
 *
 * Fetches and caches open orders from the Confidex DEX program.
 * Uses getProgramAccounts with memcmp filters for efficient queries.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import {
  ConfidentialOrder,
  OrderWithPda,
  OrderStatus,
  Side,
  TradingPairInfo,
} from './types.js';

// =============================================================================
// SHARED CONSTANTS - Source of truth: lib/src/constants.ts
// TODO: Import from @confidex/sdk when monorepo workspace is configured
// =============================================================================
const PAIR_SEED = Buffer.from('pair');

// Account sizes
// ConfidentialOrder on-chain sizes:
// - V3 (legacy): 334 bytes - DEPRECATED, do not use
// - V4 (hackathon): 390 bytes - had plaintext fields - DEPRECATED
// - V5 (production): 366 bytes - no plaintext fields, privacy hardened
// Only V5 orders are supported for matching
const ORDER_ACCOUNT_SIZE_V5 = 366;
const PAIR_ACCOUNT_SIZE = 234;

export class OrderMonitor {
  private connection: Connection;
  private programId: PublicKey;
  private orderCache: Map<string, OrderWithPda> = new Map();
  private pairCache: Map<string, TradingPairInfo> = new Map();
  private lastFetchTime: number = 0;

  constructor(connection: Connection, programId: PublicKey) {
    this.connection = connection;
    this.programId = programId;
  }

  /**
   * Derive Trading Pair PDA
   */
  derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
      this.programId
    );
  }

  /**
   * Parse ConfidentialOrder from account data
   * V5 format only (366 bytes) - no plaintext fields
   */
  private parseOrder(data: Buffer): ConfidentialOrder {
    let offset = 8; // Skip discriminator

    const maker = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const pair = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const side = data.readUInt8(offset) as Side;
    offset += 1;

    const orderType = data.readUInt8(offset);
    offset += 1;

    const encryptedAmount = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedPrice = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedFilled = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const status = data.readUInt8(offset) as OrderStatus;
    offset += 1;

    // V5: created_at_hour (coarse timestamp for privacy)
    const createdAtHour = data.readBigInt64LE(offset);
    offset += 8;

    // order_id is 16 bytes (hash-based)
    const orderId = new Uint8Array(data.subarray(offset, offset + 16));
    offset += 16;

    // order_nonce is 8 bytes (used for PDA derivation)
    const orderNonce = new Uint8Array(data.subarray(offset, offset + 8));
    offset += 8;

    const eligibilityProofVerified = data.readUInt8(offset) === 1;
    offset += 1;

    // pending_match_request is 32 bytes - parse as PublicKey for comparison
    const pendingMatchRequestBytes = new Uint8Array(data.subarray(offset, offset + 32));
    const pendingMatchRequest = new PublicKey(pendingMatchRequestBytes);
    offset += 32;

    const isMatching = data.readUInt8(offset) === 1;
    offset += 1;

    const bump = data.readUInt8(offset);
    offset += 1;

    // Ephemeral X25519 public key for MPC decryption (32 bytes)
    const ephemeralPubkey = new Uint8Array(data.subarray(offset, offset + 32));

    return {
      maker,
      pair,
      side,
      orderType,
      encryptedAmount,
      encryptedPrice,
      encryptedFilled,
      status,
      isMatching,
      createdAtHour,
      orderId,
      orderNonce,
      eligibilityProofVerified,
      pendingMatchRequest,
      bump,
      ephemeralPubkey,
    };
  }

  /**
   * Fetch all open orders for a specific trading pair
   * V5 format only (366 bytes)
   */
  async fetchOpenOrdersForPair(pairPda: PublicKey): Promise<OrderWithPda[]> {
    try {
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [
          { dataSize: ORDER_ACCOUNT_SIZE_V5 },
          { memcmp: { offset: 8 + 32, bytes: pairPda.toBase58() } },
        ],
      });

      const orders: OrderWithPda[] = [];
      for (const { pubkey, account } of accounts) {
        const order = this.parseOrder(account.data);
        // Filter for Active orders that aren't currently in matching
        if (order.status === OrderStatus.Active && !order.isMatching) {
          orders.push({ pda: pubkey, order });
          this.orderCache.set(pubkey.toString(), { pda: pubkey, order });
        }
      }

      this.lastFetchTime = Date.now();
      return orders;
    } catch (error) {
      console.error('[OrderMonitor] Error fetching orders:', error);
      throw error;
    }
  }

  /**
   * Fetch all open orders across all trading pairs
   * V5 format only (366 bytes)
   */
  async fetchAllOpenOrders(): Promise<OrderWithPda[]> {
    try {
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
      });

      console.log(`[OrderMonitor] Found ${accounts.length} V5 order accounts`);

      const orders: OrderWithPda[] = [];
      for (const { pubkey, account } of accounts) {
        const order = this.parseOrder(account.data);
        // Filter for Active orders with verified eligibility that aren't currently in matching
        if (
          order.status === OrderStatus.Active &&
          order.eligibilityProofVerified &&
          !order.isMatching
        ) {
          orders.push({ pda: pubkey, order });
          this.orderCache.set(pubkey.toString(), { pda: pubkey, order });
        }
      }

      this.lastFetchTime = Date.now();
      console.log(`[OrderMonitor] Fetched ${orders.length} open orders`);
      return orders;
    } catch (error) {
      console.error('[OrderMonitor] Error fetching all orders:', error);
      throw error;
    }
  }

  /**
   * Fetch a single order by PDA
   */
  async fetchOrder(orderPda: PublicKey): Promise<OrderWithPda | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(orderPda);
      if (!accountInfo) {
        this.orderCache.delete(orderPda.toString());
        return null;
      }

      const order = this.parseOrder(accountInfo.data);
      const orderWithPda = { pda: orderPda, order };
      this.orderCache.set(orderPda.toString(), orderWithPda);
      return orderWithPda;
    } catch (error) {
      console.error('[OrderMonitor] Error fetching order:', error);
      return null;
    }
  }

  /**
   * Get cached order (useful for avoiding repeated RPC calls)
   */
  getCachedOrder(orderPda: string): OrderWithPda | undefined {
    return this.orderCache.get(orderPda);
  }

  /**
   * Clear the order cache
   */
  clearCache(): void {
    this.orderCache.clear();
    this.pairCache.clear();
  }

  /**
   * Group orders by trading pair
   */
  groupOrdersByPair(orders: OrderWithPda[]): Map<string, OrderWithPda[]> {
    const grouped = new Map<string, OrderWithPda[]>();

    for (const orderWithPda of orders) {
      const pairKey = orderWithPda.order.pair.toString();
      if (!grouped.has(pairKey)) {
        grouped.set(pairKey, []);
      }
      grouped.get(pairKey)!.push(orderWithPda);
    }

    return grouped;
  }

  /**
   * Get order counts by side
   */
  getOrderCounts(orders: OrderWithPda[]): { buy: number; sell: number } {
    let buy = 0;
    let sell = 0;

    for (const { order } of orders) {
      if (order.side === Side.Buy) {
        buy++;
      } else {
        sell++;
      }
    }

    return { buy, sell };
  }
}
