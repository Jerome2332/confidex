/**
 * Settlement Executor
 *
 * Monitors for matched orders (status = Inactive, filled > 0) and
 * executes the settle_order instruction to transfer tokens between users.
 *
 * Flow:
 * 1. Match orders via match_orders → MPC price comparison
 * 2. MPC callback (finalize_match) sets orders to Inactive + sets filled amounts
 * 3. This service detects matched but unsettled orders
 * 4. Calls settle_order instruction to transfer tokens
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import Database from 'better-sqlite3';
import { CrankConfig } from './config.js';
import { OrderStatus, Side } from './types.js';
import { logger } from '../lib/logger.js';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const log = logger.settlement;

// =============================================================================
// SHARED CONSTANTS - Source of truth: lib/src/constants.ts
// TODO: Import from @confidex/sdk when monorepo workspace is configured
// =============================================================================
const PAIR_SEED = Buffer.from('pair');
const ORDER_SEED = Buffer.from('order');
const USER_BALANCE_SEED = Buffer.from('user_balance');
const EXCHANGE_SEED = Buffer.from('exchange');

// System program ID
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

// settle_order discriminator: sha256("global:settle_order")[0..8]
const SETTLE_ORDER_DISCRIMINATOR = new Uint8Array([0x50, 0x4a, 0xcc, 0x22, 0x0c, 0xb7, 0x42, 0x42]);

// Settlement method enum
// 0 = ShadowWire (Bulletproof ZK, 1% fee)
// 1 = C-SPL (Arcium MPC, 0% fee) - disabled until SDK available
// 2 = StandardSPL (no privacy, fallback)
export enum SettlementMethod {
  ShadowWire = 0,
  CSPL = 1,
  StandardSPL = 2,
}

interface MatchedOrderPair {
  buyOrderPda: PublicKey;
  sellOrderPda: PublicKey;
  buyMaker: PublicKey;
  sellMaker: PublicKey;
  pairPda: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}

/**
 * V5 ParsedOrder - for settlement detection
 */
interface ParsedOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  status: OrderStatus;
  encryptedFilled: Uint8Array;  // 64 bytes - first byte != 0 means order has fill
  isMatching: boolean;
  pendingMatchRequest: PublicKey;  // Orders matched together share this request ID
}

// V5 order account size
const ORDER_ACCOUNT_SIZE_V5 = 366;

export class SettlementExecutor {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private programId: PublicKey;
  private isPolling: boolean = false;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  // SQLite database for persistent settlement tracking
  private db: Database.Database;

  // Track failed settlements with cooldown (don't retry immediately)
  private failedSettlements: Map<string, number> = new Map();
  private readonly FAILURE_COOLDOWN_MS = 60000; // 1 minute cooldown

  // Settlement locks to prevent race conditions
  private settlementLocks: Map<string, number> = new Map();
  private readonly LOCK_TIMEOUT_MS = 30000; // 30 second lock

  // Cleanup interval for old records
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private readonly RECORD_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    connection: Connection,
    crankKeypair: Keypair,
    config: CrankConfig
  ) {
    this.connection = connection;
    this.crankKeypair = crankKeypair;
    this.config = config;
    this.programId = new PublicKey(config.programs.confidexDex);

    // Initialize SQLite database
    const dbPath = config.dbPath || './data/settlements.db';
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initDatabase();
    log.info({ dbPath }, 'Settlement database initialized');
  }

  /**
   * Initialize database schema
   */
  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settled_orders (
        settlement_key TEXT PRIMARY KEY,
        buy_order TEXT NOT NULL,
        sell_order TEXT NOT NULL,
        settled_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_settled_at ON settled_orders(settled_at)
    `);
  }

  /**
   * Check if a settlement has already been processed
   */
  private isSettled(settlementKey: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM settled_orders WHERE settlement_key = ?'
    ).get(settlementKey);
    return !!row;
  }

  /**
   * Mark a settlement as completed
   */
  private markSettled(settlementKey: string, buyOrder: string, sellOrder: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO settled_orders
      (settlement_key, buy_order, sell_order, settled_at)
      VALUES (?, ?, ?, ?)
    `).run(settlementKey, buyOrder, sellOrder, Date.now());
  }

  /**
   * Cleanup old settlement records (>24 hours)
   */
  private cleanupOldRecords(): void {
    const cutoff = Date.now() - this.RECORD_RETENTION_MS;
    const result = this.db.prepare('DELETE FROM settled_orders WHERE settled_at < ?').run(cutoff);
    if (result.changes > 0) {
      log.debug({ deleted: result.changes }, 'Cleaned up old settlement records');
    }
  }

  /**
   * Get count of settled orders in database
   */
  private getSettledCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM settled_orders').get() as { count: number };
    return row?.count || 0;
  }

  /**
   * Start polling for matched orders
   */
  start(): void {
    if (this.isPolling) {
      log.debug('Already polling');
      return;
    }

    this.isPolling = true;
    log.info({ settledCount: this.getSettledCount() }, 'Started polling for matched orders');

    // Poll immediately, then at intervals
    this.pollForSettlements();
    this.pollIntervalId = setInterval(() => this.pollForSettlements(), 5000);

    // Start cleanup interval for old records
    this.cleanupOldRecords(); // Run immediately
    this.cleanupIntervalId = setInterval(() => this.cleanupOldRecords(), this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.isPolling = false;
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    log.info('Stopped polling');
  }

  /**
   * Close database connection (call on shutdown)
   */
  close(): void {
    this.stop();
    if (this.db) {
      this.db.close();
      log.info('Settlement database closed');
    }
  }

  /**
   * Parse order account data - V5 format only (366 bytes)
   */
  private parseOrder(data: Buffer): ParsedOrder {
    let offset = 8; // Skip discriminator

    const maker = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const pair = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const side = data.readUInt8(offset) as Side;
    offset += 1;

    // Skip order_type
    offset += 1;

    // Skip encrypted_amount
    offset += 64;

    // Skip encrypted_price
    offset += 64;

    const encryptedFilled = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const status = data.readUInt8(offset) as OrderStatus;
    offset += 1;

    // Skip created_at_hour (8), order_id (16), order_nonce (8), eligibility_proof_verified (1)
    offset += 8 + 16 + 8 + 1;

    // pending_match_request is 32 bytes
    const pendingMatchRequest = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const isMatching = data.readUInt8(offset) === 1;

    return { maker, pair, side, status, encryptedFilled, isMatching, pendingMatchRequest };
  }

  /**
   * Check if an order has been filled
   * V5: encrypted_filled[0] != 0 means MPC has set a fill value
   */
  private isFilled(order: ParsedOrder): boolean {
    return order.encryptedFilled[0] !== 0;
  }

  /**
   * Generate settlement key for tracking
   */
  private getSettlementKey(buyPda: PublicKey, sellPda: PublicKey): string {
    return `${buyPda.toBase58()}_${sellPda.toBase58()}`;
  }

  /**
   * Acquire lock for settlement to prevent race conditions
   */
  private acquireLock(settlementKey: string): boolean {
    const existing = this.settlementLocks.get(settlementKey);
    const now = Date.now();

    if (existing && now - existing < this.LOCK_TIMEOUT_MS) {
      return false; // Lock held by another operation
    }

    this.settlementLocks.set(settlementKey, now);
    return true;
  }

  /**
   * Release lock after settlement
   */
  private releaseLock(settlementKey: string): void {
    this.settlementLocks.delete(settlementKey);
  }

  /**
   * Poll for matched orders needing settlement
   * V5: Match orders by pending_match_request (same request ID = matched together)
   */
  private async pollForSettlements(): Promise<void> {
    if (!this.isPolling) return;

    try {
      // Fetch V5 (366 byte) orders only
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
      });

      // Group filled orders by side
      // V5: encrypted_filled[0] != 0 means order has a fill from MPC
      const filledBuys: { pda: PublicKey; order: ParsedOrder }[] = [];
      const filledSells: { pda: PublicKey; order: ParsedOrder }[] = [];

      for (const { pubkey, account } of accounts) {
        const order = this.parseOrder(account.data);

        // Look for orders with non-zero encrypted_filled that aren't currently matching
        if (!order.isMatching && this.isFilled(order)) {
          if (order.side === Side.Buy) {
            filledBuys.push({ pda: pubkey, order });
          } else {
            filledSells.push({ pda: pubkey, order });
          }
        }
      }

      // Only log when there are actually filled orders to process
      if (filledBuys.length > 0 || filledSells.length > 0) {
        log.debug({ buys: filledBuys.length, sells: filledSells.length }, 'Found filled orders');
      }

      // Find matching pairs - orders matched together share the same pending_match_request
      for (const buy of filledBuys) {
        for (const sell of filledSells) {
          // Must be same trading pair
          if (!buy.order.pair.equals(sell.order.pair)) {
            continue;
          }

          // Must share the same pending_match_request (proves they were matched together)
          // Also verify the request is non-zero (orders were actually matched via MPC)
          const zeroKey = PublicKey.default;
          if (buy.order.pendingMatchRequest.equals(zeroKey)) {
            continue;
          }
          if (!buy.order.pendingMatchRequest.equals(sell.order.pendingMatchRequest)) {
            continue;
          }

          const settlementKey = this.getSettlementKey(buy.pda, sell.pda);

          // Skip if already settled (check database)
          if (this.isSettled(settlementKey)) {
            continue;
          }

          // Skip if recently failed (cooldown period)
          const lastFailure = this.failedSettlements.get(settlementKey);
          if (lastFailure && Date.now() - lastFailure < this.FAILURE_COOLDOWN_MS) {
            continue; // Still in cooldown, skip silently
          }

          // Acquire lock to prevent race conditions
          if (!this.acquireLock(settlementKey)) {
            log.debug({ settlementKey }, 'Settlement already in progress');
            continue;
          }

          // Found a pair to settle!
          log.info({
            buy: buy.pda.toBase58().slice(0, 8),
            sell: sell.pda.toBase58().slice(0, 8),
            matchRequest: buy.order.pendingMatchRequest.toBase58().slice(0, 8),
          }, 'Attempting settlement');

          try {
            await this.settleOrders(buy.pda, sell.pda, buy.order, sell.order);
            this.markSettled(settlementKey, buy.pda.toBase58(), sell.pda.toBase58());
            this.failedSettlements.delete(settlementKey); // Clear any previous failure
          } catch (err) {
            // Extract just the essential error info
            const errorMsg = this.extractErrorSummary(err);
            log.error({ error: errorMsg }, 'Settlement failed (retry in 60s)');
            this.failedSettlements.set(settlementKey, Date.now()); // Add cooldown
          } finally {
            this.releaseLock(settlementKey);
          }
        }
      }

      // Cleanup expired failure cooldowns (in-memory)
      const now = Date.now();
      for (const [key, timestamp] of this.failedSettlements.entries()) {
        if (now - timestamp > this.FAILURE_COOLDOWN_MS * 2) {
          this.failedSettlements.delete(key);
        }
      }

      // Cleanup expired locks (in-memory)
      for (const [key, timestamp] of this.settlementLocks.entries()) {
        if (now - timestamp > this.LOCK_TIMEOUT_MS) {
          this.settlementLocks.delete(key);
        }
      }

      // Note: Database cleanup is handled separately by cleanupOldRecords() on interval
    } catch (err) {
      const errorMsg = this.extractErrorSummary(err);
      log.error({ error: errorMsg }, 'Poll error');
    }
  }

  /**
   * Extract a concise error summary (no stack traces, no verbose simulation data)
   */
  private extractErrorSummary(err: unknown): string {
    if (!(err instanceof Error)) {
      return String(err);
    }

    const msg = err.message;

    // Check for Anchor custom program error
    const anchorMatch = msg.match(/custom program error: (0x[0-9a-fA-F]+)/);
    if (anchorMatch) {
      const hexCode = anchorMatch[1];
      const code = parseInt(hexCode, 16);

      // Known error codes
      if (code === 0x1782 || code === 6018) {
        return 'InsufficientBalance (buyer USDC or seller SOL too low)';
      }
      if (code === 0xbbb || code === 3003) {
        return 'AccountDidNotDeserialize (V3 order passed to V4 program)';
      }

      return `Program error ${hexCode} (${code})`;
    }

    // Check for simulation error logs
    const simMatch = msg.match(/Error Code: (\w+)/);
    if (simMatch) {
      return simMatch[1];
    }

    // Return first line only (no stack trace)
    return msg.split('\n')[0].slice(0, 100);
  }

  /**
   * Derive user balance PDA
   */
  private deriveUserBalancePda(user: PublicKey, mint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [USER_BALANCE_SEED, user.toBuffer(), mint.toBuffer()],
      this.programId
    );
    return pda;
  }

  /**
   * Derive exchange state PDA
   */
  private deriveExchangePda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [EXCHANGE_SEED],
      this.programId
    );
    return pda;
  }

  /**
   * Get fee recipient from exchange state
   */
  private async getFeeRecipient(): Promise<PublicKey | null> {
    const exchangePda = this.deriveExchangePda();
    const accountInfo = await this.connection.getAccountInfo(exchangePda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    // Exchange account layout: discriminator(8) + authority(32) = fee_recipient starts at offset 40
    // Actually need to check the exact layout - let's use offset 8 + 32 = 40 for authority, then fee_recipient
    // Based on state/exchange.rs: authority(32) + fee_recipient(32)
    const feeRecipient = new PublicKey(data.subarray(40, 72));
    return feeRecipient;
  }

  /**
   * Parse trading pair to get mints
   */
  private async getPairMints(pairPda: PublicKey): Promise<{ baseMint: PublicKey; quoteMint: PublicKey } | null> {
    const accountInfo = await this.connection.getAccountInfo(pairPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    let offset = 8; // Skip discriminator

    const baseMint = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const quoteMint = new PublicKey(data.subarray(offset, offset + 32));

    return { baseMint, quoteMint };
  }

  /**
   * Execute settle_order instruction
   *
   * @param settlementMethod - Settlement method (defaults to ShadowWire for privacy)
   */
  private async settleOrders(
    buyPda: PublicKey,
    sellPda: PublicKey,
    buyOrder: ParsedOrder,
    sellOrder: ParsedOrder,
    settlementMethod: SettlementMethod = SettlementMethod.ShadowWire
  ): Promise<void> {
    // Get trading pair mints
    const mints = await this.getPairMints(buyOrder.pair);
    if (!mints) {
      log.error('Could not fetch trading pair mints');
      return;
    }

    const { baseMint, quoteMint } = mints;

    // Derive user balance PDAs
    const buyerBaseBalance = this.deriveUserBalancePda(buyOrder.maker, baseMint);
    const buyerQuoteBalance = this.deriveUserBalancePda(buyOrder.maker, quoteMint);
    const sellerBaseBalance = this.deriveUserBalancePda(sellOrder.maker, baseMint);
    const sellerQuoteBalance = this.deriveUserBalancePda(sellOrder.maker, quoteMint);

    // Derive exchange and fee recipient accounts
    const exchangePda = this.deriveExchangePda();
    const feeRecipient = await this.getFeeRecipient();
    if (!feeRecipient) {
      log.error('Could not fetch fee recipient from exchange');
      return;
    }
    const feeRecipientBalance = this.deriveUserBalancePda(feeRecipient, quoteMint);

    const methodName = SettlementMethod[settlementMethod];
    log.debug({
      buyOrder: buyPda.toBase58().slice(0, 8),
      sellOrder: sellPda.toBase58().slice(0, 8),
      buyer: buyOrder.maker.toBase58().slice(0, 8),
      seller: sellOrder.maker.toBase58().slice(0, 8),
      method: methodName,
    }, 'Building settlement TX');

    // Build instruction data: discriminator (8 bytes) + SettleOrderParams (1 byte)
    const instructionData = Buffer.alloc(9);
    Buffer.from(SETTLE_ORDER_DISCRIMINATOR).copy(instructionData, 0);
    instructionData.writeUInt8(settlementMethod, 8);

    // Build instruction
    // Account order must match SettleOrder struct in settle_order.rs
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: buyOrder.pair, isSigner: false, isWritable: false },     // pair
        { pubkey: buyPda, isSigner: false, isWritable: true },             // buy_order
        { pubkey: sellPda, isSigner: false, isWritable: true },            // sell_order
        { pubkey: buyerBaseBalance, isSigner: false, isWritable: true },   // buyer_base_balance
        { pubkey: buyerQuoteBalance, isSigner: false, isWritable: true },  // buyer_quote_balance
        { pubkey: sellerBaseBalance, isSigner: false, isWritable: true },  // seller_base_balance
        { pubkey: sellerQuoteBalance, isSigner: false, isWritable: true }, // seller_quote_balance
        { pubkey: exchangePda, isSigner: false, isWritable: false },       // exchange
        { pubkey: feeRecipientBalance, isSigner: false, isWritable: true },// fee_recipient_balance
        { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true }, // crank (mut for init_if_needed)
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },// system_program
      ],
      programId: this.programId,
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.crankKeypair.publicKey;

    try {
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.crankKeypair],
        { commitment: 'confirmed' }
      );
      log.info({ signature: signature.slice(0, 12) }, '✓ Settlement successful');
    } catch (err: unknown) {
      const errorMsg = this.extractErrorSummary(err);
      log.error({ error: errorMsg }, '✗ Settlement TX failed');
      throw err;
    }
  }

  /**
   * Get executor status
   */
  getStatus(): { isPolling: boolean; settledCount: number } {
    return {
      isPolling: this.isPolling,
      settledCount: this.getSettledCount(),
    };
  }
}
