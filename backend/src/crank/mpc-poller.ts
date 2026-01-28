/**
 * MPC Callback Event Listener
 *
 * Listens for MXE callback events emitted when Arcium MPC cluster completes computations.
 *
 * ARCHITECTURE:
 * 1. Frontend places order → DEX stores encrypted order
 * 2. Backend crank calls match_orders → DEX CPIs to MXE → MXE queues computation via Arcium
 * 3. Arcium MPC cluster executes computation off-chain
 * 4. Arcium MPC nodes call our callback instruction (compare_prices_callback, etc.)
 * 5. MXE callback emits events (PriceCompareResult, FillCalculationResult, etc.)
 * 6. This listener receives events and optionally triggers follow-up actions
 *
 * IMPORTANT: The backend does NOT invoke callbacks. Callbacks are invoked by Arcium MPC nodes.
 * The backend only listens for events and triggers follow-up MPC operations if needed.
 *
 * @see https://docs.arcium.com/building-with-arcium/computation-lifecycle
 * @see https://docs.arcium.com/building-with-arcium/js-client-library/tracking-callbacks
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Logs,
  Context,
} from '@solana/web3.js';
import { getMXEAccAddress, awaitComputationFinalization } from '@arcium-hq/client';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { CrankConfig } from './config.js';
import { withRetry } from '../lib/retry.js';
import { classifyError, isRetryable } from '../lib/errors.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../lib/timeout.js';
import { logger } from '../lib/logger.js';
import { getAlertManager, AlertManager } from '../lib/alerts.js';
import { MpcProcessedRepository } from '../db/repositories/mpc-processed.js';
import { ArciumClient, createArciumClient } from './arcium-client.js';

const log = logger.mpc;

// =============================================================================
// EVENT DISCRIMINATORS
// =============================================================================

// Anchor event discriminator = first 8 bytes of sha256("event:<EventName>")
const MXE_EVENT_DISCRIMINATORS = {
  // PriceCompareResult: sha256("event:PriceCompareResult")[0..8]
  PRICE_COMPARE_RESULT: Buffer.from([0xe7, 0x3c, 0x8f, 0x1a, 0x5b, 0x2d, 0x9e, 0x4f]),
  // FillCalculationResult: sha256("event:FillCalculationResult")[0..8]
  FILL_CALCULATION_RESULT: Buffer.from([0xa2, 0x7b, 0x4c, 0x8d, 0x3e, 0x1f, 0x6a, 0x5b]),
  // BatchPriceCompareResult: sha256("event:BatchPriceCompareResult")[0..8]
  BATCH_PRICE_COMPARE_RESULT: Buffer.from([0xc3, 0x5d, 0xa1, 0x2b, 0x7e, 0x4f, 0x8c, 0x6d]),
  // BatchFillCalculationResult: sha256("event:BatchFillCalculationResult")[0..8]
  BATCH_FILL_CALCULATION_RESULT: Buffer.from([0xd4, 0x6e, 0xb2, 0x3c, 0x8f, 0x5a, 0x9d, 0x7e]),
};

// update_orders_from_result discriminator: sha256("global:update_orders_from_result")[0..8]
const UPDATE_ORDERS_FROM_RESULT_DISCRIMINATOR = new Uint8Array([0x8b, 0x4a, 0xea, 0x91, 0x66, 0x0e, 0xb3, 0x9e]);

// =============================================================================
// EVENT TYPES
// =============================================================================

/**
 * PriceCompareResult event from MXE compare_prices_callback
 * Emitted when Arcium MPC nodes complete price comparison
 */
interface PriceCompareResultEvent {
  computationOffset: PublicKey;
  pricesMatch: boolean;
  nonce: Uint8Array; // 16 bytes
}

/**
 * FillCalculationResult event from MXE calculate_fill_callback
 * Emitted when Arcium MPC nodes complete fill calculation
 */
interface FillCalculationResultEvent {
  computationOffset: PublicKey;
  fillAmountCiphertext: Uint8Array; // 32 bytes
  buyFullyFilled: boolean;
  sellFullyFilled: boolean;
  nonce: Uint8Array; // 16 bytes
}

/**
 * BatchPriceCompareResult event from MXE batch_compare_prices_callback
 */
interface BatchPriceCompareResultEvent {
  computationOffset: PublicKey;
  matches: boolean[]; // 5 booleans
}

/**
 * BatchFillCalculationResult event from MXE batch_calculate_fill_callback
 */
interface BatchFillCalculationResultEvent {
  computationOffset: PublicKey;
  fills: Uint8Array[]; // 5 x 32-byte ciphertexts
  buyFilled: boolean[];
  sellFilled: boolean[];
  nonce: Uint8Array; // 16 bytes
}

// =============================================================================
// PENDING COMPUTATION TRACKING
// =============================================================================

/**
 * Tracks a computation we've queued, waiting for callback
 */
interface PendingComputation {
  computationOffset: BN;
  queuedAt: number;
  type: 'compare_prices' | 'calculate_fill' | 'batch_compare' | 'batch_fill';
  buyOrderPda?: PublicKey;
  sellOrderPda?: PublicKey;
  pairPdas?: Array<{ buy: PublicKey; sell: PublicKey }>;
}

// =============================================================================
// MPC CALLBACK LISTENER
// =============================================================================

/**
 * MPC Callback Event Listener
 *
 * Subscribes to MXE program logs to receive computation result events.
 * Events are emitted when Arcium MPC nodes invoke our callback instructions.
 *
 * This class does NOT invoke callbacks - that's done by Arcium infrastructure.
 */
export class MpcPoller {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private mxeProgramId: PublicKey;
  private dexProgramId: PublicKey;
  private exchangePda: PublicKey;
  private provider: AnchorProvider;

  // Event subscription state
  private isSubscribed: boolean = false;
  private subscriptionId: number | null = null;

  // Track events we've already processed (by signature)
  private processedEvents: Set<string> = new Set();

  // Track pending computations awaiting callback
  private pendingComputations: Map<string, PendingComputation> = new Map();

  // Alert manager for critical failure notifications
  private alertManager: AlertManager;

  // Database repository for persistence (optional)
  private mpcProcessedRepo: MpcProcessedRepository | null = null;

  // Arcium MPC client for queuing follow-up computations
  private arciumClient: ArciumClient;

  // Computation timeout in milliseconds
  private readonly computationTimeoutMs = 120_000; // 2 minutes

  constructor(
    connection: Connection,
    crankKeypair: Keypair,
    config: CrankConfig,
    mpcProcessedRepo?: MpcProcessedRepository,
    arciumClient?: ArciumClient
  ) {
    this.connection = connection;
    this.crankKeypair = crankKeypair;
    this.config = config;
    this.mxeProgramId = new PublicKey(config.programs.arciumMxe);
    this.dexProgramId = new PublicKey(config.programs.confidexDex);
    this.exchangePda = this.deriveExchangePda();
    this.alertManager = getAlertManager();
    this.mpcProcessedRepo = mpcProcessedRepo ?? null;

    // Create Anchor provider for Arcium SDK
    const wallet = new Wallet(crankKeypair);
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });

    // Create or use provided ArciumClient for MPC operations
    this.arciumClient = arciumClient ?? createArciumClient(connection, crankKeypair);

    // Load persisted state from database if available
    this.loadPersistedState();

    log.info({
      mxeProgram: this.mxeProgramId.toBase58(),
      dexProgram: this.dexProgramId.toBase58(),
    }, 'MPC Callback Listener initialized');
  }

  /**
   * Derive Exchange State PDA
   */
  private deriveExchangePda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('exchange')],
      this.dexProgramId
    );
    return pda;
  }

  /**
   * Load persisted processed event state from database
   */
  private loadPersistedState(): void {
    if (!this.mpcProcessedRepo) {
      log.debug('No MPC persistence repository - using in-memory only');
      return;
    }

    try {
      const eventKeys = this.mpcProcessedRepo.getAllProcessedKeys('event');
      for (const key of eventKeys) {
        this.processedEvents.add(key);
      }

      log.info({ eventsCount: eventKeys.length }, 'Loaded persisted MPC event state');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ error: errMsg }, 'Failed to load persisted MPC state');
    }
  }

  /**
   * Mark an event as processed (persists to DB if available)
   */
  private markEventProcessed(eventKey: string, txSignature?: string): void {
    this.processedEvents.add(eventKey);

    if (this.mpcProcessedRepo) {
      try {
        this.mpcProcessedRepo.markProcessed({
          request_key: eventKey,
          request_type: 'event',
          status: 'processed',
          tx_signature: txSignature,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn({ error: errMsg, eventKey: eventKey.slice(0, 16) }, 'Failed to persist processed event');
      }
    }
  }

  // ============================================================================
  // PUBLIC API: Start/Stop Event Subscription
  // ============================================================================

  /**
   * Start listening for MXE callback events
   *
   * This subscribes to MXE program logs to receive events emitted when
   * Arcium MPC nodes complete computations and invoke our callback instructions.
   */
  start(): void {
    this.startEventSubscription();
  }

  /**
   * Start event subscription mode
   */
  startEventSubscription(): void {
    if (this.isSubscribed) {
      log.debug('Already subscribed to MXE events');
      return;
    }

    this.isSubscribed = true;
    log.info({ mxeProgram: this.mxeProgramId.toBase58() }, 'Starting MXE event subscription');

    // Subscribe to MXE program logs
    this.subscriptionId = this.connection.onLogs(
      this.mxeProgramId,
      (logs: Logs, ctx: Context) => this.handleMxeLogs(logs, ctx),
      'confirmed'
    );

    log.info({ subscriptionId: this.subscriptionId }, 'Subscribed to MXE program logs');
  }

  /**
   * Stop event subscription
   */
  async stop(): Promise<void> {
    await this.stopEventSubscription();
  }

  /**
   * Stop event subscription mode
   */
  async stopEventSubscription(): Promise<void> {
    if (!this.isSubscribed || this.subscriptionId === null) {
      return;
    }

    try {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      log.info({ subscriptionId: this.subscriptionId }, 'Unsubscribed from MXE logs');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn({ error: errMsg }, 'Error unsubscribing from MXE logs');
    }

    this.isSubscribed = false;
    this.subscriptionId = null;
  }

  // ============================================================================
  // PENDING COMPUTATION TRACKING
  // ============================================================================

  /**
   * Register a pending computation (called by MatchExecutor after queuing)
   */
  registerPendingComputation(
    computationOffset: BN,
    type: PendingComputation['type'],
    buyOrderPda?: PublicKey,
    sellOrderPda?: PublicKey
  ): void {
    const key = computationOffset.toString();
    this.pendingComputations.set(key, {
      computationOffset,
      queuedAt: Date.now(),
      type,
      buyOrderPda,
      sellOrderPda,
    });

    log.debug({
      offset: key,
      type,
      buyOrder: buyOrderPda?.toBase58().slice(0, 8),
      sellOrder: sellOrderPda?.toBase58().slice(0, 8),
    }, 'Registered pending computation');
  }

  /**
   * Await computation finalization using Arcium SDK
   *
   * This waits for the Arcium MPC cluster to complete the computation
   * and invoke our callback instruction.
   *
   * @param computationOffset - The computation offset we're waiting for
   * @returns Promise that resolves when callback transaction is confirmed
   */
  async awaitComputation(computationOffset: BN): Promise<string> {
    log.info({ offset: computationOffset.toString() }, 'Awaiting computation finalization...');

    try {
      const finalizeSig = await withTimeout(
        awaitComputationFinalization(
          this.provider,
          computationOffset,
          this.mxeProgramId,
          'confirmed'
        ),
        {
          timeoutMs: this.computationTimeoutMs,
          operation: 'awaitComputationFinalization',
        }
      );

      log.info({
        offset: computationOffset.toString(),
        signature: finalizeSig?.slice(0, 12),
      }, 'Computation finalized');

      // Remove from pending
      this.pendingComputations.delete(computationOffset.toString());

      return finalizeSig;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error({
        offset: computationOffset.toString(),
        error: errMsg,
      }, 'Computation finalization failed');

      // Remove from pending on failure
      this.pendingComputations.delete(computationOffset.toString());

      throw error;
    }
  }

  /**
   * Clean up stale pending computations
   */
  cleanupStalePendingComputations(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, comp] of this.pendingComputations.entries()) {
      if (now - comp.queuedAt > this.computationTimeoutMs) {
        this.pendingComputations.delete(key);
        cleaned++;
        log.warn({
          offset: key,
          type: comp.type,
          ageMs: now - comp.queuedAt,
        }, 'Cleaned up stale pending computation');
      }
    }

    return cleaned;
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Handle MXE log messages
   *
   * Parses logs to detect callback events emitted by Arcium MPC nodes
   */
  private async handleMxeLogs(logs: Logs, _ctx: Context): Promise<void> {
    const signature = logs.signature;
    const eventKey = signature;

    // Skip if we've already processed this transaction
    if (this.processedEvents.has(eventKey)) {
      return;
    }

    // Log all MXE transactions for debugging
    log.debug({
      signature: signature.slice(0, 12),
      logCount: logs.logs.length,
    }, 'Received MXE transaction');

    // Look for event data in logs
    for (const logLine of logs.logs) {
      if (logLine.startsWith('Program data: ')) {
        try {
          const base64Data = logLine.substring('Program data: '.length);
          const eventData = Buffer.from(base64Data, 'base64');
          const discriminator = eventData.slice(0, 8);

          if (discriminator.equals(MXE_EVENT_DISCRIMINATORS.PRICE_COMPARE_RESULT)) {
            const event = this.parsePriceCompareResult(eventData);
            await this.handlePriceCompareResult(event, signature);
            this.markEventProcessed(eventKey, signature);
          } else if (discriminator.equals(MXE_EVENT_DISCRIMINATORS.FILL_CALCULATION_RESULT)) {
            const event = this.parseFillCalculationResult(eventData);
            await this.handleFillCalculationResult(event, signature);
            this.markEventProcessed(eventKey, signature);
          } else if (discriminator.equals(MXE_EVENT_DISCRIMINATORS.BATCH_PRICE_COMPARE_RESULT)) {
            const event = this.parseBatchPriceCompareResult(eventData);
            await this.handleBatchPriceCompareResult(event, signature);
            this.markEventProcessed(eventKey, signature);
          } else if (discriminator.equals(MXE_EVENT_DISCRIMINATORS.BATCH_FILL_CALCULATION_RESULT)) {
            const event = this.parseBatchFillCalculationResult(eventData);
            await this.handleBatchFillCalculationResult(event, signature);
            this.markEventProcessed(eventKey, signature);
          }
        } catch (err) {
          // Not a valid event, skip
          continue;
        }
      }
    }

    // Cleanup old processed events (keep last 1000)
    if (this.processedEvents.size > 1000) {
      const toDelete = Array.from(this.processedEvents).slice(0, 500);
      toDelete.forEach(k => this.processedEvents.delete(k));
    }
  }

  // ============================================================================
  // EVENT PARSERS
  // ============================================================================

  /**
   * Parse PriceCompareResult event data
   * Layout: discriminator(8) + computation_offset(32) + prices_match(1) + nonce(16)
   */
  private parsePriceCompareResult(data: Buffer): PriceCompareResultEvent {
    let offset = 8; // Skip discriminator

    const computationOffset = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const pricesMatch = data[offset] === 1;
    offset += 1;

    const nonce = new Uint8Array(data.slice(offset, offset + 16));

    return { computationOffset, pricesMatch, nonce };
  }

  /**
   * Parse FillCalculationResult event data
   * Layout: discriminator(8) + computation_offset(32) + fill_amount(32) + buy_filled(1) + sell_filled(1) + nonce(16)
   */
  private parseFillCalculationResult(data: Buffer): FillCalculationResultEvent {
    let offset = 8; // Skip discriminator

    const computationOffset = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const fillAmountCiphertext = new Uint8Array(data.slice(offset, offset + 32));
    offset += 32;

    const buyFullyFilled = data[offset] === 1;
    offset += 1;

    const sellFullyFilled = data[offset] === 1;
    offset += 1;

    const nonce = new Uint8Array(data.slice(offset, offset + 16));

    return { computationOffset, fillAmountCiphertext, buyFullyFilled, sellFullyFilled, nonce };
  }

  /**
   * Parse BatchPriceCompareResult event data
   */
  private parseBatchPriceCompareResult(data: Buffer): BatchPriceCompareResultEvent {
    let offset = 8; // Skip discriminator

    const computationOffset = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const matches: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      matches.push(data[offset] === 1);
      offset += 1;
    }

    return { computationOffset, matches };
  }

  /**
   * Parse BatchFillCalculationResult event data
   */
  private parseBatchFillCalculationResult(data: Buffer): BatchFillCalculationResultEvent {
    let offset = 8; // Skip discriminator

    const computationOffset = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const fills: Uint8Array[] = [];
    for (let i = 0; i < 5; i++) {
      fills.push(new Uint8Array(data.slice(offset, offset + 32)));
      offset += 32;
    }

    const buyFilled: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      buyFilled.push(data[offset] === 1);
      offset += 1;
    }

    const sellFilled: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      sellFilled.push(data[offset] === 1);
      offset += 1;
    }

    const nonce = new Uint8Array(data.slice(offset, offset + 16));

    return { computationOffset, fills, buyFilled, sellFilled, nonce };
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Handle PriceCompareResult event
   *
   * This event is emitted when Arcium MPC nodes call compare_prices_callback.
   * If prices match, we should trigger a fill calculation.
   */
  private async handlePriceCompareResult(event: PriceCompareResultEvent, signature: string): Promise<void> {
    log.info({
      sig: signature.slice(0, 12),
      pricesMatch: event.pricesMatch,
      computationOffset: event.computationOffset.toBase58().slice(0, 12),
    }, 'Received PriceCompareResult callback event');

    if (event.pricesMatch) {
      log.info('Prices match - fill calculation will be triggered by on-chain CPI');
      // Note: In the production flow, the MXE callback should CPI to trigger fill calculation
      // or emit enough data for us to queue it. For now, we just log.
    } else {
      log.info('Prices do not match - no fill needed');
    }
  }

  /**
   * Handle FillCalculationResult event
   *
   * This event is emitted when Arcium MPC nodes call calculate_fill_callback.
   * Contains the encrypted fill amount and filled flags.
   */
  private async handleFillCalculationResult(event: FillCalculationResultEvent, signature: string): Promise<void> {
    log.info({
      sig: signature.slice(0, 12),
      buyFullyFilled: event.buyFullyFilled,
      sellFullyFilled: event.sellFullyFilled,
      computationOffset: event.computationOffset.toBase58().slice(0, 12),
      fillAmountPrefix: Buffer.from(event.fillAmountCiphertext.slice(0, 8)).toString('hex'),
    }, 'Received FillCalculationResult callback event');

    // The on-chain callback should have already updated order state via CPI
    // We just log for monitoring purposes
  }

  /**
   * Handle BatchPriceCompareResult event
   */
  private async handleBatchPriceCompareResult(event: BatchPriceCompareResultEvent, signature: string): Promise<void> {
    const matchCount = event.matches.filter(m => m).length;

    log.info({
      sig: signature.slice(0, 12),
      matchCount,
      matches: event.matches,
      computationOffset: event.computationOffset.toBase58().slice(0, 12),
    }, 'Received BatchPriceCompareResult callback event');
  }

  /**
   * Handle BatchFillCalculationResult event
   */
  private async handleBatchFillCalculationResult(event: BatchFillCalculationResultEvent, signature: string): Promise<void> {
    const buyFilledCount = event.buyFilled.filter(f => f).length;
    const sellFilledCount = event.sellFilled.filter(f => f).length;

    log.info({
      sig: signature.slice(0, 12),
      buyFilledCount,
      sellFilledCount,
      computationOffset: event.computationOffset.toBase58().slice(0, 12),
    }, 'Received BatchFillCalculationResult callback event');
  }

  // ============================================================================
  // STATUS & METRICS
  // ============================================================================

  /**
   * Get subscription status
   */
  getSubscriptionStatus(): {
    isSubscribed: boolean;
    processedEventsCount: number;
    pendingComputationsCount: number;
  } {
    return {
      isSubscribed: this.isSubscribed,
      processedEventsCount: this.processedEvents.size,
      pendingComputationsCount: this.pendingComputations.size,
    };
  }

  /**
   * Get status (alias for getSubscriptionStatus)
   */
  getStatus(): { isPolling: boolean; processedCount: number; failedCount: number } {
    const status = this.getSubscriptionStatus();
    return {
      isPolling: status.isSubscribed,
      processedCount: status.processedEventsCount,
      failedCount: 0, // No longer tracking failed requests
    };
  }

  /**
   * Get list of pending computations
   */
  getPendingComputations(): PendingComputation[] {
    return Array.from(this.pendingComputations.values());
  }

  // ============================================================================
  // DEPRECATED METHODS (kept for backwards compatibility)
  // ============================================================================

  /**
   * @deprecated Legacy polling is no longer supported. Use event subscription.
   */
  async skipAllPending(): Promise<number> {
    log.warn('skipAllPending() is deprecated - legacy polling mode removed');
    return 0;
  }
}
