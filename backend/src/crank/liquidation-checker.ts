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
import { CrankConfig } from './config.js';
import { logger } from '../lib/logger.js';

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

    // Initial check
    await this.runLiquidationCheck();

    // Start periodic checks
    this.checkIntervalId = setInterval(
      () => this.runLiquidationCheck(),
      this.checkIntervalMs
    );
  }

  /**
   * Stop the liquidation checker
   */
  stop(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
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
      log.error?.({ error }, 'Failed to process liquidation batch');
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
    const markPrice = BigInt(0); // Would get from oracle

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
  } {
    return {
      isRunning: this.isRunning,
      marketsMonitored: this.marketsToCheck.length,
      processingBatches: this.processingBatches.size,
    };
  }
}
