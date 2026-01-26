# PRD-002: Backend Infrastructure Production

**Status:** Completed (January 2026)
**Priority:** CRITICAL
**Complexity:** High
**Estimated Effort:** 3-4 days

---

## Executive Summary

The crank service lacks persistence, distributed locking, and proper failover mechanisms required for production reliability. This PRD implements database persistence, multi-instance coordination, graceful shutdown, and RPC failover to ensure reliable order matching in production.

## Implementation Status

All items in this PRD have been implemented. Key additions:

| Feature | Status | Implementation |
|---------|--------|----------------|
| SQLite Persistence | Complete | `backend/src/db/` - Full schema with repositories |
| Distributed Locking | Complete | `backend/src/crank/distributed-lock.ts` |
| Graceful Shutdown | Complete | `backend/src/crank/index.ts` - Signal handlers |
| RPC Failover | Complete | `backend/src/crank/failover-connection.ts` |
| Blockhash Manager | Complete | `backend/src/crank/blockhash-manager.ts` |
| Startup Recovery | Complete | `CrankService.recoverPendingOperations()` |
| MPC State Persistence | Complete | `mpc_processed_requests` table + repository |

### Additional Production Hardening (January 2026)

The following production gaps were also addressed:

- **Atomic Settlement**: On-chain verification after settlement TX
- **HTTP Timeouts**: Server/request timeouts (120s/60s defaults)
- **WebSocket Rate Limiting**: Message rate limiting with 3-strike disconnect
- **Analytics Rate Limiting**: 60 req/min on analytics routes
- **SQL Injection Fixes**: Parameterized TimescaleDB queries
- **Empty Catch Logging**: Debug logs in empty catch blocks
- **Structured Logging**: Replaced console.log with Pino logger

---

## Problem Statement

The current backend infrastructure has critical gaps:

1. **No Persistence** - Transaction history lost on restart, no recovery of in-flight matches
2. **No Distributed Locking** - Multiple crank instances can process same orders
3. **No Graceful Shutdown** - In-flight operations abandoned on stop
4. **Single RPC Endpoint** - No failover when primary RPC fails
5. **Blockhash Issues** - Transactions fail with expired blockhash under load

These issues cause lost matches, duplicate settlements, and service outages.

---

## Scope

### In Scope
- SQLite persistence layer for transaction history and state
- Distributed locking via database advisory locks
- Graceful shutdown with operation completion
- RPC failover with multiple endpoints
- Blockhash refresh strategy

### Out of Scope
- Kubernetes deployment (covered in PRD-005)
- Metrics/monitoring (covered in PRD-008)
- Full database migration to PostgreSQL (future)

---

## Current State Analysis

### 1. No Persistence Layer

**File:** `backend/src/crank/index.ts`

```typescript
// Current state - all in memory
export class CrankService {
  private orderStateManager: OrderStateManager;  // In-memory only
  private matchExecutor: MatchExecutor;
  private settlementExecutor: SettlementExecutor;

  // On restart:
  // - All pending matches lost
  // - No history of settlements
  // - Can't recover from partial failures
}
```

**Impact:** Service restart loses all state, requiring full rescan and risking duplicate operations.

### 2. No Distributed Locking

**File:** `backend/src/crank/match-executor.ts`

```typescript
// Current state - no locking
async executeMatch(buyOrder: PublicKey, sellOrder: PublicKey) {
  // No check if another instance is processing these orders
  // Multiple instances can attempt same match simultaneously

  // This causes:
  // - Duplicate MPC queue calls
  // - Wasted compute costs
  // - Potential double-settlement
}
```

**Impact:** Running multiple crank instances causes race conditions and duplicate operations.

### 3. No Graceful Shutdown

**File:** `backend/src/crank/index.ts`

```typescript
// Current state - abrupt stop
stop(): void {
  this.isRunning = false;
  this.matchExecutor.stop();
  this.settlementExecutor.stop();
  // In-flight matches are abandoned
  // Pending settlements may be incomplete
}
```

**Impact:** Stopping service leaves operations in undefined state.

### 4. Single RPC Endpoint

**File:** `backend/src/crank/config.ts`

```typescript
// Current state - single endpoint
export interface CrankConfig {
  rpcUrl: string;  // Only one endpoint
  // No fallback defined
}
```

**Impact:** RPC provider issues cause complete service outage.

### 5. Blockhash Expiration

**File:** `backend/src/crank/match-executor.ts`

```typescript
// Current state - blockhash fetched per transaction
async sendTransaction(tx: Transaction) {
  const { blockhash } = await this.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  // Under high load, blockhash may expire before TX confirms
}
```

**Impact:** Transactions fail with "Blockhash not found" under load.

---

## Implementation Plan

### Task 1: Add SQLite Persistence Layer

**New Files:**
- `backend/src/db/schema.ts`
- `backend/src/db/client.ts`
- `backend/src/db/migrations/001_initial.sql`
- `backend/src/db/repositories/transaction-history.ts`
- `backend/src/db/repositories/pending-operations.ts`

**Step 1.1: Create Database Schema**

```typescript
// backend/src/db/schema.ts

export const SCHEMA = `
-- Transaction history for all crank operations
CREATE TABLE IF NOT EXISTS transaction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_signature TEXT UNIQUE NOT NULL,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('match', 'settlement', 'mpc_callback')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed', 'expired')),
  buy_order_pda TEXT,
  sell_order_pda TEXT,
  mpc_request_id TEXT,
  error_message TEXT,
  slot INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Pending operations (for recovery after restart)
CREATE TABLE IF NOT EXISTS pending_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('match', 'settlement', 'mpc_poll')),
  operation_key TEXT UNIQUE NOT NULL,
  payload TEXT NOT NULL,  -- JSON serialized operation data
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_attempt_at INTEGER,
  next_attempt_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Distributed locks (advisory locking via DB)
CREATE TABLE IF NOT EXISTS distributed_locks (
  lock_key TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER NOT NULL,
  metadata TEXT  -- JSON with holder info
);

-- Order state cache (reduces RPC calls)
CREATE TABLE IF NOT EXISTS order_state_cache (
  order_pda TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  is_matching INTEGER NOT NULL DEFAULT 0,
  pending_match_request TEXT,
  last_fetched_at INTEGER NOT NULL,
  account_data BLOB  -- Raw account data for fast parsing
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tx_history_status ON transaction_history(status);
CREATE INDEX IF NOT EXISTS idx_tx_history_type ON transaction_history(tx_type);
CREATE INDEX IF NOT EXISTS idx_pending_ops_status ON pending_operations(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_locks_expires ON distributed_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_order_cache_status ON order_state_cache(status, is_matching);
`;
```

**Step 1.2: Create Database Client**

```typescript
// backend/src/db/client.ts

import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA } from './schema.js';

export class DatabaseClient {
  private db: Database.Database;
  private static instance: DatabaseClient | null = null;

  private constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');  // Better concurrency
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
  }

  static getInstance(dbPath?: string): DatabaseClient {
    if (!DatabaseClient.instance) {
      const resolvedPath = dbPath || process.env.CRANK_DB_PATH ||
        path.join(process.cwd(), 'data', 'crank.db');
      DatabaseClient.instance = new DatabaseClient(resolvedPath);
    }
    return DatabaseClient.instance;
  }

  private initializeSchema(): void {
    this.db.exec(SCHEMA);
    console.log('[DB] Schema initialized');
  }

  // Transaction wrapper
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Prepared statement cache
  private stmtCache = new Map<string, Database.Statement>();

  prepare(sql: string): Database.Statement {
    if (!this.stmtCache.has(sql)) {
      this.stmtCache.set(sql, this.db.prepare(sql));
    }
    return this.stmtCache.get(sql)!;
  }

  run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  close(): void {
    this.db.close();
    DatabaseClient.instance = null;
  }
}
```

**Step 1.3: Create Transaction History Repository**

```typescript
// backend/src/db/repositories/transaction-history.ts

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

export class TransactionHistoryRepository {
  constructor(private db: DatabaseClient) {}

  create(record: Omit<TransactionRecord, 'id' | 'created_at' | 'updated_at'>): number {
    const result = this.db.run(
      `INSERT INTO transaction_history
       (tx_signature, tx_type, status, buy_order_pda, sell_order_pda, mpc_request_id, error_message, slot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      record.tx_signature,
      record.tx_type,
      record.status,
      record.buy_order_pda,
      record.sell_order_pda,
      record.mpc_request_id,
      record.error_message,
      record.slot
    );
    return result.lastInsertRowid as number;
  }

  updateStatus(txSignature: string, status: TxStatus, errorMessage?: string): void {
    this.db.run(
      `UPDATE transaction_history
       SET status = ?, error_message = ?, updated_at = strftime('%s', 'now')
       WHERE tx_signature = ?`,
      status,
      errorMessage,
      txSignature
    );
  }

  findBySignature(txSignature: string): TransactionRecord | undefined {
    return this.db.get<TransactionRecord>(
      'SELECT * FROM transaction_history WHERE tx_signature = ?',
      txSignature
    );
  }

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

  getRecentByOrderPair(buyPda: string, sellPda: string): TransactionRecord | undefined {
    return this.db.get<TransactionRecord>(
      `SELECT * FROM transaction_history
       WHERE buy_order_pda = ? AND sell_order_pda = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      buyPda,
      sellPda
    );
  }

  // Cleanup old records (keep 30 days)
  cleanup(daysToKeep = 30): number {
    const cutoff = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);
    const result = this.db.run(
      `DELETE FROM transaction_history
       WHERE created_at < ? AND status IN ('confirmed', 'failed', 'expired')`,
      cutoff
    );
    return result.changes;
  }
}
```

**Step 1.4: Create Pending Operations Repository**

```typescript
// backend/src/db/repositories/pending-operations.ts

import { DatabaseClient } from '../client.js';

export type OperationType = 'match' | 'settlement' | 'mpc_poll';
export type OperationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface PendingOperation {
  id: number;
  operation_type: OperationType;
  operation_key: string;
  payload: string;  // JSON
  attempts: number;
  max_attempts: number;
  last_attempt_at?: number;
  next_attempt_at: number;
  status: OperationStatus;
  error_message?: string;
  created_at: number;
  updated_at: number;
}

export interface MatchPayload {
  buyOrderPda: string;
  sellOrderPda: string;
  pairPda: string;
}

export interface SettlementPayload {
  buyOrderPda: string;
  sellOrderPda: string;
  buyMaker: string;
  sellMaker: string;
  pairPda: string;
  baseMint: string;
  quoteMint: string;
}

export class PendingOperationsRepository {
  constructor(private db: DatabaseClient) {}

  create<T>(
    operationType: OperationType,
    operationKey: string,
    payload: T,
    maxAttempts = 5
  ): number {
    const result = this.db.run(
      `INSERT INTO pending_operations
       (operation_type, operation_key, payload, max_attempts, next_attempt_at, status)
       VALUES (?, ?, ?, ?, strftime('%s', 'now'), 'pending')
       ON CONFLICT(operation_key) DO UPDATE SET
         attempts = attempts,
         updated_at = strftime('%s', 'now')`,
      operationType,
      operationKey,
      JSON.stringify(payload),
      maxAttempts
    );
    return result.lastInsertRowid as number;
  }

  findReadyToProcess(operationType: OperationType, limit = 10): PendingOperation[] {
    return this.db.all<PendingOperation>(
      `SELECT * FROM pending_operations
       WHERE operation_type = ?
         AND status IN ('pending', 'in_progress')
         AND next_attempt_at <= strftime('%s', 'now')
         AND attempts < max_attempts
       ORDER BY next_attempt_at ASC
       LIMIT ?`,
      operationType,
      limit
    );
  }

  markInProgress(id: number): void {
    this.db.run(
      `UPDATE pending_operations
       SET status = 'in_progress',
           last_attempt_at = strftime('%s', 'now'),
           attempts = attempts + 1,
           updated_at = strftime('%s', 'now')
       WHERE id = ?`,
      id
    );
  }

  markCompleted(id: number): void {
    this.db.run(
      `UPDATE pending_operations
       SET status = 'completed', updated_at = strftime('%s', 'now')
       WHERE id = ?`,
      id
    );
  }

  markFailed(id: number, errorMessage: string, retryDelaySecs = 60): void {
    this.db.run(
      `UPDATE pending_operations
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           error_message = ?,
           next_attempt_at = strftime('%s', 'now') + ?,
           updated_at = strftime('%s', 'now')
       WHERE id = ?`,
      errorMessage,
      retryDelaySecs,
      id
    );
  }

  findByKey(operationKey: string): PendingOperation | undefined {
    return this.db.get<PendingOperation>(
      'SELECT * FROM pending_operations WHERE operation_key = ?',
      operationKey
    );
  }

  deleteCompleted(daysToKeep = 7): number {
    const cutoff = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);
    const result = this.db.run(
      `DELETE FROM pending_operations
       WHERE status = 'completed' AND updated_at < ?`,
      cutoff
    );
    return result.changes;
  }
}
```

---

### Task 2: Implement Distributed Locking

**New Files:**
- `backend/src/crank/distributed-lock.ts`

**Step 2.1: Create Lock Manager**

```typescript
// backend/src/crank/distributed-lock.ts

import { DatabaseClient } from '../db/client.js';
import { v4 as uuidv4 } from 'uuid';

export interface LockOptions {
  ttlSeconds?: number;  // Lock expiration (default: 300s / 5 min)
  waitTimeoutMs?: number;  // Max wait for lock (default: 10000ms)
  retryIntervalMs?: number;  // Retry interval (default: 100ms)
}

export interface AcquiredLock {
  key: string;
  holderId: string;
  expiresAt: number;
  release: () => Promise<void>;
}

export class DistributedLockManager {
  private holderId: string;
  private heldLocks: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private db: DatabaseClient,
    private instanceId?: string
  ) {
    this.holderId = instanceId || `crank-${uuidv4().slice(0, 8)}`;

    // Cleanup expired locks on startup
    this.cleanupExpiredLocks();

    // Periodic cleanup every minute
    setInterval(() => this.cleanupExpiredLocks(), 60000);
  }

  /**
   * Acquire a distributed lock
   */
  async acquire(
    lockKey: string,
    options: LockOptions = {}
  ): Promise<AcquiredLock | null> {
    const {
      ttlSeconds = 300,
      waitTimeoutMs = 10000,
      retryIntervalMs = 100,
    } = options;

    const startTime = Date.now();
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

    while (Date.now() - startTime < waitTimeoutMs) {
      const acquired = this.tryAcquire(lockKey, expiresAt);

      if (acquired) {
        // Set up auto-renewal
        const renewalInterval = setInterval(() => {
          this.renewLock(lockKey, ttlSeconds);
        }, (ttlSeconds * 1000) / 2);

        this.heldLocks.set(lockKey, renewalInterval);

        console.log(`[Lock] Acquired: ${lockKey} (holder: ${this.holderId})`);

        return {
          key: lockKey,
          holderId: this.holderId,
          expiresAt,
          release: async () => this.release(lockKey),
        };
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }

    console.log(`[Lock] Failed to acquire: ${lockKey} (timeout after ${waitTimeoutMs}ms)`);
    return null;
  }

  private tryAcquire(lockKey: string, expiresAt: number): boolean {
    try {
      // Atomic insert-or-fail
      this.db.run(
        `INSERT INTO distributed_locks (lock_key, holder_id, expires_at, metadata)
         VALUES (?, ?, ?, ?)`,
        lockKey,
        this.holderId,
        expiresAt,
        JSON.stringify({ acquiredAt: Date.now(), hostname: process.env.HOSTNAME })
      );
      return true;
    } catch (err) {
      // Lock exists - check if expired
      const existing = this.db.get<{ expires_at: number; holder_id: string }>(
        'SELECT expires_at, holder_id FROM distributed_locks WHERE lock_key = ?',
        lockKey
      );

      if (existing) {
        const now = Math.floor(Date.now() / 1000);
        if (existing.expires_at < now) {
          // Expired - try to take over
          const result = this.db.run(
            `UPDATE distributed_locks
             SET holder_id = ?, expires_at = ?, acquired_at = strftime('%s', 'now')
             WHERE lock_key = ? AND expires_at < ?`,
            this.holderId,
            expiresAt,
            lockKey,
            now
          );
          return result.changes > 0;
        }
      }

      return false;
    }
  }

  private renewLock(lockKey: string, ttlSeconds: number): void {
    const newExpiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const result = this.db.run(
      `UPDATE distributed_locks
       SET expires_at = ?
       WHERE lock_key = ? AND holder_id = ?`,
      newExpiry,
      lockKey,
      this.holderId
    );

    if (result.changes === 0) {
      console.warn(`[Lock] Failed to renew: ${lockKey} (lost ownership?)`);
      // Stop renewal attempts
      const interval = this.heldLocks.get(lockKey);
      if (interval) {
        clearInterval(interval);
        this.heldLocks.delete(lockKey);
      }
    }
  }

  async release(lockKey: string): Promise<void> {
    // Stop renewal
    const interval = this.heldLocks.get(lockKey);
    if (interval) {
      clearInterval(interval);
      this.heldLocks.delete(lockKey);
    }

    // Release lock
    const result = this.db.run(
      'DELETE FROM distributed_locks WHERE lock_key = ? AND holder_id = ?',
      lockKey,
      this.holderId
    );

    if (result.changes > 0) {
      console.log(`[Lock] Released: ${lockKey}`);
    }
  }

  async releaseAll(): Promise<void> {
    // Stop all renewals
    for (const [key, interval] of this.heldLocks) {
      clearInterval(interval);
      console.log(`[Lock] Releasing: ${key}`);
    }
    this.heldLocks.clear();

    // Release all locks held by this instance
    this.db.run(
      'DELETE FROM distributed_locks WHERE holder_id = ?',
      this.holderId
    );
  }

  private cleanupExpiredLocks(): void {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.run(
      'DELETE FROM distributed_locks WHERE expires_at < ?',
      now
    );
    if (result.changes > 0) {
      console.log(`[Lock] Cleaned up ${result.changes} expired locks`);
    }
  }

  /**
   * Execute function with lock protection
   */
  async withLock<T>(
    lockKey: string,
    fn: () => Promise<T>,
    options?: LockOptions
  ): Promise<T | null> {
    const lock = await this.acquire(lockKey, options);
    if (!lock) {
      return null;
    }

    try {
      return await fn();
    } finally {
      await lock.release();
    }
  }
}
```

**Step 2.2: Integrate Locking into Match Executor**

```typescript
// backend/src/crank/match-executor.ts

import { DistributedLockManager } from './distributed-lock.js';
import { PendingOperationsRepository, MatchPayload } from '../db/repositories/pending-operations.js';
import { TransactionHistoryRepository } from '../db/repositories/transaction-history.js';

export class MatchExecutor {
  constructor(
    private connection: Connection,
    private crankKeypair: Keypair,
    private config: CrankConfig,
    private lockManager: DistributedLockManager,
    private pendingOps: PendingOperationsRepository,
    private txHistory: TransactionHistoryRepository
  ) {}

  async executeMatch(buyOrderPda: PublicKey, sellOrderPda: PublicKey): Promise<boolean> {
    // Create unique lock key for this order pair
    const lockKey = `match:${buyOrderPda.toBase58()}:${sellOrderPda.toBase58()}`;

    // Try to acquire lock
    const lock = await this.lockManager.acquire(lockKey, {
      ttlSeconds: 120,  // 2 min lock
      waitTimeoutMs: 1000,  // Don't wait long - other instance may be processing
    });

    if (!lock) {
      console.log(`[MatchExecutor] Skipping - another instance processing: ${lockKey}`);
      return false;
    }

    try {
      // Check if recently processed
      const recentTx = this.txHistory.getRecentByOrderPair(
        buyOrderPda.toBase58(),
        sellOrderPda.toBase58()
      );
      if (recentTx && recentTx.status === 'confirmed') {
        console.log(`[MatchExecutor] Already matched: ${lockKey}`);
        return false;
      }

      // Persist operation before executing
      const payload: MatchPayload = {
        buyOrderPda: buyOrderPda.toBase58(),
        sellOrderPda: sellOrderPda.toBase58(),
        pairPda: '', // Will be filled from order data
      };
      this.pendingOps.create('match', lockKey, payload);

      // Execute match with retries
      const result = await this.executeMatchWithRetry(buyOrderPda, sellOrderPda);

      return result;
    } finally {
      await lock.release();
    }
  }

  private async executeMatchWithRetry(
    buyOrderPda: PublicKey,
    sellOrderPda: PublicKey
  ): Promise<boolean> {
    // ... existing match logic with persistence updates ...
  }
}
```

---

### Task 3: Implement Graceful Shutdown

**Files to Modify:**
- `backend/src/crank/index.ts`

**Step 3.1: Add Shutdown Handler**

```typescript
// backend/src/crank/index.ts

import { DatabaseClient } from '../db/client.js';
import { DistributedLockManager } from './distributed-lock.js';

export class CrankService {
  private isShuttingDown = false;
  private activeOperations = new Set<string>();
  private shutdownPromise: Promise<void> | null = null;
  private lockManager: DistributedLockManager;
  private db: DatabaseClient;

  constructor(config: CrankConfig) {
    this.db = DatabaseClient.getInstance();
    this.lockManager = new DistributedLockManager(this.db);

    // Register shutdown handlers
    this.registerShutdownHandlers();
  }

  private registerShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        console.log(`[Crank] Already shutting down, ignoring ${signal}`);
        return;
      }

      console.log(`[Crank] Received ${signal}, starting graceful shutdown...`);
      this.isShuttingDown = true;

      // Wait for shutdown to complete
      await this.gracefulShutdown();

      console.log(`[Crank] Shutdown complete`);
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', async (err) => {
      console.error('[Crank] Uncaught exception:', err);
      await this.emergencyShutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('[Crank] Unhandled rejection:', reason);
      await this.emergencyShutdown();
      process.exit(1);
    });
  }

  async gracefulShutdown(timeoutMs = 30000): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this._performGracefulShutdown(timeoutMs);
    return this.shutdownPromise;
  }

  private async _performGracefulShutdown(timeoutMs: number): Promise<void> {
    console.log(`[Crank] Stopping new operations...`);

    // 1. Stop accepting new work
    this.orderMonitor?.stop();
    this.matchExecutor?.stopAcceptingNew();
    this.settlementExecutor?.stopAcceptingNew();

    // 2. Wait for active operations to complete (with timeout)
    const waitStart = Date.now();
    while (this.activeOperations.size > 0) {
      if (Date.now() - waitStart > timeoutMs) {
        console.warn(`[Crank] Timeout waiting for ${this.activeOperations.size} operations`);
        break;
      }

      console.log(`[Crank] Waiting for ${this.activeOperations.size} active operations...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. Release all distributed locks
    console.log(`[Crank] Releasing distributed locks...`);
    await this.lockManager.releaseAll();

    // 4. Flush pending writes to database
    console.log(`[Crank] Flushing database...`);
    // SQLite WAL mode handles this automatically

    // 5. Close connections
    console.log(`[Crank] Closing connections...`);
    this.db.close();

    console.log(`[Crank] Graceful shutdown complete`);
  }

  private async emergencyShutdown(): Promise<void> {
    console.log(`[Crank] Emergency shutdown - releasing locks immediately`);
    await this.lockManager.releaseAll();
    this.db.close();
  }

  // Track active operations
  trackOperation(operationId: string): void {
    this.activeOperations.add(operationId);
  }

  completeOperation(operationId: string): void {
    this.activeOperations.delete(operationId);
  }

  // Check if accepting new work
  isAcceptingWork(): boolean {
    return !this.isShuttingDown;
  }
}
```

---

### Task 4: Implement RPC Failover

**New Files:**
- `backend/src/lib/failover-connection.ts`

**Step 4.1: Create Failover Connection Wrapper**

```typescript
// backend/src/lib/failover-connection.ts

import {
  Connection,
  ConnectionConfig,
  Commitment,
  AccountInfo,
  PublicKey,
  Transaction,
  TransactionSignature,
  SendOptions,
  GetProgramAccountsConfig,
  GetAccountInfoConfig,
} from '@solana/web3.js';

export interface FailoverConfig {
  endpoints: string[];
  commitment?: Commitment;
  maxRetries?: number;
  retryDelayMs?: number;
  healthCheckIntervalMs?: number;
}

interface EndpointHealth {
  url: string;
  isHealthy: boolean;
  lastCheck: number;
  latencyMs: number;
  consecutiveFailures: number;
}

export class FailoverConnection {
  private endpoints: EndpointHealth[];
  private connections: Map<string, Connection> = new Map();
  private currentIndex = 0;
  private config: Required<FailoverConfig>;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: FailoverConfig) {
    if (config.endpoints.length === 0) {
      throw new Error('At least one RPC endpoint is required');
    }

    this.config = {
      endpoints: config.endpoints,
      commitment: config.commitment || 'confirmed',
      maxRetries: config.maxRetries || 3,
      retryDelayMs: config.retryDelayMs || 1000,
      healthCheckIntervalMs: config.healthCheckIntervalMs || 30000,
    };

    // Initialize endpoint health tracking
    this.endpoints = config.endpoints.map(url => ({
      url,
      isHealthy: true,  // Assume healthy initially
      lastCheck: 0,
      latencyMs: 0,
      consecutiveFailures: 0,
    }));

    // Create connections
    for (const url of config.endpoints) {
      this.connections.set(url, new Connection(url, this.config.commitment));
    }

    // Start health checks
    this.startHealthChecks();
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(
      () => this.checkAllEndpoints(),
      this.config.healthCheckIntervalMs
    );

    // Initial check
    this.checkAllEndpoints();
  }

  private async checkAllEndpoints(): Promise<void> {
    await Promise.all(this.endpoints.map(ep => this.checkEndpoint(ep)));

    // Log status
    const healthy = this.endpoints.filter(e => e.isHealthy).length;
    console.log(`[RPC] Health check: ${healthy}/${this.endpoints.length} endpoints healthy`);
  }

  private async checkEndpoint(endpoint: EndpointHealth): Promise<void> {
    const conn = this.connections.get(endpoint.url)!;
    const start = Date.now();

    try {
      await conn.getSlot();
      endpoint.latencyMs = Date.now() - start;
      endpoint.isHealthy = true;
      endpoint.consecutiveFailures = 0;
    } catch (err) {
      endpoint.consecutiveFailures++;
      endpoint.isHealthy = endpoint.consecutiveFailures < 3;  // Allow 2 failures
      console.warn(`[RPC] Endpoint unhealthy: ${endpoint.url} (failures: ${endpoint.consecutiveFailures})`);
    }

    endpoint.lastCheck = Date.now();
  }

  private getConnection(): Connection {
    // Try current endpoint first
    const current = this.endpoints[this.currentIndex];
    if (current.isHealthy) {
      return this.connections.get(current.url)!;
    }

    // Find next healthy endpoint
    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (this.currentIndex + i + 1) % this.endpoints.length;
      if (this.endpoints[idx].isHealthy) {
        this.currentIndex = idx;
        console.log(`[RPC] Switched to: ${this.endpoints[idx].url}`);
        return this.connections.get(this.endpoints[idx].url)!;
      }
    }

    // No healthy endpoints - try the one with lowest latency
    const sorted = [...this.endpoints].sort((a, b) => a.latencyMs - b.latencyMs);
    console.warn(`[RPC] No healthy endpoints, trying: ${sorted[0].url}`);
    return this.connections.get(sorted[0].url)!;
  }

  private async withRetry<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const conn = this.getConnection();
      const endpoint = this.endpoints.find(e => this.connections.get(e.url) === conn)!;

      try {
        const result = await fn(conn);
        // Reset failures on success
        endpoint.consecutiveFailures = 0;
        endpoint.isHealthy = true;
        return result;
      } catch (err) {
        lastError = err as Error;
        endpoint.consecutiveFailures++;

        const isRetryable = this.isRetryableError(err);
        console.warn(`[RPC] Request failed (attempt ${attempt + 1}): ${(err as Error).message}`);

        if (!isRetryable || attempt === this.config.maxRetries - 1) {
          throw err;
        }

        // Mark endpoint unhealthy if too many failures
        if (endpoint.consecutiveFailures >= 3) {
          endpoint.isHealthy = false;
        }

        // Wait before retry
        await new Promise(resolve =>
          setTimeout(resolve, this.config.retryDelayMs * (attempt + 1))
        );
      }
    }

    throw lastError || new Error('Retry exhausted');
  }

  private isRetryableError(err: unknown): boolean {
    const message = (err as Error).message?.toLowerCase() || '';
    return (
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('socket') ||
      message.includes('econnreset') ||
      message.includes('429') ||  // Rate limited
      message.includes('503') ||  // Service unavailable
      message.includes('504')     // Gateway timeout
    );
  }

  // Proxied Connection methods
  async getAccountInfo(
    publicKey: PublicKey,
    commitmentOrConfig?: Commitment | GetAccountInfoConfig
  ): Promise<AccountInfo<Buffer> | null> {
    return this.withRetry(conn => conn.getAccountInfo(publicKey, commitmentOrConfig));
  }

  async getProgramAccounts(
    programId: PublicKey,
    configOrCommitment?: GetProgramAccountsConfig | Commitment
  ) {
    return this.withRetry(conn => conn.getProgramAccounts(programId, configOrCommitment));
  }

  async getLatestBlockhash(commitment?: Commitment) {
    return this.withRetry(conn => conn.getLatestBlockhash(commitment));
  }

  async sendTransaction(
    transaction: Transaction,
    signers: Keypair[],
    options?: SendOptions
  ): Promise<TransactionSignature> {
    return this.withRetry(conn => conn.sendTransaction(transaction, signers, options));
  }

  async confirmTransaction(
    signature: TransactionSignature,
    commitment?: Commitment
  ) {
    return this.withRetry(conn => conn.confirmTransaction(signature, commitment));
  }

  async getSlot(commitment?: Commitment): Promise<number> {
    return this.withRetry(conn => conn.getSlot(commitment));
  }

  async getBalance(publicKey: PublicKey, commitment?: Commitment): Promise<number> {
    return this.withRetry(conn => conn.getBalance(publicKey, commitment));
  }

  // Get raw connection for advanced operations
  getRawConnection(): Connection {
    return this.getConnection();
  }

  // Cleanup
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // Status
  getStatus(): { endpoints: EndpointHealth[]; currentEndpoint: string } {
    return {
      endpoints: this.endpoints,
      currentEndpoint: this.endpoints[this.currentIndex].url,
    };
  }
}
```

**Step 4.2: Update Config**

```typescript
// backend/src/crank/config.ts

export interface CrankConfig {
  // RPC endpoints (primary + fallbacks)
  rpcEndpoints: string[];

  // Programs
  programs: {
    confidexDex: string;
    arciumMxe: string;
  };

  // Crank wallet
  walletPath: string;

  // Polling
  pollingIntervalMs: number;

  // MPC
  useAsyncMpc: boolean;
  maxConcurrentMatches: number;

  // Circuit breaker
  errorThreshold: number;
  pauseDurationMs: number;

  // Database
  dbPath: string;
}

export function loadConfig(): CrankConfig {
  return {
    rpcEndpoints: [
      process.env.CRANK_RPC_PRIMARY || 'https://api.devnet.solana.com',
      process.env.CRANK_RPC_SECONDARY || 'https://devnet.helius-rpc.com/?api-key=...',
      process.env.CRANK_RPC_TERTIARY || 'https://rpc.ankr.com/solana_devnet',
    ].filter(Boolean),

    programs: {
      confidexDex: process.env.CONFIDEX_PROGRAM_ID || '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
      arciumMxe: process.env.MXE_PROGRAM_ID || '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi',
    },

    walletPath: process.env.CRANK_WALLET_PATH || './keys/crank-wallet.json',

    pollingIntervalMs: parseInt(process.env.CRANK_POLLING_INTERVAL_MS || '5000'),

    useAsyncMpc: process.env.CRANK_USE_ASYNC_MPC !== 'false',
    maxConcurrentMatches: parseInt(process.env.CRANK_MAX_CONCURRENT_MATCHES || '5'),

    errorThreshold: parseInt(process.env.CRANK_ERROR_THRESHOLD || '10'),
    pauseDurationMs: parseInt(process.env.CRANK_PAUSE_DURATION_MS || '60000'),

    dbPath: process.env.CRANK_DB_PATH || './data/crank.db',
  };
}
```

---

### Task 5: Implement Blockhash Refresh Strategy

**New Files:**
- `backend/src/lib/blockhash-manager.ts`

**Step 5.1: Create Blockhash Manager**

```typescript
// backend/src/lib/blockhash-manager.ts

import { Connection, Blockhash, BlockhashWithExpiryBlockHeight } from '@solana/web3.js';

export interface BlockhashInfo {
  blockhash: Blockhash;
  lastValidBlockHeight: number;
  fetchedAt: number;
  fetchedSlot: number;
}

export class BlockhashManager {
  private currentBlockhash: BlockhashInfo | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private isRefreshing = false;

  constructor(
    private connection: Connection,
    private refreshIntervalMs = 10000,  // Refresh every 10 seconds
    private maxAgeMs = 30000  // Max age before forced refresh
  ) {}

  async start(): Promise<void> {
    // Initial fetch
    await this.refresh();

    // Start periodic refresh
    this.refreshInterval = setInterval(
      () => this.refresh().catch(err =>
        console.error('[Blockhash] Refresh error:', err)
      ),
      this.refreshIntervalMs
    );

    console.log(`[Blockhash] Manager started (refresh every ${this.refreshIntervalMs}ms)`);
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async refresh(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const [blockhashInfo, slot] = await Promise.all([
        this.connection.getLatestBlockhash('confirmed'),
        this.connection.getSlot('confirmed'),
      ]);

      this.currentBlockhash = {
        blockhash: blockhashInfo.blockhash,
        lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
        fetchedAt: Date.now(),
        fetchedSlot: slot,
      };

      console.log(`[Blockhash] Refreshed: ${blockhashInfo.blockhash.slice(0, 8)}... (slot: ${slot})`);
    } finally {
      this.isRefreshing = false;
    }
  }

  async getBlockhash(): Promise<BlockhashWithExpiryBlockHeight> {
    // Check if we have a valid blockhash
    if (this.currentBlockhash) {
      const age = Date.now() - this.currentBlockhash.fetchedAt;

      if (age < this.maxAgeMs) {
        return {
          blockhash: this.currentBlockhash.blockhash,
          lastValidBlockHeight: this.currentBlockhash.lastValidBlockHeight,
        };
      }

      // Too old - force refresh
      console.log(`[Blockhash] Stale (age: ${age}ms), forcing refresh`);
    }

    // Refresh and return
    await this.refresh();

    if (!this.currentBlockhash) {
      throw new Error('Failed to fetch blockhash');
    }

    return {
      blockhash: this.currentBlockhash.blockhash,
      lastValidBlockHeight: this.currentBlockhash.lastValidBlockHeight,
    };
  }

  // Get current info for monitoring
  getInfo(): BlockhashInfo | null {
    return this.currentBlockhash;
  }
}
```

**Step 5.2: Integrate into Match Executor**

```typescript
// backend/src/crank/match-executor.ts

import { BlockhashManager } from '../lib/blockhash-manager.js';

export class MatchExecutor {
  private blockhashManager: BlockhashManager;

  constructor(
    private connection: FailoverConnection,
    private crankKeypair: Keypair,
    private config: CrankConfig
  ) {
    this.blockhashManager = new BlockhashManager(
      connection.getRawConnection(),
      10000,  // Refresh every 10 seconds
      30000   // Max age 30 seconds
    );
  }

  async start(): Promise<void> {
    await this.blockhashManager.start();
    // ... rest of start logic
  }

  async stop(): Promise<void> {
    this.blockhashManager.stop();
    // ... rest of stop logic
  }

  private async sendMatchTransaction(
    buyOrder: PublicKey,
    sellOrder: PublicKey
  ): Promise<string> {
    const tx = new Transaction();

    // Add match instruction
    tx.add(this.buildMatchInstruction(buyOrder, sellOrder));

    // Use managed blockhash
    const { blockhash, lastValidBlockHeight } = await this.blockhashManager.getBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = this.crankKeypair.publicKey;

    // Send with confirmation
    const signature = await this.connection.sendTransaction(
      tx,
      [this.crankKeypair],
      { skipPreflight: false }
    );

    // Record pending
    this.txHistory.create({
      tx_signature: signature,
      tx_type: 'match',
      status: 'pending',
      buy_order_pda: buyOrder.toBase58(),
      sell_order_pda: sellOrder.toBase58(),
    });

    // Confirm with retries
    await this.confirmWithRetry(signature, lastValidBlockHeight);

    return signature;
  }

  private async confirmWithRetry(
    signature: string,
    lastValidBlockHeight: number
  ): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = 60000;  // 60 second max wait

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const status = await this.connection.getSignatureStatus(signature);

        if (status.value?.confirmationStatus === 'confirmed' ||
            status.value?.confirmationStatus === 'finalized') {
          this.txHistory.updateStatus(signature, 'confirmed');
          console.log(`[Match] Confirmed: ${signature}`);
          return;
        }

        if (status.value?.err) {
          this.txHistory.updateStatus(signature, 'failed', JSON.stringify(status.value.err));
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
      } catch (err) {
        if ((err as Error).message?.includes('not found')) {
          // Check if blockhash expired
          const currentSlot = await this.connection.getSlot();
          if (currentSlot > lastValidBlockHeight) {
            this.txHistory.updateStatus(signature, 'expired', 'Blockhash expired');
            throw new Error('Transaction expired - blockhash no longer valid');
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    this.txHistory.updateStatus(signature, 'expired', 'Confirmation timeout');
    throw new Error('Transaction confirmation timeout');
  }
}
```

---

## Acceptance Criteria

- [x] **Database Persistence**
  - [x] SQLite database created at `data/crank.db`
  - [x] Transaction history persisted across restarts
  - [x] Pending operations recovered on startup
  - [x] Order state cache reduces RPC calls

- [x] **Distributed Locking**
  - [x] Lock acquired before processing order pair
  - [x] Lock released on completion or error
  - [x] Expired locks automatically cleaned up
  - [x] Multiple instances don't process same orders

- [x] **Graceful Shutdown**
  - [x] SIGTERM triggers graceful shutdown
  - [x] Active operations complete before exit
  - [x] All locks released on shutdown
  - [x] Database properly closed

- [x] **RPC Failover**
  - [x] Primary RPC failure triggers failover
  - [x] Health checks run every 30 seconds
  - [x] Retryable errors trigger retry logic
  - [x] Status endpoint shows endpoint health

- [x] **Blockhash Management**
  - [x] Blockhash refreshed every 30 seconds (configurable)
  - [x] Stale blockhash triggers immediate refresh
  - [x] Transaction expiration properly detected
  - [x] No "Blockhash not found" errors under load

- [x] **Startup Recovery** (Added January 2026)
  - [x] Stale locks released on startup
  - [x] Pending matches re-queued for processing
  - [x] Pending settlements recovered
  - [x] Database maintenance runs on startup

---

## Environment Variables

```bash
# Database
CRANK_DB_PATH=./data/crank.db

# RPC Endpoints (in priority order)
CRANK_RPC_PRIMARY=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
CRANK_RPC_SECONDARY=https://api.devnet.solana.com
CRANK_RPC_TERTIARY=https://rpc.ankr.com/solana_devnet

# Instance ID (for distributed locking)
CRANK_INSTANCE_ID=crank-1

# Shutdown
CRANK_SHUTDOWN_TIMEOUT_MS=30000
```

---

## Verification Commands

```bash
# Check database exists
ls -la data/crank.db

# Query transaction history
sqlite3 data/crank.db "SELECT COUNT(*) FROM transaction_history"

# Check lock status
sqlite3 data/crank.db "SELECT * FROM distributed_locks"

# Test graceful shutdown
kill -SIGTERM $(pgrep -f "node dist/index.js")

# Monitor logs during shutdown
tail -f logs/out.log
```

---

## References

- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [Solana Web3.js Connection](https://solana-labs.github.io/solana-web3.js/classes/Connection.html)
- [PM2 Process Management](https://pm2.keymetrics.io/docs/usage/quick-start/)
