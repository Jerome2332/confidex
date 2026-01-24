/**
 * MPC Result Poller
 *
 * Two operation modes:
 *
 * 1. LEGACY (Polling): Polls for pending MPC computation requests and executes the callback
 *    when results are available from the Arcium cluster.
 *
 * 2. EVENT-DRIVEN (Subscription): Subscribes to MXE events (PriceCompareResult, FillCalculationResult)
 *    and calls DEX's update_orders_from_result instruction to update order state.
 *
 * Flow (Event-Driven - Preferred):
 * 1. DEX queues match_orders → MXE queues computation
 * 2. Arcium cluster executes MPC
 * 3. MXE emits PriceCompareResult/FillCalculationResult event
 * 4. Backend receives event via log subscription
 * 5. Backend calls DEX's update_orders_from_result to update orders
 *
 * Flow (Legacy Polling):
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
  Logs,
  LogsCallback,
  Context,
} from '@solana/web3.js';
import { getMXEAccAddress } from '@arcium-hq/client';
import { CrankConfig } from './config.js';
import { withRetry } from '../lib/retry.js';
import { classifyError, MpcError, BlockchainError, isRetryable } from '../lib/errors.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../lib/timeout.js';
import { logger } from '../lib/logger.js';
import { getAlertManager, AlertManager } from '../lib/alerts.js';
import { MpcProcessedRepository } from '../db/repositories/mpc-processed.js';
import bs58 from 'bs58';

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

// update_orders_from_result discriminator: sha256("global:update_orders_from_result")[0..8]
const UPDATE_ORDERS_FROM_RESULT_DISCRIMINATOR = new Uint8Array([0x8b, 0x4a, 0xea, 0x91, 0x66, 0x0e, 0xb3, 0x9e]);

// MXE Event discriminators (Anchor event discriminator = first 8 bytes of sha256("event:<EventName>"))
const MXE_EVENT_DISCRIMINATORS = {
  // PriceCompareResult: sha256("event:PriceCompareResult")[0..8]
  PRICE_COMPARE_RESULT: Buffer.from([0xe7, 0x3c, 0x8f, 0x1a, 0x5b, 0x2d, 0x9e, 0x4f]),
  // FillCalculationResult: sha256("event:FillCalculationResult")[0..8]
  FILL_CALCULATION_RESULT: Buffer.from([0xa2, 0x7b, 0x4c, 0x8d, 0x3e, 0x1f, 0x6a, 0x5b]),
};

/**
 * MXE PriceCompareResult event data
 */
interface PriceCompareResultEvent {
  computationOffset: bigint;
  pricesMatch: boolean;
  requestId: Uint8Array;
  buyOrder: PublicKey;
  sellOrder: PublicKey;
  nonce: bigint;
}

/**
 * MXE FillCalculationResult event data
 */
interface FillCalculationResultEvent {
  computationOffset: bigint;
  encryptedFillAmount: Uint8Array;
  buyFullyFilled: boolean;
  sellFullyFilled: boolean;
  requestId: Uint8Array;
  buyOrder: PublicKey;
  sellOrder: PublicKey;
}

export class MpcPoller {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private mxeProgramId: PublicKey;
  private dexProgramId: PublicKey;
  private mxeConfigPda: PublicKey;
  private mxeAuthorityPda: PublicKey;
  private exchangePda: PublicKey;
  private isPolling: boolean = false;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  // Event subscription mode
  private isSubscribed: boolean = false;
  private subscriptionId: number | null = null;

  // Track requests we've already processed to avoid duplicate callbacks
  // These are backed by the database for persistence across restarts
  private processedRequests: Set<string> = new Set();

  // Track permanently failed requests to avoid infinite retry loops
  private failedRequests: Set<string> = new Set();

  // Track events we've already processed (by signature + log index)
  private processedEvents: Set<string> = new Set();

  // Alert manager for critical failure notifications
  private alertManager: AlertManager;

  // Database repository for persistence (optional - if not provided, uses in-memory only)
  private mpcProcessedRepo: MpcProcessedRepository | null = null;

  constructor(
    connection: Connection,
    crankKeypair: Keypair,
    config: CrankConfig,
    mpcProcessedRepo?: MpcProcessedRepository
  ) {
    this.connection = connection;
    this.crankKeypair = crankKeypair;
    this.config = config;
    this.mxeProgramId = new PublicKey(config.programs.arciumMxe);
    this.dexProgramId = new PublicKey(config.programs.confidexDex);
    this.mxeConfigPda = this.deriveMxeConfigPda();
    this.mxeAuthorityPda = this.deriveMxeAuthorityPda();
    this.exchangePda = this.deriveExchangePda();
    this.alertManager = getAlertManager();
    this.mpcProcessedRepo = mpcProcessedRepo ?? null;

    // Load persisted state from database if available
    this.loadPersistedState();
  }

  /**
   * Load persisted processed/failed request state from database
   */
  private loadPersistedState(): void {
    if (!this.mpcProcessedRepo) {
      log.debug('No MPC persistence repository - using in-memory only');
      return;
    }

    try {
      // Load processed computation requests
      const processedKeys = this.mpcProcessedRepo.getAllProcessedKeys('computation');
      for (const key of processedKeys) {
        this.processedRequests.add(key);
      }

      // Load failed computation requests
      const failedKeys = this.mpcProcessedRepo.getAllFailedKeys('computation');
      for (const key of failedKeys) {
        this.failedRequests.add(key);
      }

      // Load processed events
      const eventKeys = this.mpcProcessedRepo.getAllProcessedKeys('event');
      for (const key of eventKeys) {
        this.processedEvents.add(key);
      }

      log.info({
        processedCount: processedKeys.length,
        failedCount: failedKeys.length,
        eventsCount: eventKeys.length,
      }, 'Loaded persisted MPC state from database');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ error: errMsg }, 'Failed to load persisted MPC state');
    }
  }

  /**
   * Mark a computation request as processed (persists to DB if available)
   */
  private markRequestProcessed(requestKey: string, computationType?: string, txSignature?: string): void {
    this.processedRequests.add(requestKey);

    if (this.mpcProcessedRepo) {
      try {
        this.mpcProcessedRepo.markProcessed({
          request_key: requestKey,
          request_type: 'computation',
          status: 'processed',
          computation_type: computationType,
          tx_signature: txSignature,
        });
      } catch (err) {
        // Log but don't fail - in-memory set is the primary
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn({ error: errMsg, requestKey: requestKey.slice(0, 16) }, 'Failed to persist processed request');
      }
    }
  }

  /**
   * Mark a computation request as permanently failed (persists to DB if available)
   */
  private markRequestFailed(requestKey: string, computationType?: string, errorMessage?: string): void {
    this.failedRequests.add(requestKey);

    if (this.mpcProcessedRepo) {
      try {
        this.mpcProcessedRepo.markProcessed({
          request_key: requestKey,
          request_type: 'computation',
          status: 'failed',
          computation_type: computationType,
          error_message: errorMessage,
        });
      } catch (err) {
        // Log but don't fail - in-memory set is the primary
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn({ error: errMsg, requestKey: requestKey.slice(0, 16) }, 'Failed to persist failed request');
      }
    }
  }

  /**
   * Mark an event as processed (persists to DB if available)
   */
  private markEventProcessed(eventKey: string, txSignature?: string): void {
    this.processedEvents.add(eventKey);

    if (this.mpcProcessedRepo) {
      try {
        this.mpcProcessedRepo.markProcessed({
          request_key: eventKey,
          request_type: 'event',
          status: 'processed',
          tx_signature: txSignature,
        });
      } catch (err) {
        // Log but don't fail - in-memory set is the primary
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn({ error: errMsg, eventKey: eventKey.slice(0, 16) }, 'Failed to persist processed event');
      }
    }
  }

  /**
   * Get MXE Account address using Arcium SDK
   *
   * The MXE account is derived by Arcium using the MXE program ID.
   * This is where the x25519 key and cluster info are stored.
   */
  private deriveMxeConfigPda(): PublicKey {
    // Use Arcium SDK to get the correct MXE account address
    return getMXEAccAddress(this.mxeProgramId);
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
   * Derive Exchange State PDA
   *
   * Seeds: [b"exchange"]
   * The global exchange state account for DEX configuration
   */
  private deriveExchangePda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('exchange')],
      this.dexProgramId
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
            this.markRequestFailed(requestKey, undefined, 'Account not found or parse error');
            continue;
          }

          if (request.status === ComputationStatus.Pending) {
            log.info({
              idx: Number(i),
              type: ComputationType[request.computationType],
              pda: requestPda.toBase58().slice(0, 8),
            }, 'Processing MPC request');
            await this.processRequest(requestPda, request);
            this.markRequestProcessed(requestKey, ComputationType[request.computationType]);
            processedThisPoll++;
          } else if (request.status === ComputationStatus.Completed || request.status === ComputationStatus.Failed || request.status === ComputationStatus.Expired) {
            // Already completed/failed/expired, mark as processed to skip future polls
            this.markRequestProcessed(requestKey, ComputationType[request.computationType]);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message.split('\n')[0].slice(0, 80) : String(err);
          log.error({ idx: Number(i), error: errMsg }, 'Error processing MPC request');
          // Mark as failed to avoid retrying endlessly on parsing errors
          this.markRequestFailed(requestKey, undefined, errMsg);
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

          // Alert on MPC execution failures (critical for order matching)
          await this.alertManager.error(
            'MPC Execution Failed',
            `Arcium MPC computation failed: ${errMsg}`,
            {
              requestPda: requestPda.toBase58(),
              computationType: ComputationType[request.computationType],
              cluster: this.config.mpc.clusterOffset,
            },
            'mpc-execution-failed'
          );

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
      this.markRequestFailed(requestKey, undefined, classified.message.slice(0, 100));

      // Alert on permanent callback failures
      await this.alertManager.warning(
        'MPC Callback Permanently Failed',
        `ProcessCallback failed permanently: ${classified.message.slice(0, 60)}`,
        {
          requestKey: requestKey.slice(0, 16),
          errorType: classified.name,
          attempts: retryResult.attempts,
        },
        `callback-failed-${requestKey.slice(0, 16)}`
      );
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
          this.markRequestFailed(requestKey, undefined, 'Manually skipped');
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

  // ============================================================================
  // EVENT-DRIVEN MODE (Phase 3: Subscribe to MXE events)
  // ============================================================================

  /**
   * Start event subscription mode
   *
   * Subscribes to MXE program logs to receive computation result events.
   * When events are received, calls DEX's update_orders_from_result instruction.
   */
  startEventSubscription(): void {
    if (this.isSubscribed) {
      log.debug('Already subscribed to MXE events');
      return;
    }

    this.isSubscribed = true;
    log.info('Starting MXE event subscription');

    // Subscribe to MXE program logs
    this.subscriptionId = this.connection.onLogs(
      this.mxeProgramId,
      (logs: Logs, ctx: Context) => this.handleMxeLogs(logs, ctx),
      'confirmed'
    );

    log.info({ subscriptionId: this.subscriptionId }, 'Subscribed to MXE logs');
  }

  /**
   * Stop event subscription
   */
  async stopEventSubscription(): Promise<void> {
    if (!this.isSubscribed || this.subscriptionId === null) {
      return;
    }

    try {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      log.info({ subscriptionId: this.subscriptionId }, 'Unsubscribed from MXE logs');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn({ error: errMsg }, 'Error unsubscribing from MXE logs');
    }

    this.isSubscribed = false;
    this.subscriptionId = null;
  }

  /**
   * Handle MXE log messages
   *
   * Parses logs to detect PriceCompareResult and FillCalculationResult events
   */
  private async handleMxeLogs(logs: Logs, _ctx: Context): Promise<void> {
    const signature = logs.signature;
    const eventKey = `${signature}`;

    // Skip if we've already processed this transaction
    if (this.processedEvents.has(eventKey)) {
      return;
    }

    // Look for event data in logs
    // Anchor events are emitted as base64-encoded data in Program log messages
    for (const logLine of logs.logs) {
      if (logLine.startsWith('Program data: ')) {
        try {
          const base64Data = logLine.substring('Program data: '.length);
          const eventData = Buffer.from(base64Data, 'base64');

          // Check event discriminator
          const discriminator = eventData.slice(0, 8);

          if (discriminator.equals(MXE_EVENT_DISCRIMINATORS.PRICE_COMPARE_RESULT)) {
            await this.handlePriceCompareResult(eventData, signature);
            this.markEventProcessed(eventKey, signature);
          } else if (discriminator.equals(MXE_EVENT_DISCRIMINATORS.FILL_CALCULATION_RESULT)) {
            await this.handleFillCalculationResult(eventData, signature);
            this.markEventProcessed(eventKey, signature);
          }
        } catch (err) {
          // Not a valid event, skip
          continue;
        }
      }
    }

    // Cleanup old processed events (keep last 1000)
    if (this.processedEvents.size > 1000) {
      const toDelete = Array.from(this.processedEvents).slice(0, 500);
      toDelete.forEach(k => this.processedEvents.delete(k));
    }
  }

  /**
   * Parse PriceCompareResult event data
   */
  private parsePriceCompareResultEvent(data: Buffer): PriceCompareResultEvent {
    let offset = 8; // Skip discriminator

    const computationOffset = data.readBigUInt64LE(offset);
    offset += 8;

    const pricesMatch = data[offset] === 1;
    offset += 1;

    const requestId = new Uint8Array(data.slice(offset, offset + 32));
    offset += 32;

    const buyOrder = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const sellOrder = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const nonce = data.readBigUInt64LE(offset);
    offset += 16; // u128 but we only read first 8 bytes

    return {
      computationOffset,
      pricesMatch,
      requestId,
      buyOrder,
      sellOrder,
      nonce,
    };
  }

  /**
   * Parse FillCalculationResult event data
   */
  private parseFillCalculationResultEvent(data: Buffer): FillCalculationResultEvent {
    let offset = 8; // Skip discriminator

    const computationOffset = data.readBigUInt64LE(offset);
    offset += 8;

    const encryptedFillAmount = new Uint8Array(data.slice(offset, offset + 64));
    offset += 64;

    const buyFullyFilled = data[offset] === 1;
    offset += 1;

    const sellFullyFilled = data[offset] === 1;
    offset += 1;

    const requestId = new Uint8Array(data.slice(offset, offset + 32));
    offset += 32;

    const buyOrder = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const sellOrder = new PublicKey(data.slice(offset, offset + 32));

    return {
      computationOffset,
      encryptedFillAmount,
      buyFullyFilled,
      sellFullyFilled,
      requestId,
      buyOrder,
      sellOrder,
    };
  }

  /**
   * Handle PriceCompareResult event from MXE
   *
   * Calls DEX's update_orders_from_result instruction
   */
  private async handlePriceCompareResult(eventData: Buffer, signature: string): Promise<void> {
    const event = this.parsePriceCompareResultEvent(eventData);

    log.info({
      sig: signature.slice(0, 12),
      pricesMatch: event.pricesMatch,
      buyOrder: event.buyOrder.toBase58().slice(0, 8),
      sellOrder: event.sellOrder.toBase58().slice(0, 8),
    }, 'Received PriceCompareResult event');

    // Call DEX update_orders_from_result
    await this.callUpdateOrdersFromResult(
      event.requestId,
      event.buyOrder,
      event.sellOrder,
      event.pricesMatch,
      null, // No fill amount for price comparison
      event.pricesMatch, // If prices match, assume full fill for now
      event.pricesMatch
    );
  }

  /**
   * Handle FillCalculationResult event from MXE
   *
   * Calls DEX's update_orders_from_result instruction with fill data
   */
  private async handleFillCalculationResult(eventData: Buffer, signature: string): Promise<void> {
    const event = this.parseFillCalculationResultEvent(eventData);

    log.info({
      sig: signature.slice(0, 12),
      buyFullyFilled: event.buyFullyFilled,
      sellFullyFilled: event.sellFullyFilled,
      buyOrder: event.buyOrder.toBase58().slice(0, 8),
      sellOrder: event.sellOrder.toBase58().slice(0, 8),
    }, 'Received FillCalculationResult event');

    // Call DEX update_orders_from_result with fill data
    await this.callUpdateOrdersFromResult(
      event.requestId,
      event.buyOrder,
      event.sellOrder,
      true, // Prices must have matched to get fill result
      event.encryptedFillAmount,
      event.buyFullyFilled,
      event.sellFullyFilled
    );
  }

  /**
   * Call DEX's update_orders_from_result instruction
   *
   * This is the event-driven callback that updates order state after MPC completes
   */
  private async callUpdateOrdersFromResult(
    requestId: Uint8Array,
    buyOrder: PublicKey,
    sellOrder: PublicKey,
    pricesMatch: boolean,
    encryptedFill: Uint8Array | null,
    buyFullyFilled: boolean,
    sellFullyFilled: boolean
  ): Promise<void> {
    // Build instruction data for UpdateOrdersFromResultParams
    // Layout: discriminator(8) + request_id(32) + prices_match(1) + Option<encrypted_fill>(1 + 64?) + buy_fully_filled(1) + sell_fully_filled(1)
    const hasEncryptedFill = encryptedFill !== null;
    const dataLen = 8 + 32 + 1 + 1 + (hasEncryptedFill ? 64 : 0) + 1 + 1;
    const data = Buffer.alloc(dataLen);
    let offset = 0;

    // Discriminator
    Buffer.from(UPDATE_ORDERS_FROM_RESULT_DISCRIMINATOR).copy(data, offset);
    offset += 8;

    // Request ID (32 bytes)
    Buffer.from(requestId).copy(data, offset);
    offset += 32;

    // prices_match (bool)
    data.writeUInt8(pricesMatch ? 1 : 0, offset);
    offset += 1;

    // Option<encrypted_fill> - 1 byte for Some/None, then 64 bytes if Some
    if (hasEncryptedFill) {
      data.writeUInt8(1, offset); // Some
      offset += 1;
      Buffer.from(encryptedFill).copy(data, offset);
      offset += 64;
    } else {
      data.writeUInt8(0, offset); // None
      offset += 1;
    }

    // buy_fully_filled (bool)
    data.writeUInt8(buyFullyFilled ? 1 : 0, offset);
    offset += 1;

    // sell_fully_filled (bool)
    data.writeUInt8(sellFullyFilled ? 1 : 0, offset);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true }, // crank
        { pubkey: buyOrder, isSigner: false, isWritable: true }, // buy_order
        { pubkey: sellOrder, isSigner: false, isWritable: true }, // sell_order
        { pubkey: this.exchangePda, isSigner: false, isWritable: false }, // exchange
      ],
      programId: this.dexProgramId,
      data,
    });

    const requestIdHex = Buffer.from(requestId.slice(0, 8)).toString('hex');
    log.debug({
      requestId: requestIdHex,
      buyOrder: buyOrder.toBase58().slice(0, 8),
      sellOrder: sellOrder.toBase58().slice(0, 8),
    }, 'Calling update_orders_from_result');

    // Use withRetry for the update call
    const retryResult = await withRetry(
      async () => {
        const transaction = new Transaction().add(instruction);
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.crankKeypair.publicKey;

        const sig = await withTimeout(
          sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.crankKeypair],
            { commitment: 'confirmed' }
          ),
          {
            timeoutMs: DEFAULT_TIMEOUTS.MPC_CALLBACK,
            operation: 'update_orders_from_result',
          }
        );

        return sig;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        maxTimeMs: 30_000,
        jitterFactor: 0.1,
        isRetryable: (error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Don't retry if orders are no longer matching
          if (errorMessage.includes('OrderNotMatching')) {
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
          }, 'update_orders_from_result retry');
        },
      }
    );

    if (retryResult.success) {
      log.info({
        signature: retryResult.value?.slice(0, 12),
        pricesMatch,
        buyFullyFilled,
        sellFullyFilled,
      }, '✓ update_orders_from_result sent');
    } else {
      const classified = classifyError(retryResult.error);
      log.error({
        attempts: retryResult.attempts,
        timeMs: retryResult.totalTimeMs,
        errorType: classified.name,
        errorMsg: classified.message.slice(0, 60),
      }, '✗ update_orders_from_result failed');
    }
  }

  /**
   * Get subscription status
   */
  getSubscriptionStatus(): { isSubscribed: boolean; processedEventsCount: number } {
    return {
      isSubscribed: this.isSubscribed,
      processedEventsCount: this.processedEvents.size,
    };
  }
}
