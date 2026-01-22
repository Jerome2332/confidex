/**
 * Margin Operation Processor (V6 Async MPC)
 *
 * Monitors for pending margin add/remove operations and triggers MPC processing.
 *
 * When a user calls add_margin or remove_margin:
 * - Position stores pending_margin_amount and pending_margin_is_add
 * - Position stores pending_mpc_request = [request_id]
 * - MarginOperationInitiated event is emitted
 *
 * This service:
 * 1. Subscribes to MarginOperationInitiated events
 * 2. Triggers MXE add_encrypted or sub_encrypted computation
 * 3. MXE callback updates position collateral and thresholds
 *
 * Flow:
 * add_margin/remove_margin → MarginOperationInitiated event
 * → Backend detects pending operation
 * → Backend calls MXE add_encrypted/sub_encrypted
 * → Arcium MPC computes new collateral + thresholds
 * → MXE callback → margin_operation_callback
 * → Position updated, tokens transferred
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
import { CrankConfig } from './config.js';
import { logger } from '../lib/logger.js';
import bs58 from 'bs58';

const log = logger.margin || console;

// Position status enum
enum PositionStatus {
  Open = 0,
  Closed = 1,
  Liquidated = 2,
  AutoDeleveraged = 3,
  PendingLiquidationCheck = 4,
}

// Position side enum
enum PositionSide {
  Long = 0,
  Short = 1,
}

interface PendingMarginOperation {
  positionPda: PublicKey;
  market: PublicKey;
  amount: bigint;
  isAdd: boolean;
  requestId: Uint8Array;
  encryptedCollateral: Uint8Array;
  side: PositionSide;
}

// Instruction discriminators - sha256("global:<name>")[0..8]
const ADD_ENCRYPTED_DISCRIMINATOR = new Uint8Array([
  0x2d, 0x05, 0xa2, 0xc7, 0x85, 0xc3, 0x7f, 0x9a
]);

const SUB_ENCRYPTED_DISCRIMINATOR = new Uint8Array([
  0x84, 0x77, 0x5e, 0xef, 0xe8, 0xdc, 0x67, 0x0d
]);

export class MarginProcessor {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private dexProgramId: PublicKey;
  private mxeProgramId: PublicKey;
  private isPolling: boolean = false;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  // Event subscription
  private subscriptionId: number | null = null;

  // Track operations we're currently processing
  private processingOperations: Set<string> = new Set();

  // Track failed operations
  private failedOperations: Map<string, number> = new Map();
  private maxRetries: number = 3;

  constructor(
    connection: Connection,
    crankKeypair: Keypair,
    config: CrankConfig
  ) {
    this.connection = connection;
    this.crankKeypair = crankKeypair;
    this.config = config;
    this.dexProgramId = new PublicKey(config.programs.confidexDex);
    this.mxeProgramId = new PublicKey(config.programs.arciumMxe);
  }

  /**
   * Start processing margin operations
   */
  async start(): Promise<void> {
    if (this.isPolling) {
      log.warn?.('Margin processor already running');
      return;
    }

    log.info?.('Starting margin processor service');
    this.isPolling = true;

    // Subscribe to DEX program logs for MarginOperationInitiated events
    await this.subscribeToEvents();

    // Also poll for any pending operations we might have missed
    await this.pollPendingOperations();

    this.pollIntervalId = setInterval(
      () => this.pollPendingOperations(),
      this.config.pollingIntervalMs * 2 // Less frequent than event subscription
    );
  }

  /**
   * Stop processing
   */
  stop(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }

    if (this.subscriptionId !== null) {
      this.connection.removeOnLogsListener(this.subscriptionId).catch(() => {});
      this.subscriptionId = null;
    }

    this.isPolling = false;
    log.info?.('Margin processor service stopped');
  }

  /**
   * Subscribe to MarginOperationInitiated events
   */
  private async subscribeToEvents(): Promise<void> {
    this.subscriptionId = this.connection.onLogs(
      this.dexProgramId,
      (logs: Logs, ctx: Context) => {
        this.handleLogs(logs, ctx);
      },
      'confirmed'
    );

    log.info?.('Subscribed to DEX program logs for margin events');
  }

  /**
   * Handle program logs to detect MarginOperationInitiated events
   */
  private handleLogs(logs: Logs, ctx: Context): void {
    // Look for MarginOperationInitiated event in logs
    for (const logMessage of logs.logs) {
      if (logMessage.includes('MarginOperationInitiated')) {
        log.info?.('Detected MarginOperationInitiated event');
        // Parse the event data and process
        // The actual parsing depends on how Anchor emits events
        this.pollPendingOperations();
        break;
      }
    }
  }

  /**
   * Poll for positions with pending margin operations
   */
  private async pollPendingOperations(): Promise<void> {
    try {
      const pendingOps = await this.fetchPendingMarginOperations();

      if (pendingOps.length === 0) {
        return;
      }

      log.info?.(`Found ${pendingOps.length} pending margin operations`);

      for (const op of pendingOps) {
        const opKey = Buffer.from(op.requestId).toString('hex');

        // Skip if already processing
        if (this.processingOperations.has(opKey)) {
          continue;
        }

        // Skip if exceeded retries
        const retryCount = this.failedOperations.get(opKey) || 0;
        if (retryCount >= this.maxRetries) {
          log.warn?.(`Margin operation ${opKey.slice(0, 16)}... exceeded max retries`);
          continue;
        }

        this.processingOperations.add(opKey);

        try {
          await this.processMarginOperation(op);
          this.failedOperations.delete(opKey);
        } catch (error) {
          log.error?.({ error }, 'Failed to process margin operation');
          this.failedOperations.set(opKey, retryCount + 1);
        } finally {
          this.processingOperations.delete(opKey);
        }
      }
    } catch (error) {
      log.error?.({ error }, 'Error polling pending margin operations');
    }
  }

  /**
   * Fetch positions with pending margin operations
   * (pending_margin_amount > 0)
   */
  private async fetchPendingMarginOperations(): Promise<PendingMarginOperation[]> {
    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [
        { dataSize: 618 }, // V6 position size
        // We can't filter on pending_margin_amount > 0 directly,
        // so we fetch all positions and filter in code
      ],
    });

    const pendingOps: PendingMarginOperation[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const data = account.data;
        // Skip discriminator
        let offset = 8;

        // Skip to V6 fields
        // trader (32) + market (32) + positionId (16) + timestamps (16) + side (1) + leverage (1)
        // + encrypted fields (64*6) + commitment (32) + timestamp (8) + threshold_verified (1)
        // + funding (16) + status (1) + eligibility (1) + partial_close (1) + adl_priority (8)
        // + margin_add_hour (8) + margin_add_count (1) + bump (1) + position_seed (8)
        offset = 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 * 6 + 32 + 8 + 1 + 16 + 1 + 1 + 1 + 8 + 8 + 1 + 1 + 8;

        const pendingMpcRequest = new Uint8Array(data.subarray(offset, offset + 32));
        offset += 32;

        const pendingMarginAmount = data.readBigUInt64LE(offset);
        offset += 8;

        const pendingMarginIsAdd = data.readUInt8(offset) === 1;
        offset += 1;

        // Check if there's a pending margin operation
        if (pendingMarginAmount > 0n) {
          // Parse additional fields we need
          const market = new PublicKey(data.subarray(8 + 32, 8 + 32 + 32));
          const side = data.readUInt8(8 + 32 + 32 + 16 + 8 + 8) as PositionSide;
          const encryptedCollateral = new Uint8Array(
            data.subarray(8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 + 64, 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 + 64 + 64)
          );

          pendingOps.push({
            positionPda: pubkey,
            market,
            amount: pendingMarginAmount,
            isAdd: pendingMarginIsAdd,
            requestId: pendingMpcRequest,
            encryptedCollateral,
            side,
          });
        }
      } catch (error) {
        log.debug?.({ error }, `Failed to parse position ${pubkey.toBase58()}`);
      }
    }

    return pendingOps;
  }

  /**
   * Process a margin operation by triggering MXE computation
   */
  private async processMarginOperation(op: PendingMarginOperation): Promise<void> {
    const opType = op.isAdd ? 'add' : 'remove';
    log.info?.(
      `Processing margin ${opType} for position ${op.positionPda.toBase58()}, amount: ${op.amount}`
    );

    const instruction = await this.buildMarginMpcInstruction(op);
    const transaction = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    log.info?.(
      `Margin ${opType} MPC triggered for ${op.positionPda.toBase58()}, tx: ${signature}`
    );
  }

  /**
   * Build MXE add_encrypted or sub_encrypted instruction
   */
  private async buildMarginMpcInstruction(
    op: PendingMarginOperation
  ): Promise<TransactionInstruction> {
    const [mxeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_config')],
      this.mxeProgramId
    );

    const [mxeAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_authority')],
      this.mxeProgramId
    );

    const discriminator = op.isAdd
      ? ADD_ENCRYPTED_DISCRIMINATOR
      : SUB_ENCRYPTED_DISCRIMINATOR;

    // Build instruction data:
    // - discriminator (8 bytes)
    // - request_id (32 bytes)
    // - encrypted_collateral (64 bytes)
    // - amount (8 bytes)
    const data = Buffer.alloc(8 + 32 + 64 + 8);
    let offset = 0;

    data.set(discriminator, offset);
    offset += 8;

    data.set(op.requestId, offset);
    offset += 32;

    data.set(op.encryptedCollateral, offset);
    offset += 64;

    data.writeBigUInt64LE(op.amount, offset);

    const keys = [
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: mxeConfigPda, isSigner: false, isWritable: false },
      { pubkey: mxeAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: op.positionPda, isSigner: false, isWritable: true },
      { pubkey: op.market, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: this.mxeProgramId,
      data,
    });
  }

  /**
   * Get service status
   */
  getStatus(): {
    isPolling: boolean;
    processingCount: number;
    failedCount: number;
  } {
    return {
      isPolling: this.isPolling,
      processingCount: this.processingOperations.size,
      failedCount: this.failedOperations.size,
    };
  }
}
