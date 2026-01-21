/**
 * Database Module
 *
 * Provides SQLite persistence layer for the crank service.
 */

export { DatabaseClient, createMemoryDatabase } from './client.js';
export { SCHEMA, initializeDatabase } from './schema.js';

export {
  TransactionHistoryRepository,
  type TransactionRecord,
  type CreateTransactionInput,
  type TxType,
  type TxStatus,
} from './repositories/transaction-history.js';

export {
  PendingOperationsRepository,
  type PendingOperation,
  type CreateOperationInput,
  type OperationType,
  type OperationStatus,
  type MatchPayload,
  type SettlementPayload,
} from './repositories/pending-operations.js';

export {
  DistributedLocksRepository,
  type DistributedLock,
} from './repositories/distributed-locks.js';

export {
  OrderStateCacheRepository,
  type CachedOrder,
  type CreateCachedOrderInput,
  type CachedOrderStatus,
} from './repositories/order-state-cache.js';

/**
 * Database manager - provides access to all repositories
 */
export class DatabaseManager {
  public readonly transactions: TransactionHistoryRepository;
  public readonly pendingOps: PendingOperationsRepository;
  public readonly locks: DistributedLocksRepository;
  public readonly orderCache: OrderStateCacheRepository;

  constructor(private db: DatabaseClient) {
    this.transactions = new TransactionHistoryRepository(db);
    this.pendingOps = new PendingOperationsRepository(db);
    this.locks = new DistributedLocksRepository(db);
    this.orderCache = new OrderStateCacheRepository(db);
  }

  /**
   * Initialize database with schema
   */
  initialize(): void {
    initializeDatabase(this.db);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Run maintenance tasks
   */
  runMaintenance(): {
    transactionsDeleted: number;
    completedOpsDeleted: number;
    failedOpsDeleted: number;
    expiredLocksDeleted: number;
    staleOrdersDeleted: number;
  } {
    return {
      transactionsDeleted: this.transactions.cleanup(30),
      completedOpsDeleted: this.pendingOps.deleteCompleted(7),
      failedOpsDeleted: this.pendingOps.deleteFailed(30),
      expiredLocksDeleted: this.locks.cleanupExpired(),
      staleOrdersDeleted: this.orderCache.deleteFinalized(1),
    };
  }
}

// Re-import for type construction
import { DatabaseClient } from './client.js';
import { initializeDatabase } from './schema.js';
import { TransactionHistoryRepository } from './repositories/transaction-history.js';
import { PendingOperationsRepository } from './repositories/pending-operations.js';
import { DistributedLocksRepository } from './repositories/distributed-locks.js';
import { OrderStateCacheRepository } from './repositories/order-state-cache.js';
