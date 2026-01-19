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

// PDA seeds
const PAIR_SEED = Buffer.from('pair');

// Account sizes
const ORDER_ACCOUNT_SIZE = 317;
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

    const createdAt = data.readBigInt64LE(offset);
    offset += 8;

    const orderId = data.readBigUInt64LE(offset);
    offset += 8;

    const eligibilityProofVerified = data.readUInt8(offset) === 1;
    offset += 1;

    const pendingMatchRequest = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const bump = data.readUInt8(offset);

    return {
      maker,
      pair,
      side,
      orderType,
      encryptedAmount,
      encryptedPrice,
      encryptedFilled,
      status,
      createdAt,
      orderId,
      eligibilityProofVerified,
      pendingMatchRequest,
      bump,
    };
  }

  /**
   * Fetch all open orders for a specific trading pair
   */
  async fetchOpenOrdersForPair(pairPda: PublicKey): Promise<OrderWithPda[]> {
    try {
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [
          { dataSize: ORDER_ACCOUNT_SIZE },
          { memcmp: { offset: 8 + 32, bytes: pairPda.toBase58() } }, // pair field at offset 40
        ],
      });

      const orders: OrderWithPda[] = [];
      for (const { pubkey, account } of accounts) {
        const order = this.parseOrder(account.data);
        // Filter for open/partially filled orders
        if (order.status === OrderStatus.Open || order.status === OrderStatus.PartiallyFilled) {
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
   */
  async fetchAllOpenOrders(): Promise<OrderWithPda[]> {
    try {
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [
          { dataSize: ORDER_ACCOUNT_SIZE },
        ],
      });

      const orders: OrderWithPda[] = [];
      for (const { pubkey, account } of accounts) {
        const order = this.parseOrder(account.data);
        // Filter for open/partially filled orders with verified eligibility
        if (
          (order.status === OrderStatus.Open || order.status === OrderStatus.PartiallyFilled) &&
          order.eligibilityProofVerified
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
