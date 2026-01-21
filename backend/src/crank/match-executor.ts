/**
 * Match Executor
 *
 * Builds and submits match_orders transactions.
 * Handles retries with exponential backoff and proper error classification.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  SendTransactionError,
} from '@solana/web3.js';
import { MatchCandidate, MatchResult } from './types.js';
import { CrankConfig } from './config.js';
import { withRetry, RetryResult } from '../lib/retry.js';
import { classifyError, BlockchainError, isRetryable } from '../lib/errors.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../lib/timeout.js';

// =============================================================================
// SHARED CONSTANTS - Source of truth: lib/src/constants.ts
// TODO: Import from @confidex/sdk when monorepo workspace is configured
// =============================================================================
const EXCHANGE_SEED = Buffer.from('exchange');
const MXE_CONFIG_SEED = Buffer.from('mxe_config');
const COMPUTATION_SEED = Buffer.from('computation');

// match_orders discriminator: sha256("global:match_orders")[0..8]
const MATCH_ORDERS_DISCRIMINATOR = new Uint8Array([0x11, 0x01, 0xc9, 0x5d, 0x07, 0x33, 0xfb, 0x86]);

export class MatchExecutor {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private programId: PublicKey;
  private mxeProgramId: PublicKey;
  private mxeConfigPda: PublicKey;

  // Retry settings
  private maxRetries: number = 3;
  private baseRetryDelayMs: number = 1000;

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
    // MXE Config PDA - derived at initialization (could also be passed in)
    this.mxeConfigPda = this.deriveMxeConfigPda();
  }

  /**
   * Derive Exchange PDA
   */
  private deriveExchangePda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([EXCHANGE_SEED], this.programId);
  }

  /**
   * Derive MXE Config PDA
   *
   * Our custom MXE (CB7P5...) uses seeds: [b"mxe_config"]
   * Derived under our MXE program ID, NOT Arcium core program
   */
  private deriveMxeConfigPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [MXE_CONFIG_SEED],
      this.mxeProgramId
    );
    return pda;
  }

  /**
   * Derive Computation Request PDA
   */
  private deriveComputationRequestPda(computationCount: bigint): [PublicKey, number] {
    const countBuf = Buffer.alloc(8);
    countBuf.writeBigUInt64LE(computationCount);
    return PublicKey.findProgramAddressSync(
      [COMPUTATION_SEED, countBuf],
      this.mxeProgramId
    );
  }

  /**
   * Fetch MXE computation count
   */
  private async fetchMxeComputationCount(): Promise<bigint> {
    const accountInfo = await this.connection.getAccountInfo(this.mxeConfigPda);
    if (!accountInfo) {
      throw new Error('MXE Config not found');
    }

    // Layout: discriminator(8) + authority(32) + cluster_id(32) + cluster_offset(2) + arcium_program(32) + computation_count(8)
    const offset = 8 + 32 + 32 + 2 + 32;
    return accountInfo.data.readBigUInt64LE(offset);
  }

  /**
   * Build match_orders transaction
   */
  async buildMatchTransaction(candidate: MatchCandidate): Promise<Transaction> {
    const [exchangePda] = this.deriveExchangePda();

    // Prepare accounts
    const accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: candidate.pairPda, isSigner: false, isWritable: true },
      { pubkey: candidate.buyOrder.pda, isSigner: false, isWritable: true },
      { pubkey: candidate.sellOrder.pda, isSigner: false, isWritable: true },
      { pubkey: this.mxeProgramId, isSigner: false, isWritable: false },
    ];

    // Add MXE accounts for async MPC flow, or placeholders for sync flow
    if (this.config.useAsyncMpc) {
      const computationCount = await this.fetchMxeComputationCount();
      const [computationRequestPda] = this.deriveComputationRequestPda(computationCount);

      accounts.push({ pubkey: this.mxeConfigPda, isSigner: false, isWritable: true });
      accounts.push({ pubkey: computationRequestPda, isSigner: false, isWritable: true });
    } else {
      // Sync flow: pass program ID as None placeholder
      accounts.push({ pubkey: this.programId, isSigner: false, isWritable: false });
      accounts.push({ pubkey: this.programId, isSigner: false, isWritable: false });
    }

    accounts.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    accounts.push({ pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true });

    const instruction = new TransactionInstruction({
      keys: accounts,
      programId: this.programId,
      data: Buffer.from(MATCH_ORDERS_DISCRIMINATOR),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.crankKeypair.publicKey;

    return transaction;
  }

  /**
   * Execute a match with retries using the retry utility
   */
  async executeMatch(candidate: MatchCandidate): Promise<MatchResult> {
    const buyPda = candidate.buyOrder.pda.toString();
    const sellPda = candidate.sellOrder.pda.toString();

    console.log(`[MatchExecutor] Attempting match: ${buyPda.slice(0, 8)}... <-> ${sellPda.slice(0, 8)}...`);

    // Use the withRetry utility for standardized retry behavior
    const result: RetryResult<string> = await withRetry(
      async () => {
        const transaction = await this.buildMatchTransaction(candidate);

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

        return signature;
      },
      {
        maxAttempts: this.maxRetries,
        initialDelayMs: this.baseRetryDelayMs,
        maxDelayMs: 10_000, // Cap at 10 seconds
        backoffMultiplier: 2,
        jitterFactor: 0.1, // Add 10% jitter
        maxTimeMs: 30_000, // Total max time 30 seconds
        isRetryable: (error) => isRetryable(error),
        onRetry: (error, attempt, delayMs) => {
          const classified = classifyError(error);
          console.log(
            `[MatchExecutor] Retry ${attempt}/${this.maxRetries} after ${delayMs}ms ` +
            `(${classified.name}: ${classified.message})`
          );
        },
      }
    );

    if (result.success) {
      console.log(`[MatchExecutor] Match successful: ${result.value}`);
      return {
        success: true,
        signature: result.value,
        buyOrderPda: candidate.buyOrder.pda,
        sellOrderPda: candidate.sellOrder.pda,
        timestamp: Date.now(),
      };
    }

    // Classify the error for better logging
    const classified = classifyError(result.error);
    console.error(
      `[MatchExecutor] Match failed after ${result.attempts} attempts ` +
      `(${result.totalTimeMs}ms): ${classified.name} - ${classified.message}`
    );

    return {
      success: false,
      error: classified.message,
      buyOrderPda: candidate.buyOrder.pda,
      sellOrderPda: candidate.sellOrder.pda,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryable(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();

    // Non-retryable program errors (check these first)
    if (message.includes('custom program error')) return false;
    if (message.includes('instruction error')) return false;
    if (message.includes('insufficient funds')) return false;
    if (message.includes('account not found')) return false;
    if (message.includes('invalid account')) return false;

    // Retryable errors
    if (message.includes('blockhash not found')) return true;
    if (message.includes('timeout')) return true;
    if (message.includes('rate limit')) return true;
    if (message.includes('connection')) return true;
    if (message.includes('econnreset')) return true;
    if (message.includes('etimedout')) return true;
    if (message.includes('enotfound')) return true;
    if (message.includes('network')) return true;
    if (message.includes('socket hang up')) return true;
    if (message.includes('503')) return true;
    if (message.includes('429')) return true;

    return false;
  }

  /**
   * Extract error message for logging
   */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof SendTransactionError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute multiple matches concurrently
   */
  async executeMatches(candidates: MatchCandidate[]): Promise<MatchResult[]> {
    const results: MatchResult[] = [];

    // Execute sequentially to avoid rate limits
    // Could be parallelized with proper rate limiting
    for (const candidate of candidates) {
      const result = await this.executeMatch(candidate);
      results.push(result);

      // Small delay between matches to avoid overwhelming RPC
      await this.sleep(200);
    }

    return results;
  }
}
