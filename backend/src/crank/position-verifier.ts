/**
 * Position Verification Service (V6 Async MPC)
 *
 * Monitors for newly opened positions that need MPC verification.
 * When a position is opened via perp_open_position, it has:
 * - threshold_verified = false
 * - pending_mpc_request = [request_id]
 *
 * This service:
 * 1. Polls for positions with threshold_verified = false
 * 2. Triggers MXE verify_position_params computation
 * 3. MXE callback updates position with encrypted thresholds
 *
 * Flow:
 * perp_open_position → PositionAwaitingVerification event
 * → Backend detects pending position
 * → Backend calls MXE verify_position_params
 * → Arcium MPC computes liquidation thresholds
 * → MXE callback → position_verification_callback
 * → Position.threshold_verified = true
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

const log = logger.position || console;

// Position status enum matching on-chain
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
 * ConfidentialPosition account layout (V6 - 618 bytes total)
 */
interface ConfidentialPosition {
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
}

interface PositionWithPda {
  pda: PublicKey;
  position: ConfidentialPosition;
}

// Instruction discriminators - sha256("global:verify_position_params")[0..8]
const VERIFY_POSITION_PARAMS_DISCRIMINATOR = new Uint8Array([
  0xa8, 0x7c, 0xc9, 0xca, 0x61, 0xbf, 0x86, 0x7c
]);

export class PositionVerifier {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private dexProgramId: PublicKey;
  private mxeProgramId: PublicKey;
  private isPolling: boolean = false;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  // Track positions we're currently processing
  private processingPositions: Set<string> = new Set();

  // Track failed verifications to avoid infinite retries
  private failedPositions: Map<string, number> = new Map();
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
   * Start polling for positions awaiting verification
   */
  async start(): Promise<void> {
    if (this.isPolling) {
      log.warn?.('Position verifier already running');
      return;
    }

    log.info?.('Starting position verifier service');
    this.isPolling = true;

    // Initial poll
    await this.pollPendingPositions();

    // Start polling loop
    this.pollIntervalId = setInterval(
      () => this.pollPendingPositions(),
      this.config.pollingIntervalMs
    );
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.isPolling = false;
    log.info?.('Position verifier service stopped');
  }

  /**
   * Poll for positions that need verification
   */
  private async pollPendingPositions(): Promise<void> {
    try {
      const pendingPositions = await this.fetchPendingPositions();

      if (pendingPositions.length === 0) {
        return;
      }

      log.info?.(`Found ${pendingPositions.length} positions awaiting verification`);

      for (const { pda, position } of pendingPositions) {
        const pdaStr = pda.toBase58();

        // Skip if already processing
        if (this.processingPositions.has(pdaStr)) {
          continue;
        }

        // Skip if exceeded retry limit
        const retryCount = this.failedPositions.get(pdaStr) || 0;
        if (retryCount >= this.maxRetries) {
          log.warn?.(`Position ${pdaStr} exceeded max retries, skipping`);
          continue;
        }

        // Mark as processing
        this.processingPositions.add(pdaStr);

        try {
          await this.triggerVerification(pda, position);
          // Success - remove from failed tracking
          this.failedPositions.delete(pdaStr);
        } catch (error) {
          log.error?.({ error }, `Failed to trigger verification for ${pdaStr}`);
          this.failedPositions.set(pdaStr, retryCount + 1);
        } finally {
          this.processingPositions.delete(pdaStr);
        }
      }
    } catch (error) {
      log.error?.({ error }, 'Error polling pending positions');
    }
  }

  /**
   * Fetch all positions that need verification
   * (threshold_verified = false AND status = Open)
   */
  private async fetchPendingPositions(): Promise<PositionWithPda[]> {
    // Fetch all position accounts for the DEX program
    // Filter by: discriminator matches ConfidentialPosition, threshold_verified = false
    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [
        // V6 position size: 618 bytes (8 discriminator + 610 data)
        { dataSize: 618 },
        // threshold_verified = false (offset 492 in V6 layout)
        // The exact offset needs to be calculated based on struct layout
        {
          memcmp: {
            offset: 492, // Adjust based on actual layout
            bytes: bs58.encode(Buffer.from([0])), // false
          },
        },
      ],
    });

    const pendingPositions: PositionWithPda[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const position = this.deserializePosition(account.data);

        // Double-check: must be Open and not yet verified
        if (position.status === PositionStatus.Open && !position.thresholdVerified) {
          pendingPositions.push({ pda: pubkey, position });
        }
      } catch (error) {
        // Skip accounts that don't deserialize properly
        log.debug?.({ error }, `Failed to deserialize position ${pubkey.toBase58()}`);
      }
    }

    return pendingPositions;
  }

  /**
   * Trigger MPC verification for a position
   */
  private async triggerVerification(
    positionPda: PublicKey,
    position: ConfidentialPosition
  ): Promise<void> {
    log.info?.(`Triggering verification for position ${positionPda.toBase58()}`);

    // Build the MXE verify_position_params instruction
    // This will queue an MPC computation that calculates liquidation thresholds
    // from the position's entry price, leverage, and maintenance margin

    const instruction = await this.buildVerifyPositionParamsInstruction(
      positionPda,
      position
    );

    const transaction = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    log.info?.(`Verification triggered for ${positionPda.toBase58()}, tx: ${signature}`);
  }

  /**
   * Build verify_position_params instruction for MXE
   */
  private async buildVerifyPositionParamsInstruction(
    positionPda: PublicKey,
    position: ConfidentialPosition
  ): Promise<TransactionInstruction> {
    // Derive MXE accounts
    const [mxeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_config')],
      this.mxeProgramId
    );

    const [mxeAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_authority')],
      this.mxeProgramId
    );

    // Build instruction data
    // verify_position_params takes:
    // - encrypted_entry_price (64 bytes)
    // - leverage (1 byte)
    // - maintenance_margin_bps (2 bytes)
    // - is_long (1 byte)
    const isLong = position.side === PositionSide.Long;

    const data = Buffer.alloc(8 + 64 + 1 + 2 + 1);
    let offset = 0;

    // Discriminator (placeholder - needs actual calculation)
    data.set(VERIFY_POSITION_PARAMS_DISCRIMINATOR, offset);
    offset += 8;

    // encrypted_entry_price
    data.set(position.encryptedEntryPrice, offset);
    offset += 64;

    // leverage
    data.writeUInt8(position.leverage, offset);
    offset += 1;

    // maintenance_margin_bps (default 500 = 5%)
    data.writeUInt16LE(500, offset);
    offset += 2;

    // is_long
    data.writeUInt8(isLong ? 1 : 0, offset);

    // Build accounts list
    const keys = [
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: mxeConfigPda, isSigner: false, isWritable: false },
      { pubkey: mxeAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: position.market, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: this.mxeProgramId,
      data,
    });
  }

  /**
   * Deserialize position account data
   */
  private deserializePosition(data: Buffer): ConfidentialPosition {
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

    // i128 for entry_cumulative_funding (16 bytes)
    const entryCumulativeFunding = data.readBigInt64LE(offset); // Simplified to i64
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
    };
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
      processingCount: this.processingPositions.size,
      failedCount: this.failedPositions.size,
    };
  }
}
