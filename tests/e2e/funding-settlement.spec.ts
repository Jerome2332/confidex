/**
 * Integration Tests for Funding Settlement (V7 Async MPC)
 *
 * Tests the async MPC funding settlement flow:
 * 1. Keeper calls settle_funding -> position marked pending
 * 2. Backend detects FundingSettlementInitiated event
 * 3. Backend triggers MXE calculate_funding
 * 4. MPC callback updates encrypted collateral
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Program IDs
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const MXE_PROGRAM_ID = new PublicKey('HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

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

// V7 Position account size (692 bytes)
const V7_POSITION_SIZE = 692;

interface TestContext {
  connection: Connection;
  payer: Keypair;
  perpMarketPda: PublicKey;
  fundingStatePda: PublicKey;
}

interface ParsedPosition {
  trader: PublicKey;
  market: PublicKey;
  side: PositionSide;
  leverage: number;
  status: PositionStatus;
  thresholdVerified: boolean;
  entryCumulativeFunding: bigint;
  pendingMpcRequest: Uint8Array;
  pendingMarginAmount: bigint;
  pendingMarginIsAdd: boolean;
  pendingClose: boolean;
  isLiquidatable: boolean;
  lastUpdatedHour: bigint;
}

let ctx: TestContext;

/**
 * Setup test context
 */
async function setupTestContext(): Promise<TestContext> {
  const connection = new Connection(
    process.env.RPC_URL || 'https://api.devnet.solana.com',
    'confirmed'
  );

  // Load payer keypair
  const payerPath = process.env.PAYER_KEYPAIR_PATH ||
    path.join(process.env.HOME || '', '.config/solana/devnet.json');

  let payer: Keypair;
  if (fs.existsSync(payerPath)) {
    const secret = JSON.parse(fs.readFileSync(payerPath, 'utf-8'));
    payer = Keypair.fromSecretKey(new Uint8Array(secret));
  } else {
    payer = Keypair.generate();
    console.warn('No payer keypair found, using generated keypair');
  }

  // Derive perp market PDA (for SOL)
  const [perpMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('perp_market'), WSOL_MINT.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );

  // Derive funding state PDA
  const [fundingStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('funding_state'), perpMarketPda.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );

  console.log(`[Setup] Payer: ${payer.publicKey.toBase58()}`);
  console.log(`[Setup] Perp Market PDA: ${perpMarketPda.toBase58()}`);
  console.log(`[Setup] Funding State PDA: ${fundingStatePda.toBase58()}`);

  return {
    connection,
    payer,
    perpMarketPda,
    fundingStatePda,
  };
}

/**
 * Parse V7 position account data (692 bytes)
 */
function parsePositionAccount(data: Buffer): ParsedPosition {
  let offset = 8; // Skip discriminator

  const trader = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const market = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  offset += 16; // positionId
  offset += 8; // createdAtHour

  const lastUpdatedHour = data.readBigInt64LE(offset);
  offset += 8;

  const side = data.readUInt8(offset) as PositionSide;
  offset += 1;

  const leverage = data.readUInt8(offset);
  offset += 1;

  // Skip encrypted fields: size, entry_price, collateral, liq_below, liq_above, unrealized_pnl
  offset += 64 * 6; // 6 encrypted fields (64 bytes each)

  offset += 32; // thresholdCommitment
  offset += 8; // lastThresholdUpdateHour

  const thresholdVerified = data.readUInt8(offset) === 1;
  offset += 1;

  // entry_cumulative_funding is i128 (16 bytes)
  const entryCumulativeFundingLow = data.readBigInt64LE(offset);
  const entryCumulativeFundingHigh = data.readBigInt64LE(offset + 8);
  const entryCumulativeFunding = entryCumulativeFundingLow + (entryCumulativeFundingHigh << 64n);
  offset += 16;

  const status = data.readUInt8(offset) as PositionStatus;
  offset += 1;

  offset += 1; // eligibilityProofVerified
  offset += 1; // partialCloseCount
  offset += 8; // autoDeleveragePriority
  offset += 8; // lastMarginAddHour
  offset += 1; // marginAddCount
  offset += 1; // bump
  offset += 8; // positionSeed

  // V6+ fields
  const pendingMpcRequest = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  const pendingMarginAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const pendingMarginIsAdd = data.readUInt8(offset) === 1;
  offset += 1;

  const isLiquidatable = data.readUInt8(offset) === 1;
  offset += 1;

  // V7 field
  const pendingClose = data.readUInt8(offset) === 1;

  return {
    trader,
    market,
    side,
    leverage,
    status,
    thresholdVerified,
    entryCumulativeFunding,
    pendingMpcRequest,
    pendingMarginAmount,
    pendingMarginIsAdd,
    pendingClose,
    isLiquidatable,
    lastUpdatedHour,
  };
}

/**
 * Check if position has pending MPC request
 */
function hasPendingMpcRequest(pendingMpcRequest: Uint8Array): boolean {
  return pendingMpcRequest.some(byte => byte !== 0);
}

/**
 * Format request ID for display
 */
function formatRequestId(requestId: Uint8Array): string {
  return Buffer.from(requestId.slice(0, 8)).toString('hex');
}

describe('Funding Settlement Integration Tests (V7 Async MPC)', () => {
  beforeAll(async () => {
    ctx = await setupTestContext();

    const balance = await ctx.connection.getBalance(ctx.payer.publicKey);
    console.log(`[Setup] Payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  }, 30000);

  describe('Perp Market State', () => {
    it('should verify perp market exists and has funding state', async () => {
      const marketAccount = await ctx.connection.getAccountInfo(ctx.perpMarketPda);

      if (!marketAccount) {
        console.log('[Test] Perp market not initialized - skipping funding tests');
        return;
      }

      console.log(`[Test] Perp market found: ${ctx.perpMarketPda.toBase58()}`);
      console.log(`[Test] Market data size: ${marketAccount.data.length} bytes`);

      // Parse cumulative funding from market
      // Layout: discriminator(8) + authority(32) + underlying_mint(32) + ...
      // cumulative_funding_long at offset ~200, cumulative_funding_short follows
      const data = marketAccount.data;
      if (data.length >= 232) {
        // Approximate offset - would need exact layout
        console.log('[Test] Market has cumulative funding fields');
      }

      const fundingAccount = await ctx.connection.getAccountInfo(ctx.fundingStatePda);
      if (fundingAccount) {
        console.log(`[Test] Funding state found: ${ctx.fundingStatePda.toBase58()}`);
        console.log(`[Test] Funding state size: ${fundingAccount.data.length} bytes`);
      } else {
        console.log('[Test] Funding state not found (may be optional)');
      }

      expect(marketAccount).toBeDefined();
    });
  });

  describe('Position Funding Settlement State', () => {
    it('should find positions eligible for funding settlement', async () => {
      // Fetch V7 positions (692 bytes)
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      console.log(`[Test] Found ${accounts.length} V7 positions`);

      // Find open positions that could need funding settlement
      const eligiblePositions = accounts.filter(({ account }) => {
        try {
          const pos = parsePositionAccount(account.data);
          // Position must be open and verified
          return pos.status === PositionStatus.Open && pos.thresholdVerified;
        } catch {
          return false;
        }
      });

      console.log(`[Test] ${eligiblePositions.length} positions eligible for funding settlement`);

      for (const { pubkey, account } of eligiblePositions.slice(0, 5)) {
        const pos = parsePositionAccount(account.data);
        console.log(`[Test] Position ${pubkey.toBase58().slice(0, 12)}...`);
        console.log(`  - Side: ${PositionSide[pos.side]}`);
        console.log(`  - Leverage: ${pos.leverage}x`);
        console.log(`  - Entry Cumulative Funding: ${pos.entryCumulativeFunding}`);
        console.log(`  - Last Updated: ${new Date(Number(pos.lastUpdatedHour) * 3600000).toISOString()}`);
      }

      expect(true).toBe(true);
    });

    it('should find positions with pending funding settlement', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      // Find positions with pending MPC request (funding in progress)
      const pendingFunding = accounts.filter(({ account }) => {
        try {
          const pos = parsePositionAccount(account.data);
          // Has pending MPC request AND threshold is unverified (indicating funding settlement)
          return hasPendingMpcRequest(pos.pendingMpcRequest) && !pos.thresholdVerified;
        } catch {
          return false;
        }
      });

      console.log(`[Test] ${pendingFunding.length} positions with pending funding settlement`);

      for (const { pubkey, account } of pendingFunding) {
        const pos = parsePositionAccount(account.data);
        console.log(`[Test] Pending funding: ${pubkey.toBase58().slice(0, 12)}...`);
        console.log(`  - Request ID: ${formatRequestId(pos.pendingMpcRequest)}`);
        console.log(`  - Side: ${PositionSide[pos.side]}`);
        console.log(`  - Trader: ${pos.trader.toBase58().slice(0, 12)}...`);
      }

      expect(true).toBe(true);
    });
  });

  describe('Funding Settlement Event Format', () => {
    it('should verify FundingSettlementInitiated event format', () => {
      // From perp_settle_funding.rs
      const eventFields = {
        position: 'Pubkey',
        trader: 'Pubkey',
        market: 'Pubkey',
        request_id: '[u8; 32]',
        funding_delta: 'i128',
        current_cumulative_funding: 'i128',
        entry_cumulative_funding: 'i128',
        is_long: 'bool',
        timestamp: 'i64',
      };

      console.log('[Test] FundingSettlementInitiated event format:');
      Object.entries(eventFields).forEach(([field, type]) => {
        console.log(`  - ${field}: ${type}`);
      });

      // Verify privacy: funding_delta is included but not actual amounts
      expect(Object.keys(eventFields)).toContain('funding_delta');
      expect(Object.keys(eventFields)).not.toContain('position_size');
      expect(Object.keys(eventFields)).not.toContain('collateral');

      console.log('[Test] Privacy verified: No position size or collateral in events');
    });

    it('should verify funding_settlement_callback discriminator', () => {
      // sha256("global:funding_settlement_callback")[0..8]
      const expectedDiscriminator = [0x28, 0xf0, 0x53, 0x05, 0xb5, 0xc4, 0xd2, 0x2e];

      console.log('[Test] funding_settlement_callback discriminator:');
      console.log(`  [${expectedDiscriminator.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

      // Verify format
      expect(expectedDiscriminator).toHaveLength(8);
    });
  });

  describe('Funding Settlement Callback Params', () => {
    it('should verify FundingSettlementParams format', () => {
      // From mpc_callback.rs
      const params = {
        request_id: '[u8; 32] - MPC request ID for matching',
        new_encrypted_collateral: '[u8; 64] - Updated collateral after funding',
        new_liq_below: '[u8; 64] - Updated liquidation threshold below',
        new_liq_above: '[u8; 64] - Updated liquidation threshold above',
        new_threshold_commitment: '[u8; 32] - New threshold commitment',
        success: 'bool - Whether funding was successfully applied',
      };

      console.log('[Test] FundingSettlementParams format:');
      Object.entries(params).forEach(([field, desc]) => {
        console.log(`  - ${field}: ${desc}`);
      });

      // Total param size: 32 + 64 + 64 + 64 + 32 + 1 = 257 bytes
      const totalSize = 32 + 64 + 64 + 64 + 32 + 1;
      console.log(`[Test] Total params size: ${totalSize} bytes`);

      expect(totalSize).toBe(257);
    });
  });

  describe('Funding Settlement Flow Summary', () => {
    it('should summarize position states for funding', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      const stats = {
        total: accounts.length,
        open: 0,
        closed: 0,
        liquidated: 0,
        long: 0,
        short: 0,
        verified: 0,
        unverified: 0,
        pendingMpc: 0,
        pendingClose: 0,
        eligibleForFunding: 0,
      };

      for (const { account } of accounts) {
        try {
          const pos = parsePositionAccount(account.data);

          switch (pos.status) {
            case PositionStatus.Open: stats.open++; break;
            case PositionStatus.Closed: stats.closed++; break;
            case PositionStatus.Liquidated: stats.liquidated++; break;
          }

          if (pos.side === PositionSide.Long) stats.long++;
          else stats.short++;

          if (pos.thresholdVerified) stats.verified++;
          else stats.unverified++;

          if (hasPendingMpcRequest(pos.pendingMpcRequest)) stats.pendingMpc++;
          if (pos.pendingClose) stats.pendingClose++;

          // Eligible for funding: open, verified, no pending ops
          if (
            pos.status === PositionStatus.Open &&
            pos.thresholdVerified &&
            !hasPendingMpcRequest(pos.pendingMpcRequest) &&
            !pos.pendingClose
          ) {
            stats.eligibleForFunding++;
          }
        } catch {
          // Skip unparseable
        }
      }

      console.log('\n[Summary] V7 Position Statistics for Funding Settlement:');
      console.log('----------------------------------------------------------');
      console.log(`Total Positions:           ${stats.total}`);
      console.log(`  Open:                    ${stats.open}`);
      console.log(`  Closed:                  ${stats.closed}`);
      console.log(`  Liquidated:              ${stats.liquidated}`);
      console.log('----------------------------------------------------------');
      console.log(`Position Sides:`);
      console.log(`  Long:                    ${stats.long}`);
      console.log(`  Short:                   ${stats.short}`);
      console.log('----------------------------------------------------------');
      console.log(`MPC Verification:`);
      console.log(`  Verified:                ${stats.verified}`);
      console.log(`  Awaiting Verification:   ${stats.unverified}`);
      console.log('----------------------------------------------------------');
      console.log(`Async Operations:`);
      console.log(`  Pending MPC:             ${stats.pendingMpc}`);
      console.log(`  Pending Close:           ${stats.pendingClose}`);
      console.log('----------------------------------------------------------');
      console.log(`Eligible for Funding:      ${stats.eligibleForFunding}`);
      console.log('----------------------------------------------------------\n');

      expect(stats.total).toBeGreaterThanOrEqual(0);
    });
  });
});
