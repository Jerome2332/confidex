/**
 * MPC Processed Requests Repository
 *
 * Persists which MPC computation requests and events have been processed
 * to prevent duplicate processing after service restart.
 */

import { DatabaseClient } from '../client.js';

export type MpcRequestType = 'computation' | 'event';
export type MpcRequestStatus = 'processed' | 'failed';

export interface MpcProcessedRequest {
  id: number;
  request_key: string;
  request_type: MpcRequestType;
  status: MpcRequestStatus;
  computation_type?: string;
  tx_signature?: string;
  error_message?: string;
  created_at: number;
}

export interface CreateMpcProcessedInput {
  request_key: string;
  request_type: MpcRequestType;
  status: MpcRequestStatus;
  computation_type?: string;
  tx_signature?: string;
  error_message?: string;
}

export class MpcProcessedRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Mark a request as processed or failed
   */
  markProcessed(input: CreateMpcProcessedInput): number {
    const result = this.db.run(
      `INSERT OR REPLACE INTO mpc_processed_requests
       (request_key, request_type, status, computation_type, tx_signature, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.request_key,
      input.request_type,
      input.status,
      input.computation_type ?? null,
      input.tx_signature ?? null,
      input.error_message ?? null
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Check if a request has been processed
   */
  isProcessed(requestKey: string): boolean {
    const row = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM mpc_processed_requests WHERE request_key = ?`,
      requestKey
    );
    return (row?.count ?? 0) > 0;
  }

  /**
   * Check if a request has failed permanently
   */
  isFailed(requestKey: string): boolean {
    const row = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM mpc_processed_requests
       WHERE request_key = ? AND status = 'failed'`,
      requestKey
    );
    return (row?.count ?? 0) > 0;
  }

  /**
   * Get a processed request by key
   */
  findByKey(requestKey: string): MpcProcessedRequest | undefined {
    return this.db.get<MpcProcessedRequest>(
      'SELECT * FROM mpc_processed_requests WHERE request_key = ?',
      requestKey
    );
  }

  /**
   * Get all processed request keys (for loading into memory cache)
   */
  getAllProcessedKeys(requestType?: MpcRequestType): string[] {
    if (requestType) {
      const rows = this.db.all<{ request_key: string }>(
        `SELECT request_key FROM mpc_processed_requests
         WHERE request_type = ? AND status = 'processed'`,
        requestType
      );
      return rows.map(r => r.request_key);
    }

    const rows = this.db.all<{ request_key: string }>(
      `SELECT request_key FROM mpc_processed_requests WHERE status = 'processed'`
    );
    return rows.map(r => r.request_key);
  }

  /**
   * Get all failed request keys (for loading into memory cache)
   */
  getAllFailedKeys(requestType?: MpcRequestType): string[] {
    if (requestType) {
      const rows = this.db.all<{ request_key: string }>(
        `SELECT request_key FROM mpc_processed_requests
         WHERE request_type = ? AND status = 'failed'`,
        requestType
      );
      return rows.map(r => r.request_key);
    }

    const rows = this.db.all<{ request_key: string }>(
      `SELECT request_key FROM mpc_processed_requests WHERE status = 'failed'`
    );
    return rows.map(r => r.request_key);
  }

  /**
   * Get counts by status
   */
  getCountByStatus(): Record<MpcRequestStatus, number> {
    const rows = this.db.all<{ status: MpcRequestStatus; count: number }>(
      `SELECT status, COUNT(*) as count FROM mpc_processed_requests GROUP BY status`
    );

    const result: Record<MpcRequestStatus, number> = {
      processed: 0,
      failed: 0,
    };

    for (const row of rows) {
      result[row.status] = row.count;
    }

    return result;
  }

  /**
   * Delete old processed requests (keep recent for audit trail)
   */
  deleteOldRecords(daysOld = 7): number {
    const cutoff = Math.floor(Date.now() / 1000) - daysOld * 24 * 60 * 60;
    const result = this.db.run(
      `DELETE FROM mpc_processed_requests WHERE created_at < ?`,
      cutoff
    );
    return result.changes;
  }

  /**
   * Get total count
   */
  getTotalCount(): number {
    const row = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM mpc_processed_requests'
    );
    return row?.count ?? 0;
  }
}
