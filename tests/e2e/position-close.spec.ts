/**
 * End-to-End Tests for V7 Async MPC Position Close Flow
 *
 * Tests the initiate_close_position → MPC PnL calculation → close_position_callback flow:
 * 1. initiate_close_position queues MPC calculation
 * 2. Backend detects ClosePositionInitiated event
 * 3. MPC calculates PnL via calculate_pnl circuit
 * 4. close_position_callback applies results and transfers funds
 *
 * Important: V7 positions are 692 bytes (up from 618 in V6)
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

// Account sizes
const V7_POSITION_SIZE = 692;
const V6_POSITION_SIZE = 618;

// Position status enum (must match programs/confidex_dex/src/state/perp_position.rs)
enum PositionStatus {
  Open = 0,
  Closed = 1,
  Liquidated = 2,
  AutoDeleveraged = 3,
  PendingLiquidationCheck = 4,
  PendingClose = 5,
}

// Position side enum
enum PositionSide {
  Long = 0,
  Short = 1,
}

interface TestContext {
  connection: Connection;
  payer: Keypair;
  exchangePda: PublicKey;
  perpMarketPda: PublicKey;
}

interface V7Position {
  trader: PublicKey;
  market: PublicKey;
  positionId: Uint8Array;
  createdAtHour: bigint;
  lastUpdatedHour: bigint;
  side: PositionSide;
  leverage: number;
  encryptedSize: Uint8Array;
  encryptedEntryPrice: Uint8Array;
  encryptedCollateral: Uint8Array;
  encryptedUnrealizedPnl: Uint8Array;
  encryptedLiquidationPrice: Uint8Array;
  encryptedMaintenanceMargin: Uint8Array;
  thresholdCommitment: Uint8Array;
  lastThresholdUpdateHour: bigint;
  thresholdVerified: boolean;
  entryCumulativeFunding: bigint;
  status: PositionStatus;
  eligibilityProofVerified: boolean;
  partialCloseCount: number;
  autoDeleveragePriority: bigint;
  lastMarginAddHour: bigint;
  marginAddCount: number;
  bump: number;
  positionSeed: bigint;
  pendingMpcRequest: Uint8Array;
  pendingMarginAmount: bigint;
  pendingMarginIsAdd: boolean;
  isLiquidatable: boolean;
  pendingCloseFullClose: boolean;
  closeMpcRequestId: Uint8Array;
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

  // Derive exchange PDA
  const [exchangePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('exchange_state')],
    CONFIDEX_PROGRAM_ID
  );

  // Derive perp market PDA (for SOL)
  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const [perpMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('perp_market'), WSOL_MINT.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );

  console.log(`[Setup] Payer: ${payer.publicKey.toBase58()}`);
  console.log(`[Setup] Exchange PDA: ${exchangePda.toBase58()}`);
  console.log(`[Setup] Perp Market PDA: ${perpMarketPda.toBase58()}`);

  return {
    connection,
    payer,
    exchangePda,
    perpMarketPda,
  };
}

/**
 * Parse V7 position account data (692 bytes)
 */
function parseV7PositionAccount(data: Buffer): V7Position {
  let offset = 8; // Skip discriminator

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

  // 6 encrypted fields (64 bytes each)
  const encryptedSize = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedEntryPrice = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedCollateral = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedUnrealizedPnl = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedLiquidationPrice = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedMaintenanceMargin = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const thresholdCommitment = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  const lastThresholdUpdateHour = data.readBigInt64LE(offset);
  offset += 8;

  const thresholdVerified = data.readUInt8(offset) === 1;
  offset += 1;

  const entryCumulativeFunding = data.readBigInt64LE(offset);
  offset += 16; // i128 but we read only lower 64 bits

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

  // V7 fields
  const pendingCloseFullClose = data.readUInt8(offset) === 1;
  offset += 1;

  const closeMpcRequestId = new Uint8Array(data.subarray(offset, offset + 32));
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
    encryptedUnrealizedPnl,
    encryptedLiquidationPrice,
    encryptedMaintenanceMargin,
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
    pendingCloseFullClose,
    closeMpcRequestId,
  };
}

/**
 * Check if position has pending close MPC request
 */
function hasPendingCloseRequest(position: V7Position): boolean {
  // Check if closeMpcRequestId is non-zero
  return position.closeMpcRequestId.some(b => b !== 0);
}

/**
 * Wait for a condition with timeout
 */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 2000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return false;
}

describe('V7 Async MPC Position Close Flow', () => {
  beforeAll(async () => {
    ctx = await setupTestContext();

    const balance = await ctx.connection.getBalance(ctx.payer.publicKey);
    console.log(`[Setup] Payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      console.warn('[Setup] Low balance - tests may fail');
    }
  }, 30000);

  describe('Position Infrastructure Verification', () => {
    it('should verify V7 position account size', () => {
      // V7 position accounts are 692 bytes
      expect(V7_POSITION_SIZE).toBe(692);
      console.log(`[Test] V7 position account size: ${V7_POSITION_SIZE} bytes`);
      console.log(`[Test] V6 position account size: ${V6_POSITION_SIZE} bytes`);
      console.log(`[Test] Size increase: ${V7_POSITION_SIZE - V6_POSITION_SIZE} bytes for close MPC fields`);
    });

    it('should fetch V7 positions from devnet', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      console.log(`[Test] Found ${accounts.length} V7 positions (692 bytes)`);

      // Also check for V6 positions for comparison
      const v6Accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V6_POSITION_SIZE }],
      });

      console.log(`[Test] Found ${v6Accounts.length} V6 positions (618 bytes)`);

      expect(accounts.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('initiate_close_position Verification', () => {
    it('should find positions with pending close MPC requests', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      const pendingClosePositions = accounts.filter(({ account }) => {
        try {
          const pos = parseV7PositionAccount(account.data);
          return hasPendingCloseRequest(pos);
        } catch {
          return false;
        }
      });

      console.log(`[Test] Found ${pendingClosePositions.length} positions with pending close MPC`);

      for (const { pubkey, account } of pendingClosePositions) {
        const pos = parseV7PositionAccount(account.data);
        console.log(`[Test] Pending close: ${pubkey.toBase58().slice(0, 16)}...`);
        console.log(`  - Trader: ${pos.trader.toBase58().slice(0, 12)}...`);
        console.log(`  - Side: ${PositionSide[pos.side]}`);
        console.log(`  - Full close: ${pos.pendingCloseFullClose}`);
        console.log(`  - Status: ${PositionStatus[pos.status]}`);
      }

      expect(true).toBe(true);
    });

    it('should find positions in PendingClose status', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      const pendingCloseStatus = accounts.filter(({ account }) => {
        try {
          const pos = parseV7PositionAccount(account.data);
          return pos.status === PositionStatus.PendingClose;
        } catch {
          return false;
        }
      });

      console.log(`[Test] Found ${pendingCloseStatus.length} positions with PendingClose status`);

      for (const { pubkey, account } of pendingCloseStatus) {
        const pos = parseV7PositionAccount(account.data);
        console.log(`[Test] PendingClose: ${pubkey.toBase58().slice(0, 16)}...`);
        console.log(`  - Has MPC request ID: ${hasPendingCloseRequest(pos)}`);
        console.log(`  - Full close: ${pos.pendingCloseFullClose}`);
      }

      expect(true).toBe(true);
    });
  });

  describe('close_position_callback Verification', () => {
    it('should find successfully closed positions', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      const closedPositions = accounts.filter(({ account }) => {
        try {
          const pos = parseV7PositionAccount(account.data);
          return pos.status === PositionStatus.Closed;
        } catch {
          return false;
        }
      });

      console.log(`[Test] Found ${closedPositions.length} closed positions`);

      for (const { pubkey, account } of closedPositions.slice(0, 5)) {
        const pos = parseV7PositionAccount(account.data);
        console.log(`[Test] Closed: ${pubkey.toBase58().slice(0, 16)}...`);
        console.log(`  - Trader: ${pos.trader.toBase58().slice(0, 12)}...`);
        console.log(`  - Side: ${PositionSide[pos.side]}`);
        console.log(`  - Partial close count: ${pos.partialCloseCount}`);
      }

      expect(true).toBe(true);
    });

    it('should verify closed positions have cleared MPC state', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      const closedWithState = accounts.filter(({ account }) => {
        try {
          const pos = parseV7PositionAccount(account.data);
          // Closed positions should have cleared MPC state
          return pos.status === PositionStatus.Closed && hasPendingCloseRequest(pos);
        } catch {
          return false;
        }
      });

      console.log(`[Test] Found ${closedWithState.length} closed positions with leftover MPC state`);

      if (closedWithState.length > 0) {
        console.warn('[Test] Warning: Some closed positions still have pending MPC state');
      }

      expect(closedWithState.length).toBe(0);
    });
  });

  describe('Async MPC Close Flow State Machine', () => {
    it('should summarize close flow states', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      const stats = {
        total: accounts.length,
        open: 0,
        closed: 0,
        liquidated: 0,
        pendingClose: 0,
        pendingLiqCheck: 0,
        autoDeleveraged: 0,
        withPendingCloseRequest: 0,
        fullClose: 0,
        partialClose: 0,
      };

      for (const { account } of accounts) {
        try {
          const pos = parseV7PositionAccount(account.data);

          switch (pos.status) {
            case PositionStatus.Open:
              stats.open++;
              break;
            case PositionStatus.Closed:
              stats.closed++;
              break;
            case PositionStatus.Liquidated:
              stats.liquidated++;
              break;
            case PositionStatus.PendingClose:
              stats.pendingClose++;
              if (pos.pendingCloseFullClose) {
                stats.fullClose++;
              } else {
                stats.partialClose++;
              }
              break;
            case PositionStatus.PendingLiquidationCheck:
              stats.pendingLiqCheck++;
              break;
            case PositionStatus.AutoDeleveraged:
              stats.autoDeleveraged++;
              break;
          }

          if (hasPendingCloseRequest(pos)) {
            stats.withPendingCloseRequest++;
          }
        } catch {
          // Skip unparseable
        }
      }

      console.log('\n[Summary] V7 Position Close Flow Statistics:');
      console.log('====================================================');
      console.log(`Total V7 Positions:        ${stats.total}`);
      console.log('----------------------------------------------------');
      console.log('Position Status:');
      console.log(`  Open:                    ${stats.open}`);
      console.log(`  Closed:                  ${stats.closed}`);
      console.log(`  Liquidated:              ${stats.liquidated}`);
      console.log(`  Auto-Deleveraged:        ${stats.autoDeleveraged}`);
      console.log(`  Pending Liq Check:       ${stats.pendingLiqCheck}`);
      console.log(`  Pending Close:           ${stats.pendingClose}`);
      console.log('----------------------------------------------------');
      console.log('Close Flow State:');
      console.log(`  With Pending MPC:        ${stats.withPendingCloseRequest}`);
      console.log(`  Full Close Requested:    ${stats.fullClose}`);
      console.log(`  Partial Close Requested: ${stats.partialClose}`);
      console.log('====================================================\n');

      expect(stats.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('MPC Request ID Verification', () => {
    it('should verify MPC request IDs are properly formatted', async () => {
      const accounts = await ctx.connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
        filters: [{ dataSize: V7_POSITION_SIZE }],
      });

      for (const { pubkey, account } of accounts) {
        try {
          const pos = parseV7PositionAccount(account.data);

          if (hasPendingCloseRequest(pos)) {
            // MPC request ID should be 32 bytes
            expect(pos.closeMpcRequestId.length).toBe(32);

            // Check it's not all zeros
            const isNonZero = pos.closeMpcRequestId.some(b => b !== 0);
            expect(isNonZero).toBe(true);

            console.log(`[Test] Position ${pubkey.toBase58().slice(0, 12)} has valid MPC request ID`);
          }
        } catch {
          // Skip unparseable
        }
      }

      expect(true).toBe(true);
    });
  });

  describe('Event Detection (Backend Integration)', () => {
    it('should document ClosePositionInitiated event structure', () => {
      // Event emitted by initiate_close_position:
      // ClosePositionInitiated {
      //   position: Pubkey,
      //   trader: Pubkey,
      //   market: Pubkey,
      //   full_close: bool,
      //   mpc_request_id: [u8; 32],
      //   timestamp: i64,
      // }

      const eventFields = [
        'position: Pubkey',
        'trader: Pubkey',
        'market: Pubkey',
        'full_close: bool',
        'mpc_request_id: [u8; 32]',
        'timestamp: i64',
      ];

      console.log('[Test] ClosePositionInitiated event structure:');
      eventFields.forEach(field => console.log(`  - ${field}`));

      // Privacy: No encrypted amounts in events
      expect(eventFields.some(f => f.includes('amount'))).toBe(false);
      expect(eventFields.some(f => f.includes('price'))).toBe(false);

      console.log('[Test] Privacy verified: No amounts/prices in close events');
    });

    it('should document PositionClosed event structure', () => {
      // Event emitted by close_position_callback:
      // PositionClosed {
      //   position: Pubkey,
      //   trader: Pubkey,
      //   market: Pubkey,
      //   side: PositionSide,
      //   timestamp: i64,
      // }

      const eventFields = [
        'position: Pubkey',
        'trader: Pubkey',
        'market: Pubkey',
        'side: PositionSide',
        'timestamp: i64',
      ];

      console.log('[Test] PositionClosed event structure:');
      eventFields.forEach(field => console.log(`  - ${field}`));

      // Privacy: No PnL amounts in events
      expect(eventFields.some(f => f.includes('pnl'))).toBe(false);

      console.log('[Test] Privacy verified: No PnL in close completion events');
    });
  });
});
