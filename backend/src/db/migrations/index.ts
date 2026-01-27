/**
 * Database Migration System
 *
 * Manages schema migrations for the SQLite database using a versioned
 * migration approach. Migrations are applied in order and tracked in
 * a migrations table to prevent re-application.
 *
 * Features:
 * - Ordered migration execution
 * - Rollback support (when defined)
 * - Migration status tracking
 * - Dry-run mode for testing
 */

import { DatabaseClient } from '../client.js';
import { logger } from '../../lib/logger.js';

const log = logger.db;

export interface Migration {
  /** Unique migration version (e.g., '001', '002') */
  version: string;
  /** Human-readable description */
  description: string;
  /** SQL to apply the migration */
  up: string;
  /** SQL to rollback the migration (optional) */
  down?: string;
}

export interface MigrationResult {
  version: string;
  description: string;
  status: 'applied' | 'skipped' | 'failed';
  durationMs?: number;
  error?: string;
}

export interface MigrationStatus {
  version: string;
  applied_at: number;
  description: string;
}

/**
 * Create the migrations tracking table
 */
const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS __migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

/**
 * Available migrations in order
 */
export const MIGRATIONS: Migration[] = [
  {
    version: '001',
    description: 'Initial schema (already applied via schema.ts)',
    up: `
      -- This migration represents the initial schema
      -- It's a no-op since schema.ts already creates these tables
      SELECT 1;
    `,
    down: `
      -- WARNING: This will drop all tables
      DROP TABLE IF EXISTS mpc_processed_requests;
      DROP TABLE IF EXISTS order_state_cache;
      DROP TABLE IF EXISTS distributed_locks;
      DROP TABLE IF EXISTS pending_operations;
      DROP TABLE IF EXISTS transaction_history;
    `,
  },
  {
    version: '002',
    description: 'Add settlement_requests table for settlement state machine',
    up: `
      CREATE TABLE IF NOT EXISTS settlement_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        settlement_key TEXT UNIQUE NOT NULL,
        buy_order_pda TEXT NOT NULL,
        sell_order_pda TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'base_transferred', 'quote_transferred', 'completed', 'failed', 'expired', 'rolling_back')) DEFAULT 'pending',
        method TEXT NOT NULL CHECK (method IN ('shadowwire', 'cspl', 'legacy')) DEFAULT 'legacy',
        base_mint TEXT NOT NULL,
        quote_mint TEXT NOT NULL,
        encrypted_fill_amount TEXT,
        encrypted_fill_value TEXT,
        base_transfer_id TEXT,
        quote_transfer_id TEXT,
        failure_reason TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_settlement_status ON settlement_requests(status);
      CREATE INDEX IF NOT EXISTS idx_settlement_expires ON settlement_requests(expires_at);
      CREATE INDEX IF NOT EXISTS idx_settlement_orders ON settlement_requests(buy_order_pda, sell_order_pda);
    `,
    down: `
      DROP INDEX IF EXISTS idx_settlement_orders;
      DROP INDEX IF EXISTS idx_settlement_expires;
      DROP INDEX IF EXISTS idx_settlement_status;
      DROP TABLE IF EXISTS settlement_requests;
    `,
  },
  {
    version: '003',
    description: 'Add order cache metrics table',
    up: `
      CREATE TABLE IF NOT EXISTS order_cache_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        cache_size INTEGER NOT NULL,
        hit_count INTEGER NOT NULL,
        miss_count INTEGER NOT NULL,
        invalidation_count INTEGER NOT NULL,
        avg_age_seconds REAL
      );

      CREATE INDEX IF NOT EXISTS idx_cache_metrics_timestamp ON order_cache_metrics(timestamp);
    `,
    down: `
      DROP INDEX IF EXISTS idx_cache_metrics_timestamp;
      DROP TABLE IF EXISTS order_cache_metrics;
    `,
  },
  {
    version: '004',
    description: 'Add position tracking for perpetuals',
    up: `
      CREATE TABLE IF NOT EXISTS position_state_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_pda TEXT UNIQUE NOT NULL,
        market_pda TEXT NOT NULL,
        trader TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('Long', 'Short')),
        status TEXT NOT NULL CHECK (status IN ('Active', 'Liquidating', 'Closed', 'PendingVerification')),
        leverage INTEGER NOT NULL,
        threshold_verified INTEGER NOT NULL DEFAULT 0,
        slot INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_position_cache_market ON position_state_cache(market_pda, status);
      CREATE INDEX IF NOT EXISTS idx_position_cache_trader ON position_state_cache(trader);
      CREATE INDEX IF NOT EXISTS idx_position_cache_verification ON position_state_cache(threshold_verified, status);
    `,
    down: `
      DROP INDEX IF EXISTS idx_position_cache_verification;
      DROP INDEX IF EXISTS idx_position_cache_trader;
      DROP INDEX IF EXISTS idx_position_cache_market;
      DROP TABLE IF EXISTS position_state_cache;
    `,
  },
  {
    version: '005',
    description: 'Add batch processing queue table',
    up: `
      CREATE TABLE IF NOT EXISTS batch_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_type TEXT NOT NULL CHECK (batch_type IN ('match', 'settlement', 'liquidation', 'verification')),
        batch_key TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
        items TEXT NOT NULL, -- JSON array of items to process
        item_count INTEGER NOT NULL,
        processed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_batch_queue_status ON batch_queue(status, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_batch_queue_type ON batch_queue(batch_type, status);
    `,
    down: `
      DROP INDEX IF EXISTS idx_batch_queue_type;
      DROP INDEX IF EXISTS idx_batch_queue_status;
      DROP TABLE IF EXISTS batch_queue;
    `,
  },
];

export class MigrationRunner {
  private db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
    this.ensureMigrationsTable();
  }

  /**
   * Ensure the migrations tracking table exists
   */
  private ensureMigrationsTable(): void {
    this.db.exec(MIGRATIONS_TABLE_SQL);
  }

  /**
   * Get list of applied migrations
   */
  getAppliedMigrations(): MigrationStatus[] {
    return this.db.all<MigrationStatus>(
      'SELECT version, applied_at, description FROM __migrations ORDER BY version ASC'
    );
  }

  /**
   * Check if a specific migration has been applied
   */
  isMigrationApplied(version: string): boolean {
    const result = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM __migrations WHERE version = ?',
      version
    );
    return (result?.count ?? 0) > 0;
  }

  /**
   * Get pending migrations (not yet applied)
   */
  getPendingMigrations(): Migration[] {
    return MIGRATIONS.filter((m) => !this.isMigrationApplied(m.version));
  }

  /**
   * Run all pending migrations
   */
  runPendingMigrations(dryRun: boolean = false): MigrationResult[] {
    const pending = this.getPendingMigrations();
    const results: MigrationResult[] = [];

    if (pending.length === 0) {
      log.info('No pending migrations');
      return results;
    }

    log.info(
      { count: pending.length, dryRun },
      'Running pending migrations'
    );

    for (const migration of pending) {
      const result = this.runMigration(migration, dryRun);
      results.push(result);

      if (result.status === 'failed' && !dryRun) {
        log.error(
          { version: migration.version, error: result.error },
          'Migration failed, stopping'
        );
        break;
      }
    }

    return results;
  }

  /**
   * Run a specific migration
   */
  runMigration(migration: Migration, dryRun: boolean = false): MigrationResult {
    const startTime = Date.now();

    if (this.isMigrationApplied(migration.version)) {
      return {
        version: migration.version,
        description: migration.description,
        status: 'skipped',
      };
    }

    log.info(
      { version: migration.version, description: migration.description, dryRun },
      'Applying migration'
    );

    if (dryRun) {
      log.debug({ sql: migration.up }, 'Migration SQL (dry run)');
      return {
        version: migration.version,
        description: migration.description,
        status: 'skipped',
        durationMs: Date.now() - startTime,
      };
    }

    try {
      this.db.transaction(() => {
        // Apply the migration
        this.db.exec(migration.up);

        // Record in migrations table
        this.db.run(
          'INSERT INTO __migrations (version, description) VALUES (?, ?)',
          migration.version,
          migration.description
        );
      });

      const durationMs = Date.now() - startTime;
      log.info(
        { version: migration.version, durationMs },
        'Migration applied successfully'
      );

      return {
        version: migration.version,
        description: migration.description,
        status: 'applied',
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(
        { version: migration.version, error: errorMessage },
        'Migration failed'
      );

      return {
        version: migration.version,
        description: migration.description,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Rollback a specific migration
   */
  rollbackMigration(version: string): MigrationResult {
    const migration = MIGRATIONS.find((m) => m.version === version);

    if (!migration) {
      return {
        version,
        description: 'Unknown',
        status: 'failed',
        error: `Migration ${version} not found`,
      };
    }

    if (!this.isMigrationApplied(version)) {
      return {
        version,
        description: migration.description,
        status: 'skipped',
      };
    }

    if (!migration.down) {
      return {
        version,
        description: migration.description,
        status: 'failed',
        error: 'No rollback SQL defined for this migration',
      };
    }

    const startTime = Date.now();
    log.info({ version, description: migration.description }, 'Rolling back migration');

    try {
      this.db.transaction(() => {
        // Apply rollback
        this.db.exec(migration.down!);

        // Remove from migrations table
        this.db.run('DELETE FROM __migrations WHERE version = ?', version);
      });

      const durationMs = Date.now() - startTime;
      log.info({ version, durationMs }, 'Migration rolled back successfully');

      return {
        version,
        description: migration.description,
        status: 'applied',
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ version, error: errorMessage }, 'Rollback failed');

      return {
        version,
        description: migration.description,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Get migration status summary
   */
  getStatus(): {
    applied: MigrationStatus[];
    pending: Migration[];
    total: number;
  } {
    return {
      applied: this.getAppliedMigrations(),
      pending: this.getPendingMigrations(),
      total: MIGRATIONS.length,
    };
  }
}

/**
 * Run migrations on startup
 */
export function runMigrationsOnStartup(db: DatabaseClient): MigrationResult[] {
  const runner = new MigrationRunner(db);
  return runner.runPendingMigrations();
}
