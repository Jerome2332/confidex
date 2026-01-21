/**
 * Transaction History Repository
 *
 * Persists transaction history for all crank operations.
 * Enables recovery and deduplication after restart.
 */

import { DatabaseClient } from '../client.js';

export type TxType = 'match' | 'settlement' | 'mpc_callback';
export type TxStatus = 'pending' | 'confirmed' | 'failed' | 'expired';

export interface TransactionRecord {
  id: number;
  tx_signature: string;
  tx_type: TxType;
  status: TxStatus;
  buy_order_pda?: string;
  sell_order_pda?: string;
  mpc_request_id?: string;
  error_message?: string;
  slot?: number;
  created_at: number;
  updated_at: number;
}

export interface CreateTransactionInput {
  tx_signature: string;
  tx_type: TxType;
  status: TxStatus;
  buy_order_pda?: string;
  sell_order_pda?: string;
  mpc_request_id?: string;
  error_message?: string;
  slot?: number;
}

export class TransactionHistoryRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new transaction record
   */
  create(record: CreateTransactionInput): number {
    const result = this.db.run(
      `INSERT INTO transaction_history
       (tx_signature, tx_type, status, buy_order_pda, sell_order_pda, mpc_request_id, error_message, slot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      record.tx_signature,
      record.tx_type,
      record.status,
      record.buy_order_pda ?? null,
      record.sell_order_pda ?? null,
      record.mpc_request_id ?? null,
      record.error_message ?? null,
      record.slot ?? null
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Update transaction status
   */
  updateStatus(txSignature: string, status: TxStatus, errorMessage?: string, slot?: number): boolean {
    const result = this.db.run(
      `UPDATE transaction_history
       SET status = ?, error_message = COALESCE(?, error_message), slot = COALESCE(?, slot), updated_at = strftime('%s', 'now')
       WHERE tx_signature = ?`,
      status,
      errorMessage ?? null,
      slot ?? null,
      txSignature
    );
    return result.changes > 0;
  }

  /**
   * Find transaction by signature
   */
  findBySignature(txSignature: string): TransactionRecord | undefined {
    return this.db.get<TransactionRecord>(
      'SELECT * FROM transaction_history WHERE tx_signature = ?',
      txSignature
    );
  }

  /**
   * Find pending transactions by type
   */
  findPendingByType(txType: TxType, limit = 100): TransactionRecord[] {
    return this.db.all<TransactionRecord>(
      `SELECT * FROM transaction_history
       WHERE tx_type = ? AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
      txType,
      limit
    );
  }

  /**
   * Find all pending transactions
   */
  findAllPending(limit = 100): TransactionRecord[] {
    return this.db.all<TransactionRecord>(
      `SELECT * FROM transaction_history
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
      limit
    );
  }

  /**
   * Get recent transaction for an order pair
   */
  getRecentByOrderPair(buyPda: string, sellPda: string, maxAgeSeconds = 300): TransactionRecord | undefined {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    return this.db.get<TransactionRecord>(
      `SELECT * FROM transaction_history
       WHERE buy_order_pda = ? AND sell_order_pda = ? AND created_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
      buyPda,
      sellPda,
      cutoff
    );
  }

  /**
   * Check if an order pair was recently matched
   */
  wasRecentlyMatched(buyPda: string, sellPda: string, maxAgeSeconds = 300): boolean {
    const record = this.getRecentByOrderPair(buyPda, sellPda, maxAgeSeconds);
    return record !== undefined && (record.status === 'confirmed' || record.status === 'pending');
  }

  /**
   * Get transaction count by status
   */
  getCountByStatus(): Record<TxStatus, number> {
    const rows = this.db.all<{ status: TxStatus; count: number }>(
      `SELECT status, COUNT(*) as count FROM transaction_history GROUP BY status`
    );

    const result: Record<TxStatus, number> = {
      pending: 0,
      confirmed: 0,
      failed: 0,
      expired: 0,
    };

    for (const row of rows) {
      result[row.status] = row.count;
    }

    return result;
  }

  /**
   * Cleanup old records
   */
  cleanup(daysToKeep = 30): number {
    const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 24 * 60 * 60;
    const result = this.db.run(
      `DELETE FROM transaction_history
       WHERE created_at < ? AND status IN ('confirmed', 'failed', 'expired')`,
      cutoff
    );
    return result.changes;
  }

  /**
   * Get recent transactions
   */
  getRecent(limit = 50): TransactionRecord[] {
    return this.db.all<TransactionRecord>(
      `SELECT * FROM transaction_history
       ORDER BY created_at DESC
       LIMIT ?`,
      limit
    );
  }
}
