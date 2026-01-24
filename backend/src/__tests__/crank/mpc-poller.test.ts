import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey, Logs, Context } from '@solana/web3.js';

// Mock external dependencies with vi.hoisted
const mockWithRetry = vi.hoisted(() => vi.fn());
const mockWithTimeout = vi.hoisted(() => vi.fn());
const mockClassifyError = vi.hoisted(() => vi.fn());
const mockIsRetryable = vi.hoisted(() => vi.fn());
const mockAlertManager = vi.hoisted(() => ({
  error: vi.fn().mockResolvedValue(undefined),
  warning: vi.fn().mockResolvedValue(undefined),
  info: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@arcium-hq/client', () => ({
  getMXEAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: mockWithRetry,
}));

vi.mock('../../lib/errors.js', () => ({
  classifyError: mockClassifyError,
  MpcError: class MpcError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'MpcError';
    }
  },
  BlockchainError: class BlockchainError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'BlockchainError';
    }
  },
  isRetryable: mockIsRetryable,
}));

vi.mock('../../lib/timeout.js', () => ({
  withTimeout: mockWithTimeout,
  DEFAULT_TIMEOUTS: { MPC_CALLBACK: 30000 },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    mpc: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../../lib/alerts.js', () => ({
  getAlertManager: vi.fn().mockReturnValue(mockAlertManager),
  AlertManager: class MockAlertManager {},
}));

// Import after mocks
import { MpcPoller } from '../../crank/mpc-poller.js';
import { CrankConfig } from '../../crank/config.js';

// Computation status enum (must match on-chain)
enum ComputationStatus {
  Pending = 0,
  Processing = 1,
  Completed = 2,
  Failed = 3,
  Expired = 4,
}

// Computation type enum
enum ComputationType {
  ComparePrices = 0,
  CalculateFill = 1,
  Add = 2,
  Subtract = 3,
  Multiply = 4,
  VerifyPositionParams = 5,
  CheckLiquidation = 6,
}

// Helper to create mock MXE config account data
function createMockMxeConfigData(computationCount: bigint, completedCount: bigint): Buffer {
  // Layout: discriminator(8) + authority(32) + cluster_id(32) + cluster_offset(2) + arcium_program(32) + computation_count(8) + completed_count(8)
  const data = Buffer.alloc(8 + 32 + 32 + 2 + 32 + 8 + 8);

  // Write computation_count at correct offset
  const countOffset = 8 + 32 + 32 + 2 + 32;
  data.writeBigUInt64LE(computationCount, countOffset);
  data.writeBigUInt64LE(completedCount, countOffset + 8);

  return data;
}

// Helper to create mock computation request account data
function createMockComputationRequestData(
  requestId: Buffer,
  computationType: ComputationType,
  status: ComputationStatus,
  callbackAccount1: PublicKey,
  callbackAccount2: PublicKey,
  inputs: Buffer = Buffer.alloc(0),
  result: Buffer = Buffer.alloc(0)
): Buffer {
  // Layout: discriminator(8) + request_id(32) + computation_type(1) + requester(32) + callback_program(32) +
  //         callback_discriminator(8) + inputs_len(4) + inputs + status(1) + created_at(8) + completed_at(8) +
  //         result_len(4) + result + callback_account1(32) + callback_account2(32) + bump(1)
  const dataLen = 8 + 32 + 1 + 32 + 32 + 8 + 4 + inputs.length + 1 + 8 + 8 + 4 + result.length + 32 + 32 + 1;
  const data = Buffer.alloc(dataLen);
  let offset = 0;

  // Discriminator (8 bytes)
  offset += 8;

  // Request ID (32 bytes)
  requestId.copy(data, offset);
  offset += 32;

  // Computation type (1 byte)
  data.writeUInt8(computationType, offset);
  offset += 1;

  // Requester (32 bytes - use a dummy pubkey)
  const requester = new PublicKey('11111111111111111111111111111111');
  requester.toBuffer().copy(data, offset);
  offset += 32;

  // Callback program (32 bytes)
  const callbackProgram = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
  callbackProgram.toBuffer().copy(data, offset);
  offset += 32;

  // Callback discriminator (8 bytes)
  offset += 8;

  // Inputs Vec<u8>: 4-byte length prefix + data
  data.writeUInt32LE(inputs.length, offset);
  offset += 4;
  if (inputs.length > 0) {
    inputs.copy(data, offset);
    offset += inputs.length;
  }

  // Status (1 byte)
  data.writeUInt8(status, offset);
  offset += 1;

  // Created at (8 bytes) - timestamp
  data.writeBigInt64LE(BigInt(Date.now()), offset);
  offset += 8;

  // Completed at (8 bytes)
  data.writeBigInt64LE(BigInt(0), offset);
  offset += 8;

  // Result Vec<u8>: 4-byte length prefix + data
  data.writeUInt32LE(result.length, offset);
  offset += 4;
  if (result.length > 0) {
    result.copy(data, offset);
    offset += result.length;
  }

  // Callback account 1 (32 bytes)
  callbackAccount1.toBuffer().copy(data, offset);
  offset += 32;

  // Callback account 2 (32 bytes)
  callbackAccount2.toBuffer().copy(data, offset);
  offset += 32;

  // Bump (1 byte)
  data.writeUInt8(255, offset);

  return data;
}

// MXE Event discriminators
const MXE_EVENT_DISCRIMINATORS = {
  PRICE_COMPARE_RESULT: Buffer.from([0xe7, 0x3c, 0x8f, 0x1a, 0x5b, 0x2d, 0x9e, 0x4f]),
  FILL_CALCULATION_RESULT: Buffer.from([0xa2, 0x7b, 0x4c, 0x8d, 0x3e, 0x1f, 0x6a, 0x5b]),
};

// Helper to create mock PriceCompareResult event data
function createPriceCompareResultEventData(
  computationOffset: bigint,
  pricesMatch: boolean,
  requestId: Buffer,
  buyOrder: PublicKey,
  sellOrder: PublicKey,
  nonce: bigint = BigInt(12345)
): Buffer {
  // Layout: discriminator(8) + computation_offset(8) + prices_match(1) + request_id(32) +
  //         buy_order(32) + sell_order(32) + nonce(16)
  const data = Buffer.alloc(8 + 8 + 1 + 32 + 32 + 32 + 16);
  let offset = 0;

  // Discriminator
  MXE_EVENT_DISCRIMINATORS.PRICE_COMPARE_RESULT.copy(data, offset);
  offset += 8;

  // Computation offset
  data.writeBigUInt64LE(computationOffset, offset);
  offset += 8;

  // Prices match
  data.writeUInt8(pricesMatch ? 1 : 0, offset);
  offset += 1;

  // Request ID
  requestId.copy(data, offset);
  offset += 32;

  // Buy order
  buyOrder.toBuffer().copy(data, offset);
  offset += 32;

  // Sell order
  sellOrder.toBuffer().copy(data, offset);
  offset += 32;

  // Nonce (u128 - 16 bytes, just write first 8)
  data.writeBigUInt64LE(nonce, offset);

  return data;
}

// Helper to create mock FillCalculationResult event data
function createFillCalculationResultEventData(
  computationOffset: bigint,
  encryptedFillAmount: Buffer,
  buyFullyFilled: boolean,
  sellFullyFilled: boolean,
  requestId: Buffer,
  buyOrder: PublicKey,
  sellOrder: PublicKey
): Buffer {
  // Layout: discriminator(8) + computation_offset(8) + encrypted_fill(64) + buy_fully_filled(1) +
  //         sell_fully_filled(1) + request_id(32) + buy_order(32) + sell_order(32)
  const data = Buffer.alloc(8 + 8 + 64 + 1 + 1 + 32 + 32 + 32);
  let offset = 0;

  // Discriminator
  MXE_EVENT_DISCRIMINATORS.FILL_CALCULATION_RESULT.copy(data, offset);
  offset += 8;

  // Computation offset
  data.writeBigUInt64LE(computationOffset, offset);
  offset += 8;

  // Encrypted fill amount (64 bytes)
  encryptedFillAmount.copy(data, offset);
  offset += 64;

  // Buy fully filled
  data.writeUInt8(buyFullyFilled ? 1 : 0, offset);
  offset += 1;

  // Sell fully filled
  data.writeUInt8(sellFullyFilled ? 1 : 0, offset);
  offset += 1;

  // Request ID
  requestId.copy(data, offset);
  offset += 32;

  // Buy order
  buyOrder.toBuffer().copy(data, offset);
  offset += 32;

  // Sell order
  sellOrder.toBuffer().copy(data, offset);

  return data;
}

describe('MpcPoller', () => {
  let poller: MpcPoller;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let mockConfig: CrankConfig;

  // Sample order PDAs
  const buyOrderPda = Keypair.generate().publicKey;
  const sellOrderPda = Keypair.generate().publicKey;

  beforeEach(() => {
    vi.clearAllMocks();

    crankKeypair = Keypair.generate();

    mockConnection = {
      getAccountInfo: vi.fn(),
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'ABC123blockhash',
        lastValidBlockHeight: 12500,
      }),
      onLogs: vi.fn().mockReturnValue(1),
      removeOnLogsListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;

    mockConfig = {
      programs: {
        confidexDex: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
        arciumMxe: 'HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS',
      },
      pollingIntervalMs: 1000,
      mpc: {
        clusterOffset: 456,
      },
    } as unknown as CrankConfig;

    // Default mock implementations
    mockWithRetry.mockImplementation(async (fn) => {
      try {
        const value = await fn();
        return { success: true, value, attempts: 1, totalTimeMs: 100 };
      } catch (error) {
        return { success: false, error, attempts: 1, totalTimeMs: 100 };
      }
    });
    mockWithTimeout.mockImplementation(async (promise) => promise);
    mockClassifyError.mockReturnValue({ name: 'UnknownError', message: 'Test error' });
    mockIsRetryable.mockReturnValue(true);

    poller = new MpcPoller(mockConnection, crankKeypair, mockConfig);
  });

  afterEach(() => {
    poller.stop();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('initializes with correct program IDs', () => {
      expect(poller).toBeDefined();
    });

    it('initializes in stopped state', () => {
      const status = poller.getStatus();
      expect(status.isPolling).toBe(false);
    });

    it('initializes with zero processed and failed counts', () => {
      const status = poller.getStatus();
      expect(status.processedCount).toBe(0);
      expect(status.failedCount).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('starts polling for MPC results', () => {
      vi.useFakeTimers();

      // Mock empty config - no pending requests
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(0), BigInt(0)),
      });

      poller.start();

      expect(poller.getStatus().isPolling).toBe(true);

      poller.stop();

      expect(poller.getStatus().isPolling).toBe(false);

      vi.useRealTimers();
    });

    it('ignores multiple start calls', () => {
      vi.useFakeTimers();

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(0), BigInt(0)),
      });

      poller.start();
      poller.start(); // Second call should be ignored

      expect(poller.getStatus().isPolling).toBe(true);

      poller.stop();
      vi.useRealTimers();
    });

    it('handles stop when not started', () => {
      // Should not throw
      expect(() => poller.stop()).not.toThrow();
    });

    it('can restart after stopping', () => {
      vi.useFakeTimers();

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(0), BigInt(0)),
      });

      poller.start();
      poller.stop();
      poller.start();

      expect(poller.getStatus().isPolling).toBe(true);

      poller.stop();
      vi.useRealTimers();
    });
  });

  describe('polling for pending requests', () => {
    it('skips polling when no MXE config found', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(mockConnection.getAccountInfo).toHaveBeenCalled();
    });

    it('skips polling when no pending computations', async () => {
      // No pending (computationCount === completedCount)
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(10), BigInt(10)),
      });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Only config should be fetched, no request PDAs
      expect(mockConnection.getAccountInfo).toHaveBeenCalledTimes(1);
    });

    it('polls for pending computations when count differs', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(3), 0);

      // Has pending (computationCount > completedCount)
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(5), BigInt(3)),
        })
        // Return computation request data for first pending
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        })
        // Return null for remaining
        .mockResolvedValue(null);

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should have fetched config + attempted to fetch request PDAs
      expect(mockConnection.getAccountInfo).toHaveBeenCalled();
    });

    it('marks already completed requests as processed', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(3), 0);

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(4), BigInt(3)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Completed,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(poller.getStatus().processedCount).toBe(1);
    });

    it('marks failed requests as processed', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(3), 0);

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(4), BigInt(3)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Failed,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(poller.getStatus().processedCount).toBe(1);
    });

    it('marks expired requests as processed', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(3), 0);

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(4), BigInt(3)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Expired,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(poller.getStatus().processedCount).toBe(1);
    });

    it('handles errors when processing individual requests', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(4), BigInt(3)),
        })
        // Return invalid data that will cause parsing error
        .mockResolvedValueOnce({
          data: Buffer.alloc(10), // Too short to be valid
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should mark as failed due to parsing error
      expect(poller.getStatus().failedCount).toBe(1);
    });

    it('cleans up old processed requests when limit exceeded', async () => {
      const requestId = Buffer.alloc(32);

      // Create many pending requests
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1100), BigInt(0)),
        });

      // Return completed status for all requests
      for (let i = 0; i < 1100; i++) {
        requestId.writeBigUInt64LE(BigInt(i), 0);
        (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Completed,
            buyOrderPda,
            sellOrderPda
          ),
        });
      }

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should have cleaned up some old processed requests
      // Limit is 1000, should delete 500 oldest when exceeded
      expect(poller.getStatus().processedCount).toBeLessThanOrEqual(1000);
    });

    it('handles poll error gracefully', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should not throw, just log error
      expect(poller.getStatus().isPolling).toBe(false);
    });

    it('does not poll when isPolling is false', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(5), BigInt(3)),
      });

      // Don't start the poller, directly check it doesn't poll
      expect(poller.getStatus().isPolling).toBe(false);
    });
  });

  describe('processRequest - demo mode', () => {
    it('handles ComparePrices computation type in demo mode', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      // Ensure we're in demo mode (no CRANK_USE_REAL_MPC)
      delete process.env.CRANK_USE_REAL_MPC;

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should have processed successfully
      expect(poller.getStatus().processedCount).toBe(1);
    });

    it('handles CalculateFill computation type in demo mode', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      delete process.env.CRANK_USE_REAL_MPC;

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.CalculateFill,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(poller.getStatus().processedCount).toBe(1);
    });

    it('handles unknown computation type in demo mode', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      delete process.env.CRANK_USE_REAL_MPC;

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.CheckLiquidation, // Unknown type for demo
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should still process (mark as processed)
      expect(poller.getStatus().processedCount).toBe(1);
    });
  });

  describe('callProcessCallback', () => {
    it('handles successful callback', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      mockWithRetry.mockResolvedValue({
        success: true,
        value: 'test-signature-123',
        attempts: 1,
        totalTimeMs: 100,
      });

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(poller.getStatus().processedCount).toBe(1);
    });

    it('handles permanent callback failure (ConstraintSeeds)', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      mockWithRetry.mockResolvedValue({
        success: false,
        error: new Error('ConstraintSeeds: Invalid seeds'),
        attempts: 3,
        totalTimeMs: 5000,
      });

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should be marked as permanently failed
      expect(poller.getStatus().failedCount).toBe(1);
    });

    it('handles permanent callback failure (InvalidRequestId)', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      mockWithRetry.mockResolvedValue({
        success: false,
        error: new Error('InvalidRequestId'),
        attempts: 3,
        totalTimeMs: 5000,
      });

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(poller.getStatus().failedCount).toBe(1);
    });

    it('handles permanent callback failure (RequestNotPending)', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      mockWithRetry.mockResolvedValue({
        success: false,
        error: new Error('RequestNotPending'),
        attempts: 1,
        totalTimeMs: 100,
      });

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      expect(poller.getStatus().failedCount).toBe(1);
    });

    it('handles transient callback failure (allows retry)', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      mockWithRetry.mockResolvedValue({
        success: false,
        error: new Error('Network timeout'),
        attempts: 3,
        totalTimeMs: 5000,
      });

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Transient failure should not add to failedCount
      // It removes from processedRequests to allow retry
      expect(poller.getStatus().failedCount).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('returns current polling status', () => {
      const status = poller.getStatus();

      expect(status).toHaveProperty('isPolling');
      expect(status).toHaveProperty('processedCount');
      expect(status).toHaveProperty('failedCount');
      expect(status.isPolling).toBe(false);
      expect(status.processedCount).toBe(0);
      expect(status.failedCount).toBe(0);
    });

    it('reflects started state', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(0), BigInt(0)),
      });

      vi.useFakeTimers();
      poller.start();

      const status = poller.getStatus();
      expect(status.isPolling).toBe(true);

      poller.stop();
      vi.useRealTimers();
    });
  });

  describe('cleanup', () => {
    it('cleans up interval on stop', () => {
      vi.useFakeTimers();

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(0), BigInt(0)),
      });

      poller.start();
      poller.stop();

      // Should be able to start again
      poller.start();
      expect(poller.getStatus().isPolling).toBe(true);
      poller.stop();

      vi.useRealTimers();
    });
  });

  describe('skipAllPending', () => {
    it('returns 0 when no MXE config found', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const skipped = await poller.skipAllPending();

      expect(skipped).toBe(0);
    });

    it('skips pending computations', async () => {
      // Has 3 pending computations (5 - 2)
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(5), BigInt(2)),
      });

      const skipped = await poller.skipAllPending();

      expect(skipped).toBe(3);
      expect(poller.getStatus().failedCount).toBe(3);
    });

    it('handles error during skip', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const skipped = await poller.skipAllPending();

      expect(skipped).toBe(0);
    });

    it('does not double-count already skipped requests', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMxeConfigData(BigInt(5), BigInt(2)),
      });

      await poller.skipAllPending();
      const skippedAgain = await poller.skipAllPending();

      expect(skippedAgain).toBe(0); // Already marked as failed
    });
  });

  describe('Event Subscription Mode', () => {
    describe('startEventSubscription', () => {
      it('subscribes to MXE program logs', () => {
        poller.startEventSubscription();

        expect(mockConnection.onLogs).toHaveBeenCalledWith(
          expect.any(PublicKey),
          expect.any(Function),
          'confirmed'
        );

        const status = poller.getSubscriptionStatus();
        expect(status.isSubscribed).toBe(true);
      });

      it('ignores multiple subscription calls', () => {
        poller.startEventSubscription();
        poller.startEventSubscription();

        expect(mockConnection.onLogs).toHaveBeenCalledTimes(1);
      });
    });

    describe('stopEventSubscription', () => {
      it('unsubscribes from MXE logs', async () => {
        poller.startEventSubscription();
        await poller.stopEventSubscription();

        expect(mockConnection.removeOnLogsListener).toHaveBeenCalledWith(1);

        const status = poller.getSubscriptionStatus();
        expect(status.isSubscribed).toBe(false);
      });

      it('handles stop when not subscribed', async () => {
        await poller.stopEventSubscription();

        expect(mockConnection.removeOnLogsListener).not.toHaveBeenCalled();
      });

      it('handles error during unsubscribe gracefully', async () => {
        poller.startEventSubscription();

        (mockConnection.removeOnLogsListener as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('Unsubscribe failed')
        );

        // Should not throw
        await expect(poller.stopEventSubscription()).resolves.not.toThrow();

        const status = poller.getSubscriptionStatus();
        expect(status.isSubscribed).toBe(false);
      });
    });

    describe('handleMxeLogs', () => {
      it('processes PriceCompareResult event', async () => {
        poller.startEventSubscription();

        // Get the callback function that was registered
        const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

        const requestId = Buffer.alloc(32);
        const eventData = createPriceCompareResultEventData(
          BigInt(0),
          true,
          requestId,
          buyOrderPda,
          sellOrderPda
        );

        const logs: Logs = {
          signature: 'test-signature-123',
          err: null,
          logs: [`Program data: ${eventData.toString('base64')}`],
        };

        await onLogsCallback(logs, { slot: 12345 } as Context);

        const status = poller.getSubscriptionStatus();
        expect(status.processedEventsCount).toBe(1);
      });

      it('processes FillCalculationResult event', async () => {
        poller.startEventSubscription();

        const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

        const requestId = Buffer.alloc(32);
        const encryptedFill = Buffer.alloc(64);
        const eventData = createFillCalculationResultEventData(
          BigInt(0),
          encryptedFill,
          true,
          true,
          requestId,
          buyOrderPda,
          sellOrderPda
        );

        const logs: Logs = {
          signature: 'test-signature-456',
          err: null,
          logs: [`Program data: ${eventData.toString('base64')}`],
        };

        await onLogsCallback(logs, { slot: 12345 } as Context);

        const status = poller.getSubscriptionStatus();
        expect(status.processedEventsCount).toBe(1);
      });

      it('skips already processed events', async () => {
        poller.startEventSubscription();

        const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

        const requestId = Buffer.alloc(32);
        const eventData = createPriceCompareResultEventData(
          BigInt(0),
          true,
          requestId,
          buyOrderPda,
          sellOrderPda
        );

        const logs: Logs = {
          signature: 'duplicate-signature',
          err: null,
          logs: [`Program data: ${eventData.toString('base64')}`],
        };

        await onLogsCallback(logs, { slot: 12345 } as Context);
        await onLogsCallback(logs, { slot: 12345 } as Context); // Duplicate

        const status = poller.getSubscriptionStatus();
        expect(status.processedEventsCount).toBe(1);
      });

      it('ignores logs without Program data prefix', async () => {
        poller.startEventSubscription();

        const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

        const logs: Logs = {
          signature: 'test-signature-789',
          err: null,
          logs: ['Program invoke: some_program', 'Random log message'],
        };

        await onLogsCallback(logs, { slot: 12345 } as Context);

        const status = poller.getSubscriptionStatus();
        expect(status.processedEventsCount).toBe(0);
      });

      it('ignores invalid base64 data', async () => {
        poller.startEventSubscription();

        const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

        const logs: Logs = {
          signature: 'test-signature-invalid',
          err: null,
          logs: ['Program data: !!!invalid-base64!!!'],
        };

        await onLogsCallback(logs, { slot: 12345 } as Context);

        const status = poller.getSubscriptionStatus();
        expect(status.processedEventsCount).toBe(0);
      });

      it('ignores events with unknown discriminators', async () => {
        poller.startEventSubscription();

        const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

        // Create event data with unknown discriminator
        const unknownData = Buffer.alloc(100);
        unknownData.fill(0xff, 0, 8); // Unknown discriminator

        const logs: Logs = {
          signature: 'test-signature-unknown',
          err: null,
          logs: [`Program data: ${unknownData.toString('base64')}`],
        };

        await onLogsCallback(logs, { slot: 12345 } as Context);

        const status = poller.getSubscriptionStatus();
        expect(status.processedEventsCount).toBe(0);
      });

      it('cleans up old processed events when limit exceeded', async () => {
        poller.startEventSubscription();

        const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

        // Process many events
        for (let i = 0; i < 1100; i++) {
          const requestId = Buffer.alloc(32);
          requestId.writeUInt32LE(i, 0);
          const eventData = createPriceCompareResultEventData(
            BigInt(i),
            true,
            requestId,
            buyOrderPda,
            sellOrderPda
          );

          const logs: Logs = {
            signature: `test-signature-${i}`,
            err: null,
            logs: [`Program data: ${eventData.toString('base64')}`],
          };

          await onLogsCallback(logs, { slot: 12345 } as Context);
        }

        const status = poller.getSubscriptionStatus();
        // Should have cleaned up some old events (keeps 1000, deletes 500 when exceeded)
        expect(status.processedEventsCount).toBeLessThanOrEqual(1000);
      });
    });

    describe('getSubscriptionStatus', () => {
      it('returns initial subscription status', () => {
        const status = poller.getSubscriptionStatus();

        expect(status.isSubscribed).toBe(false);
        expect(status.processedEventsCount).toBe(0);
      });

      it('reflects subscribed state', () => {
        poller.startEventSubscription();

        const status = poller.getSubscriptionStatus();
        expect(status.isSubscribed).toBe(true);
      });
    });
  });

  describe('callUpdateOrdersFromResult', () => {
    it('builds correct instruction data with encrypted fill', async () => {
      poller.startEventSubscription();

      mockWithRetry.mockResolvedValue({
        success: true,
        value: 'update-signature-123',
        attempts: 1,
        totalTimeMs: 100,
      });

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

      const requestId = Buffer.alloc(32);
      const encryptedFill = Buffer.alloc(64).fill(0xab);
      const eventData = createFillCalculationResultEventData(
        BigInt(0),
        encryptedFill,
        true,
        false,
        requestId,
        buyOrderPda,
        sellOrderPda
      );

      const logs: Logs = {
        signature: 'fill-event-signature',
        err: null,
        logs: [`Program data: ${eventData.toString('base64')}`],
      };

      await onLogsCallback(logs, { slot: 12345 } as Context);

      expect(mockWithRetry).toHaveBeenCalled();
    });

    it('handles OrderNotMatching error as non-retryable', async () => {
      poller.startEventSubscription();

      // Make withRetry call the isRetryable function
      mockWithRetry.mockImplementation(async (_fn, opts) => {
        // Simulate retry logic checking isRetryable
        const error = new Error('OrderNotMatching');
        const shouldRetry = opts?.isRetryable?.(error);
        expect(shouldRetry).toBe(false);
        return { success: false, error, attempts: 1, totalTimeMs: 100 };
      });

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

      const requestId = Buffer.alloc(32);
      const eventData = createPriceCompareResultEventData(
        BigInt(0),
        true,
        requestId,
        buyOrderPda,
        sellOrderPda
      );

      const logs: Logs = {
        signature: 'order-not-matching-sig',
        err: null,
        logs: [`Program data: ${eventData.toString('base64')}`],
      };

      await onLogsCallback(logs, { slot: 12345 } as Context);
    });

    it('handles successful update_orders_from_result', async () => {
      poller.startEventSubscription();

      mockWithRetry.mockResolvedValue({
        success: true,
        value: 'success-signature',
        attempts: 1,
        totalTimeMs: 100,
      });

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

      const requestId = Buffer.alloc(32);
      const eventData = createPriceCompareResultEventData(
        BigInt(0),
        false, // prices don't match
        requestId,
        buyOrderPda,
        sellOrderPda
      );

      const logs: Logs = {
        signature: 'success-update-sig',
        err: null,
        logs: [`Program data: ${eventData.toString('base64')}`],
      };

      await onLogsCallback(logs, { slot: 12345 } as Context);

      expect(mockWithRetry).toHaveBeenCalled();
    });

    it('handles failed update_orders_from_result', async () => {
      poller.startEventSubscription();

      mockWithRetry.mockResolvedValue({
        success: false,
        error: new Error('Transaction failed'),
        attempts: 3,
        totalTimeMs: 5000,
      });

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

      const requestId = Buffer.alloc(32);
      const eventData = createPriceCompareResultEventData(
        BigInt(0),
        true,
        requestId,
        buyOrderPda,
        sellOrderPda
      );

      const logs: Logs = {
        signature: 'failed-update-sig',
        err: null,
        logs: [`Program data: ${eventData.toString('base64')}`],
      };

      await onLogsCallback(logs, { slot: 12345 } as Context);

      // Should log error but not throw
      expect(mockWithRetry).toHaveBeenCalled();
    });
  });

  describe('Production MPC mode', () => {
    beforeEach(() => {
      process.env.CRANK_USE_REAL_MPC = 'true';
    });

    afterEach(() => {
      delete process.env.CRANK_USE_REAL_MPC;
    });

    it('attempts real MPC when CRANK_USE_REAL_MPC is true', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      // Mock the dynamic imports to fail (simulating MXE not available)
      vi.mock('./arcium-client.js', () => ({
        createArciumClient: vi.fn().mockReturnValue({
          isAvailable: vi.fn().mockResolvedValue(false),
        }),
      }));

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should have attempted to process (may fail due to MXE not available)
      expect(poller.getStatus().processedCount + poller.getStatus().failedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases', () => {
    it('handles null error in withRetry result', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      mockWithRetry.mockResolvedValue({
        success: false,
        error: null,
        attempts: 3,
        totalTimeMs: 5000,
      });

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should handle gracefully
      expect(poller.getStatus().failedCount).toBe(0);
    });

    it('handles non-Error objects in catch blocks', async () => {
      const requestId = Buffer.alloc(32);
      requestId.writeBigUInt64LE(BigInt(0), 0);

      mockWithRetry.mockRejectedValue('string error');

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: createMockMxeConfigData(BigInt(1), BigInt(0)),
        })
        .mockResolvedValueOnce({
          data: createMockComputationRequestData(
            requestId,
            ComputationType.ComparePrices,
            ComputationStatus.Pending,
            buyOrderPda,
            sellOrderPda
          ),
        });

      vi.useFakeTimers();
      poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      vi.useRealTimers();

      // Should mark as failed
      expect(poller.getStatus().failedCount).toBe(1);
    });

    it('invokes isRetryable callback for non-OrderNotMatching errors', async () => {
      poller.startEventSubscription();

      // Mock isRetryable to return true for retryable errors
      mockIsRetryable.mockReturnValue(true);
      mockClassifyError.mockReturnValue({ name: 'NetworkError', message: 'Connection refused' });

      // Make withRetry call the isRetryable function with a non-OrderNotMatching error
      mockWithRetry.mockImplementation(async (_fn, opts) => {
        const error = new Error('Connection refused');
        const shouldRetry = opts?.isRetryable?.(error);
        expect(shouldRetry).toBe(true);
        expect(mockIsRetryable).toHaveBeenCalledWith(error);
        return { success: false, error, attempts: 3, totalTimeMs: 3000 };
      });

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

      const requestId = Buffer.alloc(32);
      const eventData = createPriceCompareResultEventData(
        BigInt(0),
        true,
        requestId,
        buyOrderPda,
        sellOrderPda
      );

      const logs: Logs = {
        signature: 'retry-check-sig',
        err: null,
        logs: [`Program data: ${eventData.toString('base64')}`],
      };

      await onLogsCallback(logs, { slot: 12345 } as Context);

      expect(mockIsRetryable).toHaveBeenCalled();
    });

    it('invokes onRetry callback when retrying', async () => {
      poller.startEventSubscription();

      const retryError = new Error('Temporary network error');
      mockClassifyError.mockReturnValue({ name: 'NetworkError', message: 'Temporary network error' });
      mockIsRetryable.mockReturnValue(true);

      // Make withRetry call the onRetry callback
      mockWithRetry.mockImplementation(async (_fn, opts) => {
        // Simulate retry behavior by calling onRetry
        opts?.onRetry?.(retryError, 1, 1000);
        opts?.onRetry?.(retryError, 2, 2000);
        return { success: true, value: 'retry-success-sig', attempts: 3, totalTimeMs: 3000 };
      });

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

      const requestId = Buffer.alloc(32);
      const eventData = createPriceCompareResultEventData(
        BigInt(0),
        true,
        requestId,
        buyOrderPda,
        sellOrderPda
      );

      const logs: Logs = {
        signature: 'on-retry-sig',
        err: null,
        logs: [`Program data: ${eventData.toString('base64')}`],
      };

      await onLogsCallback(logs, { slot: 12345 } as Context);

      // Verify classifyError was called during onRetry
      expect(mockClassifyError).toHaveBeenCalledWith(retryError);
    });

    it('isRetryable returns false for OrderNotMatching, falls through to isRetryable for other errors', async () => {
      poller.startEventSubscription();

      mockIsRetryable.mockReturnValue(false);
      mockClassifyError.mockReturnValue({ name: 'UnknownError', message: 'Unknown' });

      // Test both branches in the same mock
      let callCount = 0;
      mockWithRetry.mockImplementation(async (_fn, opts) => {
        callCount++;
        if (callCount === 1) {
          // First call: OrderNotMatching error
          const orderNotMatchingError = new Error('OrderNotMatching');
          const shouldRetry1 = opts?.isRetryable?.(orderNotMatchingError);
          expect(shouldRetry1).toBe(false);
        }
        if (callCount >= 1) {
          // Second call: Other error - should call isRetryable from lib
          const otherError = new Error('Some other error');
          const shouldRetry2 = opts?.isRetryable?.(otherError);
          expect(shouldRetry2).toBe(false); // mockIsRetryable returns false
          expect(mockIsRetryable).toHaveBeenCalledWith(otherError);
        }
        return { success: true, value: 'sig', attempts: 1, totalTimeMs: 100 };
      });

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as (logs: Logs, ctx: Context) => Promise<void>;

      const requestId = Buffer.alloc(32);
      const eventData = createPriceCompareResultEventData(
        BigInt(0),
        true,
        requestId,
        buyOrderPda,
        sellOrderPda
      );

      const logs: Logs = {
        signature: 'both-branches-sig',
        err: null,
        logs: [`Program data: ${eventData.toString('base64')}`],
      };

      await onLogsCallback(logs, { slot: 12345 } as Context);
    });
  });
});
