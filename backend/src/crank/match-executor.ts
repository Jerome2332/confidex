/**
 * Match Executor
 *
 * Builds and submits match_orders transactions.
 * Handles retries with exponential backoff.
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

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const COMPUTATION_SEED = Buffer.from('computation');

// match_orders discriminator (pre-computed sha256("global:match_orders")[0..8])
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
   */
  private deriveMxeConfigPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_config')],
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
   * Execute a match with retries
   */
  async executeMatch(candidate: MatchCandidate): Promise<MatchResult> {
    const buyPda = candidate.buyOrder.pda.toString();
    const sellPda = candidate.sellOrder.pda.toString();

    console.log(`[MatchExecutor] Attempting match: ${buyPda.slice(0, 8)}... <-> ${sellPda.slice(0, 8)}...`);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const transaction = await this.buildMatchTransaction(candidate);

        const signature = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.crankKeypair],
          { commitment: 'confirmed' }
        );

        console.log(`[MatchExecutor] Match successful: ${signature}`);

        return {
          success: true,
          signature,
          buyOrderPda: candidate.buyOrder.pda,
          sellOrderPda: candidate.sellOrder.pda,
          timestamp: Date.now(),
        };
      } catch (error) {
        lastError = error as Error;

        // Check if it's a retryable error
        if (this.isRetryable(error)) {
          const delay = this.baseRetryDelayMs * Math.pow(2, attempt);
          console.log(`[MatchExecutor] Retry ${attempt + 1}/${this.maxRetries} after ${delay}ms`);
          await this.sleep(delay);
          continue;
        }

        // Non-retryable error, log and return failure
        console.error(`[MatchExecutor] Non-retryable error:`, this.extractErrorMessage(error));
        break;
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      buyOrderPda: candidate.buyOrder.pda,
      sellOrderPda: candidate.sellOrder.pda,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryable(error: unknown): boolean {
    if (error instanceof SendTransactionError) {
      const message = error.message.toLowerCase();

      // Retryable errors
      if (message.includes('blockhash not found')) return true;
      if (message.includes('timeout')) return true;
      if (message.includes('rate limit')) return true;
      if (message.includes('connection')) return true;

      // Non-retryable program errors
      if (message.includes('custom program error')) return false;
      if (message.includes('instruction error')) return false;
    }

    // Network errors are generally retryable
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('econnreset')) return true;
      if (message.includes('etimedout')) return true;
      if (message.includes('enotfound')) return true;
    }

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
