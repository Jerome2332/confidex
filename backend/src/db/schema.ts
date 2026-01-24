/**
 * Database Schema
 *
 * SQLite schema for crank service persistence.
 * Includes transaction history, pending operations, distributed locks, and order state cache.
 */

import { DatabaseClient } from './client.js';

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
  operation_type TEXT NOT NULL CHECK (operation_type IN ('match', 'settlement', 'mpc_callback')),
  operation_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
  payload TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  locked_by TEXT,
  locked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Distributed locks (advisory locking via DB)
CREATE TABLE IF NOT EXISTS distributed_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_name TEXT UNIQUE NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER NOT NULL,
  metadata TEXT
);

-- Order state cache (reduces RPC calls)
CREATE TABLE IF NOT EXISTS order_state_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_pda TEXT UNIQUE NOT NULL,
  trading_pair_pda TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
  status TEXT NOT NULL CHECK (status IN ('Open', 'PartiallyFilled', 'Filled', 'Cancelled', 'Matching')),
  owner TEXT NOT NULL,
  slot INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- MPC processed requests tracking (for duplicate prevention after restart)
CREATE TABLE IF NOT EXISTS mpc_processed_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key TEXT UNIQUE NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('computation', 'event')),
  status TEXT NOT NULL CHECK (status IN ('processed', 'failed')),
  computation_type TEXT,
  tx_signature TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tx_history_status ON transaction_history(status);
CREATE INDEX IF NOT EXISTS idx_tx_history_type ON transaction_history(tx_type);
CREATE INDEX IF NOT EXISTS idx_tx_history_orders ON transaction_history(buy_order_pda, sell_order_pda);
CREATE INDEX IF NOT EXISTS idx_pending_ops_status ON pending_operations(status);
CREATE INDEX IF NOT EXISTS idx_pending_ops_locked ON pending_operations(locked_by, locked_at);
CREATE INDEX IF NOT EXISTS idx_locks_name ON distributed_locks(lock_name);
CREATE INDEX IF NOT EXISTS idx_locks_expires ON distributed_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_order_cache_pair ON order_state_cache(trading_pair_pda, status);
CREATE INDEX IF NOT EXISTS idx_order_cache_owner ON order_state_cache(owner);
CREATE INDEX IF NOT EXISTS idx_mpc_processed_key ON mpc_processed_requests(request_key);
CREATE INDEX IF NOT EXISTS idx_mpc_processed_created ON mpc_processed_requests(created_at);
`;

/**
 * Initialize database with schema
 */
export function initializeDatabase(db: DatabaseClient): void {
  db.exec(SCHEMA);
}
