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
import { getAlertManager, AlertManager } from '../lib/alerts.js';
import bs58 from 'bs58';
import BN from 'bn.js';
import {
  deriveArciumAccounts,
  arciumAccountsForDirectMxeCall,
  DEFAULT_CLUSTER_OFFSET,
  DEFAULT_MXE_PROGRAM_ID,
} from './arcium-accounts.js';
import { getCompDefAccOffset } from '@arcium-hq/client';

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
 * ConfidentialPosition account layout (V9 - 820 bytes total)
 *
 * V9 adds encrypted verification params (96 bytes) for correct MPC verification.
 * V8 added ephemeral_pubkey (32 bytes) for MPC decryption.
 * V7 added pending_close fields (74 bytes).
 *
 * Per Arcium documentation: when `Enc<Shared, T>` wraps a struct,
 * ALL fields must be encrypted with the SAME shared secret and nonce.
 * V9 stores pre-encrypted leverage, mm_bps, is_long to satisfy this requirement.
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
  // V7 fields
  pendingClose: boolean;
  pendingCloseExitPrice: bigint;
  pendingCloseFull: boolean;
  pendingCloseSize: Uint8Array;     // 64 bytes
  // V8 fields
  ephemeralPubkey: Uint8Array;      // 32 bytes - X25519 public key for MPC
  // V9 fields - encrypted verification params (all encrypted with same key/nonce)
  encryptedLeverage: Uint8Array;    // 32 bytes - encrypted u8 for MPC
  encryptedMmBps: Uint8Array;       // 32 bytes - encrypted u16 for MPC
  encryptedIsLong: Uint8Array;      // 32 bytes - encrypted bool for MPC
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

  // Track positions with encryption key mismatch (permanent skip)
  private encryptionMismatchPositions: Set<string> = new Set();

  // Alert manager for critical failures
  private alertManager: AlertManager;

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
    this.alertManager = getAlertManager();
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

        // Skip if position has encryption key mismatch (permanent)
        if (this.encryptionMismatchPositions.has(pdaStr)) {
          log.debug?.(`Skipping position ${pdaStr} - encrypted with wrong MXE key`);
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
          // Extract full error message including simulation logs
          const fullErrorMsg = error instanceof Error ? error.message : String(error);
          const shortErrorMsg = fullErrorMsg.split('\n')[0].slice(0, 80);

          // Detect encryption key mismatch error from Arcium MPC
          if (fullErrorMsg.includes('PlaintextI64(0)') ||
              (fullErrorMsg.includes('Invalid argument') && fullErrorMsg.includes('Ciphertext'))) {
            log.error?.({
              position: pdaStr,
              error: fullErrorMsg,
            }, 'Position encrypted with wrong MXE key - permanently skipping. ' +
               'This position was created before MXE keygen completed or with a different MXE deployment.');
            this.encryptionMismatchPositions.add(pdaStr);
            this.failedPositions.delete(pdaStr);
          } else {
            // Log full error on first failure for debugging
            if (retryCount === 0) {
              log.error?.({ error: fullErrorMsg }, `Failed to trigger verification for ${pdaStr} (full error)`);
            } else {
              log.error?.({ error: shortErrorMsg }, `Failed to trigger verification for ${pdaStr}`);
            }
            this.failedPositions.set(pdaStr, retryCount + 1);

            // Alert on verification failures (affects position safety)
            const isMaxRetries = retryCount + 1 >= this.maxRetries;
            if (isMaxRetries) {
              await this.alertManager.error(
                'Position Verification Failed Permanently',
                `Position verification exceeded max retries: ${shortErrorMsg}`,
                {
                  position: pdaStr.slice(0, 16),
                  trader: position.trader.toBase58().slice(0, 16),
                  market: position.market.toBase58().slice(0, 16),
                  attempts: retryCount + 1,
                },
                `verification-failed-${pdaStr.slice(0, 16)}`
              );
            }
          }
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
    // V9 position size: 820 bytes (V8 was 724, V7 was 692, V6 was 618)
    // V9 adds encrypted_leverage (32), encrypted_mm_bps (32), encrypted_is_long (32)
    const V9_POSITION_SIZE = 820;
    const THRESHOLD_VERIFIED_OFFSET = 530; // Same offset as V7/V8/V9

    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [
        { dataSize: V9_POSITION_SIZE },
        // threshold_verified = false (offset 530 in V7/V8/V9 layout)
        {
          memcmp: {
            offset: THRESHOLD_VERIFIED_OFFSET,
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
   * Build verify_position_params instruction for MXE (V9 - all params encrypted)
   *
   * Per Arcium documentation: when `Enc<Shared, T>` wraps a struct,
   * ALL fields must be encrypted with the SAME shared secret and nonce.
   * V9 positions store pre-encrypted leverage, mm_bps, is_long ciphertexts.
   *
   * Account order must match queue_computation_accounts macro in MXE lib.rs:
   *   0: payer (signer, mut)
   *   1: sign_pda_account (mut)
   *   2: mxe_account
   *   3: mempool_account (mut)
   *   4: executing_pool (mut)
   *   5: computation_account (mut)
   *   6: comp_def_account
   *   7: cluster_account (mut)
   *   8: pool_account (mut)
   *   9: clock_account (mut)
   *  10: system_program
   *  11: arcium_program
   */
  private async buildVerifyPositionParamsInstruction(
    positionPda: PublicKey,
    position: ConfidentialPosition
  ): Promise<TransactionInstruction> {
    // Generate random computation offset for this MPC request
    const computationOffset = new BN(Date.now()).mul(new BN(1000)).add(new BN(Math.floor(Math.random() * 1000)));

    // Get the comp_def offset for verify_position_params
    const compDefOffset = Buffer.from(getCompDefAccOffset('verify_position_params')).readUInt32LE(0);

    // Derive all Arcium infrastructure accounts
    const arciumAccounts = deriveArciumAccounts(
      this.mxeProgramId,
      DEFAULT_CLUSTER_OFFSET,
      computationOffset,
      compDefOffset
    );

    // Build instruction data (V9 - all params encrypted)
    // verify_position_params takes (from MXE lib.rs V9):
    // - computation_offset (u64)            8 bytes
    // - entry_price_ciphertext ([u8; 32])   32 bytes
    // - leverage_ciphertext ([u8; 32])      32 bytes (V9: now encrypted!)
    // - mm_bps_ciphertext ([u8; 32])        32 bytes (V9: now encrypted!)
    // - is_long_ciphertext ([u8; 32])       32 bytes (V9: now encrypted!)
    // - pub_key ([u8; 32])                  32 bytes - X25519 public key for encryption
    // - nonce (u128)                        16 bytes - Rescue cipher nonce

    // Extract nonce from encrypted entry price (first 16 bytes of 64-byte blob)
    const nonce = position.encryptedEntryPrice.slice(0, 16);

    // Use the position's ephemeral pubkey (V8+) for MPC decryption
    const pubKey = position.ephemeralPubkey;

    // Verify position has valid ephemeral pubkey
    if (pubKey.every(b => b === 0)) {
      throw new Error('Position missing ephemeral pubkey (pre-V8 position) - cannot verify');
    }

    // Verify position has V9 encrypted verification params
    if (position.encryptedLeverage.every(b => b === 0)) {
      throw new Error('Position missing encrypted verification params (pre-V9 position) - cannot verify with MPC');
    }

    // Total size: 8 (disc) + 8 (offset) + 32 (entry_price) + 32 (leverage) + 32 (mm_bps) + 32 (is_long) + 32 (pubkey) + 16 (nonce) = 192 bytes
    const data = Buffer.alloc(192);
    let offset = 0;

    // Discriminator
    data.set(VERIFY_POSITION_PARAMS_DISCRIMINATOR, offset);
    offset += 8;

    // computation_offset (u64)
    const offsetBuf = computationOffset.toArrayLike(Buffer, 'le', 8);
    data.set(offsetBuf, offset);
    offset += 8;

    // entry_price_ciphertext - bytes 16-48 of encrypted entry price (ciphertext portion)
    // V2 format: [nonce (16) | ciphertext (32) | ephemeral_pubkey_truncated (16)]
    data.set(position.encryptedEntryPrice.slice(16, 48), offset);
    offset += 32;

    // leverage_ciphertext (V9: encrypted, read from position)
    data.set(position.encryptedLeverage, offset);
    offset += 32;

    // mm_bps_ciphertext (V9: encrypted, read from position)
    data.set(position.encryptedMmBps, offset);
    offset += 32;

    // is_long_ciphertext (V9: encrypted, read from position)
    data.set(position.encryptedIsLong, offset);
    offset += 32;

    // pub_key - full 32-byte X25519 ephemeral public key from V8+ position
    data.set(pubKey, offset);
    offset += 32;

    // nonce - 16-byte nonce as u128 (little-endian)
    data.set(nonce, offset);

    // Build accounts list for direct MXE call
    // Position 10 must be system_program, position 11 must be arcium_program
    const keys = [
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      ...arciumAccountsForDirectMxeCall(arciumAccounts),
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
    offset += 1;

    // V7 fields (close position tracking)
    const pendingClose = data.readUInt8(offset) === 1;
    offset += 1;

    const pendingCloseExitPrice = data.readBigUInt64LE(offset);
    offset += 8;

    const pendingCloseFull = data.readUInt8(offset) === 1;
    offset += 1;

    const pendingCloseSize = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    // V8 fields (MPC decryption fix)
    const ephemeralPubkey = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    // V9 fields (encrypted verification params)
    // These were encrypted at position creation with same key/nonce as entry_price
    const encryptedLeverage = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const encryptedMmBps = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const encryptedIsLong = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

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
      ephemeralPubkey,
      encryptedLeverage,
      encryptedMmBps,
      encryptedIsLong,
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
