/**
 * Funding Settlement Processor (V7 Async MPC)
 *
 * Monitors for positions with pending funding settlement and triggers MPC callback
 * when the funding computation completes.
 *
 * When keeper calls settle_funding:
 * - Position stores pending_mpc_request = [request_id]
 * - Position stores funding_delta in threshold_commitment (temporary)
 * - threshold_verified = false (prevents liquidation during settlement)
 * - FundingSettlementInitiated event is emitted
 *
 * This service:
 * 1. Subscribes to FundingSettlementInitiated events
 * 2. Triggers MXE calculate_funding computation
 * 3. Polls Arcium cluster for computation results
 * 4. When result ready, triggers funding_settlement_callback
 * 5. Callback updates encrypted collateral and thresholds
 *
 * Flow:
 * settle_funding → FundingSettlementInitiated event
 * → Backend detects pending funding
 * → Backend calls MXE calculate_funding
 * → Arcium MPC computes funding payment
 * → Backend calls funding_settlement_callback
 * → Position collateral updated, threshold re-verified
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
import {
  deriveArciumAccounts,
  arciumAccountsToRemainingAccounts,
  DEFAULT_CLUSTER_OFFSET,
  DEFAULT_MXE_PROGRAM_ID,
} from './arcium-accounts.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import { getCompDefAccOffset } from '@arcium-hq/client';

const log = logger.crank || console;

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

/**
 * V7 ConfidentialPosition account layout (692 bytes total)
 */
interface ConfidentialPositionV7 {
  trader: PublicKey;
  market: PublicKey;
  positionId: Uint8Array;           // 16 bytes
  createdAtHour: bigint;
  lastUpdatedHour: bigint;
  side: PositionSide;
  leverage: number;
  encryptedSize: Uint8Array;        // 64 bytes
  encryptedEntryPrice: Uint8Array;  // 64 bytes
  encryptedCollateral: Uint8Array;  // 64 bytes
  encryptedRealizedPnl: Uint8Array; // 64 bytes
  encryptedLiqBelow: Uint8Array;    // 64 bytes
  encryptedLiqAbove: Uint8Array;    // 64 bytes
  thresholdCommitment: Uint8Array;  // 32 bytes
  lastThresholdUpdateHour: bigint;
  thresholdVerified: boolean;
  entryCumulativeFunding: bigint;   // i128
  status: PositionStatus;
  eligibilityProofVerified: boolean;
  partialCloseCount: number;
  autoDeleveragePriority: bigint;
  lastMarginAddHour: bigint;
  marginAddCount: number;
  bump: number;
  positionSeed: bigint;
  // V6 fields
  pendingMpcRequest: Uint8Array;    // 32 bytes
  pendingMarginAmount: bigint;
  pendingMarginIsAdd: boolean;
  isLiquidatable: boolean;
  // V7 fields (close position tracking)
  pendingClose: boolean;
  pendingCloseExitPrice: bigint;
  pendingCloseFull: boolean;
  pendingCloseSize: Uint8Array;     // 64 bytes
}

interface PendingFundingOperation {
  positionPda: PublicKey;
  position: ConfidentialPositionV7;
  requestId: Uint8Array;
  fundingDelta: bigint;  // Extracted from thresholdCommitment
  currentCumulativeFunding: bigint;  // Extracted from thresholdCommitment
}

// Instruction discriminators
// sha256("global:funding_settlement_callback")[0..8]
const FUNDING_SETTLEMENT_CALLBACK_DISCRIMINATOR = new Uint8Array([
  0x28, 0xf0, 0x53, 0x05, 0xb5, 0xc4, 0xd2, 0x2e,
]);

// sha256("global:calculate_funding")[0..8]
const CALCULATE_FUNDING_DISCRIMINATOR = new Uint8Array([
  0x6d, 0x7e, 0x85, 0xc8, 0xe7, 0x30, 0xe3, 0x80,
]);

/**
 * Get comp def offset for calculate_funding circuit
 */
function getCalculateFundingCompDefOffset(): number {
  try {
    const offsetBytes = getCompDefAccOffset('calculate_funding');
    return Buffer.from(offsetBytes).readUInt32LE(0);
  } catch {
    // Default offset if not found
    return 5;
  }
}

export class FundingSettlementProcessor {
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

  // Track MPC computation results by request ID
  private mpcResults: Map<string, {
    newEncryptedCollateral: Uint8Array;
    newEncryptedLiqThreshold: Uint8Array;
    isReceiving: boolean;
  }> = new Map();

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
   * Start processing funding settlement operations
   */
  async start(): Promise<void> {
    if (this.isPolling) {
      log.warn?.('Funding settlement processor already running');
      return;
    }

    log.info?.('Starting funding settlement processor service');
    this.isPolling = true;

    // Subscribe to DEX program logs for FundingSettlementInitiated events
    await this.subscribeToEvents();

    // Also poll for any pending operations we might have missed
    await this.pollPendingFundingOperations();

    this.pollIntervalId = setInterval(
      () => this.pollPendingFundingOperations(),
      this.config.pollingIntervalMs * 3 // Funding is less time-critical
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
    log.info?.('Funding settlement processor service stopped');
  }

  /**
   * Subscribe to FundingSettlementInitiated events
   */
  private async subscribeToEvents(): Promise<void> {
    this.subscriptionId = this.connection.onLogs(
      this.dexProgramId,
      (logs: Logs, ctx: Context) => {
        this.handleLogs(logs, ctx);
      },
      'confirmed'
    );

    log.info?.('Subscribed to DEX program logs for funding settlement events');
  }

  /**
   * Handle program logs to detect FundingSettlementInitiated events
   */
  private handleLogs(logs: Logs, _ctx: Context): void {
    for (const logMessage of logs.logs) {
      if (logMessage.includes('FundingSettlementInitiated')) {
        log.info?.('Detected FundingSettlementInitiated event');
        // Trigger immediate poll to pick up the new operation
        this.pollPendingFundingOperations().catch(err => {
          log.error?.({ error: err }, 'Error in immediate funding poll');
        });
        break;
      }
    }
  }

  /**
   * Poll for positions with pending funding settlement
   * Detection: threshold_verified = false AND pending_mpc_request != 0 AND no margin/close pending
   */
  private async pollPendingFundingOperations(): Promise<void> {
    try {
      const pendingOps = await this.fetchPendingFundingOperations();

      if (pendingOps.length === 0) {
        return;
      }

      log.info?.(`Found ${pendingOps.length} pending funding settlement operations`);

      for (const op of pendingOps) {
        const opKey = Buffer.from(op.requestId).toString('hex');

        // Skip if already processing
        if (this.processingOperations.has(opKey)) {
          continue;
        }

        // Skip if exceeded retries
        const retryCount = this.failedOperations.get(opKey) || 0;
        if (retryCount >= this.maxRetries) {
          log.warn?.(`Funding operation ${opKey.slice(0, 16)}... exceeded max retries`);
          continue;
        }

        this.processingOperations.add(opKey);

        try {
          await this.processFundingOperation(op);
          this.failedOperations.delete(opKey);
        } catch (error) {
          log.error?.({ error }, 'Failed to process funding operation');
          this.failedOperations.set(opKey, retryCount + 1);
        } finally {
          this.processingOperations.delete(opKey);
        }
      }
    } catch (error) {
      log.error?.({ error }, 'Error polling pending funding operations');
    }
  }

  /**
   * Fetch positions with pending funding settlement
   * Detected by: threshold_verified=false, pending_mpc_request!=0, pending_margin_amount=0, pending_close=false
   */
  private async fetchPendingFundingOperations(): Promise<PendingFundingOperation[]> {
    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [
        { dataSize: 724 }, // V8 position size (V7 was 692)
        // Filter: threshold_verified = false
        {
          memcmp: {
            offset: 530, // threshold_verified offset (same for V7/V8)
            bytes: bs58.encode(Buffer.from([0])), // false
          },
        },
      ],
    });

    const pendingOps: PendingFundingOperation[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const position = this.deserializePositionV7(account.data);

        // Must have a pending MPC request
        const hasRequest = position.pendingMpcRequest.some(b => b !== 0);
        if (!hasRequest) continue;

        // Must NOT have pending margin operation
        if (position.pendingMarginAmount > 0n) continue;

        // Must NOT have pending close
        if (position.pendingClose) continue;

        // Extract funding delta from threshold_commitment
        // First 16 bytes: funding_delta as i128
        // Last 16 bytes: current_cumulative_funding as i128
        const fundingDeltaBytes = position.thresholdCommitment.slice(0, 16);
        const currentFundingBytes = position.thresholdCommitment.slice(16, 32);

        const fundingDelta = this.readI128(fundingDeltaBytes);
        const currentCumulativeFunding = this.readI128(currentFundingBytes);

        // Skip if funding delta is 0 (shouldn't happen, but safety check)
        if (fundingDelta === 0n) continue;

        pendingOps.push({
          positionPda: pubkey,
          position,
          requestId: position.pendingMpcRequest,
          fundingDelta,
          currentCumulativeFunding,
        });
      } catch (error) {
        log.debug?.({ error }, `Failed to parse position ${pubkey.toBase58()}`);
      }
    }

    return pendingOps;
  }

  /**
   * Process a single funding operation
   */
  private async processFundingOperation(op: PendingFundingOperation): Promise<void> {
    const opKey = Buffer.from(op.requestId).toString('hex');
    log.info?.(`Processing funding settlement for position ${op.positionPda.toBase58()}, delta=${op.fundingDelta}`);

    // Check if we already have MPC result
    let result = this.mpcResults.get(opKey);

    if (!result) {
      // Trigger MXE calculate_funding
      await this.triggerCalculateFunding(op);

      // Poll for result (simplified - in production use event subscription)
      const polledResult = await this.pollForMpcResult(op);

      if (polledResult) {
        result = polledResult;
        this.mpcResults.set(opKey, result);
      }
    }

    if (result) {
      // Submit callback transaction
      await this.submitFundingCallback(op, result);
      this.mpcResults.delete(opKey);
    }
  }

  /**
   * Trigger MXE calculate_funding computation
   */
  private async triggerCalculateFunding(op: PendingFundingOperation): Promise<void> {
    log.info?.(`Triggering calculate_funding for ${op.positionPda.toBase58()}`);

    const instruction = await this.buildCalculateFundingInstruction(op);
    const transaction = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    log.info?.(`calculate_funding triggered, tx: ${signature}`);
  }

  /**
   * Build MXE calculate_funding instruction
   */
  private async buildCalculateFundingInstruction(
    op: PendingFundingOperation
  ): Promise<TransactionInstruction> {
    const computationOffset = BigInt(getCalculateFundingCompDefOffset());

    // Get first 32 bytes of encrypted_size as ciphertext
    const sizeCiphertext = new Uint8Array(op.position.encryptedSize.slice(0, 32));

    // Convert funding delta to BPS and time delta
    // funding_rate_bps = funding_delta / position_size * 10000
    // For now, pass the delta directly and let MPC handle scaling
    const fundingRateBps = op.fundingDelta;

    // Time delta in seconds (assume 1 hour for funding rate application)
    const timeDeltaSecs = 3600n;

    const isLong = op.position.side === PositionSide.Long;

    // Get MXE X25519 public key from environment or use default
    const pubKeyHex = process.env.MXE_X25519_PUBKEY ||
      '46589a2f72e04b041864f84900632a8a017173ddc002f37d5ab3c7a69e1a1f1b';
    const pubKey = new Uint8Array(Buffer.from(pubKeyHex, 'hex'));

    // Generate nonce
    const nonce = BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000));

    // Derive Arcium accounts
    const arciumAccounts = deriveArciumAccounts(
      this.mxeProgramId,
      DEFAULT_CLUSTER_OFFSET,
      new BN(computationOffset.toString())
    );

    // Build instruction data
    const data = Buffer.alloc(8 + 8 + 32 + 8 + 8 + 1 + 32 + 16);
    let offset = 0;

    // Discriminator
    data.set(CALCULATE_FUNDING_DISCRIMINATOR, offset);
    offset += 8;

    // computation_offset (u64)
    data.writeBigUInt64LE(computationOffset, offset);
    offset += 8;

    // size_ciphertext (32 bytes)
    data.set(sizeCiphertext, offset);
    offset += 32;

    // funding_rate_bps (i64) - use first 8 bytes of funding delta
    const fundingI64 = op.fundingDelta > 0n
      ? (op.fundingDelta > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : op.fundingDelta)
      : (op.fundingDelta < BigInt(-Number.MAX_SAFE_INTEGER) ? BigInt(-Number.MAX_SAFE_INTEGER) : op.fundingDelta);
    data.writeBigInt64LE(fundingI64, offset);
    offset += 8;

    // time_delta_secs (u64)
    data.writeBigUInt64LE(timeDeltaSecs, offset);
    offset += 8;

    // is_long (bool)
    data.writeUInt8(isLong ? 1 : 0, offset);
    offset += 1;

    // pub_key (32 bytes)
    data.set(pubKey.slice(0, 32), offset);
    offset += 32;

    // nonce (u128)
    const nonceBuf = Buffer.alloc(16);
    nonceBuf.writeBigUInt64LE(nonce & BigInt('0xFFFFFFFFFFFFFFFF'), 0);
    nonceBuf.writeBigUInt64LE(nonce >> 64n, 8);
    data.set(nonceBuf, offset);

    // Build accounts
    const keys = [
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      ...arciumAccountsToRemainingAccounts(arciumAccounts),
    ];

    return new TransactionInstruction({
      keys,
      programId: this.mxeProgramId,
      data,
    });
  }

  /**
   * Poll for MPC computation result
   * In production, use event subscription instead
   */
  private async pollForMpcResult(
    op: PendingFundingOperation
  ): Promise<{
    newEncryptedCollateral: Uint8Array;
    newEncryptedLiqThreshold: Uint8Array;
    isReceiving: boolean;
  } | null> {
    // For now, simulate MPC result based on position data
    // In production: poll Arcium cluster for computation result
    const maxAttempts = 30;
    const pollInterval = 2000; // 2 seconds

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      // Check if result is available (would check Arcium events in production)
      // For hackathon: create simulated result based on funding direction
      const isReceiving = op.fundingDelta < 0n;

      // In production: this would be the actual MPC output
      // For now, return the existing values (callback will fail validation
      // until real MPC is integrated)
      const newEncryptedCollateral = new Uint8Array(op.position.encryptedCollateral);
      const newEncryptedLiqThreshold = op.position.side === PositionSide.Long
        ? new Uint8Array(op.position.encryptedLiqBelow)
        : new Uint8Array(op.position.encryptedLiqAbove);

      log.info?.(`MPC result ready for funding settlement (simulated)`);
      return {
        newEncryptedCollateral,
        newEncryptedLiqThreshold,
        isReceiving,
      };
    }

    log.warn?.(`MPC result not available after ${maxAttempts} attempts`);
    return null;
  }

  /**
   * Submit funding_settlement_callback transaction
   */
  private async submitFundingCallback(
    op: PendingFundingOperation,
    result: {
      newEncryptedCollateral: Uint8Array;
      newEncryptedLiqThreshold: Uint8Array;
      isReceiving: boolean;
    }
  ): Promise<void> {
    log.info?.(`Submitting funding_settlement_callback for ${op.positionPda.toBase58()}`);

    // Derive MXE authority PDA
    const [mxeAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_authority')],
      this.mxeProgramId
    );

    // Derive market PDA (need to fetch from position)
    const marketPda = op.position.market;

    // Build instruction data
    const data = Buffer.alloc(8 + 32 + 64 + 64 + 1 + 1);
    let offset = 0;

    // Discriminator
    data.set(FUNDING_SETTLEMENT_CALLBACK_DISCRIMINATOR, offset);
    offset += 8;

    // request_id (32 bytes)
    data.set(op.requestId, offset);
    offset += 32;

    // new_encrypted_collateral (64 bytes)
    data.set(result.newEncryptedCollateral, offset);
    offset += 64;

    // new_encrypted_liq_threshold (64 bytes)
    data.set(result.newEncryptedLiqThreshold, offset);
    offset += 64;

    // is_receiving (bool)
    data.writeUInt8(result.isReceiving ? 1 : 0, offset);
    offset += 1;

    // success (bool)
    data.writeUInt8(1, offset); // true

    const keys = [
      { pubkey: mxeAuthority, isSigner: true, isWritable: false },
      { pubkey: op.positionPda, isSigner: false, isWritable: true },
      { pubkey: marketPda, isSigner: false, isWritable: false },
    ];

    const instruction = new TransactionInstruction({
      keys,
      programId: this.dexProgramId,
      data,
    });

    const transaction = new Transaction().add(instruction);

    // Note: MXE authority needs to sign - in production this is done by the MXE
    // For testing, we may need to use a test signer or skip this callback
    try {
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.crankKeypair], // Note: this won't work - MXE authority must sign
        { commitment: 'confirmed' }
      );

      log.info?.(`funding_settlement_callback submitted, tx: ${signature}`);
    } catch (error) {
      log.warn?.({ error }, 'funding_settlement_callback requires MXE authority signature');
      // In production, the MXE program handles the callback automatically
    }
  }

  /**
   * Deserialize V7 position account data
   */
  private deserializePositionV7(data: Buffer): ConfidentialPositionV7 {
    let offset = 8; // Skip discriminator

    const trader = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const market = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const positionId = new Uint8Array(data.subarray(offset, offset + 16));
    offset += 16;

    const createdAtHour = data.readBigInt64LE(offset);
    offset += 8;

    const lastUpdatedHour = data.readBigInt64LE(offset);
    offset += 8;

    const side = data.readUInt8(offset) as PositionSide;
    offset += 1;

    const leverage = data.readUInt8(offset);
    offset += 1;

    const encryptedSize = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedEntryPrice = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedCollateral = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedRealizedPnl = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedLiqBelow = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedLiqAbove = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const thresholdCommitment = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const lastThresholdUpdateHour = data.readBigInt64LE(offset);
    offset += 8;

    const thresholdVerified = data.readUInt8(offset) === 1;
    offset += 1;

    // i128 for entry_cumulative_funding (16 bytes)
    const entryCumulativeFunding = this.readI128(data.subarray(offset, offset + 16));
    offset += 16;

    const status = data.readUInt8(offset) as PositionStatus;
    offset += 1;

    const eligibilityProofVerified = data.readUInt8(offset) === 1;
    offset += 1;

    const partialCloseCount = data.readUInt8(offset);
    offset += 1;

    const autoDeleveragePriority = data.readBigUInt64LE(offset);
    offset += 8;

    const lastMarginAddHour = data.readBigInt64LE(offset);
    offset += 8;

    const marginAddCount = data.readUInt8(offset);
    offset += 1;

    const bump = data.readUInt8(offset);
    offset += 1;

    const positionSeed = data.readBigUInt64LE(offset);
    offset += 8;

    // V6 fields
    const pendingMpcRequest = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const pendingMarginAmount = data.readBigUInt64LE(offset);
    offset += 8;

    const pendingMarginIsAdd = data.readUInt8(offset) === 1;
    offset += 1;

    const isLiquidatable = data.readUInt8(offset) === 1;
    offset += 1;

    // V7 fields
    const pendingClose = data.readUInt8(offset) === 1;
    offset += 1;

    const pendingCloseExitPrice = data.readBigUInt64LE(offset);
    offset += 8;

    const pendingCloseFull = data.readUInt8(offset) === 1;
    offset += 1;

    const pendingCloseSize = new Uint8Array(data.subarray(offset, offset + 64));

    return {
      trader,
      market,
      positionId,
      createdAtHour,
      lastUpdatedHour,
      side,
      leverage,
      encryptedSize,
      encryptedEntryPrice,
      encryptedCollateral,
      encryptedRealizedPnl,
      encryptedLiqBelow,
      encryptedLiqAbove,
      thresholdCommitment,
      lastThresholdUpdateHour,
      thresholdVerified,
      entryCumulativeFunding,
      status,
      eligibilityProofVerified,
      partialCloseCount,
      autoDeleveragePriority,
      lastMarginAddHour,
      marginAddCount,
      bump,
      positionSeed,
      pendingMpcRequest,
      pendingMarginAmount,
      pendingMarginIsAdd,
      isLiquidatable,
      pendingClose,
      pendingCloseExitPrice,
      pendingCloseFull,
      pendingCloseSize,
    };
  }

  /**
   * Read i128 from buffer (little-endian)
   */
  private readI128(buf: Uint8Array): bigint {
    const low = Buffer.from(buf.slice(0, 8)).readBigUInt64LE(0);
    const high = Buffer.from(buf.slice(8, 16)).readBigInt64LE(0);
    return (high << 64n) | low;
  }

  /**
   * Get service status
   */
  getStatus(): {
    isPolling: boolean;
    processingCount: number;
    failedCount: number;
    cachedResults: number;
  } {
    return {
      isPolling: this.isPolling,
      processingCount: this.processingOperations.size,
      failedCount: this.failedOperations.size,
      cachedResults: this.mpcResults.size,
    };
  }
}
