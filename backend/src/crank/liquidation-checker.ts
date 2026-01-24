/**
 * Liquidation Checker Service (V6 Async MPC)
 *
 * Periodically runs batch liquidation checks for open positions.
 *
 * In V6, liquidation thresholds are ENCRYPTED, so we can't check on-chain
 * whether mark_price < liq_below (for longs) or mark_price > liq_above (for shorts).
 * Instead, we trigger MPC batch checks that:
 * 1. Compare mark price against encrypted thresholds
 * 2. Set is_liquidatable = true on positions that should be liquidated
 *
 * Flow:
 * 1. Keeper periodically calls initiate_liquidation_check with batch of positions
 * 2. Event emitted → Backend triggers MXE batch_liquidation_check
 * 3. Arcium MPC compares mark price vs encrypted thresholds for each position
 * 4. MXE callback → liquidation_check_callback updates is_liquidatable flags
 * 5. execute_adl or liquidate_position can now read cached flag
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { CrankConfig } from './config.js';
import { logger } from '../lib/logger.js';
import { getAlertManager, AlertManager } from '../lib/alerts.js';
import {
  PythHermesClient,
  loadPriceConfig,
  parsePriceFeedsFromEnv,
  PYTH_FEED_IDS,
  type PriceData,
  type PriceFeedConfig,
} from '../prices/index.js';
import { getEventBroadcaster } from '../index.js';

const log = logger.liquidation || console;

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

interface OpenPosition {
  pda: PublicKey;
  market: PublicKey;
  side: PositionSide;
  leverage: number;
  thresholdVerified: boolean;
  isLiquidatable: boolean;
  status: PositionStatus;
}

// Maximum positions per batch (matches on-chain LiquidationBatchRequest.MAX_POSITIONS)
const MAX_POSITIONS_PER_BATCH = 10;

// Instruction discriminators - sha256("global:<name>")[0..8]
// DEX instruction: check_liquidation_batch
const CHECK_LIQUIDATION_BATCH_DISCRIMINATOR = new Uint8Array([
  0x24, 0x41, 0x88, 0x5d, 0xe5, 0xdd, 0xb5, 0x7b
]);

// MXE instruction: batch_liquidation_check
const BATCH_LIQUIDATION_CHECK_DISCRIMINATOR = new Uint8Array([
  0x3e, 0x33, 0xc0, 0x49, 0x7f, 0xbb, 0xf2, 0xc9
]);

export class LiquidationChecker {
  private connection: Connection;
  private crankKeypair: Keypair;
  private config: CrankConfig;
  private dexProgramId: PublicKey;
  private mxeProgramId: PublicKey;
  private isRunning: boolean = false;
  private checkIntervalId: ReturnType<typeof setInterval> | null = null;

  // Check interval (more frequent than regular polling since liquidations are time-sensitive)
  private checkIntervalMs: number;

  // Track batches we're currently processing
  private processingBatches: Set<string> = new Set();

  // Markets to check (can be configured)
  private marketsToCheck: PublicKey[] = [];

  // Alert manager for critical failures
  private alertManager: AlertManager;

  // Pyth price streaming client
  private pythClient: PythHermesClient | null = null;
  private priceFeeds: PriceFeedConfig[] = [];

  // Map market PDAs to their price feed IDs
  private marketPriceFeeds: Map<string, string> = new Map();

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
    // More frequent checks for liquidations (every 10 seconds default)
    this.checkIntervalMs = Math.min(config.pollingIntervalMs, 10000);
    this.alertManager = getAlertManager();
  }

  /**
   * Add a market to monitor for liquidations
   */
  addMarket(marketPda: PublicKey): void {
    if (!this.marketsToCheck.find(m => m.equals(marketPda))) {
      this.marketsToCheck.push(marketPda);
      log.info?.(`Added market ${marketPda.toBase58()} to liquidation monitoring`);
    }
  }

  /**
   * Start the liquidation checker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn?.('Liquidation checker already running');
      return;
    }

    log.info?.('Starting liquidation checker service');
    this.isRunning = true;

    // Initialize Pyth price streaming
    await this.initializePythStreaming();

    // Initial check
    await this.runLiquidationCheck();

    // Start periodic checks
    this.checkIntervalId = setInterval(
      () => this.runLiquidationCheck(),
      this.checkIntervalMs
    );
  }

  /**
   * Initialize Pyth Hermes price streaming
   */
  private async initializePythStreaming(): Promise<void> {
    const priceConfig = loadPriceConfig();

    if (!priceConfig.enabled) {
      log.info?.('Pyth price streaming disabled (PRICE_STREAMING_ENABLED=false)');
      return;
    }

    try {
      this.priceFeeds = parsePriceFeedsFromEnv();

      // Default: SOL/USD for most markets
      if (this.priceFeeds.length === 0) {
        this.priceFeeds = [{ feedId: PYTH_FEED_IDS.SOL_USD, symbol: 'SOL/USD' }];
      }

      this.pythClient = new PythHermesClient(this.priceFeeds, priceConfig);

      await this.pythClient.connect(
        // Price update callback - trigger liquidation checks on significant moves
        (feedId: string, price: PriceData) => {
          this.onPriceUpdate(feedId, price);
        },
        // Connection status callback
        (connected: boolean, error?: Error) => {
          if (connected) {
            log.info?.('Pyth Hermes connected for liquidation price monitoring');
          } else {
            log.warn?.({ error: error?.message }, 'Pyth Hermes disconnected');
          }
        }
      );

      log.info?.(
        {
          feeds: this.priceFeeds.map((f) => f.symbol),
          feedCount: this.priceFeeds.length,
        },
        'Pyth price streaming initialized for liquidation checker'
      );
    } catch (error) {
      log.error?.({ error }, 'Failed to initialize Pyth streaming, falling back to polling-only');
      // Continue without Pyth - liquidation checks will still run on interval
    }
  }

  /**
   * Handle price updates from Pyth
   * Triggers immediate liquidation check when price moves significantly
   */
  private onPriceUpdate(feedId: string, price: PriceData): void {
    // Broadcast price update to WebSocket clients
    const broadcaster = getEventBroadcaster();
    if (broadcaster) {
      const symbol = this.priceFeeds.find((f) => f.feedId === feedId)?.symbol ?? feedId;
      broadcaster.priceUpdate({
        feedId,
        symbol,
        price: price.price.toString(),
        confidence: price.conf.toString(),
        publishTime: price.publishTime,
      });
    }

    // Find markets using this price feed and check for liquidations
    for (const [marketKey, marketFeedId] of this.marketPriceFeeds.entries()) {
      if (marketFeedId === feedId) {
        // Debounce: only check if not already processing this market
        const debounceKey = `price-${marketKey}`;
        if (!this.processingBatches.has(debounceKey)) {
          this.processingBatches.add(debounceKey);
          this.checkMarketPositions(new PublicKey(marketKey))
            .catch((err) => log.error?.({ error: err }, 'Price-triggered liquidation check failed'))
            .finally(() => this.processingBatches.delete(debounceKey));
        }
      }
    }
  }

  /**
   * Set the price feed for a market
   */
  setMarketPriceFeed(marketPda: PublicKey, feedId: string): void {
    this.marketPriceFeeds.set(marketPda.toBase58(), feedId);
    log.info?.(`Market ${marketPda.toBase58().slice(0, 12)} using price feed ${feedId.slice(0, 12)}`);
  }

  /**
   * Get current mark price for a market (from Pyth)
   */
  getMarkPrice(marketPda: PublicKey): bigint | null {
    if (!this.pythClient) {
      return null;
    }

    const feedId = this.marketPriceFeeds.get(marketPda.toBase58());
    if (!feedId) {
      // Default to SOL/USD
      return this.pythClient.getPriceAsU64(PYTH_FEED_IDS.SOL_USD, 6);
    }

    return this.pythClient.getPriceAsU64(feedId, 6);
  }

  /**
   * Stop the liquidation checker
   */
  stop(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }

    // Disconnect Pyth streaming
    if (this.pythClient) {
      this.pythClient.disconnect();
      this.pythClient = null;
    }

    this.isRunning = false;
    log.info?.('Liquidation checker service stopped');
  }

  /**
   * Run liquidation check for all monitored markets
   */
  private async runLiquidationCheck(): Promise<void> {
    try {
      for (const market of this.marketsToCheck) {
        await this.checkMarketPositions(market);
      }

      // If no specific markets configured, check all positions
      if (this.marketsToCheck.length === 0) {
        await this.checkAllPositions();
      }
    } catch (error) {
      log.error?.({ error }, 'Error running liquidation check');
    }
  }

  /**
   * Check positions for a specific market
   */
  private async checkMarketPositions(marketPda: PublicKey): Promise<void> {
    const positions = await this.fetchOpenPositions(marketPda);

    if (positions.length === 0) {
      return;
    }

    // Filter to positions that:
    // 1. Are verified (threshold_verified = true)
    // 2. Are not already marked liquidatable
    // 3. Are in Open status
    const eligiblePositions = positions.filter(
      p => p.thresholdVerified && !p.isLiquidatable && p.status === PositionStatus.Open
    );

    if (eligiblePositions.length === 0) {
      return;
    }

    log.info?.(`Checking ${eligiblePositions.length} positions in market ${marketPda.toBase58()}`);

    // Process in batches of MAX_POSITIONS_PER_BATCH
    for (let i = 0; i < eligiblePositions.length; i += MAX_POSITIONS_PER_BATCH) {
      const batch = eligiblePositions.slice(i, i + MAX_POSITIONS_PER_BATCH);
      await this.processBatch(marketPda, batch);
    }
  }

  /**
   * Check all positions across all markets
   */
  private async checkAllPositions(): Promise<void> {
    const positions = await this.fetchAllOpenPositions();

    if (positions.length === 0) {
      return;
    }

    // Group by market
    const byMarket = new Map<string, OpenPosition[]>();
    for (const pos of positions) {
      const marketKey = pos.market.toBase58();
      if (!byMarket.has(marketKey)) {
        byMarket.set(marketKey, []);
      }
      byMarket.get(marketKey)!.push(pos);
    }

    // Process each market's positions
    for (const [marketKey, marketPositions] of byMarket) {
      const eligible = marketPositions.filter(
        p => p.thresholdVerified && !p.isLiquidatable && p.status === PositionStatus.Open
      );

      if (eligible.length === 0) continue;

      const marketPda = new PublicKey(marketKey);
      for (let i = 0; i < eligible.length; i += MAX_POSITIONS_PER_BATCH) {
        const batch = eligible.slice(i, i + MAX_POSITIONS_PER_BATCH);
        await this.processBatch(marketPda, batch);
      }
    }
  }

  /**
   * Process a batch of positions for liquidation check
   */
  private async processBatch(
    marketPda: PublicKey,
    positions: OpenPosition[]
  ): Promise<void> {
    const batchId = `${marketPda.toBase58()}-${Date.now()}`;

    if (this.processingBatches.has(batchId)) {
      return;
    }

    this.processingBatches.add(batchId);

    try {
      log.info?.(`Processing liquidation batch: ${positions.length} positions`);

      // First, call DEX initiate_liquidation_check
      const initTx = await this.buildInitiateLiquidationCheckTx(marketPda, positions);
      const initSig = await sendAndConfirmTransaction(
        this.connection,
        initTx,
        [this.crankKeypair],
        { commitment: 'confirmed' }
      );

      log.info?.(`Initiated liquidation check, tx: ${initSig}`);

      // Then trigger the MXE batch computation
      const mpcTx = await this.buildBatchLiquidationMpcTx(marketPda, positions);
      const mpcSig = await sendAndConfirmTransaction(
        this.connection,
        mpcTx,
        [this.crankKeypair],
        { commitment: 'confirmed' }
      );

      log.info?.(`MPC batch liquidation check triggered, tx: ${mpcSig}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0].slice(0, 80) : String(error);
      log.error?.({ error: errorMsg }, 'Failed to process liquidation batch');

      // Alert on batch processing failures (critical for risk management)
      await this.alertManager.error(
        'Liquidation Batch Failed',
        `Failed to process liquidation batch: ${errorMsg}`,
        {
          market: marketPda.toBase58().slice(0, 16),
          positionCount: positions.length,
          batchId: batchId.slice(0, 24),
        },
        `liquidation-batch-failed-${batchId.slice(0, 24)}`
      );
    } finally {
      this.processingBatches.delete(batchId);
    }
  }

  /**
   * Fetch open positions for a specific market
   */
  private async fetchOpenPositions(marketPda: PublicKey): Promise<OpenPosition[]> {
    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [
        { dataSize: 618 }, // V6 position size
        // Filter by market
        {
          memcmp: {
            offset: 8 + 32, // After discriminator + trader
            bytes: marketPda.toBase58(),
          },
        },
      ],
    });

    return this.parsePositionAccounts(accounts);
  }

  /**
   * Fetch all open positions
   */
  private async fetchAllOpenPositions(): Promise<OpenPosition[]> {
    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [
        { dataSize: 618 }, // V6 position size
      ],
    });

    return this.parsePositionAccounts(accounts);
  }

  /**
   * Parse position account data
   */
  private parsePositionAccounts(
    accounts: readonly { pubkey: PublicKey; account: { data: Buffer } }[]
  ): OpenPosition[] {
    const positions: OpenPosition[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const data = account.data;

        // Parse key fields for liquidation checking
        const market = new PublicKey(data.subarray(8 + 32, 8 + 32 + 32));
        const side = data.readUInt8(8 + 32 + 32 + 16 + 8 + 8) as PositionSide;
        const leverage = data.readUInt8(8 + 32 + 32 + 16 + 8 + 8 + 1);

        // threshold_verified offset
        const thresholdVerifiedOffset = 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 * 6 + 32 + 8;
        const thresholdVerified = data.readUInt8(thresholdVerifiedOffset) === 1;

        // status offset (after threshold_verified + i128 funding)
        const statusOffset = thresholdVerifiedOffset + 1 + 16;
        const status = data.readUInt8(statusOffset) as PositionStatus;

        // is_liquidatable is at the end of V6 fields
        const isLiquidatableOffset = 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 * 6 + 32 + 8 + 1 + 16 + 1 + 1 + 1 + 8 + 8 + 1 + 1 + 8 + 32 + 8 + 1;
        const isLiquidatable = data.readUInt8(isLiquidatableOffset) === 1;

        positions.push({
          pda: pubkey,
          market,
          side,
          leverage,
          thresholdVerified,
          isLiquidatable,
          status,
        });
      } catch (error) {
        log.debug?.({ error }, `Failed to parse position ${pubkey.toBase58()}`);
      }
    }

    return positions;
  }

  /**
   * Build initiate_liquidation_check transaction
   */
  private async buildInitiateLiquidationCheckTx(
    marketPda: PublicKey,
    positions: OpenPosition[]
  ): Promise<Transaction> {
    // Derive oracle PDA (would need actual oracle from market account)
    // For now, use a placeholder
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pyth_price'), marketPda.toBuffer()],
      this.dexProgramId
    );

    const data = Buffer.alloc(8);
    data.set(CHECK_LIQUIDATION_BATCH_DISCRIMINATOR, 0);

    // Build remaining accounts (positions to check)
    const remainingAccounts = positions.map(p => ({
      pubkey: p.pda,
      isSigner: false,
      isWritable: true,
    }));

    const keys = [
      { pubkey: marketPda, isSigner: false, isWritable: false },
      { pubkey: oraclePda, isSigner: false, isWritable: false },
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      ...remainingAccounts,
    ];

    const instruction = new TransactionInstruction({
      keys,
      programId: this.dexProgramId,
      data,
    });

    return new Transaction().add(instruction);
  }

  /**
   * Build MXE batch_liquidation_check transaction
   */
  private async buildBatchLiquidationMpcTx(
    marketPda: PublicKey,
    positions: OpenPosition[]
  ): Promise<Transaction> {
    const [mxeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_config')],
      this.mxeProgramId
    );

    const [mxeAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mxe_authority')],
      this.mxeProgramId
    );

    // Build instruction data
    // batch_liquidation_check takes:
    // - request_id (32 bytes)
    // - mark_price (8 bytes)
    // - position_count (1 byte)
    const requestId = this.generateRequestId();

    // Get mark price from Pyth oracle
    const markPrice = this.getMarkPrice(marketPda);
    if (markPrice === null) {
      throw new Error('Cannot get mark price from Pyth oracle - price unavailable or stale');
    }
    log.debug?.({ markPrice: markPrice.toString(), market: marketPda.toBase58().slice(0, 12) }, 'Using Pyth mark price for liquidation check');

    const data = Buffer.alloc(8 + 32 + 8 + 1);
    let offset = 0;

    data.set(BATCH_LIQUIDATION_CHECK_DISCRIMINATOR, offset);
    offset += 8;

    data.set(requestId, offset);
    offset += 32;

    data.writeBigUInt64LE(markPrice, offset);
    offset += 8;

    data.writeUInt8(positions.length, offset);

    // Remaining accounts: all positions to check
    const remainingAccounts = positions.map(p => ({
      pubkey: p.pda,
      isSigner: false,
      isWritable: true,
    }));

    const keys = [
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: mxeConfigPda, isSigner: false, isWritable: false },
      { pubkey: mxeAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: marketPda, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ];

    const instruction = new TransactionInstruction({
      keys,
      programId: this.mxeProgramId,
      data,
    });

    return new Transaction().add(instruction);
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): Uint8Array {
    const id = new Uint8Array(32);
    const timestamp = BigInt(Date.now());
    const timestampBytes = Buffer.alloc(8);
    timestampBytes.writeBigUInt64LE(timestamp);
    id.set(timestampBytes, 0);

    // Add random bytes
    for (let i = 8; i < 32; i++) {
      id[i] = Math.floor(Math.random() * 256);
    }

    return id;
  }

  /**
   * Get service status
   */
  getStatus(): {
    isRunning: boolean;
    marketsMonitored: number;
    processingBatches: number;
    pythConnected: boolean;
    pythStats: ReturnType<PythHermesClient['getStats']> | null;
  } {
    return {
      isRunning: this.isRunning,
      marketsMonitored: this.marketsToCheck.length,
      processingBatches: this.processingBatches.size,
      pythConnected: this.pythClient?.connected ?? false,
      pythStats: this.pythClient?.getStats() ?? null,
    };
  }

  // =========================================================================
  // LIQUIDATION EXECUTION (V7)
  // =========================================================================

  /**
   * Execute liquidations for positions marked as liquidatable
   *
   * This method:
   * 1. Fetches all positions with is_liquidatable = true
   * 2. For each liquidatable position, calls liquidate_position
   * 3. Liquidation transfers collateral from trader to insurance fund (minus bonus to liquidator)
   *
   * Note: Before calling this, MPC batch check must have set is_liquidatable = true
   */
  async executeLiquidations(marketPda: PublicKey): Promise<number> {
    log.info?.(`[Liquidation] Executing liquidations for market ${marketPda.toBase58().slice(0, 12)}`);

    // Fetch positions marked as liquidatable
    const liquidatablePositions = await this.fetchLiquidatablePositions(marketPda);

    if (liquidatablePositions.length === 0) {
      log.debug?.('[Liquidation] No liquidatable positions found');
      return 0;
    }

    log.info?.(`[Liquidation] Found ${liquidatablePositions.length} liquidatable positions`);

    let successCount = 0;

    for (const position of liquidatablePositions) {
      try {
        await this.executeSingleLiquidation(marketPda, position);
        successCount++;
        log.info?.(`[Liquidation] Position liquidated successfully: ${position.pda.toBase58().slice(0, 12)}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message.split('\n')[0].slice(0, 80) : String(error);
        log.error?.(`[Liquidation] Failed to liquidate position ${position.pda.toBase58().slice(0, 12)}: ${errorMsg}`);

        // Alert on liquidation execution failures (critical for risk management)
        await this.alertManager.error(
          'Liquidation Execution Failed',
          `Failed to execute liquidation: ${errorMsg}`,
          {
            position: position.pda.toBase58().slice(0, 16),
            market: marketPda.toBase58().slice(0, 16),
            side: position.side === PositionSide.Long ? 'Long' : 'Short',
            leverage: position.leverage,
          },
          `liquidation-exec-failed-${position.pda.toBase58().slice(0, 16)}`
        );
      }
    }

    log.info?.(`[Liquidation] Execution complete: ${successCount} succeeded, ${liquidatablePositions.length - successCount} failed`);

    return successCount;
  }

  /**
   * Fetch positions with is_liquidatable = true
   */
  private async fetchLiquidatablePositions(
    marketPda: PublicKey
  ): Promise<OpenPosition[]> {
    // Fetch all V7 positions (692 bytes)
    const V7_POSITION_SIZE = 692;
    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [{ dataSize: V7_POSITION_SIZE }],
    });

    const liquidatable: OpenPosition[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const data = account.data;
        let offset = 8; // Skip discriminator

        // Skip trader (32) + market (32) + positionId (16) + timestamps (16) + side (1) + leverage (1)
        offset += 32; // trader
        const market = new PublicKey(data.subarray(offset, offset + 32));
        offset += 32;

        // Check if this position is for our market
        if (!market.equals(marketPda)) {
          continue;
        }

        offset += 16 + 8 + 8; // positionId, createdAtHour, lastUpdatedHour

        const side = data.readUInt8(offset) as PositionSide;
        offset += 1;

        const leverage = data.readUInt8(offset);
        offset += 1;

        // Skip encrypted fields (6 x 64 = 384 bytes)
        offset += 64 * 6;

        // Skip threshold commitment (32) + lastThresholdUpdateHour (8)
        offset += 32 + 8;

        const thresholdVerified = data.readUInt8(offset) === 1;
        offset += 1;

        // Skip entryCumulativeFunding (16)
        offset += 16;

        const status = data.readUInt8(offset) as PositionStatus;
        offset += 1;

        // Skip eligibilityProofVerified (1) + partialCloseCount (1) + autoDeleveragePriority (8) +
        // lastMarginAddHour (8) + marginAddCount (1) + bump (1) + positionSeed (8) + pendingMpcRequest (32) +
        // pendingMarginAmount (8) + pendingMarginIsAdd (1)
        offset += 1 + 1 + 8 + 8 + 1 + 1 + 8 + 32 + 8 + 1;

        // Read is_liquidatable flag (V6+)
        const isLiquidatable = data.readUInt8(offset) === 1;

        // Only include open, verified positions marked as liquidatable
        if (
          status === PositionStatus.Open &&
          thresholdVerified &&
          isLiquidatable
        ) {
          liquidatable.push({
            pda: pubkey,
            market: marketPda,
            side,
            leverage,
            thresholdVerified,
            isLiquidatable,
            status,
          });
        }
      } catch (err) {
        // Log and skip unparseable positions
        const errMsg = err instanceof Error ? err.message : String(err);
        log.debug({ error: errMsg }, 'Failed to parse position data, skipping');
      }
    }

    return liquidatable;
  }

  /**
   * Execute liquidation for a single position
   */
  private async executeSingleLiquidation(
    marketPda: PublicKey,
    position: OpenPosition
  ): Promise<string> {
    // Find the completed batch request that verified this position
    const batchRequest = await this.findCompletedBatchRequest(marketPda, position.pda);

    if (!batchRequest) {
      throw new Error('No completed batch request found for position');
    }

    // Build liquidate_position transaction
    const tx = await this.buildLiquidatePositionTx(
      marketPda,
      position,
      batchRequest
    );

    // Send and confirm
    const signature = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.crankKeypair],
      { commitment: 'confirmed' }
    );

    return signature;
  }

  /**
   * Find a completed batch request that verified this position as liquidatable
   */
  private async findCompletedBatchRequest(
    marketPda: PublicKey,
    positionPda: PublicKey
  ): Promise<PublicKey | null> {
    // LiquidationBatchRequest account size (adjust based on actual struct)
    const BATCH_REQUEST_SIZE = 328; // Approximate size

    const accounts = await this.connection.getProgramAccounts(this.dexProgramId, {
      filters: [{ dataSize: BATCH_REQUEST_SIZE }],
    });

    for (const { pubkey, account } of accounts) {
      try {
        const data = account.data;
        let offset = 8; // Skip discriminator

        const requestMarket = new PublicKey(data.subarray(offset, offset + 32));
        offset += 32;

        if (!requestMarket.equals(marketPda)) {
          continue;
        }

        // Skip mark_price (8) + position_count (1)
        offset += 8 + 1;

        // Read positions array (10 x 32 = 320 bytes)
        const positions: PublicKey[] = [];
        for (let i = 0; i < 10; i++) {
          positions.push(new PublicKey(data.subarray(offset, offset + 32)));
          offset += 32;
        }

        // Check if our position is in this batch
        if (!positions.some(p => p.equals(positionPda))) {
          continue;
        }

        // Skip results array (10 bytes)
        offset += 10;

        // Read completed flag
        const completed = data.readUInt8(offset) === 1;

        if (completed) {
          return pubkey;
        }
      } catch (err) {
        // Log and skip unparseable check results
        const errMsg = err instanceof Error ? err.message : String(err);
        log.debug({ error: errMsg }, 'Failed to parse liquidation check result, skipping');
      }
    }

    return null;
  }

  /**
   * Build liquidate_position transaction
   */
  private async buildLiquidatePositionTx(
    marketPda: PublicKey,
    position: OpenPosition,
    batchRequest: PublicKey
  ): Promise<Transaction> {
    // Instruction discriminator for liquidate_position
    // sha256("global:liquidate_position")[0..8]
    const LIQUIDATE_POSITION_DISCRIMINATOR = new Uint8Array([
      0x55, 0x0f, 0x6f, 0x0b, 0xbb, 0x97, 0x0a, 0x1c
    ]);

    // Derive required PDAs
    const [liquidationConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('liquidation_config')],
      this.dexProgramId
    );

    // Get market account to find vault addresses
    const marketAccount = await this.connection.getAccountInfo(marketPda);
    if (!marketAccount) {
      throw new Error('Market account not found');
    }

    // Parse market account for vault addresses
    // Layout: discriminator(8) + authority(32) + underlying_mint(32) + ...
    const marketData = marketAccount.data;
    let offset = 8 + 32 + 32; // Skip to relevant fields

    // Read oracle_price_feed (after more fields)
    offset += 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 16 + 16 + 4 + 4 + 4 + 4 + 4; // Skip many fields
    const oraclePriceFeed = new PublicKey(marketData.subarray(offset, offset + 32));
    offset += 32;

    const collateralVault = new PublicKey(marketData.subarray(offset, offset + 32));
    offset += 32;

    const insuranceFund = new PublicKey(marketData.subarray(offset, offset + 32));

    // Build instruction
    const data = Buffer.alloc(8);
    data.set(LIQUIDATE_POSITION_DISCRIMINATOR, 0);

    // Account order matches LiquidatePosition struct
    const keys = [
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: position.pda, isSigner: false, isWritable: true },
      { pubkey: batchRequest, isSigner: false, isWritable: true },
      { pubkey: liquidationConfig, isSigner: false, isWritable: false },
      { pubkey: oraclePriceFeed, isSigner: false, isWritable: false },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: insuranceFund, isSigner: false, isWritable: true },
      // Liquidator's collateral account - derive from keypair
      {
        pubkey: await this.getLiquidatorCollateralAccount(marketPda),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: this.crankKeypair.publicKey, isSigner: true, isWritable: true },
    ];

    const instruction = new TransactionInstruction({
      keys,
      programId: this.dexProgramId,
      data,
    });

    return new Transaction().add(instruction);
  }

  /**
   * Get liquidator's collateral token account (USDC ATA)
   * Uses SPL Token SDK for correct ATA derivation
   */
  private getLiquidatorCollateralAccount(_marketPda: PublicKey): PublicKey {
    // Devnet dummy USDC mint from CLAUDE.md
    const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

    // Use SPL Token SDK for proper ATA derivation
    return getAssociatedTokenAddressSync(USDC_MINT, this.crankKeypair.publicKey);
  }
}
