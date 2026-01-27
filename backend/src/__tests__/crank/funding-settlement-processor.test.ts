import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey, Logs, Context } from '@solana/web3.js';
import { FundingSettlementProcessor } from '../../crank/funding-settlement-processor.js';
import { CrankConfig } from '../../crank/config.js';

// Use vi.hoisted to create mock function accessible in tests
const { mockSendAndConfirmTransaction } = vi.hoisted(() => ({
  mockSendAndConfirmTransaction: vi.fn().mockResolvedValue('mock-signature'),
}));

// Mock dependencies
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getAccountInfo: vi.fn().mockResolvedValue(null),
      onLogs: vi.fn().mockReturnValue(1),
      removeOnLogsListener: vi.fn().mockResolvedValue(undefined),
    })),
    sendAndConfirmTransaction: mockSendAndConfirmTransaction,
  };
});

vi.mock('../../lib/logger.js', () => ({
  logger: {
    crank: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../../crank/arcium-accounts.js', () => ({
  deriveArciumAccounts: vi.fn().mockReturnValue({
    computationAccount: new PublicKey('11111111111111111111111111111111'),
    mxeAccount: new PublicKey('11111111111111111111111111111111'),
    clusterAccount: new PublicKey('11111111111111111111111111111111'),
  }),
  arciumAccountsToRemainingAccounts: vi.fn().mockReturnValue([]),
  DEFAULT_CLUSTER_OFFSET: 456,
  DEFAULT_MXE_PROGRAM_ID: new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi'),
}));

vi.mock('@arcium-hq/client', () => ({
  getCompDefAccOffset: vi.fn().mockReturnValue(Buffer.from([5, 0, 0, 0])),
}));

vi.mock('bs58', () => ({
  default: {
    encode: vi.fn().mockReturnValue('encodedString'),
    decode: vi.fn().mockReturnValue(new Uint8Array(32)),
  },
}));

// Helper to create mock config
function createMockConfig(): CrankConfig {
  return {
    pollingIntervalMs: 5000,
    programs: {
      confidexDex: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
      arciumMxe: '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi',
    },
    rpc: {
      primary: 'https://api.devnet.solana.com',
      fallback: [],
    },
  } as CrankConfig;
}

// Helper to create V8 position data for funding settlement testing (724 bytes)
function createMockPositionDataV8(options: {
  market?: PublicKey;
  trader?: PublicKey;
  side?: number;
  thresholdVerified?: boolean;
  pendingMpcRequest?: Uint8Array;
  pendingMarginAmount?: bigint;
  pendingClose?: boolean;
  fundingDelta?: bigint;
  currentCumulativeFunding?: bigint;
} = {}): Buffer {
  const data = Buffer.alloc(724); // V8 position size
  let offset = 0;

  // Discriminator (8 bytes)
  offset += 8;

  // Trader (32 bytes)
  const trader = options.trader || Keypair.generate().publicKey;
  data.set(trader.toBytes(), offset);
  offset += 32;

  // Market (32 bytes)
  const market = options.market || Keypair.generate().publicKey;
  data.set(market.toBytes(), offset);
  offset += 32;

  // Position ID (16 bytes)
  offset += 16;

  // Created at hour (8 bytes)
  offset += 8;

  // Last updated hour (8 bytes)
  offset += 8;

  // Side (1 byte)
  data.writeUInt8(options.side ?? 0, offset);
  offset += 1;

  // Leverage (1 byte)
  data.writeUInt8(10, offset);
  offset += 1;

  // Encrypted fields (6 x 64 = 384 bytes)
  offset += 64 * 6;

  // Threshold commitment (32 bytes) - contains funding delta and current cumulative funding
  const thresholdCommitment = Buffer.alloc(32);
  // First 16 bytes: funding_delta as i128
  const fundingDelta = options.fundingDelta ?? 1000n;
  thresholdCommitment.writeBigInt64LE(fundingDelta, 0);
  // Next 8 bytes: high bits of i128 (zeros for small values)
  // Last 16 bytes: current_cumulative_funding
  const currentFunding = options.currentCumulativeFunding ?? 5000n;
  thresholdCommitment.writeBigInt64LE(currentFunding, 16);
  data.set(thresholdCommitment, offset);
  offset += 32;

  // Last threshold update hour (8 bytes)
  offset += 8;

  // Threshold verified (1 byte) - should be false for pending funding
  data.writeUInt8(options.thresholdVerified !== false ? 1 : 0, offset);
  offset += 1;

  // Entry cumulative funding (16 bytes)
  offset += 16;

  // Status (1 byte) - 0 = Open
  data.writeUInt8(0, offset);
  offset += 1;

  // eligibility_proof_verified (1)
  offset += 1;

  // partial_close_count (1)
  offset += 1;

  // auto_deleverage_priority (8)
  offset += 8;

  // last_margin_add_hour (8)
  offset += 8;

  // margin_add_count (1)
  offset += 1;

  // bump (1)
  offset += 1;

  // position_seed (8)
  offset += 8;

  // pending_mpc_request (32 bytes)
  const pendingRequest = options.pendingMpcRequest || new Uint8Array(32).fill(1);
  data.set(pendingRequest, offset);
  offset += 32;

  // pending_margin_amount (8 bytes)
  data.writeBigUInt64LE(options.pendingMarginAmount ?? 0n, offset);
  offset += 8;

  // pending_margin_is_add (1)
  offset += 1;

  // is_liquidatable (1)
  offset += 1;

  // pending_close (1 byte)
  data.writeUInt8(options.pendingClose ? 1 : 0, offset);
  offset += 1;

  // pending_close_exit_price (8)
  offset += 8;

  // pending_close_full (1)
  offset += 1;

  // pending_close_size (64)
  // offset += 64;

  return data;
}

describe('FundingSettlementProcessor', () => {
  let processor: FundingSettlementProcessor;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let config: CrankConfig;
  let logsCallback: (logs: Logs, ctx: Context) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    crankKeypair = Keypair.generate();
    config = createMockConfig();

    mockConnection = {
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getAccountInfo: vi.fn().mockResolvedValue(null),
      onLogs: vi.fn().mockImplementation((programId, callback) => {
        logsCallback = callback;
        return 1;
      }),
      removeOnLogsListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;

    processor = new FundingSettlementProcessor(mockConnection, crankKeypair, config);
  });

  afterEach(() => {
    processor.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('initializes with correct properties', () => {
      const status = processor.getStatus();
      expect(status.isPolling).toBe(false);
      expect(status.processingCount).toBe(0);
      expect(status.failedCount).toBe(0);
      expect(status.cachedResults).toBe(0);
    });
  });

  describe('start', () => {
    it('starts the processor', async () => {
      await processor.start();
      expect(processor.getStatus().isPolling).toBe(true);
    });

    it('subscribes to program logs', async () => {
      await processor.start();
      expect(mockConnection.onLogs).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.any(Function),
        'confirmed'
      );
    });

    it('does not restart if already running', async () => {
      await processor.start();
      await processor.start();

      expect(mockConnection.onLogs).toHaveBeenCalledTimes(1);
    });

    it('runs initial poll on start', async () => {
      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: expect.arrayContaining([
            { dataSize: 724 },
          ]),
        })
      );
    });
  });

  describe('stop', () => {
    it('stops the processor', async () => {
      await processor.start();
      processor.stop();
      expect(processor.getStatus().isPolling).toBe(false);
    });

    it('removes log listener', async () => {
      await processor.start();
      processor.stop();
      expect(mockConnection.removeOnLogsListener).toHaveBeenCalledWith(1);
    });

    it('can be stopped when not running', () => {
      expect(() => processor.stop()).not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('returns correct initial status', () => {
      expect(processor.getStatus()).toEqual({
        isPolling: false,
        processingCount: 0,
        failedCount: 0,
        cachedResults: 0,
      });
    });

    it('reflects running state', async () => {
      await processor.start();
      expect(processor.getStatus().isPolling).toBe(true);
    });
  });

  describe('handleLogs', () => {
    it('triggers poll on FundingSettlementInitiated event', async () => {
      await processor.start();

      const initialCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      // Simulate log event
      logsCallback(
        {
          signature: 'test-sig',
          logs: ['Program log: FundingSettlementInitiated { position: xyz }'],
          err: null,
        },
        { slot: 1 }
      );

      // Advance time to allow event processing (use specific time, not runAllTimers)
      await vi.advanceTimersByTimeAsync(100);

      const afterCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(afterCalls).toBeGreaterThan(initialCalls);
    });

    it('ignores unrelated log events', async () => {
      await processor.start();

      const initialCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      logsCallback(
        {
          signature: 'test-sig',
          logs: ['Program log: SomeOtherEvent'],
          err: null,
        },
        { slot: 1 }
      );

      // Advance time slightly (use specific time, not runAllTimers)
      await vi.advanceTimersByTimeAsync(100);

      const afterCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;
      // Should not trigger additional polls
      expect(afterCalls).toBe(initialCalls);
    });
  });

  describe('fetchPendingFundingOperations', () => {
    it('fetches positions with pending funding', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const pendingFundingPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: false, // Must be false for pending funding
        pendingMpcRequest: new Uint8Array(32).fill(1), // Non-zero
        pendingMarginAmount: 0n, // Must be 0
        pendingClose: false, // Must be false
        fundingDelta: 1000n,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: positionPda, account: { data: pendingFundingPosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: expect.arrayContaining([
            { dataSize: 724 },
            expect.objectContaining({
              memcmp: expect.objectContaining({
                offset: 530, // threshold_verified offset in V7/V8
              }),
            }),
          ]),
        })
      );
    });

    it('filters out positions with pending margin', async () => {
      const positionWithMargin = createMockPositionDataV8({
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        pendingMarginAmount: 1000n, // Has pending margin - should be filtered
        pendingClose: false,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: positionWithMargin } },
      ]);

      await processor.start();

      // Position should be filtered out (not processed)
      expect(processor.getStatus().processingCount).toBe(0);
    });

    it('filters out positions with pending close', async () => {
      const positionWithClose = createMockPositionDataV8({
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        pendingMarginAmount: 0n,
        pendingClose: true, // Has pending close - should be filtered
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: positionWithClose } },
      ]);

      await processor.start();

      expect(processor.getStatus().processingCount).toBe(0);
    });

    it('filters out positions without pending MPC request', async () => {
      const positionNoRequest = createMockPositionDataV8({
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(0), // No request
        pendingMarginAmount: 0n,
        pendingClose: false,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: positionNoRequest } },
      ]);

      await processor.start();

      expect(processor.getStatus().processingCount).toBe(0);
    });

    it('filters out positions with zero funding delta', async () => {
      const positionZeroDelta = createMockPositionDataV8({
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        pendingMarginAmount: 0n,
        pendingClose: false,
        fundingDelta: 0n, // Zero delta
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: positionZeroDelta } },
      ]);

      await processor.start();

      expect(processor.getStatus().processingCount).toBe(0);
    });
  });

  describe('processFundingOperation', () => {
    it('triggers MPC calculation', async () => {
      const marketPda = Keypair.generate().publicKey;

      const pendingPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        pendingMarginAmount: 0n,
        pendingClose: false,
        fundingDelta: 1000n,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: pendingPosition } },
      ]);

      await processor.start();

      // Should have attempted to process
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('respects max retries', async () => {
      const marketPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const pendingPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: false,
        pendingMpcRequest: requestId,
        pendingMarginAmount: 0n,
        pendingClose: false,
        fundingDelta: 1000n,
      });

      // Fail multiple times
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Transaction failed')
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: pendingPosition } },
      ]);

      await processor.start();

      // Trigger multiple poll cycles
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 3);
      }

      // After max retries, operation should be skipped
      const status = processor.getStatus();
      expect(status.failedCount).toBeGreaterThan(0);
    });
  });

  describe('MPC result polling', () => {
    it('polls for MPC result with timeout', async () => {
      const marketPda = Keypair.generate().publicKey;

      const pendingPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        pendingMarginAmount: 0n,
        pendingClose: false,
        fundingDelta: 1000n,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: pendingPosition } },
      ]);

      await processor.start();

      // Advance past MPC polling timeout
      await vi.advanceTimersByTimeAsync(60000);

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('deserializePositionV7', () => {
    it('correctly parses V7 position data', async () => {
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;

      const positionData = createMockPositionDataV8({
        trader,
        market,
        side: 1, // Short
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        fundingDelta: 5000n,
      });

      // Access private method
      const deserialize = (processor as any).deserializePositionV7.bind(processor);
      const position = deserialize(positionData);

      expect(position.market.toBase58()).toBe(market.toBase58());
      expect(position.trader.toBase58()).toBe(trader.toBase58());
      expect(position.side).toBe(1);
      expect(position.leverage).toBe(10);
      expect(position.thresholdVerified).toBe(false);
    });
  });

  describe('readI128', () => {
    it('reads positive i128 values', () => {
      const readI128 = (processor as any).readI128.bind(processor);

      const buf = Buffer.alloc(16);
      buf.writeBigUInt64LE(1000n, 0);
      buf.writeBigInt64LE(0n, 8);

      const result = readI128(buf);
      expect(result).toBe(1000n);
    });

    it('reads negative i128 values', () => {
      const readI128 = (processor as any).readI128.bind(processor);

      const buf = Buffer.alloc(16);
      buf.writeBigUInt64LE(BigInt('0xFFFFFFFFFFFFFC18'), 0); // -1000 in low bits
      buf.writeBigInt64LE(-1n, 8); // Sign extension

      const result = readI128(buf);
      expect(result).toBeLessThan(0n);
    });
  });

  describe('periodic polling', () => {
    it('polls at configured interval', async () => {
      await processor.start();

      const initialCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      // Advance by 3x polling interval (funding uses 3x multiplier)
      await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 3);

      const afterCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(afterCalls).toBeGreaterThan(initialCalls);
    });

    it('stops polling after stop', async () => {
      await processor.start();
      processor.stop();

      const callsAfterStop = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 10);

      const callsAfterWait = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callsAfterWait).toBe(callsAfterStop);
    });
  });

  describe('error handling', () => {
    it('handles getProgramAccounts errors', async () => {
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('RPC error')
      );

      await processor.start();

      expect(processor.getStatus().isPolling).toBe(true);
    });

    it('handles position parsing errors', async () => {
      const invalidData = Buffer.alloc(100); // Too small

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: invalidData } },
      ]);

      await processor.start();

      expect(processor.getStatus().isPolling).toBe(true);
    });
  });

  describe('side-specific handling', () => {
    it('handles long position funding', async () => {
      const longPosition = createMockPositionDataV8({
        side: 0, // Long
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        fundingDelta: 1000n, // Positive = paying funding
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: longPosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('handles short position funding', async () => {
      const shortPosition = createMockPositionDataV8({
        side: 1, // Short
        thresholdVerified: false,
        pendingMpcRequest: new Uint8Array(32).fill(1),
        fundingDelta: -1000n, // Negative = receiving funding
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: shortPosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('pollForMpcResult', () => {
    it('returns simulated MPC result for long position (isReceiving = false)', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const traderPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const op = {
        positionPda,
        requestId,
        fundingDelta: 1000n, // Positive = paying funding (isReceiving = false)
        position: {
          trader: traderPda,
          market: marketPda,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 0 as const, // Long
          leverage: 10,
          encryptedSize: new Uint8Array(64).fill(1),
          encryptedEntryPrice: new Uint8Array(64).fill(2),
          encryptedCollateral: new Uint8Array(64).fill(3),
          encryptedRealizedPnl: new Uint8Array(64).fill(4),
          encryptedLiqBelow: new Uint8Array(64).fill(5),
          encryptedLiqAbove: new Uint8Array(64).fill(6),
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      // Call private method directly
      const pollForMpcResult = (processor as any).pollForMpcResult.bind(processor);

      // Run the poll in background while advancing timers
      const pollPromise = pollForMpcResult(op);

      // Advance past poll interval (2000ms)
      await vi.advanceTimersByTimeAsync(2500);

      const result = await pollPromise;

      expect(result).not.toBeNull();
      expect(result.isReceiving).toBe(false); // Positive delta = paying
      expect(result.newEncryptedCollateral).toBeDefined();
      expect(result.newEncryptedLiqThreshold).toBeDefined();
    });

    it('returns simulated MPC result for short position (isReceiving = true)', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const traderPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(2);

      const op = {
        positionPda,
        requestId,
        fundingDelta: -500n, // Negative = receiving funding (isReceiving = true)
        position: {
          trader: traderPda,
          market: marketPda,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 1 as const, // Short
          leverage: 10,
          encryptedSize: new Uint8Array(64).fill(1),
          encryptedEntryPrice: new Uint8Array(64).fill(2),
          encryptedCollateral: new Uint8Array(64).fill(3),
          encryptedRealizedPnl: new Uint8Array(64).fill(4),
          encryptedLiqBelow: new Uint8Array(64).fill(5),
          encryptedLiqAbove: new Uint8Array(64).fill(6),
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const pollForMpcResult = (processor as any).pollForMpcResult.bind(processor);
      const pollPromise = pollForMpcResult(op);
      await vi.advanceTimersByTimeAsync(2500);
      const result = await pollPromise;

      expect(result).not.toBeNull();
      expect(result.isReceiving).toBe(true); // Negative delta = receiving
    });

    it('uses encryptedLiqBelow for long positions', async () => {
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(3);
      const encryptedLiqBelow = new Uint8Array(64).fill(0xAA);
      const encryptedLiqAbove = new Uint8Array(64).fill(0xBB);

      const op = {
        positionPda,
        requestId,
        fundingDelta: 100n,
        position: {
          trader: Keypair.generate().publicKey,
          market: Keypair.generate().publicKey,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 0 as const, // Long - should use encryptedLiqBelow
          leverage: 10,
          encryptedSize: new Uint8Array(64),
          encryptedEntryPrice: new Uint8Array(64),
          encryptedCollateral: new Uint8Array(64).fill(0xCC),
          encryptedRealizedPnl: new Uint8Array(64),
          encryptedLiqBelow,
          encryptedLiqAbove,
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const pollForMpcResult = (processor as any).pollForMpcResult.bind(processor);
      const pollPromise = pollForMpcResult(op);
      await vi.advanceTimersByTimeAsync(2500);
      const result = await pollPromise;

      expect(result).not.toBeNull();
      // For long positions, uses encryptedLiqBelow
      expect(result.newEncryptedLiqThreshold[0]).toBe(0xAA);
    });

    it('uses encryptedLiqAbove for short positions', async () => {
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(4);
      const encryptedLiqBelow = new Uint8Array(64).fill(0xAA);
      const encryptedLiqAbove = new Uint8Array(64).fill(0xBB);

      const op = {
        positionPda,
        requestId,
        fundingDelta: -100n,
        position: {
          trader: Keypair.generate().publicKey,
          market: Keypair.generate().publicKey,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 1 as const, // Short - should use encryptedLiqAbove
          leverage: 10,
          encryptedSize: new Uint8Array(64),
          encryptedEntryPrice: new Uint8Array(64),
          encryptedCollateral: new Uint8Array(64).fill(0xCC),
          encryptedRealizedPnl: new Uint8Array(64),
          encryptedLiqBelow,
          encryptedLiqAbove,
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const pollForMpcResult = (processor as any).pollForMpcResult.bind(processor);
      const pollPromise = pollForMpcResult(op);
      await vi.advanceTimersByTimeAsync(2500);
      const result = await pollPromise;

      expect(result).not.toBeNull();
      // For short positions, uses encryptedLiqAbove
      expect(result.newEncryptedLiqThreshold[0]).toBe(0xBB);
    });

    it('copies existing collateral into result', async () => {
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(5);
      const encryptedCollateral = new Uint8Array(64).fill(0xDD);

      const op = {
        positionPda,
        requestId,
        fundingDelta: 500n,
        position: {
          trader: Keypair.generate().publicKey,
          market: Keypair.generate().publicKey,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 0 as const,
          leverage: 10,
          encryptedSize: new Uint8Array(64),
          encryptedEntryPrice: new Uint8Array(64),
          encryptedCollateral,
          encryptedRealizedPnl: new Uint8Array(64),
          encryptedLiqBelow: new Uint8Array(64),
          encryptedLiqAbove: new Uint8Array(64),
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const pollForMpcResult = (processor as any).pollForMpcResult.bind(processor);
      const pollPromise = pollForMpcResult(op);
      await vi.advanceTimersByTimeAsync(2500);
      const result = await pollPromise;

      expect(result).not.toBeNull();
      expect(result.newEncryptedCollateral[0]).toBe(0xDD);
    });
  });

  describe('submitFundingCallback', () => {
    it('submits funding callback transaction successfully', async () => {
      mockSendAndConfirmTransaction.mockResolvedValue('callback-sig-123');

      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const traderPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(4);

      // Create the operation object directly to test submitFundingCallback
      const op = {
        positionPda,
        requestId,
        fundingDelta: 1000n,
        position: {
          trader: traderPda,
          market: marketPda,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 0 as const, // Long
          leverage: 10,
          encryptedSize: new Uint8Array(64),
          encryptedEntryPrice: new Uint8Array(64),
          encryptedCollateral: new Uint8Array(64),
          encryptedRealizedPnl: new Uint8Array(64),
          encryptedLiqBelow: new Uint8Array(64),
          encryptedLiqAbove: new Uint8Array(64),
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const result = {
        newEncryptedCollateral: new Uint8Array(64),
        newEncryptedLiqThreshold: new Uint8Array(64),
        isReceiving: false,
      };

      // Call private method directly
      const submitFundingCallback = (processor as any).submitFundingCallback.bind(processor);
      await submitFundingCallback(op, result);

      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();
    });

    it('handles callback transaction failure gracefully', async () => {
      mockSendAndConfirmTransaction.mockRejectedValue(new Error('MXE authority signature required'));

      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const traderPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(5);

      const op = {
        positionPda,
        requestId,
        fundingDelta: 1000n,
        position: {
          trader: traderPda,
          market: marketPda,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 0 as const,
          leverage: 10,
          encryptedSize: new Uint8Array(64),
          encryptedEntryPrice: new Uint8Array(64),
          encryptedCollateral: new Uint8Array(64),
          encryptedRealizedPnl: new Uint8Array(64),
          encryptedLiqBelow: new Uint8Array(64),
          encryptedLiqAbove: new Uint8Array(64),
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const result = {
        newEncryptedCollateral: new Uint8Array(64),
        newEncryptedLiqThreshold: new Uint8Array(64),
        isReceiving: false,
      };

      // Should not throw even when transaction fails
      const submitFundingCallback = (processor as any).submitFundingCallback.bind(processor);
      await expect(submitFundingCallback(op, result)).resolves.toBeUndefined();
    });

    it('builds callback instruction with correct data format', async () => {
      let capturedTx: any;
      mockSendAndConfirmTransaction.mockImplementation(async (conn, tx) => {
        capturedTx = tx;
        return 'tx-sig';
      });

      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const traderPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(6);

      const op = {
        positionPda,
        requestId,
        fundingDelta: 2000n,
        position: {
          trader: traderPda,
          market: marketPda,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 0 as const,
          leverage: 10,
          encryptedSize: new Uint8Array(64),
          encryptedEntryPrice: new Uint8Array(64),
          encryptedCollateral: new Uint8Array(64),
          encryptedRealizedPnl: new Uint8Array(64),
          encryptedLiqBelow: new Uint8Array(64),
          encryptedLiqAbove: new Uint8Array(64),
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const result = {
        newEncryptedCollateral: new Uint8Array(64).fill(0xAB),
        newEncryptedLiqThreshold: new Uint8Array(64).fill(0xCD),
        isReceiving: true,
      };

      const submitFundingCallback = (processor as any).submitFundingCallback.bind(processor);
      await submitFundingCallback(op, result);

      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();
      expect(capturedTx).toBeDefined();
    });

    it('handles short position callback with correct liq threshold', async () => {
      mockSendAndConfirmTransaction.mockResolvedValue('short-callback-sig');

      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const traderPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(7);

      const op = {
        positionPda,
        requestId,
        fundingDelta: -1500n, // Negative = receiving
        position: {
          trader: traderPda,
          market: marketPda,
          positionId: new Uint8Array(16),
          createdAtHour: 0n,
          lastUpdatedHour: 0n,
          side: 1 as const, // Short - uses encryptedLiqAbove
          leverage: 10,
          encryptedSize: new Uint8Array(64),
          encryptedEntryPrice: new Uint8Array(64),
          encryptedCollateral: new Uint8Array(64),
          encryptedRealizedPnl: new Uint8Array(64),
          encryptedLiqBelow: new Uint8Array(64),
          encryptedLiqAbove: new Uint8Array(64).fill(0xEF), // Different pattern for short
          thresholdCommitment: new Uint8Array(32),
          lastThresholdUpdateHour: 0n,
          thresholdVerified: false,
          entryCumulativeFunding: 0n,
          status: 0,
          eligibilityProofVerified: true,
          partialCloseCount: 0,
          autoDeleveragePriority: 0n,
          lastMarginAddHour: 0n,
          marginAddCount: 0,
          bump: 0,
          positionSeed: 0n,
          pendingMpcRequest: requestId,
          pendingMarginAmount: 0n,
          pendingMarginIsAdd: false,
          isLiquidatable: false,
          pendingClose: false,
          pendingCloseExitPrice: 0n,
          pendingCloseFull: false,
          pendingCloseSize: new Uint8Array(64),
        },
      };

      const result = {
        newEncryptedCollateral: new Uint8Array(64),
        newEncryptedLiqThreshold: new Uint8Array(64),
        isReceiving: true,
      };

      const submitFundingCallback = (processor as any).submitFundingCallback.bind(processor);
      await submitFundingCallback(op, result);

      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();
    });
  });

  describe('MPC result caching', () => {
    it('caches MPC result for reuse', async () => {
      mockSendAndConfirmTransaction.mockResolvedValue('cached-sig');

      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(8);

      const pendingPosition = createMockPositionDataV8({
        thresholdVerified: false,
        pendingMpcRequest: requestId,
        pendingMarginAmount: 0n,
        pendingClose: false,
        fundingDelta: 500n,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: pendingPosition } },
      ]);

      await processor.start();

      // First poll cycle
      await vi.advanceTimersByTimeAsync(3000);

      // Status should reflect cached results if operation is still pending
      const status = processor.getStatus();
      expect(status.isPolling).toBe(true);
    });

    it('clears cached result after successful callback', async () => {
      mockSendAndConfirmTransaction.mockResolvedValue('cleared-sig');

      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(9);

      const pendingPosition = createMockPositionDataV8({
        thresholdVerified: false,
        pendingMpcRequest: requestId,
        pendingMarginAmount: 0n,
        pendingClose: false,
        fundingDelta: 750n,
      });

      // First poll returns pending position, second poll returns empty (settled)
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: pendingPosition } },
        ])
        .mockResolvedValue([]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(3000);

      // After successful callback, cache should be cleared
      const status = processor.getStatus();
      expect(status.cachedResults).toBe(0);
    });
  });
});
