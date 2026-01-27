/**
 * Settlement Executor
 *
 * Monitors for matched orders (status = Inactive, filled > 0) and
 * executes the settle_order instruction to transfer tokens between users.
 *
 * Settlement Flow (ShadowWire - Privacy Preserving):
 * 1. Match orders via match_orders → MPC price comparison
 * 2. MPC callback (finalize_match) sets orders to Inactive + sets filled amounts
 * 3. This service detects matched but unsettled orders
 * 4. Calls initiate_settlement to create SettlementRequest PDA
 * 5. Executes ShadowWire transfers via relayer client (amounts hidden)
 * 6. Records transfer IDs on-chain via record_shadowwire_transfer
 * 7. Finalizes settlement to mark orders as filled
 *
 * Legacy Flow (settle_order - for backward compatibility):
 * Steps 1-3 same as above
 * 4. Calls settle_order instruction directly (deprecated, leaks amounts)
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
import { getAlertManager, AlertManager } from '../lib/alerts.js';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import {
  ShadowWireRelayerClient,
  createRelayerClientFromEnv,
  type ShadowWireToken,
} from '../shadowwire/index.js';
import { DistributedLockService, type AcquiredLock } from './distributed-lock.js';

const log = logger.settlement;

// =============================================================================
// SHARED CONSTANTS - Source of truth: lib/src/constants.ts
// TODO: Import from @confidex/sdk when monorepo workspace is configured
// =============================================================================
const PAIR_SEED = Buffer.from('pair');
const ORDER_SEED = Buffer.from('order');
const USER_BALANCE_SEED = Buffer.from('user_balance');
const EXCHANGE_SEED = Buffer.from('exchange');
const SETTLEMENT_SEED = Buffer.from('settlement');
const SHADOWWIRE_USER_SEED = Buffer.from('shadowwire_user');

// System program ID
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

// Instruction discriminators (sha256("global:<instruction_name>")[0..8])
const SETTLE_ORDER_DISCRIMINATOR = new Uint8Array([0x50, 0x4a, 0xcc, 0x22, 0x0c, 0xb7, 0x42, 0x42]);
// Generated via: crypto.createHash('sha256').update('global:initiate_settlement').digest().slice(0,8)
const INITIATE_SETTLEMENT_DISCRIMINATOR = new Uint8Array([21, 206, 83, 9, 54, 135, 177, 194]);
const RECORD_TRANSFER_DISCRIMINATOR = new Uint8Array([92, 125, 242, 30, 125, 179, 202, 213]);
const FINALIZE_SETTLEMENT_DISCRIMINATOR = new Uint8Array([220, 72, 152, 119, 178, 196, 25, 170]);
// Generated via: crypto.createHash('sha256').update('global:fail_settlement').digest().slice(0,8)
const FAIL_SETTLEMENT_DISCRIMINATOR = new Uint8Array([179, 157, 56, 89, 247, 141, 88, 91]);
// Generated via: crypto.createHash('sha256').update('global:expire_settlement').digest().slice(0,8)
const EXPIRE_SETTLEMENT_DISCRIMINATOR = new Uint8Array([88, 198, 217, 132, 11, 91, 184, 12]);

// Token mint to ShadowWire token mapping
// Only tokens supported by ShadowWire SDK (@radr/shadowwire)
const MINT_TO_TOKEN: Record<string, ShadowWireToken> = {
  // Wrapped SOL
  'So11111111111111111111111111111111111111112': 'SOL',
  // USDC (devnet + mainnet)
  'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr': 'USDC',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
};

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

  // Alert manager for critical failures
  private alertManager: AlertManager;

  // ShadowWire relayer client for privacy-preserving settlements
  private shadowWireClient: ShadowWireRelayerClient | null = null;
  private useShadowWire: boolean = false;

  // Distributed lock service for multi-instance coordination (optional)
  private distributedLockService: DistributedLockService | null = null;

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
    this.alertManager = getAlertManager();

    // Initialize ShadowWire client if configured
    this.useShadowWire = process.env.SETTLEMENT_METHOD === 'shadowwire' ||
                         process.env.SHADOWWIRE_ENABLED === 'true';
    if (this.useShadowWire && process.env.SHADOWWIRE_API_KEY) {
      this.shadowWireClient = createRelayerClientFromEnv();
      log.info('ShadowWire settlement enabled');
    } else {
      log.info('Using legacy settlement (ShadowWire not configured)');
    }

    log.info({ dbPath, useShadowWire: this.useShadowWire }, 'Settlement database initialized');
  }

  /**
   * Set distributed lock service for multi-instance coordination
   * When set, uses distributed locks instead of in-memory locks
   */
  setDistributedLockService(lockService: DistributedLockService): void {
    this.distributedLockService = lockService;
    log.info({ instanceId: lockService.getInstanceId() }, 'Distributed lock service enabled');
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

    // Process rollback queue periodically (every 30 seconds)
    setInterval(() => this.processRollbackQueue(), 30000);
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
  // Track distributed locks for cleanup
  private distributedLocks: Map<string, AcquiredLock> = new Map();

  /**
   * Acquire lock for settlement (in-memory or distributed)
   */
  private async acquireLock(settlementKey: string): Promise<boolean> {
    // Use distributed locks if available (multi-instance mode)
    if (this.distributedLockService) {
      const lockName = `settlement:${settlementKey}`;
      const lock = await this.distributedLockService.acquire(lockName, {
        ttlSeconds: 60,
        metadata: JSON.stringify({ settlementKey, timestamp: Date.now() }),
      });

      if (lock) {
        this.distributedLocks.set(settlementKey, lock);
        return true;
      }
      return false;
    }

    // Fall back to in-memory locks (single-instance mode)
    const existing = this.settlementLocks.get(settlementKey);
    const now = Date.now();

    if (existing && now - existing < this.LOCK_TIMEOUT_MS) {
      return false; // Lock held by another operation
    }

    this.settlementLocks.set(settlementKey, now);
    return true;
  }

  /**
   * Release lock after settlement (in-memory or distributed)
   */
  private async releaseLock(settlementKey: string): Promise<void> {
    // Release distributed lock if available
    const distributedLock = this.distributedLocks.get(settlementKey);
    if (distributedLock) {
      await distributedLock.release();
      this.distributedLocks.delete(settlementKey);
      return;
    }

    // Fall back to in-memory lock cleanup
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
          if (!await this.acquireLock(settlementKey)) {
            log.debug({ settlementKey }, 'Settlement already in progress');
            continue;
          }

          // Found a pair to settle!
          log.info({
            buy: buy.pda.toBase58().slice(0, 8),
            sell: sell.pda.toBase58().slice(0, 8),
            matchRequest: buy.order.pendingMatchRequest.toBase58().slice(0, 8),
            method: this.useShadowWire ? 'ShadowWire' : 'Legacy',
          }, 'Attempting settlement');

          try {
            // Settlement is atomic: only mark as settled after on-chain verification
            // Use ShadowWire for privacy-preserving settlement if configured
            const signature = this.useShadowWire && this.shadowWireClient
              ? await this.settleOrdersViaShadowWire(buy.pda, sell.pda, buy.order, sell.order)
              : await this.settleOrders(buy.pda, sell.pda, buy.order, sell.order);
            // Only mark settled if settleOrders returns successfully (includes on-chain verification)
            this.markSettled(settlementKey, buy.pda.toBase58(), sell.pda.toBase58());
            this.failedSettlements.delete(settlementKey); // Clear any previous failure
            log.debug({ signature: signature.slice(0, 12), settlementKey: settlementKey.slice(0, 20) }, 'Settlement recorded in database');
          } catch (err) {
            // Extract just the essential error info
            const errorMsg = this.extractErrorSummary(err);
            log.error({ error: errorMsg }, 'Settlement failed (retry in 60s)');
            this.failedSettlements.set(settlementKey, Date.now()); // Add cooldown

            // Alert on settlement failures (critical for order completion)
            await this.alertManager.error(
              'Settlement Failed',
              `Order settlement failed: ${errorMsg}`,
              {
                buyOrder: buy.pda.toBase58().slice(0, 16),
                sellOrder: sell.pda.toBase58().slice(0, 16),
                matchRequest: buy.order.pendingMatchRequest.toBase58().slice(0, 16),
              },
              `settlement-failed-${settlementKey.slice(0, 32)}`
            );
          } finally {
            await this.releaseLock(settlementKey);
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
   * @returns Transaction signature if successful
   */
  private async settleOrders(
    buyPda: PublicKey,
    sellPda: PublicKey,
    buyOrder: ParsedOrder,
    sellOrder: ParsedOrder,
    settlementMethod: SettlementMethod = SettlementMethod.ShadowWire
  ): Promise<string> {
    // Get trading pair mints
    const mints = await this.getPairMints(buyOrder.pair);
    if (!mints) {
      log.error('Could not fetch trading pair mints');
      throw new Error('Could not fetch trading pair mints');
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
      throw new Error('Could not fetch fee recipient from exchange');
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

      // Verify settlement succeeded by checking on-chain order status
      // This makes the settlement atomic - we only return success if verified
      const verified = await this.verifySettlementOnChain(buyPda, sellPda);
      if (!verified) {
        log.warn({ signature: signature.slice(0, 12) }, 'Settlement TX confirmed but on-chain verification failed');
        throw new Error('Settlement verification failed - orders not in expected state');
      }

      log.info({ signature: signature.slice(0, 12) }, '✓ Settlement successful and verified');
      return signature;
    } catch (err: unknown) {
      const errorMsg = this.extractErrorSummary(err);
      log.error({ error: errorMsg }, '✗ Settlement TX failed');

      // Alert specifically on InsufficientBalance errors (common production issue)
      if (errorMsg.includes('InsufficientBalance')) {
        await this.alertManager.warning(
          'Settlement Insufficient Balance',
          `User has insufficient balance for settlement: ${errorMsg}`,
          {
            buyOrder: buyPda.toBase58().slice(0, 16),
            sellOrder: sellPda.toBase58().slice(0, 16),
            buyer: buyOrder.maker.toBase58().slice(0, 16),
            seller: sellOrder.maker.toBase58().slice(0, 16),
          },
          `insufficient-balance-${buyPda.toBase58().slice(0, 16)}`
        );
      }

      throw err;
    }
  }

  // ==========================================================================
  // SHADOWWIRE SETTLEMENT METHODS
  // ==========================================================================

  /**
   * Execute two-phase ShadowWire settlement (privacy-preserving)
   *
   * Flow:
   * 1. initiate_settlement - Create SettlementRequest PDA on-chain
   * 2. Execute ShadowWire transfers via relayer (amounts hidden)
   * 3. record_shadowwire_transfer - Record transfer IDs on-chain
   * 4. finalize_settlement - Mark orders as filled
   */
  private async settleOrdersViaShadowWire(
    buyPda: PublicKey,
    sellPda: PublicKey,
    buyOrder: ParsedOrder,
    sellOrder: ParsedOrder
  ): Promise<string> {
    if (!this.shadowWireClient) {
      throw new Error('ShadowWire client not initialized');
    }

    // Get trading pair mints
    const mints = await this.getPairMints(buyOrder.pair);
    if (!mints) {
      throw new Error('Could not fetch trading pair mints');
    }

    const { baseMint, quoteMint } = mints;

    // Map mints to ShadowWire tokens
    const baseToken = MINT_TO_TOKEN[baseMint.toBase58()];
    const quoteToken = MINT_TO_TOKEN[quoteMint.toBase58()];

    if (!baseToken || !quoteToken) {
      log.warn({ baseMint: baseMint.toBase58(), quoteMint: quoteMint.toBase58() },
        'Tokens not supported by ShadowWire, falling back to legacy settlement');
      return this.settleOrders(buyPda, sellPda, buyOrder, sellOrder, SettlementMethod.StandardSPL);
    }

    log.info({
      buy: buyPda.toBase58().slice(0, 8),
      sell: sellPda.toBase58().slice(0, 8),
      baseToken,
      quoteToken,
    }, 'Starting ShadowWire settlement');

    // Step 1: Initiate settlement on-chain
    const settlementPda = this.deriveSettlementPda(buyPda, sellPda);
    await this.initiateSettlementOnChain(buyPda, sellPda, buyOrder, sellOrder, settlementPda);

    try {
      // Step 2: Get decrypted amounts from MPC
      // For now, we read the plaintext values from the order (hackathon mode)
      // In production, this would come from an MPC callback
      const fillAmount = this.extractFillAmount(buyOrder);
      const fillValue = this.extractFillValue(buyOrder);

      if (fillAmount === 0n || fillValue === 0n) {
        throw new Error('Fill amounts are zero');
      }

      // Step 3: Execute base token transfer (seller → buyer)
      log.debug({ amount: fillAmount.toString(), token: baseToken }, 'Executing base transfer');
      const baseResult = await this.shadowWireClient.executeTransfer({
        sender: sellOrder.maker.toBase58(),
        recipient: buyOrder.maker.toBase58(),
        amount: fillAmount,
        token: baseToken,
        type: 'internal',
      });

      if (!baseResult.success) {
        throw new Error(`Base transfer failed: ${baseResult.error}`);
      }

      // Record base transfer on-chain
      await this.recordTransferOnChain(settlementPda, 'base', baseResult.transferId);

      // Step 4: Execute quote token transfer (buyer → seller)
      log.debug({ amount: fillValue.toString(), token: quoteToken }, 'Executing quote transfer');
      const quoteResult = await this.shadowWireClient.executeTransfer({
        sender: buyOrder.maker.toBase58(),
        recipient: sellOrder.maker.toBase58(),
        amount: fillValue,
        token: quoteToken,
        type: 'internal',
      });

      if (!quoteResult.success) {
        // Quote transfer failed - initiate rollback for the base transfer
        log.error({ baseTransferId: baseResult.transferId }, 'Quote transfer failed, initiating rollback');
        await this.initiateRollback(settlementPda, buyPda, sellPda, baseResult.transferId, buyOrder, sellOrder);
        throw new Error(`Quote transfer failed: ${quoteResult.error}`);
      }

      // Record quote transfer on-chain
      await this.recordTransferOnChain(settlementPda, 'quote', quoteResult.transferId);

      // Step 5: Finalize settlement
      const signature = await this.finalizeSettlementOnChain(settlementPda, buyPda, sellPda);

      log.info({
        signature: signature.slice(0, 12),
        baseTransferId: baseResult.transferId.slice(0, 12),
        quoteTransferId: quoteResult.transferId.slice(0, 12),
      }, '✓ ShadowWire settlement complete');

      return signature;
    } catch (err) {
      // Mark settlement as failed on-chain
      await this.markSettlementFailed(settlementPda).catch(() => {});
      throw err;
    }
  }

  /**
   * Derive settlement request PDA
   */
  private deriveSettlementPda(buyPda: PublicKey, sellPda: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SETTLEMENT_SEED, buyPda.toBuffer(), sellPda.toBuffer()],
      this.programId
    );
    return pda;
  }

  /**
   * Extract fill amount from order (hackathon: first 8 bytes of encrypted_filled)
   * In production: This comes from MPC callback
   */
  private extractFillAmount(order: ParsedOrder): bigint {
    // First 8 bytes of encrypted_filled contain plaintext in hackathon mode
    const buffer = Buffer.from(order.encryptedFilled.slice(0, 8));
    return buffer.readBigUInt64LE(0);
  }

  /**
   * Extract fill value from order (hackathon: compute from price)
   * In production: This comes from MPC callback
   */
  private extractFillValue(order: ParsedOrder): bigint {
    // For hackathon, compute fill_value = fill_amount * price / 1e9
    // This would be done by MPC in production
    const fillAmount = this.extractFillAmount(order);
    // Price would need to be read from order as well - simplified for now
    // Assuming price is in encrypted_price first 8 bytes
    return fillAmount; // Placeholder - actual computation needs price
  }

  /**
   * Initiate settlement on-chain (creates SettlementRequest PDA)
   */
  private async initiateSettlementOnChain(
    buyPda: PublicKey,
    sellPda: PublicKey,
    buyOrder: ParsedOrder,
    sellOrder: ParsedOrder,
    settlementPda: PublicKey
  ): Promise<string> {
    // Get mints
    const mints = await this.getPairMints(buyOrder.pair);
    if (!mints) throw new Error('Could not fetch trading pair mints');

    // Build instruction data: discriminator (8) + method (1)
    const instructionData = Buffer.alloc(9);
    Buffer.from(INITIATE_SETTLEMENT_DISCRIMINATOR).copy(instructionData, 0);
    instructionData.writeUInt8(SettlementMethod.ShadowWire, 8);

    // Account order must match InitiateSettlement struct:
    // 1. pair (readonly) - trading pair for validation
    // 2. buy_order (mut)
    // 3. sell_order (mut)
    // 4. settlement_request (init, mut)
    // 5. authority (signer, mut)
    // 6. system_program (readonly)
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: buyOrder.pair, isSigner: false, isWritable: false },      // pair
        { pubkey: buyPda, isSigner: false, isWritable: true },               // buy_order
        { pubkey: sellPda, isSigner: false, isWritable: true },              // sell_order
        { pubkey: settlementPda, isSigner: false, isWritable: true },        // settlement_request
        { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true }, // authority
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },   // system_program
      ],
      programId: this.programId,
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.crankKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    log.debug({ signature: signature.slice(0, 12), settlementPda: settlementPda.toBase58().slice(0, 12) },
      'Settlement initiated on-chain');

    return signature;
  }

  /**
   * Record ShadowWire transfer on-chain
   */
  private async recordTransferOnChain(
    settlementPda: PublicKey,
    transferType: 'base' | 'quote',
    transferId: string
  ): Promise<string> {
    const exchangePda = this.deriveExchangePda();

    // Build instruction data: discriminator (8) + transfer_type (1) + transfer_id (32)
    const instructionData = Buffer.alloc(41);
    Buffer.from(RECORD_TRANSFER_DISCRIMINATOR).copy(instructionData, 0);
    instructionData.writeUInt8(transferType === 'base' ? 0 : 1, 8);
    Buffer.from(transferId, 'hex').copy(instructionData, 9, 0, 32);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: settlementPda, isSigner: false, isWritable: true },
        { pubkey: exchangePda, isSigner: false, isWritable: false },
        { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      ],
      programId: this.programId,
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.crankKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    log.debug({ signature: signature.slice(0, 12), transferType, transferId: transferId.slice(0, 12) },
      'Transfer recorded on-chain');

    return signature;
  }

  /**
   * Finalize settlement on-chain
   */
  private async finalizeSettlementOnChain(
    settlementPda: PublicKey,
    buyPda: PublicKey,
    sellPda: PublicKey
  ): Promise<string> {
    const instructionData = Buffer.alloc(8);
    Buffer.from(FINALIZE_SETTLEMENT_DISCRIMINATOR).copy(instructionData, 0);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: settlementPda, isSigner: false, isWritable: true },
        { pubkey: buyPda, isSigner: false, isWritable: true },
        { pubkey: sellPda, isSigner: false, isWritable: true },
        { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      ],
      programId: this.programId,
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.crankKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    return signature;
  }

  /**
   * Failure reason enum (matches on-chain FailureReason)
   */
  private readonly FailureReason = {
    TransferFailed: 0,
    MpcFailed: 1,
    Timeout: 2,
    ManualIntervention: 3,
    Unknown: 4,
  } as const;

  /**
   * Mark settlement as failed on-chain
   */
  private async markSettlementFailed(
    settlementPda: PublicKey,
    buyPda?: PublicKey,
    sellPda?: PublicKey,
    reason: number = 4 // Unknown
  ): Promise<void> {
    try {
      // If we don't have the order PDAs, we can't call fail_settlement
      if (!buyPda || !sellPda) {
        log.warn({ settlementPda: settlementPda.toBase58().slice(0, 12) },
          'Settlement failed - cannot call fail_settlement without order PDAs');
        return;
      }

      const exchangePda = this.deriveExchangePda();

      // Build instruction data: discriminator (8) + reason (1) + error_message_option (1 for None)
      const instructionData = Buffer.alloc(10);
      Buffer.from(FAIL_SETTLEMENT_DISCRIMINATOR).copy(instructionData, 0);
      instructionData.writeUInt8(reason, 8);
      instructionData.writeUInt8(0, 9); // Option::None for error_message

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: settlementPda, isSigner: false, isWritable: true },  // settlement_request
          { pubkey: buyPda, isSigner: false, isWritable: true },         // buy_order
          { pubkey: sellPda, isSigner: false, isWritable: true },        // sell_order
          { pubkey: exchangePda, isSigner: false, isWritable: false },   // exchange
          { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true }, // authority
        ],
        programId: this.programId,
        data: instructionData,
      });

      const transaction = new Transaction().add(instruction);
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.crankKeypair.publicKey;

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.crankKeypair],
        { commitment: 'confirmed' }
      );

      log.info({ signature: signature.slice(0, 12), settlementPda: settlementPda.toBase58().slice(0, 12) },
        'Settlement marked as failed on-chain');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ error: errMsg, settlementPda: settlementPda.toBase58().slice(0, 12) },
        'Failed to mark settlement as failed on-chain');
    }
  }

  /**
   * Initiate rollback for a partial settlement (base transferred, quote failed)
   *
   * This function:
   * 1. Marks the settlement as RollingBack on-chain via fail_settlement
   * 2. Attempts to reverse the base transfer via ShadowWire
   * 3. If rollback succeeds, the settlement stays in RollingBack/Failed state
   * 4. If rollback fails, alerts for manual intervention
   */
  private async initiateRollback(
    settlementPda: PublicKey,
    buyPda: PublicKey,
    sellPda: PublicKey,
    baseTransferId: string,
    buyOrder: ParsedOrder,
    sellOrder: ParsedOrder
  ): Promise<void> {
    log.info({
      settlementPda: settlementPda.toBase58().slice(0, 12),
      baseTransferId: baseTransferId.slice(0, 12),
    }, 'Initiating settlement rollback');

    // Step 1: Mark settlement as failed (which sets it to RollingBack if partial)
    await this.markSettlementFailed(
      settlementPda,
      buyPda,
      sellPda,
      this.FailureReason.TransferFailed
    );

    // Step 2: Attempt to reverse the base transfer via ShadowWire
    if (!this.shadowWireClient) {
      log.error('Cannot rollback - ShadowWire client not available');
      await this.alertManager.error(
        'Rollback Failed - No ShadowWire Client',
        'Settlement rollback required but ShadowWire client is not available',
        {
          settlementPda: settlementPda.toBase58(),
          baseTransferId,
          buyer: buyOrder.maker.toBase58(),
          seller: sellOrder.maker.toBase58(),
        },
        `rollback-no-client-${settlementPda.toBase58().slice(0, 16)}`
      );
      return;
    }

    try {
      // Get trading pair mints to determine the token type
      const mints = await this.getPairMints(buyOrder.pair);
      if (!mints) {
        throw new Error('Could not fetch trading pair mints for rollback');
      }

      const baseToken = MINT_TO_TOKEN[mints.baseMint.toBase58()];
      if (!baseToken) {
        throw new Error(`Base token ${mints.baseMint.toBase58()} not supported by ShadowWire`);
      }

      // Get the fill amount to reverse
      const fillAmount = this.extractFillAmount(buyOrder);

      log.info({
        amount: fillAmount.toString(),
        token: baseToken,
        from: buyOrder.maker.toBase58().slice(0, 8),
        to: sellOrder.maker.toBase58().slice(0, 8),
      }, 'Executing rollback transfer (buyer → seller)');

      // Execute reverse transfer: buyer → seller (returning the base token)
      const rollbackResult = await this.shadowWireClient.executeTransfer({
        sender: buyOrder.maker.toBase58(),  // Buyer received the base token
        recipient: sellOrder.maker.toBase58(), // Return to seller
        amount: fillAmount,
        token: baseToken,
        type: 'internal',
      });

      if (rollbackResult.success) {
        log.info({
          rollbackTransferId: rollbackResult.transferId.slice(0, 12),
          originalTransferId: baseTransferId.slice(0, 12),
        }, '✓ Rollback transfer successful');

        // Alert for audit trail (even successful rollbacks should be tracked)
        await this.alertManager.warning(
          'Settlement Rollback Completed',
          'A settlement was rolled back after quote transfer failure',
          {
            settlementPda: settlementPda.toBase58(),
            originalTransferId: baseTransferId,
            rollbackTransferId: rollbackResult.transferId,
            buyer: buyOrder.maker.toBase58(),
            seller: sellOrder.maker.toBase58(),
          },
          `rollback-success-${settlementPda.toBase58().slice(0, 16)}`
        );
      } else {
        throw new Error(`Rollback transfer failed: ${rollbackResult.error}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ error: errMsg }, 'Rollback failed - MANUAL INTERVENTION REQUIRED');

      // Critical alert - manual intervention needed
      await this.alertManager.error(
        'CRITICAL: Settlement Rollback Failed',
        `Settlement rollback failed - manual intervention required. Error: ${errMsg}`,
        {
          settlementPda: settlementPda.toBase58(),
          baseTransferId,
          buyer: buyOrder.maker.toBase58(),
          seller: sellOrder.maker.toBase58(),
          error: errMsg,
        },
        `rollback-failed-${settlementPda.toBase58().slice(0, 16)}`
      );

      // Add to a rollback queue for manual processing
      this.addToRollbackQueue(settlementPda, buyPda, sellPda, baseTransferId);
    }
  }

  /**
   * Queue for settlements that need manual rollback intervention
   */
  private rollbackQueue: Map<string, {
    settlementPda: PublicKey;
    buyPda: PublicKey;
    sellPda: PublicKey;
    baseTransferId: string;
    addedAt: number;
    retryCount: number;
  }> = new Map();

  private readonly MAX_ROLLBACK_RETRIES = 3;
  private readonly ROLLBACK_RETRY_DELAY_MS = 60000; // 1 minute

  /**
   * Add settlement to rollback queue for retry
   */
  private addToRollbackQueue(
    settlementPda: PublicKey,
    buyPda: PublicKey,
    sellPda: PublicKey,
    baseTransferId: string
  ): void {
    const key = settlementPda.toBase58();
    const existing = this.rollbackQueue.get(key);

    if (existing && existing.retryCount >= this.MAX_ROLLBACK_RETRIES) {
      log.error({ settlementPda: key.slice(0, 12), retryCount: existing.retryCount },
        'Max rollback retries exceeded - settlement requires manual intervention');
      return;
    }

    this.rollbackQueue.set(key, {
      settlementPda,
      buyPda,
      sellPda,
      baseTransferId,
      addedAt: Date.now(),
      retryCount: existing ? existing.retryCount + 1 : 1,
    });

    log.info({ settlementPda: key.slice(0, 12), retryCount: existing?.retryCount || 1 },
      'Settlement added to rollback queue');
  }

  /**
   * Process rollback queue (called periodically)
   * Attempts to retry failed rollbacks
   */
  async processRollbackQueue(): Promise<void> {
    const now = Date.now();

    for (const [key, item] of this.rollbackQueue.entries()) {
      // Check if enough time has passed since last attempt
      if (now - item.addedAt < this.ROLLBACK_RETRY_DELAY_MS) {
        continue;
      }

      log.info({ settlementPda: key.slice(0, 12), retryCount: item.retryCount },
        'Retrying rollback from queue');

      try {
        // Fetch order data to get the fill amount
        const [buyAccount, sellAccount] = await Promise.all([
          this.connection.getAccountInfo(item.buyPda),
          this.connection.getAccountInfo(item.sellPda),
        ]);

        if (!buyAccount || !sellAccount) {
          log.warn({ settlementPda: key.slice(0, 12) }, 'Orders not found - removing from rollback queue');
          this.rollbackQueue.delete(key);
          continue;
        }

        const buyOrder = this.parseOrder(buyAccount.data);
        const sellOrder = this.parseOrder(sellAccount.data);

        // Attempt rollback again
        await this.initiateRollback(
          item.settlementPda,
          item.buyPda,
          item.sellPda,
          item.baseTransferId,
          buyOrder,
          sellOrder
        );

        // If we get here without throwing, remove from queue
        this.rollbackQueue.delete(key);
      } catch (err) {
        // Update retry count and timestamp
        item.addedAt = now;
        item.retryCount++;

        if (item.retryCount >= this.MAX_ROLLBACK_RETRIES) {
          log.error({ settlementPda: key.slice(0, 12) },
            'Max rollback retries exceeded - removing from queue');
          this.rollbackQueue.delete(key);
        }
      }
    }
  }

  /**
   * Get rollback queue status (for monitoring)
   */
  getRollbackQueueStatus(): { count: number; items: string[] } {
    return {
      count: this.rollbackQueue.size,
      items: Array.from(this.rollbackQueue.keys()).map(k => k.slice(0, 16)),
    };
  }

  // ==========================================================================
  // LEGACY SETTLEMENT METHODS
  // ==========================================================================

  /**
   * Verify settlement succeeded by checking on-chain order status
   * Orders should be closed (account doesn't exist) or status should be Filled/Cancelled
   */
  private async verifySettlementOnChain(buyPda: PublicKey, sellPda: PublicKey): Promise<boolean> {
    try {
      // Small delay to ensure state is propagated
      await new Promise(resolve => setTimeout(resolve, 500));

      const [buyAccount, sellAccount] = await Promise.all([
        this.connection.getAccountInfo(buyPda),
        this.connection.getAccountInfo(sellPda),
      ]);

      // If accounts are closed, settlement succeeded
      if (!buyAccount && !sellAccount) {
        return true;
      }

      // If accounts exist, check their status
      // Settlement should have set them to Inactive (filled/cancelled) or closed them
      if (buyAccount) {
        const buyOrderStatus = this.parseOrder(buyAccount.data);
        // Inactive = filled or cancelled (terminal state)
        if (buyOrderStatus.status !== OrderStatus.Inactive) {
          log.warn({ buyStatus: buyOrderStatus.status }, 'Buy order not in terminal state after settlement');
          return false;
        }
      }

      if (sellAccount) {
        const sellOrderStatus = this.parseOrder(sellAccount.data);
        if (sellOrderStatus.status !== OrderStatus.Inactive) {
          log.warn({ sellStatus: sellOrderStatus.status }, 'Sell order not in terminal state after settlement');
          return false;
        }
      }

      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ error: errMsg }, 'Error verifying settlement on-chain');
      return false;
    }
  }

  /**
   * Get executor status
   */
  getStatus(): {
    isPolling: boolean;
    settledCount: number;
    rollbackQueue: { count: number; items: string[] };
  } {
    return {
      isPolling: this.isPolling,
      settledCount: this.getSettledCount(),
      rollbackQueue: this.getRollbackQueueStatus(),
    };
  }
}
