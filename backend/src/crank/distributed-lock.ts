/**
 * Distributed Lock Service
 *
 * Provides distributed locking for multi-instance crank coordination.
 * Uses SQLite for local development and can be extended to Redis for production.
 */

import { v4 as uuidv4 } from 'uuid';
import { DistributedLocksRepository } from '../db/repositories/distributed-locks.js';

export interface LockOptions {
  /** Time-to-live in seconds (default: 60) */
  ttlSeconds?: number;
  /** Retry acquiring lock if failed (default: false) */
  retry?: boolean;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelayMs?: number;
  /** Optional metadata to attach to lock */
  metadata?: string;
}

export interface AcquiredLock {
  lockName: string;
  ownerId: string;
  release: () => Promise<void>;
  extend: (ttlSeconds?: number) => Promise<boolean>;
  isValid: () => boolean;
}

/**
 * Distributed Lock Service
 *
 * Usage:
 * ```typescript
 * const lock = await lockService.acquire('order-matching');
 * if (lock) {
 *   try {
 *     // do work
 *   } finally {
 *     await lock.release();
 *   }
 * }
 *
 * // Or use withLock helper:
 * await lockService.withLock('order-matching', async () => {
 *   // do work
 * });
 * ```
 */
export class DistributedLockService {
  private readonly instanceId: string;
  private readonly activeLocks = new Map<string, NodeJS.Timeout>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(
    private readonly locksRepo: DistributedLocksRepository,
    options?: { instanceId?: string; heartbeatIntervalMs?: number }
  ) {
    this.instanceId = options?.instanceId ?? `crank-${uuidv4().slice(0, 8)}`;

    // Start heartbeat to extend held locks
    const heartbeatMs = options?.heartbeatIntervalMs ?? 30_000;
    this.heartbeatInterval = setInterval(() => this.heartbeat(), heartbeatMs);
  }

  /**
   * Get the instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Attempt to acquire a lock
   */
  async acquire(lockName: string, options: LockOptions = {}): Promise<AcquiredLock | null> {
    if (this.isShuttingDown) {
      return null;
    }

    const {
      ttlSeconds = 60,
      retry = false,
      maxRetries = 3,
      retryDelayMs = 1000,
      metadata,
    } = options;

    let attempts = 0;
    const maxAttempts = retry ? maxRetries : 1;

    while (attempts < maxAttempts) {
      attempts++;

      const acquired = this.locksRepo.acquire(lockName, this.instanceId, ttlSeconds, metadata);

      if (acquired) {
        return this.createLockHandle(lockName, ttlSeconds);
      }

      if (attempts < maxAttempts) {
        await this.delay(retryDelayMs);
      }
    }

    return null;
  }

  /**
   * Execute callback with lock held
   */
  async withLock<T>(
    lockName: string,
    callback: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T | null> {
    const lock = await this.acquire(lockName, options);

    if (!lock) {
      return null;
    }

    try {
      return await callback();
    } finally {
      await lock.release();
    }
  }

  /**
   * Try to acquire lock without waiting
   */
  tryAcquire(lockName: string, options: Omit<LockOptions, 'retry'> = {}): AcquiredLock | null {
    if (this.isShuttingDown) {
      return null;
    }

    const { ttlSeconds = 60, metadata } = options;

    const acquired = this.locksRepo.acquire(lockName, this.instanceId, ttlSeconds, metadata);

    if (acquired) {
      return this.createLockHandle(lockName, ttlSeconds);
    }

    return null;
  }

  /**
   * Check if this instance holds a specific lock
   */
  holdsLock(lockName: string): boolean {
    return this.locksRepo.isHeldBy(lockName, this.instanceId);
  }

  /**
   * Check if a lock is held by any instance
   */
  isLocked(lockName: string): boolean {
    return this.locksRepo.isHeld(lockName);
  }

  /**
   * Get info about a lock
   */
  getLockInfo(lockName: string) {
    return this.locksRepo.get(lockName);
  }

  /**
   * Release all locks held by this instance (for shutdown)
   */
  releaseAll(): number {
    // Clear all auto-extend timers
    for (const [, timer] of this.activeLocks) {
      clearInterval(timer);
    }
    this.activeLocks.clear();

    return this.locksRepo.releaseAllByOwner(this.instanceId);
  }

  /**
   * List all locks held by this instance
   */
  listHeldLocks() {
    return this.locksRepo.listByOwner(this.instanceId);
  }

  /**
   * Shutdown the lock service gracefully
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Release all locks
    this.releaseAll();
  }

  /**
   * Create a lock handle for managing an acquired lock
   */
  private createLockHandle(lockName: string, ttlSeconds: number): AcquiredLock {
    // Set up auto-extend timer (extend at 50% of TTL)
    const extendInterval = (ttlSeconds * 1000) / 2;
    const timer = setInterval(() => {
      if (!this.isShuttingDown) {
        this.locksRepo.extend(lockName, this.instanceId, ttlSeconds);
      }
    }, extendInterval);

    this.activeLocks.set(lockName, timer);

    return {
      lockName,
      ownerId: this.instanceId,

      release: async () => {
        const timer = this.activeLocks.get(lockName);
        if (timer) {
          clearInterval(timer);
          this.activeLocks.delete(lockName);
        }
        this.locksRepo.release(lockName, this.instanceId);
      },

      extend: async (newTtl?: number) => {
        return this.locksRepo.extend(lockName, this.instanceId, newTtl ?? ttlSeconds);
      },

      isValid: () => {
        return this.locksRepo.isHeldBy(lockName, this.instanceId);
      },
    };
  }

  /**
   * Heartbeat to extend all held locks
   */
  private heartbeat(): void {
    if (this.isShuttingDown) return;

    const heldLocks = this.locksRepo.listByOwner(this.instanceId);
    for (const lock of heldLocks) {
      // Extend by 60 seconds
      this.locksRepo.extend(lock.lock_name, this.instanceId, 60);
    }
  }

  /**
   * Promise-based delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Well-known lock names for crank operations
 */
export const LOCK_NAMES = {
  /** Main order matching lock */
  ORDER_MATCHING: 'crank:order-matching',
  /** MPC callback processing lock */
  MPC_CALLBACKS: 'crank:mpc-callbacks',
  /** Settlement processing lock */
  SETTLEMENT: 'crank:settlement',
  /** Crank startup lock (prevents multiple instances starting simultaneously) */
  CRANK_STARTUP: 'crank:startup',
  /** Database maintenance lock */
  DB_MAINTENANCE: 'crank:db-maintenance',
} as const;

export type LockName = (typeof LOCK_NAMES)[keyof typeof LOCK_NAMES];
