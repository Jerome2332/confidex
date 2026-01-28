/**
 * Close Position Processor (V7 Async MPC)
 *
 * Monitors for positions with pending close operations and triggers MPC callback
 * when the PnL computation completes.
 *
 * When a user calls initiate_close_position:
 * - Position stores pending_close = true
 * - Position stores pending_close_exit_price, pending_close_full, pending_close_size
 * - Position stores pending_mpc_request = [request_id]
 * - ClosePositionInitiated event is emitted
 * - MPC computation for PnL is queued via calculate_pnl
 *
 * This service:
 * 1. Subscribes to ClosePositionInitiated events
 * 2. Polls Arcium cluster for computation results
 * 3. When result ready, triggers close_position_callback
 * 4. Callback transfers payout to trader and marks position Closed
 *
 * Flow:
 * initiate_close_position → ClosePositionInitiated event
 * → Backend detects pending close
 * → Backend polls MPC for result
 * → Arcium MPC returns encrypted_pnl
 * → Backend calls close_position_callback
 * → Position marked Closed, tokens transferred
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
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
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
import { getCompDefAccOffset, getCompDefAccAddress } from '@arcium-hq/client';

const log = logger.position || logger.crank || console;

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
 * Includes all fields through the V7 async close position tracking
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

interface PendingCloseOperation {
  positionPda: PublicKey;
  position: ConfidentialPositionV7;
  requestId: Uint8Array;
}

// Instruction discriminator for close_position_callback
// sha256("global:close_position_callback")[0..8]
const CLOSE_POSITION_CALLBACK_DISCRIMINATOR = new Uint8Array([
  0xb4, 0xf6, 0x1a, 0x06, 0x10, 0x75, 0x48, 0x0c,
]);

/**
 * Get comp def offset for calculate_pnl circuit
 */
function getCalculatePnlCompDefOffset(): number {
  const offsetBytes = getCompDefAccOffset('calculate_pnl');
  return Buffer.from(offsetBytes).readUInt32LE(0);
}

export class ClosePositionProcessor {
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
  private mpcResults: Map<string, { encryptedPnl: Uint8Array; isProfit: boolean }> = new Map();

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
   * Start processing close position operations
   */
  async start(): Promise<void> {
    if (this.isPolling) {
      log.warn?.('Close position processor already running');
      return;
    }

    log.info?.('Starting close position processor service');
    this.isPolling = true;

    // Subscribe to DEX program logs for ClosePositionInitiated events
    await this.subscribeToEvents();

    // Also poll for any pending operations we might have missed
    await this.pollPendingCloseOperations();

    this.pollIntervalId = setInterval(
      () => this.pollPendingCloseOperations(),
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
    log.info?.('Close position processor service stopped');
  }

  /**
   * Subscribe to ClosePositionInitiated events
   */
  private async subscribeToEvents(): Promise<void> {
    this.subscriptionId = this.connection.onLogs(
      this.dexProgramId,
      (logs: Logs, ctx: Context) => {
        this.handleLogs(logs, ctx);
      },
      'confirmed'
    );

    log.info?.('Subscribed to DEX program logs for close position events');
  }

  /**
   * Handle program logs to detect ClosePositionInitiated events
   */
  private handleLogs(logs: Logs, _ctx: Context): void {
    // Look for ClosePositionInitiated event in logs
    for (const logMessage of logs.logs) {
      if (logMessage.includes('ClosePositionInitiated')) {
        log.info?.('Detected ClosePositionInitiated event');
        // Parse the event data and process
        // The actual parsing depends on how Anchor emits events
        this.pollPendingCloseOperations();
        break;
      }
    }
  }

  /**
   * Poll for positions with pending close operations
   */
  private async pollPendingCloseOperations(): Promise<void> {
    try {
      const pendingOps = await this.fetchPendingCloseOperations();

      if (pendingOps.length === 0) {
        return;
      }

      log.info?.(`Found ${pendingOps.length} pending close position operations`);

      for (const op of pendingOps) {
        const opKey = Buffer.from(op.requestId).toString('hex');

        // Skip if already processing
        if (this.processingOperations.has(opKey)) {
          continue;
        }

        // Skip if exceeded retries
        const retryCount = this.failedOperations.get(opKey) || 0;
        if (retryCount >= this.maxRetries) {
          log.warn?.(`Close position operation ${opKey.slice(0, 16)}... exceeded max retries`);
          continue;
        }

        this.processingOperations.add(opKey);

        try {
          await this.processCloseOperation(op);
          this.failedOperations.delete(opKey);
        } catch (error) {
          log.error?.({ error }, 'Failed to process close position operation');
          this.failedOperations.set(opKey, retryCount + 1);
        } finally {
          this.processingOperations.delete(opKey);
        }
      }
    } catch (error) {
      log.error?.({ error }, 'Error polling pending close position operations');
    }
  }

  /**
   * Fetch positions with pending close operations
   * (pending_close = true)
   */
  private async fetchPendingCloseOperations(): Promise<PendingCloseOperation[]> {
    // V8 position size: 724 bytes (adds 32-byte ephemeral_pubkey at end)
    const V8_POSITION_SIZE = 724;

    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [
        { dataSize: V8_POSITION_SIZE },
        // Filter for pending_close = true
        // pending_close is at offset 618 (same for V7/V8 - ephemeral_pubkey added at end)
        {
          memcmp: {
            offset: 618,
            bytes: bs58.encode(Buffer.from([1])), // true
          },
        },
      ],
    });

    const pendingOps: PendingCloseOperation[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const position = this.deserializePositionV7(account.data);

        // Double-check: must have pending_close = true
        if (position.pendingClose) {
          pendingOps.push({
            positionPda: pubkey,
            position,
            requestId: position.pendingMpcRequest,
          });
        }
      } catch (error) {
        log.debug?.({ error }, `Failed to parse position ${pubkey.toBase58()}`);
      }
    }

    return pendingOps;
  }

  /**
   * Process a close position operation
   *
   * This checks if MPC result is ready and triggers the callback
   */
  private async processCloseOperation(op: PendingCloseOperation): Promise<void> {
    const requestIdHex = Buffer.from(op.requestId).toString('hex').slice(0, 16);
    log.info?.(
      `Processing close position for ${op.positionPda.toBase58()}, request: ${requestIdHex}...`
    );

    // Check if we have a cached MPC result
    const cachedResult = this.mpcResults.get(Buffer.from(op.requestId).toString('hex'));

    if (cachedResult) {
      // We have the result, trigger callback
      await this.triggerCloseCallback(op, cachedResult.encryptedPnl, cachedResult.isProfit);
      this.mpcResults.delete(Buffer.from(op.requestId).toString('hex'));
      return;
    }

    // Poll Arcium for the computation result
    const result = await this.pollMpcResult(op.requestId);

    if (result) {
      await this.triggerCloseCallback(op, result.encryptedPnl, result.isProfit);
    } else {
      log.debug?.(`MPC result not ready yet for ${requestIdHex}...`);
      // Result not ready yet, will be retried on next poll
    }
  }

  /**
   * Poll Arcium cluster for MPC computation result
   */
  private async pollMpcResult(
    requestId: Uint8Array
  ): Promise<{ encryptedPnl: Uint8Array; isProfit: boolean } | null> {
    // Get computation account address with calculate_pnl comp def offset
    const computationOffset = new BN(requestId.slice(0, 8), 'le');
    const accounts = deriveArciumAccounts(
      this.mxeProgramId,
      DEFAULT_CLUSTER_OFFSET,
      computationOffset,
      getCalculatePnlCompDefOffset()
    );

    try {
      // Fetch computation account to check status
      const accountInfo = await this.connection.getAccountInfo(accounts.computationAccount);

      if (!accountInfo || accountInfo.data.length < 100) {
        // Computation account doesn't exist or is too small
        return null;
      }

      // Parse computation account to check if completed
      // The structure depends on Arcium's account layout
      // For now, check if there's output data (simplified)
      const data = accountInfo.data;

      // Check status byte (position varies by Arcium version)
      // Status: 0 = pending, 1 = executing, 2 = completed, 3 = failed
      const statusOffset = 8; // After discriminator
      const status = data[statusOffset];

      if (status !== 2) {
        // Not completed yet
        return null;
      }

      // Parse output data (encrypted_pnl is 64 bytes + is_profit is 1 byte)
      const outputOffset = 100; // Adjust based on actual layout
      const encryptedPnl = new Uint8Array(data.slice(outputOffset, outputOffset + 64));
      const isProfit = data[outputOffset + 64] === 1;

      log.info?.(
        `MPC result ready: isProfit=${isProfit}, pnl_first_byte=${encryptedPnl[0]}`
      );

      return { encryptedPnl, isProfit };
    } catch (error) {
      log.debug?.({ error }, 'Error polling MPC result');
      return null;
    }
  }

  /**
   * Trigger close_position_callback instruction
   */
  private async triggerCloseCallback(
    op: PendingCloseOperation,
    encryptedPnl: Uint8Array,
    isProfit: boolean
  ): Promise<void> {
    log.info?.(`Triggering close position callback for ${op.positionPda.toBase58()}`);

    const instruction = await this.buildCloseCallbackInstruction(op, encryptedPnl, isProfit);
    const transaction = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    log.info?.(
      `Close position callback completed for ${op.positionPda.toBase58()}, tx: ${signature}`
    );
  }

  /**
   * Build close_position_callback instruction
   */
  private async buildCloseCallbackInstruction(
    op: PendingCloseOperation,
    encryptedPnl: Uint8Array,
    isProfit: boolean
  ): Promise<TransactionInstruction> {
    // Derive vault authority PDA
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), op.position.market.toBuffer()],
      this.dexProgramId
    );

    // Get market account to find collateral vault
    const marketInfo = await this.connection.getAccountInfo(op.position.market);
    if (!marketInfo) {
      throw new Error('Market account not found');
    }

    // Parse market to get collateral_vault and fee_recipient
    // Layout: discriminator (8) + ... + collateral_vault (32) at offset ~180
    const collateralVaultOffset = 180; // Adjust based on PerpetualMarket layout
    const collateralVault = new PublicKey(
      marketInfo.data.slice(collateralVaultOffset, collateralVaultOffset + 32)
    );

    const feeRecipientOffset = collateralVaultOffset + 32;
    const feeRecipient = new PublicKey(
      marketInfo.data.slice(feeRecipientOffset, feeRecipientOffset + 32)
    );

    // Get trader's collateral account (ATA)
    // Get quote mint from market
    const quoteMintOffset = 64; // Adjust based on layout
    const quoteMint = new PublicKey(
      marketInfo.data.slice(quoteMintOffset, quoteMintOffset + 32)
    );

    const traderCollateralAccount = getAssociatedTokenAddressSync(
      quoteMint,
      op.position.trader
    );

    // Build instruction data
    // ClosePositionCallbackParams:
    // - request_id: [u8; 32]
    // - encrypted_pnl: [u8; 64]
    // - encrypted_funding_owed: [u8; 64] (set to zeros for now)
    // - is_profit: bool
    // - is_receiving_funding: bool (set to false for now)
    // - payout_amount: u64 (plaintext payout for hackathon)
    const data = Buffer.alloc(8 + 32 + 64 + 64 + 1 + 1 + 8);
    let offset = 0;

    // Discriminator
    data.set(CLOSE_POSITION_CALLBACK_DISCRIMINATOR, offset);
    offset += 8;

    // request_id
    data.set(op.requestId, offset);
    offset += 32;

    // encrypted_pnl
    data.set(encryptedPnl, offset);
    offset += 64;

    // encrypted_funding_owed (zeros for now)
    offset += 64;

    // is_profit
    data.writeUInt8(isProfit ? 1 : 0, offset);
    offset += 1;

    // is_receiving_funding
    data.writeUInt8(0, offset);
    offset += 1;

    // payout_amount (plaintext - extract from encrypted for hackathon)
    // In production, this would come from MPC result
    const payoutAmount = this.calculatePlaintextPayout(op.position, encryptedPnl, isProfit);
    data.writeBigUInt64LE(BigInt(payoutAmount), offset);

    // Build accounts list matching ClosePositionCallback struct
    const keys = [
      { pubkey: op.position.market, isSigner: false, isWritable: true },
      { pubkey: op.positionPda, isSigner: false, isWritable: true },
      { pubkey: traderCollateralAccount, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: feeRecipient, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: this.dexProgramId,
      data,
    });
  }

  /**
   * Calculate plaintext payout amount (hackathon workaround)
   *
   * In production, this would be computed entirely by MPC.
   * For hackathon, we extract plaintext from first 8 bytes of encrypted fields.
   */
  private calculatePlaintextPayout(
    position: ConfidentialPositionV7,
    _encryptedPnl: Uint8Array,
    isProfit: boolean
  ): number {
    // Extract plaintext values from first 8 bytes (hackathon format)
    const collateral = Number(
      Buffer.from(position.encryptedCollateral.slice(0, 8)).readBigUInt64LE(0)
    );

    // Extract PnL from first 8 bytes as i64 (can be negative)
    const pnl = Number(
      Buffer.from(_encryptedPnl.slice(0, 8)).readBigInt64LE(0)
    );

    // Calculate payout: collateral + pnl (if profit) - pnl (if loss)
    let payout = collateral;
    if (isProfit) {
      payout += Math.abs(pnl);
    } else {
      payout -= Math.abs(pnl);
    }

    // Ensure non-negative (position can be fully liquidated)
    payout = Math.max(0, payout);

    // Apply close fee (0.1% = 10 bps)
    const fee = Math.floor(payout * 10 / 10000);
    payout -= fee;

    log.debug?.({
      collateral,
      pnl,
      isProfit,
      fee,
      payout,
    }, 'Calculated plaintext payout');

    return payout;
  }

  /**
   * Deserialize V7 position account data
   */
  private deserializePositionV7(data: Buffer): ConfidentialPositionV7 {
    // Skip 8-byte discriminator
    let offset = 8;

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

    // i128 for entry_cumulative_funding (16 bytes) - read as i64 for simplicity
    const entryCumulativeFunding = data.readBigInt64LE(offset);
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
   * Store MPC result for later processing
   * Called when MPC completes before we poll for it
   */
  storeResult(requestId: Uint8Array, encryptedPnl: Uint8Array, isProfit: boolean): void {
    const key = Buffer.from(requestId).toString('hex');
    this.mpcResults.set(key, { encryptedPnl, isProfit });
    log.info?.(`Stored MPC result for request ${key.slice(0, 16)}...`);
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
