/**
 * Jito Block Engine Client
 *
 * Submits transaction bundles to Jito validators for MEV-protected execution.
 * Features:
 * - Atomic bundle execution (all-or-nothing)
 * - Anti-frontrunning protection
 * - Tip rotation across multiple tip accounts
 * - Status polling with timeout
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { createLogger } from '../lib/logger.js';
import { withRetry, type RetryResult } from '../lib/retry.js';
import type {
  JitoConfig,
  BundleSubmissionResponse,
  BundleStatusResponse,
  BundleResult,
  BundleStatus,
} from './types.js';
import { JITO_TIP_ACCOUNTS } from './types.js';

const log = createLogger('jito');

// =============================================================================
// Jito Client
// =============================================================================

export class JitoClient {
  private tipAccountIndex = 0;
  private connection: Connection;

  constructor(
    private config: JitoConfig,
    connection?: Connection
  ) {
    this.connection = connection ?? new Connection('https://api.mainnet-beta.solana.com');
  }

  // ===========================================================================
  // Tip Management
  // ===========================================================================

  /**
   * Get the next tip account (round-robin)
   */
  getNextTipAccount(): PublicKey {
    const account = JITO_TIP_ACCOUNTS[this.tipAccountIndex];
    this.tipAccountIndex = (this.tipAccountIndex + 1) % JITO_TIP_ACCOUNTS.length;
    return new PublicKey(account);
  }

  /**
   * Build a tip instruction
   * Should be added to the main transaction (not a separate one)
   */
  buildTipInstruction(payer: PublicKey, tipLamports: number): TransactionInstruction {
    const tipAccount = this.getNextTipAccount();

    return SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: tipAccount,
      lamports: tipLamports,
    });
  }

  /**
   * Build an anti-frontrun marker instruction
   * Adding a pubkey starting with "jitodontfront" signals to Jito not to frontrun
   */
  buildAntiFrontrunInstruction(): TransactionInstruction {
    // This is a no-op instruction that contains the anti-frontrun marker
    // Jito validators recognize this and won't frontrun the bundle
    return {
      keys: [],
      programId: new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV'), // Memo program
      data: Buffer.from('jitodontfront'), // Anti-frontrun marker
    };
  }

  // ===========================================================================
  // Bundle Submission
  // ===========================================================================

  /**
   * Submit a bundle of transactions
   */
  async submitBundle(
    transactions: Transaction[],
    signers: Keypair[],
    options?: {
      tipLamports?: number;
      addAntiFrontrun?: boolean;
    }
  ): Promise<BundleResult> {
    const tipLamports = options?.tipLamports ?? this.config.defaultTipLamports;

    log.info(
      {
        transactionCount: transactions.length,
        tipLamports,
        tipSol: tipLamports / LAMPORTS_PER_SOL,
      },
      'Submitting Jito bundle'
    );

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    // Sign and serialize transactions
    const serializedTxs: string[] = [];

    for (const tx of transactions) {
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = signers[0].publicKey;

      // Sign with all signers
      tx.sign(...signers);

      // Serialize to base58
      const serialized = bs58.encode(tx.serialize());
      serializedTxs.push(serialized);
    }

    // Submit bundle
    const bundleId = await this.sendBundle(serializedTxs);

    log.info({ bundleId }, 'Bundle submitted, polling for status');

    // Poll for bundle status
    const result = await this.pollBundleStatus(bundleId, tipLamports);

    return result;
  }

  /**
   * Submit a single transaction as a bundle with tip
   * Convenience method for common case
   */
  async submitSingleWithTip(
    transaction: Transaction,
    signers: Keypair[],
    options?: {
      tipLamports?: number;
      addAntiFrontrun?: boolean;
    }
  ): Promise<BundleResult> {
    const tipLamports = options?.tipLamports ?? this.config.defaultTipLamports;
    const payer = signers[0];

    // Add tip instruction to the transaction
    const tipIx = this.buildTipInstruction(payer.publicKey, tipLamports);
    transaction.add(tipIx);

    // Optionally add anti-frontrun marker
    if (options?.addAntiFrontrun) {
      const antiFrontrunIx = this.buildAntiFrontrunInstruction();
      transaction.add(antiFrontrunIx);
    }

    return this.submitBundle([transaction], signers, { tipLamports });
  }

  /**
   * Send bundle to Jito block engine
   */
  private async sendBundle(serializedTxs: string[]): Promise<string> {
    const retryResult = await withRetry(
      async () => {
        const res = await fetch(`${this.config.blockEngineUrl}/api/v1/bundles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.authToken && { Authorization: `Bearer ${this.config.authToken}` }),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [serializedTxs],
          }),
          signal: AbortSignal.timeout(this.config.submissionTimeoutMs),
        });

        if (!res.ok) {
          throw new Error(`Jito API error: ${res.status} ${res.statusText}`);
        }

        return res.json() as Promise<BundleSubmissionResponse>;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        isRetryable: (err: Error) => {
          // Retry on network errors, not on validation errors
          return err.message.includes('fetch') || err.message.includes('network');
        },
      }
    );

    if (!retryResult.success || !retryResult.value) {
      throw retryResult.error ?? new Error('Jito sendBundle failed');
    }

    const response = retryResult.value;

    if (response.error) {
      throw new Error(`Jito sendBundle error: ${response.error.message} (code: ${(response.error as { code?: number }).code})`);
    }

    if (!response.result) {
      throw new Error('Jito sendBundle returned no result');
    }

    return response.result;
  }

  /**
   * Poll for bundle status until terminal state
   */
  private async pollBundleStatus(bundleId: string, tipPaid: number): Promise<BundleResult> {
    let attempts = 0;
    let lastStatus: BundleStatus = 'pending';

    while (attempts < this.config.maxStatusPollAttempts) {
      await this.sleep(this.config.statusPollIntervalMs);
      attempts++;

      try {
        const response = await fetch(`${this.config.blockEngineUrl}/api/v1/bundles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.authToken && { Authorization: `Bearer ${this.config.authToken}` }),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]],
          }),
        });

        const data = (await response.json()) as BundleStatusResponse;

        if (data.error) {
          log.warn({ bundleId, error: data.error }, 'Bundle status query error');
          continue;
        }

        if (!data.result) {
          continue;
        }

        const status = this.parseStatus(data.result.status);
        lastStatus = status;

        log.debug(
          {
            bundleId,
            status,
            slot: data.result.slot,
            attempt: attempts,
          },
          'Bundle status update'
        );

        // Terminal states
        if (status === 'landed') {
          return {
            bundleId,
            status: 'landed',
            slot: data.result.slot,
            tipPaid,
          };
        }

        if (status === 'failed' || status === 'dropped' || status === 'invalid') {
          return {
            bundleId,
            status,
            error: data.result.error ?? `Bundle ${status}`,
            tipPaid: 0, // No tip paid on failure
          };
        }
      } catch (err) {
        log.warn({ bundleId, error: err, attempt: attempts }, 'Error polling bundle status');
      }
    }

    // Timeout
    log.warn({ bundleId, attempts }, 'Bundle status poll timeout');
    return {
      bundleId,
      status: 'timeout',
      error: `Status poll timeout after ${attempts} attempts (last status: ${lastStatus})`,
      tipPaid: 0,
    };
  }

  /**
   * Parse Jito status string to our enum
   */
  private parseStatus(status: string): BundleStatus {
    const statusLower = status.toLowerCase();

    if (statusLower === 'landed' || statusLower === 'finalized') {
      return 'landed';
    }
    if (statusLower === 'failed') {
      return 'failed';
    }
    if (statusLower === 'dropped') {
      return 'dropped';
    }
    if (statusLower === 'invalid') {
      return 'invalid';
    }
    return 'pending';
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Check if Jito block engine is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.blockEngineUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTipAccounts',
          params: [],
        }),
        signal: AbortSignal.timeout(5000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get recommended tip based on recent bundles
   * Note: This is a placeholder - Jito doesn't expose tip percentiles publicly
   */
  async getRecommendedTip(): Promise<number> {
    // For now, return config default
    // In production, you might query a Jito analytics endpoint or calculate based on recent tips
    return this.config.defaultTipLamports;
  }
}
