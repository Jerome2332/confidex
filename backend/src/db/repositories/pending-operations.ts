/**
 * Pending Operations Repository
 *
 * Tracks pending MPC matches and settlements for recovery after restart.
 */

import { DatabaseClient } from '../client.js';

export type OperationType = 'match' | 'settlement' | 'mpc_callback';
export type OperationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface PendingOperation {
  id: number;
  operation_type: OperationType;
  operation_key: string;
  status: OperationStatus;
  payload: string; // JSON stringified
  retry_count: number;
  max_retries: number;
  last_error?: string;
  locked_by?: string;
  locked_at?: number;
  created_at: number;
  updated_at: number;
}

export interface MatchPayload {
  buyOrderPda: string;
  sellOrderPda: string;
  tradingPairPda: string;
  mpcRequestId?: string;
}

export interface SettlementPayload {
  matchId: string;
  buyOrderPda: string;
  sellOrderPda: string;
  fillAmount: string; // BigInt as string
  buyerPubkey: string;
  sellerPubkey: string;
}

export interface CreateOperationInput {
  operation_type: OperationType;
  operation_key: string;
  payload: string;
  max_retries?: number;
}

export class PendingOperationsRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new pending operation
   */
  create(input: CreateOperationInput): number {
    const result = this.db.run(
      `INSERT INTO pending_operations
       (operation_type, operation_key, status, payload, retry_count, max_retries)
       VALUES (?, ?, 'pending', ?, 0, ?)`,
      input.operation_type,
      input.operation_key,
      input.payload,
      input.max_retries ?? 3
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Find operations ready to process (pending and not locked)
   */
  findReadyToProcess(type?: OperationType, limit = 50): PendingOperation[] {
    const now = Math.floor(Date.now() / 1000);
    const lockTimeout = 300; // 5 minutes

    if (type) {
      return this.db.all<PendingOperation>(
        `SELECT * FROM pending_operations
         WHERE operation_type = ?
         AND status IN ('pending', 'in_progress')
         AND retry_count < max_retries
         AND (locked_by IS NULL OR locked_at < ?)
         ORDER BY created_at ASC
         LIMIT ?`,
        type,
        now - lockTimeout,
        limit
      );
    }

    return this.db.all<PendingOperation>(
      `SELECT * FROM pending_operations
       WHERE status IN ('pending', 'in_progress')
       AND retry_count < max_retries
       AND (locked_by IS NULL OR locked_at < ?)
       ORDER BY created_at ASC
       LIMIT ?`,
      now - lockTimeout,
      limit
    );
  }

  /**
   * Mark operation as in progress with lock
   */
  markInProgress(id: number, lockedBy: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const lockTimeout = 300;

    const result = this.db.run(
      `UPDATE pending_operations
       SET status = 'in_progress', locked_by = ?, locked_at = ?, updated_at = strftime('%s', 'now')
       WHERE id = ?
       AND (locked_by IS NULL OR locked_by = ? OR locked_at < ?)`,
      lockedBy,
      now,
      id,
      lockedBy,
      now - lockTimeout
    );
    return result.changes > 0;
  }

  /**
   * Mark operation as completed
   */
  markCompleted(id: number): boolean {
    const result = this.db.run(
      `UPDATE pending_operations
       SET status = 'completed', locked_by = NULL, locked_at = NULL, updated_at = strftime('%s', 'now')
       WHERE id = ?`,
      id
    );
    return result.changes > 0;
  }

  /**
   * Mark operation as failed with error
   */
  markFailed(id: number, error: string): boolean {
    const result = this.db.run(
      `UPDATE pending_operations
       SET status = 'failed', last_error = ?, retry_count = retry_count + 1,
           locked_by = NULL, locked_at = NULL, updated_at = strftime('%s', 'now')
       WHERE id = ?`,
      error,
      id
    );
    return result.changes > 0;
  }

  /**
   * Reset operation for retry
   */
  resetForRetry(id: number): boolean {
    const result = this.db.run(
      `UPDATE pending_operations
       SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = strftime('%s', 'now')
       WHERE id = ? AND retry_count < max_retries`,
      id
    );
    return result.changes > 0;
  }

  /**
   * Find operation by key
   */
  findByKey(operationKey: string): PendingOperation | undefined {
    return this.db.get<PendingOperation>(
      'SELECT * FROM pending_operations WHERE operation_key = ?',
      operationKey
    );
  }

  /**
   * Find operation by ID
   */
  findById(id: number): PendingOperation | undefined {
    return this.db.get<PendingOperation>(
      'SELECT * FROM pending_operations WHERE id = ?',
      id
    );
  }

  /**
   * Check if operation exists (for deduplication)
   */
  exists(operationKey: string): boolean {
    const row = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM pending_operations
       WHERE operation_key = ? AND status NOT IN ('completed', 'failed')`,
      operationKey
    );
    return (row?.count ?? 0) > 0;
  }

  /**
   * Delete completed operations older than specified days
   */
  deleteCompleted(daysOld = 7): number {
    const cutoff = Math.floor(Date.now() / 1000) - daysOld * 24 * 60 * 60;
    const result = this.db.run(
      `DELETE FROM pending_operations
       WHERE status = 'completed' AND updated_at < ?`,
      cutoff
    );
    return result.changes;
  }

  /**
   * Delete failed operations older than specified days
   */
  deleteFailed(daysOld = 30): number {
    const cutoff = Math.floor(Date.now() / 1000) - daysOld * 24 * 60 * 60;
    const result = this.db.run(
      `DELETE FROM pending_operations
       WHERE status = 'failed' AND updated_at < ?`,
      cutoff
    );
    return result.changes;
  }

  /**
   * Get counts by status
   */
  getCountByStatus(): Record<OperationStatus, number> {
    const rows = this.db.all<{ status: OperationStatus; count: number }>(
      `SELECT status, COUNT(*) as count FROM pending_operations GROUP BY status`
    );

    const result: Record<OperationStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };

    for (const row of rows) {
      result[row.status] = row.count;
    }

    return result;
  }

  /**
   * Release stale locks (for operations locked too long)
   */
  releaseStaleLocks(lockTimeoutSeconds = 300): number {
    const cutoff = Math.floor(Date.now() / 1000) - lockTimeoutSeconds;
    const result = this.db.run(
      `UPDATE pending_operations
       SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = strftime('%s', 'now')
       WHERE status = 'in_progress' AND locked_at < ?`,
      cutoff
    );
    return result.changes;
  }
}
