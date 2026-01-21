/**
 * MPC Result Poller
 *
 * Polls for pending MPC computation requests and executes the callback
 * when results are available from the Arcium cluster.
 *
 * Flow:
 * 1. DEX queues match_orders → creates ComputationRequest (status: Pending)
 * 2. Backend polls ComputationRequest accounts for Pending status
 * 3. Backend calls Arcium SDK to get result (if available)
 * 4. Backend calls ProcessCallback on MXE to deliver result
 * 5. MXE CPIs to DEX's finalize_match to complete the order update
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { CrankConfig } from './config.js';
import { withRetry } from '../lib/retry.js';
import { classifyError, MpcError, BlockchainError, isRetryable } from '../lib/errors.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../lib/timeout.js';
import { logger } from '../lib/logger.js';

const log = logger.mpc;

// Computation status enum matching on-chain
enum ComputationStatus {
  Pending = 0,
  Processing = 1,
  Completed = 2,
  Failed = 3,
  Expired = 4,
}

// Computation type enum matching on-chain
enum ComputationType {
  ComparePrices = 0,
  CalculateFill = 1,
  Add = 2,
  Subtract = 3,
  Multiply = 4,
  VerifyPositionParams = 5,
  CheckLiquidation = 6,
  CalculatePnl = 7,
  CalculateFunding = 8,
  CalculateMarginRatio = 9,
  UpdateCollateral = 10,
}

interface ComputationRequest {
  requestId: Uint8Array;
  computationType: ComputationType;
  requester: PublicKey;
  callbackProgram: PublicKey;
  callbackDiscriminator: Uint8Array;
  inputs: Uint8Array;
  status: ComputationStatus;
  createdAt: bigint;
  completedAt: bigint;
  result: Uint8Array;
  callbackAccount1: PublicKey;
  callbackAccount2: PublicKey;
  bump: number;
}

// ProcessCallback discriminator: sha256("global:process_callback")[0..8]
const PROCESS_CALLBACK_DISCRIMINATOR = new Uint8Array([0xb8, 0x53, 0x02, 0x4c, 0x8a, 0x72, 0xd9, 0xc9]);

export class MpcPoller {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private mxeProgramId: PublicKey;
  private mxeConfigPda: PublicKey;
  private mxeAuthorityPda: PublicKey;
  private isPolling: boolean = false;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  // Track requests we've already processed to avoid duplicate callbacks
  private processedRequests: Set<string> = new Set();

  // Track permanently failed requests to avoid infinite retry loops
  private failedRequests: Set<string> = new Set();

  constructor(
    connection: Connection,
    crankKeypair: Keypair,
    config: CrankConfig
  ) {
    this.connection = connection;
    this.crankKeypair = crankKeypair;
    this.config = config;
    this.mxeProgramId = new PublicKey(config.programs.arciumMxe);
    this.mxeConfigPda = this.deriveMxeConfigPda();
    this.mxeAuthorityPda = this.deriveMxeAuthorityPda();
  }

  /**
   * Derive MXE Config PDA
   *
   * Our custom MXE uses seeds: [b"mxe_config"]
   * Derived under the MXE program ID (CB7P5...)
   */
  private deriveMxeConfigPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_config')],
      this.mxeProgramId
    );
    return pda;
  }

  /**
   * Derive MXE Authority PDA (for signing callbacks)
   *
   * Seeds: [b"mxe_authority"]
   * This PDA signs CPI calls to DEX's finalize_match
   */
  private deriveMxeAuthorityPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_authority')],
      this.mxeProgramId
    );
    return pda;
  }

  /**
   * Derive Computation Request PDA from index
   *
   * Seeds: [b"computation", index_le_bytes]
   * Each computation request gets a unique PDA based on its index
   */
  private deriveComputationRequestPda(index: bigint): PublicKey {
    const indexBuf = Buffer.alloc(8);
    indexBuf.writeBigUInt64LE(index);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('computation'), indexBuf],
      this.mxeProgramId
    );
    return pda;
  }

  /**
   * Start polling for MPC results
   */
  start(): void {
    if (this.isPolling) {
      log.debug('Already polling');
      return;
    }

    this.isPolling = true;
    log.info('Started polling for MPC results');

    // Poll immediately, then at intervals
    this.pollForResults();
    this.pollIntervalId = setInterval(() => this.pollForResults(), 3000);
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.isPolling = false;
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    log.info('Stopped polling');
  }

  /**
   * Poll for pending computation requests and process them
   */
  private async pollForResults(): Promise<void> {
    if (!this.isPolling) return;

    try {
      // Get MXE config to find computation count
      const configInfo = await this.connection.getAccountInfo(this.mxeConfigPda);
      if (!configInfo) {
        log.debug('MXE config not found');
        return;
      }

      // Parse computation_count from config
      // Layout: discriminator(8) + authority(32) + cluster_id(32) + cluster_offset(2) + arcium_program(32) + computation_count(8) + completed_count(8)
      const computationCount = configInfo.data.readBigUInt64LE(8 + 32 + 32 + 2 + 32);
      const completedCount = configInfo.data.readBigUInt64LE(8 + 32 + 32 + 2 + 32 + 8);

      const pendingCount = Number(computationCount - completedCount);
      if (pendingCount <= 0) {
        return;
      }

      // Scan recent computation requests for pending ones
      // Start from completed_count and scan up to computation_count
      let processedThisPoll = 0;

      for (let i = completedCount; i < computationCount; i++) {
        const requestPda = this.deriveComputationRequestPda(i);
        const requestKey = requestPda.toBase58();

        // Skip if already processed or permanently failed
        if (this.processedRequests.has(requestKey) || this.failedRequests.has(requestKey)) {
          continue;
        }

        try {
          const request = await this.fetchComputationRequest(requestPda);
          if (!request) {
            // Account doesn't exist or couldn't be parsed, mark as failed to skip
            this.failedRequests.add(requestKey);
            continue;
          }

          if (request.status === ComputationStatus.Pending) {
            log.info({
              idx: Number(i),
              type: ComputationType[request.computationType],
              pda: requestPda.toBase58().slice(0, 8),
            }, 'Processing MPC request');
            await this.processRequest(requestPda, request);
            this.processedRequests.add(requestKey);
            processedThisPoll++;
          } else if (request.status === ComputationStatus.Completed || request.status === ComputationStatus.Failed || request.status === ComputationStatus.Expired) {
            // Already completed/failed/expired, mark as processed to skip future polls
            this.processedRequests.add(requestKey);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message.split('\n')[0].slice(0, 80) : String(err);
          log.error({ idx: Number(i), error: errMsg }, 'Error processing MPC request');
          // Mark as failed to avoid retrying endlessly on parsing errors
          this.failedRequests.add(requestKey);
        }
      }

      if (processedThisPoll > 0) {
        log.debug({ processed: processedThisPoll }, 'Processed MPC requests');
      }

      // Cleanup old processed requests (keep last 1000)
      if (this.processedRequests.size > 1000) {
        const toDelete = Array.from(this.processedRequests).slice(0, 500);
        toDelete.forEach(k => this.processedRequests.delete(k));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.split('\n')[0].slice(0, 80) : String(err);
      log.error({ error: errMsg }, 'MPC poll error');
    }
  }

  /**
   * Fetch and parse a computation request account
   */
  private async fetchComputationRequest(pda: PublicKey): Promise<ComputationRequest | null> {
    const info = await this.connection.getAccountInfo(pda);
    if (!info) return null;

    const data = info.data;
    let offset = 8; // Skip discriminator

    const requestId = data.slice(offset, offset + 32);
    offset += 32;

    const computationType = data[offset] as ComputationType;
    offset += 1;

    const requester = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const callbackProgram = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const callbackDiscriminator = data.slice(offset, offset + 8);
    offset += 8;

    // Vec<u8> inputs - 4-byte length prefix
    const inputsLen = data.readUInt32LE(offset);
    offset += 4;
    const inputs = data.slice(offset, offset + inputsLen);
    offset += inputsLen;

    const status = data[offset] as ComputationStatus;
    offset += 1;

    const createdAt = data.readBigInt64LE(offset);
    offset += 8;

    const completedAt = data.readBigInt64LE(offset);
    offset += 8;

    // Vec<u8> result - 4-byte length prefix
    const resultLen = data.readUInt32LE(offset);
    offset += 4;
    const result = data.slice(offset, offset + resultLen);
    offset += resultLen;

    const callbackAccount1 = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const callbackAccount2 = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const bump = data[offset];

    return {
      requestId: new Uint8Array(requestId),
      computationType,
      requester,
      callbackProgram,
      callbackDiscriminator: new Uint8Array(callbackDiscriminator),
      inputs: new Uint8Array(inputs),
      status,
      createdAt: BigInt(createdAt),
      completedAt: BigInt(completedAt),
      result: new Uint8Array(result),
      callbackAccount1,
      callbackAccount2,
      bump,
    };
  }

  /**
   * Process a pending computation request
   *
   * For demo/hackathon: We simulate MPC execution by computing results locally
   * In production (useRealMpc=true): Uses real Arcium MPC on cluster 456
   */
  private async processRequest(requestPda: PublicKey, request: ComputationRequest): Promise<void> {
    // Compute result based on computation type
    let result: Uint8Array;
    let success: boolean;

    // Check if we should use real MPC (from environment)
    const useRealMpc = process.env.CRANK_USE_REAL_MPC === 'true';

    try {
      if (useRealMpc && request.computationType === ComputationType.ComparePrices) {
        // === PRODUCTION: Use real Arcium MPC ===
        log.debug('Using PRODUCTION MPC mode');

        try {
          // Dynamically import production MPC modules
          const { createArciumClient } = await import('./arcium-client.js');
          const { extractFromV2Blob } = await import('./encryption-utils.js');

          // Create Arcium client
          const arciumClient = createArciumClient(this.connection, this.crankKeypair);

          // Check if MXE is available
          const isAvailable = await arciumClient.isAvailable();
          if (!isAvailable) {
            log.error('Real MXE not available - cannot proceed with MPC');
            // NO FALLBACK TO DEMO MODE - MXE must be available for production
            result = new Uint8Array([0]);
            success = false;
            throw new MpcError('MXE not available - ensure MXE is deployed and keygen is complete');
          } else {
            // Fetch order accounts to get encrypted prices and ephemeral pubkeys
            const buyOrderData = await this.connection.getAccountInfo(request.callbackAccount1);
            const sellOrderData = await this.connection.getAccountInfo(request.callbackAccount2);

            if (!buyOrderData || !sellOrderData) {
              throw new Error('Order accounts not found');
            }

            // Parse encrypted prices from order accounts
            // Order layout: ... encrypted_price starts at offset 8+32+32+1+1+64 = 138
            const ENCRYPTED_PRICE_OFFSET = 138;
            const EPHEMERAL_PUBKEY_OFFSET = 358; // After all other fields

            const buyEncryptedPrice = buyOrderData.data.slice(ENCRYPTED_PRICE_OFFSET, ENCRYPTED_PRICE_OFFSET + 64);
            const sellEncryptedPrice = sellOrderData.data.slice(ENCRYPTED_PRICE_OFFSET, ENCRYPTED_PRICE_OFFSET + 64);
            const buyEphemeralPubkey = buyOrderData.data.slice(EPHEMERAL_PUBKEY_OFFSET, EPHEMERAL_PUBKEY_OFFSET + 32);

            // Extract ciphertexts and nonces from V2 blobs
            const buyInputs = extractFromV2Blob(new Uint8Array(buyEncryptedPrice));
            const sellInputs = extractFromV2Blob(new Uint8Array(sellEncryptedPrice));

            log.debug({
              buyNonce: buyInputs.nonce.toString(16).slice(0, 8),
              sellNonce: sellInputs.nonce.toString(16).slice(0, 8),
            }, 'Extracted price ciphertexts');

            // Execute real MPC comparison
            const pricesMatch = await arciumClient.executeComparePrices(
              buyInputs.ciphertext,
              sellInputs.ciphertext,
              buyInputs.nonce, // Use buy order's nonce
              new Uint8Array(buyEphemeralPubkey)
            );

            result = new Uint8Array([pricesMatch ? 1 : 0]);
            success = true;
            log.info({ pricesMatch }, 'Real MPC result');
          }
        } catch (mpcErr) {
          const errMsg = mpcErr instanceof Error ? mpcErr.message.split('\n')[0].slice(0, 80) : String(mpcErr);
          log.error({ error: errMsg }, 'Real MPC execution failed');
          // NO FALLBACK TO DEMO MODE - propagate the error
          // Mark computation as failed - circuit breaker will handle retries
          result = new Uint8Array([0]);
          success = false;
          // Throw to trigger circuit breaker / retry logic
          throw new MpcError(`MPC execution failed: ${errMsg}`);
        }
      } else {
        // === DEMO: Simulated MPC ===
        switch (request.computationType) {
          case ComputationType.ComparePrices:
            // For demo: Always return true (prices match)
            result = new Uint8Array([1]); // true = prices match
            success = true;
            log.debug('ComparePrices → true (demo)');
            break;

          case ComputationType.CalculateFill:
            // For demo: Return dummy fill result
            result = new Uint8Array(64 + 1 + 1); // 64-byte encrypted fill + 2 bools
            result[64] = 1; // buy_fully_filled = true
            result[65] = 1; // sell_fully_filled = true
            success = true;
            log.debug('CalculateFill → full fill (demo)');
            break;

          default:
            log.warn({ type: request.computationType }, 'Unknown computation type');
            result = new Uint8Array([0]);
            success = false;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.split('\n')[0].slice(0, 80) : String(err);
      log.error({ error: errMsg }, 'Error computing MPC result');
      result = new Uint8Array([0]);
      success = false;
    }

    // Call ProcessCallback on MXE to deliver result
    await this.callProcessCallback(requestPda, request, result, success);
  }

  /**
   * Call ProcessCallback instruction on MXE program with retry logic
   *
   * The request_id in instruction data MUST match the one stored in the request account.
   * The first 8 bytes of request_id contain the index used for PDA derivation.
   */
  private async callProcessCallback(
    requestPda: PublicKey,
    request: ComputationRequest,
    result: Uint8Array,
    success: boolean
  ): Promise<void> {
    // Use the request_id from the account (not computed)
    const requestId = request.requestId;
    const requestKey = requestPda.toBase58();

    // Build instruction data: discriminator + request_id + result (vec) + success (bool)
    const dataLen = 8 + 32 + 4 + result.length + 1;
    const data = Buffer.alloc(dataLen);
    let offset = 0;

    // Discriminator
    Buffer.from(PROCESS_CALLBACK_DISCRIMINATOR).copy(data, offset);
    offset += 8;

    // Request ID (full 32 bytes from account - first 8 bytes contain index for PDA derivation)
    Buffer.from(requestId).copy(data, offset);
    offset += 32;

    // Result as Vec<u8> (4-byte length prefix)
    data.writeUInt32LE(result.length, offset);
    offset += 4;
    Buffer.from(result).copy(data, offset);
    offset += result.length;

    // Success bool
    data.writeUInt8(success ? 1 : 0, offset);

    log.debug({
      requestPda: requestPda.toBase58().slice(0, 8),
      requestIdPrefix: Buffer.from(requestId.slice(0, 8)).toString('hex'),
    }, 'Sending ProcessCallback');

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: this.mxeConfigPda, isSigner: false, isWritable: true },
        { pubkey: requestPda, isSigner: false, isWritable: true },
        { pubkey: this.mxeAuthorityPda, isSigner: false, isWritable: false },
        { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: false }, // cluster_authority (crank as signer for demo)
        { pubkey: request.callbackProgram, isSigner: false, isWritable: false },
        { pubkey: request.callbackAccount1, isSigner: false, isWritable: true },
        { pubkey: request.callbackAccount2, isSigner: false, isWritable: true },
      ],
      programId: this.mxeProgramId,
      data,
    });

    // Use withRetry for callback execution
    const retryResult = await withRetry(
      async () => {
        const transaction = new Transaction().add(instruction);
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.crankKeypair.publicKey;

        const signature = await withTimeout(
          sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.crankKeypair],
            { commitment: 'confirmed' }
          ),
          {
            timeoutMs: DEFAULT_TIMEOUTS.MPC_CALLBACK,
            operation: 'MPC callback',
          }
        );

        return signature;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        maxTimeMs: 30_000, // Total max time 30 seconds
        jitterFactor: 0.1,
        isRetryable: (error) => {
          // Check for permanent failures that should not be retried
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isPermanentFailure =
            errorMessage.includes('ConstraintSeeds') ||
            errorMessage.includes('InstructionFallbackNotFound') ||
            errorMessage.includes('InvalidRequestId') ||
            errorMessage.includes('RequestNotPending');

          if (isPermanentFailure) {
            return false;
          }

          return isRetryable(error);
        },
        onRetry: (error, attempt, delayMs) => {
          const classified = classifyError(error);
          log.warn({
            attempt,
            delayMs,
            errorType: classified.name,
          }, 'Callback retry');
        },
      }
    );

    if (retryResult.success) {
      log.info({ signature: retryResult.value?.slice(0, 12) }, '✓ ProcessCallback sent');
      return;
    }

    // Handle failure
    const classified = classifyError(retryResult.error);
    log.error({
      attempts: retryResult.attempts,
      timeMs: retryResult.totalTimeMs,
      errorType: classified.name,
      errorMsg: classified.message.slice(0, 60),
    }, '✗ ProcessCallback failed');

    // Check if this is a permanent failure
    const errorMessage = retryResult.error?.message || '';
    const isPermanentFailure =
      errorMessage.includes('ConstraintSeeds') ||
      errorMessage.includes('InstructionFallbackNotFound') ||
      errorMessage.includes('InvalidRequestId') ||
      errorMessage.includes('RequestNotPending');

    if (isPermanentFailure) {
      // Mark as permanently failed, don't retry
      log.warn({ request: requestKey.slice(0, 8) }, 'Marking request as permanently failed');
      this.failedRequests.add(requestKey);
    } else {
      // Transient failure, allow retry on next poll
      this.processedRequests.delete(requestKey);
    }
  }

  /**
   * Get poller status
   */
  getStatus(): { isPolling: boolean; processedCount: number; failedCount: number } {
    return {
      isPolling: this.isPolling,
      processedCount: this.processedRequests.size,
      failedCount: this.failedRequests.size,
    };
  }

  /**
   * Mark all current pending computations as processed (skip them)
   * This is useful to clear stale pending computations that will never complete
   */
  async skipAllPending(): Promise<number> {
    try {
      const configInfo = await this.connection.getAccountInfo(this.mxeConfigPda);
      if (!configInfo) {
        log.warn('MXE config not found, cannot skip pending');
        return 0;
      }

      // Parse computation_count and completed_count
      const computationCount = configInfo.data.readBigUInt64LE(8 + 32 + 32 + 2 + 32);
      const completedCount = configInfo.data.readBigUInt64LE(8 + 32 + 32 + 2 + 32 + 8);

      let skipped = 0;
      for (let i = completedCount; i < computationCount; i++) {
        const requestPda = this.deriveComputationRequestPda(i);
        const requestKey = requestPda.toBase58();

        if (!this.processedRequests.has(requestKey) && !this.failedRequests.has(requestKey)) {
          this.failedRequests.add(requestKey);
          skipped++;
        }
      }

      log.info({ skipped, total: Number(computationCount - completedCount) }, 'Skipped pending computations');
      return skipped;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      log.error({ error: errMsg }, 'Failed to skip pending computations');
      return 0;
    }
  }
}
