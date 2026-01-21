/**
 * Order State Cache Repository
 *
 * Caches on-chain order state for faster lookups and reduced RPC calls.
 */

import { DatabaseClient } from '../client.js';

export type CachedOrderStatus = 'Open' | 'PartiallyFilled' | 'Filled' | 'Cancelled' | 'Matching';

export interface CachedOrder {
  id: number;
  order_pda: string;
  trading_pair_pda: string;
  side: 'Buy' | 'Sell';
  status: CachedOrderStatus;
  owner: string;
  slot: number;
  created_at: number;
  updated_at: number;
}

export interface CreateCachedOrderInput {
  order_pda: string;
  trading_pair_pda: string;
  side: 'Buy' | 'Sell';
  status: CachedOrderStatus;
  owner: string;
  slot: number;
}

export class OrderStateCacheRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Upsert an order into the cache
   */
  upsert(input: CreateCachedOrderInput): void {
    this.db.run(
      `INSERT INTO order_state_cache (order_pda, trading_pair_pda, side, status, owner, slot)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(order_pda) DO UPDATE SET
         status = excluded.status,
         slot = excluded.slot,
         updated_at = strftime('%s', 'now')
       WHERE excluded.slot >= order_state_cache.slot`,
      input.order_pda,
      input.trading_pair_pda,
      input.side,
      input.status,
      input.owner,
      input.slot
    );
  }

  /**
   * Update order status
   */
  updateStatus(orderPda: string, status: CachedOrderStatus, slot: number): boolean {
    const result = this.db.run(
      `UPDATE order_state_cache
       SET status = ?, slot = ?, updated_at = strftime('%s', 'now')
       WHERE order_pda = ? AND slot <= ?`,
      status,
      slot,
      orderPda,
      slot
    );
    return result.changes > 0;
  }

  /**
   * Get order by PDA
   */
  getByPda(orderPda: string): CachedOrder | undefined {
    return this.db.get<CachedOrder>(
      'SELECT * FROM order_state_cache WHERE order_pda = ?',
      orderPda
    );
  }

  /**
   * Find open orders for a trading pair
   */
  findOpenByTradingPair(tradingPairPda: string, side?: 'Buy' | 'Sell'): CachedOrder[] {
    if (side) {
      return this.db.all<CachedOrder>(
        `SELECT * FROM order_state_cache
         WHERE trading_pair_pda = ? AND side = ? AND status IN ('Open', 'PartiallyFilled')
         ORDER BY created_at ASC`,
        tradingPairPda,
        side
      );
    }

    return this.db.all<CachedOrder>(
      `SELECT * FROM order_state_cache
       WHERE trading_pair_pda = ? AND status IN ('Open', 'PartiallyFilled')
       ORDER BY created_at ASC`,
      tradingPairPda
    );
  }

  /**
   * Find all open buy orders for a trading pair
   */
  findOpenBuyOrders(tradingPairPda: string, limit = 100): CachedOrder[] {
    return this.db.all<CachedOrder>(
      `SELECT * FROM order_state_cache
       WHERE trading_pair_pda = ? AND side = 'Buy' AND status IN ('Open', 'PartiallyFilled')
       ORDER BY created_at ASC
       LIMIT ?`,
      tradingPairPda,
      limit
    );
  }

  /**
   * Find all open sell orders for a trading pair
   */
  findOpenSellOrders(tradingPairPda: string, limit = 100): CachedOrder[] {
    return this.db.all<CachedOrder>(
      `SELECT * FROM order_state_cache
       WHERE trading_pair_pda = ? AND side = 'Sell' AND status IN ('Open', 'PartiallyFilled')
       ORDER BY created_at ASC
       LIMIT ?`,
      tradingPairPda,
      limit
    );
  }

  /**
   * Find orders by owner
   */
  findByOwner(owner: string): CachedOrder[] {
    return this.db.all<CachedOrder>(
      `SELECT * FROM order_state_cache WHERE owner = ? ORDER BY created_at DESC`,
      owner
    );
  }

  /**
   * Find orders currently being matched
   */
  findMatching(): CachedOrder[] {
    return this.db.all<CachedOrder>(
      `SELECT * FROM order_state_cache WHERE status = 'Matching' ORDER BY updated_at ASC`
    );
  }

  /**
   * Delete order from cache
   */
  delete(orderPda: string): boolean {
    const result = this.db.run(
      'DELETE FROM order_state_cache WHERE order_pda = ?',
      orderPda
    );
    return result.changes > 0;
  }

  /**
   * Delete orders that are filled or cancelled (cleanup)
   */
  deleteFinalized(daysOld = 1): number {
    const cutoff = Math.floor(Date.now() / 1000) - daysOld * 24 * 60 * 60;
    const result = this.db.run(
      `DELETE FROM order_state_cache
       WHERE status IN ('Filled', 'Cancelled') AND updated_at < ?`,
      cutoff
    );
    return result.changes;
  }

  /**
   * Get count of open orders by trading pair
   */
  getOpenOrderCount(tradingPairPda?: string): number {
    if (tradingPairPda) {
      const row = this.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM order_state_cache
         WHERE trading_pair_pda = ? AND status IN ('Open', 'PartiallyFilled')`,
        tradingPairPda
      );
      return row?.count ?? 0;
    }

    const row = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM order_state_cache
       WHERE status IN ('Open', 'PartiallyFilled')`
    );
    return row?.count ?? 0;
  }

  /**
   * Get cache stats
   */
  getStats(): { total: number; byStatus: Record<CachedOrderStatus, number> } {
    const total = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM order_state_cache'
    )?.count ?? 0;

    const rows = this.db.all<{ status: CachedOrderStatus; count: number }>(
      'SELECT status, COUNT(*) as count FROM order_state_cache GROUP BY status'
    );

    const byStatus: Record<CachedOrderStatus, number> = {
      Open: 0,
      PartiallyFilled: 0,
      Filled: 0,
      Cancelled: 0,
      Matching: 0,
    };

    for (const row of rows) {
      byStatus[row.status] = row.count;
    }

    return { total, byStatus };
  }

  /**
   * Invalidate cache entries older than specified age
   */
  invalidateStale(maxAgeSeconds = 300): number {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    const result = this.db.run(
      `DELETE FROM order_state_cache WHERE updated_at < ?`,
      cutoff
    );
    return result.changes;
  }
}
