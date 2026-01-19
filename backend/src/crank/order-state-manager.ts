/**
 * Order State Manager
 *
 * Manages order locks to prevent double-matching.
 * Tracks pending MPC computations for async flow.
 */

import { OrderLock } from './types.js';

export class OrderStateManager {
  // Order locks: orderPda -> lock info
  private locks: Map<string, OrderLock> = new Map();

  // Lock expiration time (60 seconds)
  private lockExpirationMs: number = 60_000;

  // MPC request expiration (2 minutes for async flow)
  private mpcExpirationMs: number = 120_000;

  /**
   * Attempt to acquire locks for a buy/sell pair
   * Returns true if both locks acquired, false if either is already locked
   */
  acquireLocks(buyOrderPda: string, sellOrderPda: string, requestId?: string): boolean {
    // Clean up expired locks first
    this.cleanupExpiredLocks();

    // Check if either order is already locked
    if (this.locks.has(buyOrderPda) || this.locks.has(sellOrderPda)) {
      return false;
    }

    const now = Date.now();

    // Acquire both locks atomically
    this.locks.set(buyOrderPda, {
      orderPda: buyOrderPda,
      lockedAt: now,
      matchPartner: sellOrderPda,
      requestId,
    });

    this.locks.set(sellOrderPda, {
      orderPda: sellOrderPda,
      lockedAt: now,
      matchPartner: buyOrderPda,
      requestId,
    });

    console.log(`[OrderStateManager] Acquired locks for ${buyOrderPda.slice(0, 8)}... and ${sellOrderPda.slice(0, 8)}...`);
    return true;
  }

  /**
   * Release locks for a buy/sell pair
   */
  releaseLocks(buyOrderPda: string, sellOrderPda: string): void {
    this.locks.delete(buyOrderPda);
    this.locks.delete(sellOrderPda);
    console.log(`[OrderStateManager] Released locks for ${buyOrderPda.slice(0, 8)}... and ${sellOrderPda.slice(0, 8)}...`);
  }

  /**
   * Release lock for a single order
   */
  releaseLock(orderPda: string): void {
    const lock = this.locks.get(orderPda);
    if (lock?.matchPartner) {
      this.locks.delete(lock.matchPartner);
    }
    this.locks.delete(orderPda);
  }

  /**
   * Check if an order is locked
   */
  isLocked(orderPda: string): boolean {
    this.cleanupExpiredLocks();
    return this.locks.has(orderPda);
  }

  /**
   * Get all locked order PDAs
   */
  getLockedOrders(): Set<string> {
    this.cleanupExpiredLocks();
    return new Set(this.locks.keys());
  }

  /**
   * Get lock info for an order
   */
  getLockInfo(orderPda: string): OrderLock | undefined {
    return this.locks.get(orderPda);
  }

  /**
   * Update lock with MPC request ID (for async flow tracking)
   */
  setMpcRequestId(orderPda: string, requestId: string): void {
    const lock = this.locks.get(orderPda);
    if (lock) {
      lock.requestId = requestId;
    }
  }

  /**
   * Get pending match count
   */
  getPendingMatchCount(): number {
    this.cleanupExpiredLocks();
    // Each match involves 2 orders, so divide by 2
    return Math.floor(this.locks.size / 2);
  }

  /**
   * Clean up expired locks
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, lock] of this.locks) {
      const expirationTime = lock.requestId
        ? this.mpcExpirationMs  // Longer expiration for MPC requests
        : this.lockExpirationMs;

      if (now - lock.lockedAt > expirationTime) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      console.log(`[OrderStateManager] Expired lock: ${key.slice(0, 8)}...`);
      this.locks.delete(key);
    }
  }

  /**
   * Force clear all locks (for testing/admin)
   */
  clearAllLocks(): void {
    const count = this.locks.size;
    this.locks.clear();
    console.log(`[OrderStateManager] Cleared ${count} locks`);
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { totalLocks: number; pendingMatches: number; oldestLockAge: number } {
    this.cleanupExpiredLocks();
    const now = Date.now();

    let oldestLockAge = 0;
    for (const lock of this.locks.values()) {
      const age = now - lock.lockedAt;
      if (age > oldestLockAge) {
        oldestLockAge = age;
      }
    }

    return {
      totalLocks: this.locks.size,
      pendingMatches: Math.floor(this.locks.size / 2),
      oldestLockAge,
    };
  }
}
