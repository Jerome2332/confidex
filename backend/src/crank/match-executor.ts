/**
 * Match Executor V5
 *
 * Builds and submits match_orders transactions with correct Arcium MXE account structure.
 *
 * Account Structure (17 accounts total):
 *   Primary accounts (6) - in Accounts struct order:
 *     0. exchange (readonly)      - seeds: [b"exchange"]
 *     1. pair (writable)          - seeds: [b"pair", base_mint, quote_mint]
 *     2. buy_order (writable)     - seeds: [b"order", maker, order_nonce]
 *     3. sell_order (writable)    - seeds: [b"order", maker, order_nonce]
 *     4. system_program (readonly)
 *     5. crank (signer, writable)
 *
 *   Remaining accounts (11) - MXE infrastructure:
 *     0. sign_pda_account (mut)      - seeds: [b"ArciumSignerAccount"] @ MXE
 *     1. mxe_account (mut)           - getMXEAccAddress(mxeProgramId)
 *     2. mempool_account (mut)       - getMempoolAccAddress(clusterOffset)
 *     3. executing_pool (mut)        - getExecutingPoolAccAddress(clusterOffset)
 *     4. computation_account (mut)   - getComputationAccAddress(clusterOffset, offset)
 *     5. comp_def_account (readonly) - getCompDefAccAddress(mxeProgramId, compDefOffset)
 *     6. cluster_account (mut)       - getClusterAccAddress(clusterOffset)
 *     7. pool_account (mut)          - getFeePoolAccAddress()
 *     8. clock_account (mut)         - getClockAccAddress()
 *     9. arcium_program (readonly)   - Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ
 *    10. mxe_program (readonly)      - 4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi
 *
 * Instruction Data (64 bytes):
 *   [0..8]   discriminator - sha256("global:match_orders")[0..8]
 *   [8..16]  computation_offset (u64 LE)
 *   [16..48] pub_key ([u8; 32]) - X25519 ephemeral pubkey
 *   [48..64] nonce (u128 LE)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { x25519 } from '@arcium-hq/client';
import { randomBytes } from 'crypto';
import BN from 'bn.js';

import { MatchCandidate, MatchResult } from './types.js';
import { CrankConfig } from './config.js';
import { withRetry, RetryResult } from '../lib/retry.js';
import { classifyError, isRetryable } from '../lib/errors.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../lib/timeout.js';
import { logger } from '../lib/logger.js';
import {
  deriveArciumAccounts,
  arciumAccountsToRemainingAccounts,
  logArciumAccounts,
  DEFAULT_CLUSTER_OFFSET,
} from './arcium-accounts.js';

const log = logger.matching;

// =============================================================================
// CONSTANTS
// =============================================================================

const EXCHANGE_SEED = Buffer.from('exchange');

// match_orders discriminator: sha256("global:match_orders")[0..8]
const MATCH_ORDERS_DISCRIMINATOR = Buffer.from([0x11, 0x01, 0xc9, 0x5d, 0x07, 0x33, 0xfb, 0x86]);

// =============================================================================
// TYPES
// =============================================================================

interface PendingComputation {
  computationOffset: BN;
  ephemeralPrivateKey: Uint8Array;
  buyOrderPda: PublicKey;
  sellOrderPda: PublicKey;
  timestamp: number;
}

// =============================================================================
// MATCH EXECUTOR
// =============================================================================

export class MatchExecutor {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private programId: PublicKey;
  private mxeProgramId: PublicKey;

  // Retry settings
  private maxRetries: number = 3;
  private baseRetryDelayMs: number = 1000;

  // Track pending computations for result polling
  private pendingComputations: Map<string, PendingComputation> = new Map();

  constructor(
    connection: Connection,
    crankKeypair: Keypair,
    config: CrankConfig
  ) {
    this.connection = connection;
    this.crankKeypair = crankKeypair;
    this.config = config;
    this.programId = new PublicKey(config.programs.confidexDex);
    this.mxeProgramId = new PublicKey(config.programs.arciumMxe);
  }

  /**
   * Derive Exchange PDA
   */
  private deriveExchangePda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([EXCHANGE_SEED], this.programId);
  }

  /**
   * Generate a unique computation key for tracking
   */
  private computationKey(buyPda: PublicKey, sellPda: PublicKey): string {
    return `${buyPda.toBase58()}:${sellPda.toBase58()}`;
  }

  /**
   * Build 64-byte match_orders instruction data
   *
   * Format:
   *   [0..8]   discriminator
   *   [8..16]  computation_offset (u64 LE)
   *   [16..48] pub_key ([u8; 32]) - X25519 ephemeral pubkey
   *   [48..64] nonce (u128 LE)
   */
  private buildMatchInstructionData(
    computationOffset: BN,
    ephemeralPubkey: Uint8Array,
    nonce: Buffer
  ): Buffer {
    const data = Buffer.alloc(64);
    let offset = 0;

    // Discriminator (8 bytes)
    MATCH_ORDERS_DISCRIMINATOR.copy(data, offset);
    offset += 8;

    // computation_offset: u64 LE (8 bytes)
    const offsetBytes = computationOffset.toArrayLike(Buffer, 'le', 8);
    offsetBytes.copy(data, offset);
    offset += 8;

    // pub_key: [u8; 32] - X25519 ephemeral pubkey
    Buffer.from(ephemeralPubkey).copy(data, offset);
    offset += 32;

    // nonce: u128 LE (16 bytes)
    nonce.copy(data, offset);

    return data;
  }

  /**
   * Build match_orders transaction with correct account structure
   *
   * Total: 6 primary accounts + 11 remaining accounts = 17 accounts
   */
  async buildMatchTransaction(candidate: MatchCandidate): Promise<{
    transaction: Transaction;
    computationOffset: BN;
    ephemeralPrivateKey: Uint8Array;
  }> {
    // Generate random computation offset (u64)
    const computationOffset = new BN(randomBytes(8));

    // Generate ephemeral X25519 keypair for MPC output encryption
    const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
    const ephemeralPubkey = x25519.getPublicKey(ephemeralPrivateKey);

    // Generate random nonce (u128)
    const nonce = randomBytes(16);

    // Get cluster offset from config
    const clusterOffset = this.config.mpc?.clusterOffset ?? DEFAULT_CLUSTER_OFFSET;

    // Derive all Arcium accounts
    const arciumAccounts = deriveArciumAccounts(
      this.mxeProgramId,
      clusterOffset,
      computationOffset
    );

    // Log derived accounts for debugging
    if (log.isLevelEnabled?.('debug')) {
      logArciumAccounts(arciumAccounts, '[MatchExecutor] ');
    }

    // Derive exchange PDA
    const [exchangePda] = this.deriveExchangePda();

    // ==========================================================================
    // PRIMARY ACCOUNTS (6) - must match MatchOrders struct order exactly
    // ==========================================================================
    const primaryAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
      { pubkey: exchangePda, isSigner: false, isWritable: false },                    // 0. exchange
      { pubkey: candidate.pairPda, isSigner: false, isWritable: true },               // 1. pair
      { pubkey: candidate.buyOrder.pda, isSigner: false, isWritable: true },          // 2. buy_order
      { pubkey: candidate.sellOrder.pda, isSigner: false, isWritable: true },         // 3. sell_order
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },        // 4. system_program
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },      // 5. crank
    ];

    // ==========================================================================
    // REMAINING ACCOUNTS (11) - MXE infrastructure in exact order
    // ==========================================================================
    const remainingAccounts = arciumAccountsToRemainingAccounts(arciumAccounts);

    // Build instruction data (64 bytes)
    const instructionData = this.buildMatchInstructionData(
      computationOffset,
      ephemeralPubkey,
      nonce
    );

    // Log instruction data for debugging
    log.debug({
      discriminator: MATCH_ORDERS_DISCRIMINATOR.toString('hex'),
      computationOffset: computationOffset.toString(),
      ephemeralPubkey: Buffer.from(ephemeralPubkey).toString('hex'),
      nonce: nonce.toString('hex'),
      totalBytes: instructionData.length,
    }, 'Built match_orders instruction data');

    // Create instruction
    const instruction = new TransactionInstruction({
      keys: [...primaryAccounts, ...remainingAccounts],
      programId: this.programId,
      data: instructionData,
    });

    // Log account summary
    log.info({
      primaryCount: primaryAccounts.length,
      remainingCount: remainingAccounts.length,
      totalAccounts: primaryAccounts.length + remainingAccounts.length,
      instructionDataSize: instructionData.length,
      computationOffset: computationOffset.toString(),
    }, 'Built match_orders instruction');

    // Build transaction
    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.crankKeypair.publicKey;

    return {
      transaction,
      computationOffset,
      ephemeralPrivateKey,
    };
  }

  /**
   * Execute a match with retries
   */
  async executeMatch(candidate: MatchCandidate): Promise<MatchResult> {
    const buyPda = candidate.buyOrder.pda.toString();
    const sellPda = candidate.sellOrder.pda.toString();

    log.info({
      buyOrder: buyPda.slice(0, 12),
      sellOrder: sellPda.slice(0, 12),
    }, 'Attempting match');

    // Use the withRetry utility for standardized retry behavior
    const result: RetryResult<{ signature: string; computationOffset: BN }> = await withRetry(
      async () => {
        const { transaction, computationOffset, ephemeralPrivateKey } =
          await this.buildMatchTransaction(candidate);

        // Wrap with timeout for transaction confirmation
        const signature = await withTimeout(
          sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.crankKeypair],
            { commitment: 'confirmed' }
          ),
          {
            timeoutMs: DEFAULT_TIMEOUTS.TRANSACTION,
            operation: 'sendAndConfirmTransaction',
          }
        );

        // Store pending computation for tracking
        const key = this.computationKey(candidate.buyOrder.pda, candidate.sellOrder.pda);
        this.pendingComputations.set(key, {
          computationOffset,
          ephemeralPrivateKey,
          buyOrderPda: candidate.buyOrder.pda,
          sellOrderPda: candidate.sellOrder.pda,
          timestamp: Date.now(),
        });

        return { signature, computationOffset };
      },
      {
        maxAttempts: this.maxRetries,
        initialDelayMs: this.baseRetryDelayMs,
        maxDelayMs: 10_000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
        maxTimeMs: 30_000,
        isRetryable: (error) => isRetryable(error),
        onRetry: (error, attempt, delayMs) => {
          const classified = classifyError(error);
          log.warn({
            attempt,
            maxAttempts: this.maxRetries,
            delayMs,
            errorName: classified.name,
            errorMessage: classified.message,
          }, 'Retrying match');
        },
      }
    );

    if (result.success && result.value) {
      log.info({
        signature: result.value.signature,
        computationOffset: result.value.computationOffset.toString(),
        buyOrder: buyPda.slice(0, 12),
        sellOrder: sellPda.slice(0, 12),
      }, 'Match queued successfully');

      return {
        success: true,
        signature: result.value.signature,
        buyOrderPda: candidate.buyOrder.pda,
        sellOrderPda: candidate.sellOrder.pda,
        timestamp: Date.now(),
        computationOffset: result.value.computationOffset.toString(),
      };
    }

    // Classify the error for better logging
    const classified = classifyError(result.error);
    log.error({
      attempts: result.attempts,
      totalTimeMs: result.totalTimeMs,
      errorName: classified.name,
      errorMessage: classified.message,
      buyOrder: buyPda.slice(0, 12),
      sellOrder: sellPda.slice(0, 12),
    }, 'Match failed');

    return {
      success: false,
      error: classified.message,
      buyOrderPda: candidate.buyOrder.pda,
      sellOrderPda: candidate.sellOrder.pda,
      timestamp: Date.now(),
    };
  }

  /**
   * Get pending computation for a match pair
   */
  getPendingComputation(buyPda: PublicKey, sellPda: PublicKey): PendingComputation | undefined {
    const key = this.computationKey(buyPda, sellPda);
    return this.pendingComputations.get(key);
  }

  /**
   * Remove pending computation after it completes or times out
   */
  removePendingComputation(buyPda: PublicKey, sellPda: PublicKey): void {
    const key = this.computationKey(buyPda, sellPda);
    this.pendingComputations.delete(key);
  }

  /**
   * Get all pending computations
   */
  getAllPendingComputations(): PendingComputation[] {
    return Array.from(this.pendingComputations.values());
  }

  /**
   * Clean up stale pending computations (older than timeout)
   */
  cleanupStaleComputations(maxAgeMs: number = 120_000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, computation] of this.pendingComputations.entries()) {
      if (now - computation.timestamp > maxAgeMs) {
        this.pendingComputations.delete(key);
        cleaned++;
        log.warn({
          buyOrder: computation.buyOrderPda.toBase58().slice(0, 12),
          sellOrder: computation.sellOrderPda.toBase58().slice(0, 12),
          ageMs: now - computation.timestamp,
        }, 'Cleaned up stale computation');
      }
    }

    return cleaned;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute multiple matches concurrently (with rate limiting)
   */
  async executeMatches(candidates: MatchCandidate[]): Promise<MatchResult[]> {
    const results: MatchResult[] = [];

    // Execute sequentially to avoid rate limits
    for (const candidate of candidates) {
      const result = await this.executeMatch(candidate);
      results.push(result);

      // Small delay between matches to avoid overwhelming RPC
      await this.sleep(200);
    }

    return results;
  }
}
