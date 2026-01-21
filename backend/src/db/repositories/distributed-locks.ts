/**
 * Distributed Locks Repository
 *
 * Provides database-backed distributed locking for multi-instance coordination.
 */

import { DatabaseClient } from '../client.js';

export interface DistributedLock {
  id: number;
  lock_name: string;
  owner_id: string;
  acquired_at: number;
  expires_at: number;
  metadata?: string;
}

export class DistributedLocksRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Attempt to acquire a lock
   * Returns true if lock was acquired, false if already held by another owner
   */
  acquire(lockName: string, ownerId: string, ttlSeconds = 60, metadata?: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;

    // Try to insert new lock or update if expired
    const result = this.db.run(
      `INSERT INTO distributed_locks (lock_name, owner_id, acquired_at, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lock_name) DO UPDATE SET
         owner_id = excluded.owner_id,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at,
         metadata = excluded.metadata
       WHERE distributed_locks.expires_at < ? OR distributed_locks.owner_id = ?`,
      lockName,
      ownerId,
      now,
      expiresAt,
      metadata ?? null,
      now,
      ownerId
    );

    // Check if we actually hold the lock now
    const lock = this.get(lockName);
    return lock !== undefined && lock.owner_id === ownerId;
  }

  /**
   * Release a lock (only if owned by the specified owner)
   */
  release(lockName: string, ownerId: string): boolean {
    const result = this.db.run(
      `DELETE FROM distributed_locks WHERE lock_name = ? AND owner_id = ?`,
      lockName,
      ownerId
    );
    return result.changes > 0;
  }

  /**
   * Extend a lock's TTL (only if owned by the specified owner)
   */
  extend(lockName: string, ownerId: string, ttlSeconds = 60): boolean {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;

    const result = this.db.run(
      `UPDATE distributed_locks
       SET expires_at = ?
       WHERE lock_name = ? AND owner_id = ? AND expires_at > ?`,
      expiresAt,
      lockName,
      ownerId,
      now
    );
    return result.changes > 0;
  }

  /**
   * Check if a lock is currently held
   */
  isHeld(lockName: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const lock = this.db.get<DistributedLock>(
      `SELECT * FROM distributed_locks WHERE lock_name = ? AND expires_at > ?`,
      lockName,
      now
    );
    return lock !== undefined;
  }

  /**
   * Check if a specific owner holds the lock
   */
  isHeldBy(lockName: string, ownerId: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const lock = this.db.get<DistributedLock>(
      `SELECT * FROM distributed_locks WHERE lock_name = ? AND owner_id = ? AND expires_at > ?`,
      lockName,
      ownerId,
      now
    );
    return lock !== undefined;
  }

  /**
   * Get lock info
   */
  get(lockName: string): DistributedLock | undefined {
    const now = Math.floor(Date.now() / 1000);
    return this.db.get<DistributedLock>(
      `SELECT * FROM distributed_locks WHERE lock_name = ? AND expires_at > ?`,
      lockName,
      now
    );
  }

  /**
   * Release all locks owned by a specific owner (for graceful shutdown)
   */
  releaseAllByOwner(ownerId: string): number {
    const result = this.db.run(
      `DELETE FROM distributed_locks WHERE owner_id = ?`,
      ownerId
    );
    return result.changes;
  }

  /**
   * Clean up expired locks
   */
  cleanupExpired(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.run(
      `DELETE FROM distributed_locks WHERE expires_at < ?`,
      now
    );
    return result.changes;
  }

  /**
   * List all active locks
   */
  listActive(): DistributedLock[] {
    const now = Math.floor(Date.now() / 1000);
    return this.db.all<DistributedLock>(
      `SELECT * FROM distributed_locks WHERE expires_at > ? ORDER BY acquired_at ASC`,
      now
    );
  }

  /**
   * List locks by owner
   */
  listByOwner(ownerId: string): DistributedLock[] {
    const now = Math.floor(Date.now() / 1000);
    return this.db.all<DistributedLock>(
      `SELECT * FROM distributed_locks WHERE owner_id = ? AND expires_at > ? ORDER BY acquired_at ASC`,
      ownerId,
      now
    );
  }
}
