/**
 * Database Client
 *
 * SQLite database client with connection pooling, prepared statement caching,
 * and transaction support.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA } from './schema.js';
import { logger } from '../lib/logger.js';

const log = logger.db;

export class DatabaseClient {
  private db: Database.Database;
  private static instance: DatabaseClient | null = null;
  private stmtCache = new Map<string, Database.Statement>();

  private constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Configure for better performance and reliability
    this.db.pragma('journal_mode = WAL'); // Write-ahead logging for better concurrency
    this.db.pragma('synchronous = NORMAL'); // Balance between safety and speed
    this.db.pragma('foreign_keys = ON'); // Enforce foreign key constraints
    this.db.pragma('busy_timeout = 5000'); // Wait up to 5s for locks

    this.initializeSchema();

    log.info({ dbPath }, 'Database initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(dbPath?: string): DatabaseClient {
    if (!DatabaseClient.instance) {
      const resolvedPath =
        dbPath ||
        process.env.CRANK_DB_PATH ||
        path.join(process.cwd(), 'data', 'crank.db');

      DatabaseClient.instance = new DatabaseClient(resolvedPath);
    }
    return DatabaseClient.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    if (DatabaseClient.instance) {
      DatabaseClient.instance.close();
      DatabaseClient.instance = null;
    }
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(SCHEMA);
    log.debug('Schema initialized');
  }

  /**
   * Execute multiple statements in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Get or create a prepared statement
   */
  prepare(sql: string): Database.Statement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * Execute SQL with parameters and return run result
   */
  run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.prepare(sql).run(...params);
  }

  /**
   * Execute SQL and return single row
   */
  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  /**
   * Execute SQL and return all rows
   */
  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  /**
   * Execute raw SQL (no prepared statement caching)
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Close database connection
   */
  close(): void {
    // Clear statement cache
    this.stmtCache.clear();

    // Close database
    this.db.close();

    log.info('Database connection closed');
  }

  /**
   * Check if database is open
   */
  isOpen(): boolean {
    return this.db.open;
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.db.name;
  }

  /**
   * Vacuum database to reclaim space
   */
  vacuum(): void {
    this.db.exec('VACUUM');
  }

  /**
   * Checkpoint WAL to main database file
   */
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }
}

/**
 * Create an in-memory database (for testing)
 */
export function createMemoryDatabase(): DatabaseClient {
  // Reset any existing instance
  DatabaseClient.resetInstance();

  // Create in-memory database
  return DatabaseClient.getInstance(':memory:');
}
