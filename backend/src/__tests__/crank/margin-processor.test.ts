import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction, Logs, Context } from '@solana/web3.js';
import { MarginProcessor } from '../../crank/margin-processor.js';
import { CrankConfig } from '../../crank/config.js';

// V6 position account size
const POSITION_ACCOUNT_SIZE_V6 = 618;

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  logger: {
    margin: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock sendAndConfirmTransaction
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    sendAndConfirmTransaction: vi.fn().mockResolvedValue('mocktxsig123'),
  };
});

// Helper to create mock V6 position data with pending margin operation
function createMockPositionDataWithPendingMargin(
  options: {
    trader?: PublicKey;
    market?: PublicKey;
    side?: number; // 0 = Long, 1 = Short
    pendingMpcRequest?: Uint8Array;
    pendingMarginAmount?: bigint;
    pendingMarginIsAdd?: boolean;
    encryptedCollateral?: Uint8Array;
  } = {}
): Buffer {
  const data = Buffer.alloc(POSITION_ACCOUNT_SIZE_V6);
  let offset = 8; // Skip discriminator

  // trader (32 bytes)
  const trader = options.trader ?? Keypair.generate().publicKey;
  trader.toBuffer().copy(data, offset);
  offset += 32;

  // market (32 bytes)
  const market = options.market ?? Keypair.generate().publicKey;
  market.toBuffer().copy(data, offset);
  offset += 32;

  // positionId (16 bytes)
  offset += 16;

  // timestamps: created_at_hour (8), updated_at (8)
  offset += 8 + 8;

  // side (1 byte)
  data.writeUInt8(options.side ?? 0, offset);
  offset += 1;

  // leverage (1 byte)
  data.writeUInt8(10, offset);
  offset += 1;

  // 6 encrypted fields (64 bytes each = 384 bytes)
  // encrypted_amount, encrypted_entry, encrypted_collateral, etc.
  if (options.encryptedCollateral) {
    // Write encrypted collateral at offset 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 + 64
    const collateralOffset = 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 + 64;
    data.set(options.encryptedCollateral.slice(0, 64), collateralOffset);
  }
  offset += 64 * 6;

  // commitment (32 bytes)
  offset += 32;

  // timestamp (8 bytes)
  offset += 8;

  // threshold_verified (1 byte)
  offset += 1;

  // funding_accumulated (16 bytes)
  offset += 16;

  // status (1 byte)
  offset += 1;

  // eligibility_verified (1 byte)
  offset += 1;

  // partial_close (1 byte)
  offset += 1;

  // adl_priority (8 bytes)
  offset += 8;

  // margin_add_hour (8 bytes)
  offset += 8;

  // margin_add_count (1 byte)
  offset += 1;

  // bump (1 byte)
  offset += 1;

  // position_seed (8 bytes)
  offset += 8;

  // pending_mpc_request (32 bytes)
  const pendingMpcRequest = options.pendingMpcRequest ?? new Uint8Array(32);
  data.set(pendingMpcRequest, offset);
  offset += 32;

  // pending_margin_amount (8 bytes)
  const pendingMarginAmount = options.pendingMarginAmount ?? 0n;
  data.writeBigUInt64LE(pendingMarginAmount, offset);
  offset += 8;

  // pending_margin_is_add (1 byte)
  data.writeUInt8(options.pendingMarginIsAdd ? 1 : 0, offset);

  return data;
}

describe('MarginProcessor', () => {
  let processor: MarginProcessor;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let config: CrankConfig;

  const dexProgramId = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
  const mxeProgramId = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    crankKeypair = Keypair.generate();

    config = {
      pollingIntervalMs: 1000,
      maxRetries: 3,
      programs: {
        confidexDex: dexProgramId.toBase58(),
        arciumMxe: mxeProgramId.toBase58(),
        eligibilityVerifier: 'EligibilityVerifier111111111111111111111111',
        arciumCore: 'ArciumCore111111111111111111111111111111111',
      },
      rpcUrl: 'https://api.devnet.solana.com',
    } as CrankConfig;

    mockConnection = {
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      onLogs: vi.fn().mockReturnValue(1),
      removeOnLogsListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;

    processor = new MarginProcessor(mockConnection, crankKeypair, config);
  });

  afterEach(() => {
    processor.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('initializes with connection, keypair and config', () => {
      expect(processor).toBeDefined();
    });

    it('starts with not polling', () => {
      const status = processor.getStatus();
      expect(status.isPolling).toBe(false);
    });

    it('initializes with zero processing and failed counts', () => {
      const status = processor.getStatus();
      expect(status.processingCount).toBe(0);
      expect(status.failedCount).toBe(0);
    });
  });

  describe('start', () => {
    it('sets isPolling to true', async () => {
      await processor.start();

      const status = processor.getStatus();
      expect(status.isPolling).toBe(true);
    });

    it('subscribes to DEX program logs', async () => {
      await processor.start();

      expect(mockConnection.onLogs).toHaveBeenCalledWith(
        dexProgramId,
        expect.any(Function),
        'confirmed'
      );
    });

    it('does not start if already running', async () => {
      await processor.start();
      await processor.start();

      // onLogs should only be called once
      expect(mockConnection.onLogs).toHaveBeenCalledTimes(1);
    });

    it('polls for pending operations immediately', async () => {
      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('sets up polling interval', async () => {
      await processor.start();

      // Advance time to trigger polling
      await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 2);

      // Should have been called initially + once more
      expect(mockConnection.getProgramAccounts).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    it('sets isPolling to false', async () => {
      await processor.start();
      processor.stop();

      const status = processor.getStatus();
      expect(status.isPolling).toBe(false);
    });

    it('removes logs listener', async () => {
      await processor.start();
      processor.stop();

      expect(mockConnection.removeOnLogsListener).toHaveBeenCalledWith(1);
    });

    it('clears polling interval', async () => {
      await processor.start();
      processor.stop();

      // Advance time - should not trigger more polls
      const callsBefore = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock
        .calls.length;

      await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 10);

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledTimes(callsBefore);
    });

    it('can be called when not running', () => {
      expect(() => processor.stop()).not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('returns correct status when not polling', () => {
      const status = processor.getStatus();

      expect(status).toEqual({
        isPolling: false,
        processingCount: 0,
        failedCount: 0,
      });
    });

    it('returns correct status when polling', async () => {
      await processor.start();

      const status = processor.getStatus();
      expect(status.isPolling).toBe(true);
    });
  });

  describe('fetchPendingMarginOperations', () => {
    it('queries for V6 positions', async () => {
      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(dexProgramId, {
        filters: [{ dataSize: POSITION_ACCOUNT_SIZE_V6 }],
      });
    });

    it('returns positions with pending margin amount > 0', async () => {
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: requestId,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();

      // The processor should process the pending operation
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('filters out positions without pending margin operations', async () => {
      const positionPda = Keypair.generate().publicKey;

      // Position with no pending margin (amount = 0)
      const positionData = createMockPositionDataWithPendingMargin({
        pendingMarginAmount: 0n,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();

      // Should have queried but no operations to process
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
      expect(processor.getStatus().processingCount).toBe(0);
    });

    it('handles parse errors gracefully', async () => {
      const positionPda = Keypair.generate().publicKey;

      // Invalid/short data
      const badData = Buffer.alloc(50);

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: badData } },
      ]);

      // Should not throw
      await expect(processor.start()).resolves.not.toThrow();
    });
  });

  describe('processMarginOperation', () => {
    it('processes add margin operation', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);
      const encryptedCollateral = new Uint8Array(64).fill(2);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: requestId,
        encryptedCollateral,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();

      // Wait for processing
      await vi.advanceTimersByTimeAsync(100);

      expect(sendAndConfirmTransaction).toHaveBeenCalled();
    });

    it('processes remove margin operation', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 500000n,
        pendingMarginIsAdd: false, // remove
        pendingMpcRequest: requestId,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(sendAndConfirmTransaction).toHaveBeenCalled();
    });

    it('tracks processing operations correctly', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: requestId,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      // Verify initial state
      expect(processor.getStatus().processingCount).toBe(0);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      // After processing completes, count should be back to 0
      expect(processor.getStatus().processingCount).toBe(0);
      expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
    });

    it('retries failed operations', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: requestId,
      });

      // Fail first, succeed second
      (sendAndConfirmTransaction as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue('txsig');

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Trigger retry
      await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 2);

      expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(2);
    });

    it('stops retrying after max retries', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: requestId,
      });

      // Always fail
      (sendAndConfirmTransaction as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Always fails')
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();

      // First attempt
      await vi.advanceTimersByTimeAsync(100);

      // Trigger retries (max 3)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 2);
      }

      // Should have tried exactly maxRetries (3) times
      expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(3);
      expect(processor.getStatus().failedCount).toBe(1);
    });
  });

  describe('buildMarginMpcInstruction', () => {
    it('builds add_encrypted instruction with correct discriminator', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: requestId,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Check the transaction was built correctly
      expect(sendAndConfirmTransaction).toHaveBeenCalledWith(
        mockConnection,
        expect.any(Transaction),
        [crankKeypair],
        { commitment: 'confirmed' }
      );
    });

    it('builds sub_encrypted instruction for remove margin', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 500000n,
        pendingMarginIsAdd: false, // remove = sub_encrypted
        pendingMpcRequest: requestId,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(sendAndConfirmTransaction).toHaveBeenCalled();
    });

    it('includes correct account keys', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const requestId = new Uint8Array(32).fill(1);

      const positionData = createMockPositionDataWithPendingMargin({
        market,
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: requestId,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify transaction structure
      const call = (sendAndConfirmTransaction as ReturnType<typeof vi.fn>).mock.calls[0];
      const transaction = call[1] as Transaction;
      expect(transaction.instructions).toHaveLength(1);
      expect(transaction.instructions[0].programId.equals(mxeProgramId)).toBe(true);
    });
  });

  describe('event handling', () => {
    it('handles MarginOperationInitiated log', async () => {
      await processor.start();

      // Get the callback passed to onLogs
      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // Simulate log event
      const mockLogs: Logs = {
        signature: 'txsig123',
        err: null,
        logs: [
          'Program log: Instruction: AddMargin',
          'Program log: MarginOperationInitiated',
          'Program log: Request ID: abc123',
        ],
      };

      const mockContext: Context = { slot: 12345 };

      // Clear initial poll call count
      vi.clearAllMocks();

      // Trigger the callback
      onLogsCallback(mockLogs, mockContext);

      // Should trigger a poll
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('ignores logs without MarginOperationInitiated', async () => {
      await processor.start();

      const onLogsCallback = (mockConnection.onLogs as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const mockLogs: Logs = {
        signature: 'txsig123',
        err: null,
        logs: ['Program log: Some other instruction', 'Program log: Completed'],
      };

      const mockContext: Context = { slot: 12345 };

      vi.clearAllMocks();

      onLogsCallback(mockLogs, mockContext);

      // Should not trigger additional poll
      expect(mockConnection.getProgramAccounts).not.toHaveBeenCalled();
    });
  });

  describe('multiple operations', () => {
    it('processes multiple pending operations', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;

      const operations = [
        {
          pubkey: Keypair.generate().publicKey,
          data: createMockPositionDataWithPendingMargin({
            market,
            pendingMarginAmount: 1000000n,
            pendingMarginIsAdd: true,
            pendingMpcRequest: new Uint8Array(32).fill(1),
          }),
        },
        {
          pubkey: Keypair.generate().publicKey,
          data: createMockPositionDataWithPendingMargin({
            market,
            pendingMarginAmount: 500000n,
            pendingMarginIsAdd: false,
            pendingMpcRequest: new Uint8Array(32).fill(2),
          }),
        },
        {
          pubkey: Keypair.generate().publicKey,
          data: createMockPositionDataWithPendingMargin({
            market,
            pendingMarginAmount: 2000000n,
            pendingMarginIsAdd: true,
            pendingMpcRequest: new Uint8Array(32).fill(3),
          }),
        },
      ];

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(
        operations.map(({ pubkey, data }) => ({ pubkey, account: { data } }))
      );

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Should process all 3 operations
      expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(3);
    });

    it('handles mixed success and failure', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const market = Keypair.generate().publicKey;

      const operations = [
        {
          pubkey: Keypair.generate().publicKey,
          data: createMockPositionDataWithPendingMargin({
            market,
            pendingMarginAmount: 1000000n,
            pendingMarginIsAdd: true,
            pendingMpcRequest: new Uint8Array(32).fill(1),
          }),
        },
        {
          pubkey: Keypair.generate().publicKey,
          data: createMockPositionDataWithPendingMargin({
            market,
            pendingMarginAmount: 500000n,
            pendingMarginIsAdd: false,
            pendingMpcRequest: new Uint8Array(32).fill(2),
          }),
        },
      ];

      // First succeeds, second fails
      (sendAndConfirmTransaction as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('tx1')
        .mockRejectedValueOnce(new Error('Failed'));

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(
        operations.map(({ pubkey, data }) => ({ pubkey, account: { data } }))
      );

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(2);
      expect(processor.getStatus().failedCount).toBe(1);
    });
  });

  describe('position side handling', () => {
    it('processes long positions', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionDataWithPendingMargin({
        side: 0, // Long
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: new Uint8Array(32).fill(1),
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(sendAndConfirmTransaction).toHaveBeenCalled();
    });

    it('processes short positions', async () => {
      const { sendAndConfirmTransaction } = await import('@solana/web3.js');
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionDataWithPendingMargin({
        side: 1, // Short
        pendingMarginAmount: 1000000n,
        pendingMarginIsAdd: true,
        pendingMpcRequest: new Uint8Array(32).fill(1),
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      await processor.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(sendAndConfirmTransaction).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles getProgramAccounts failure gracefully', async () => {
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('RPC error')
      );

      await expect(processor.start()).resolves.not.toThrow();
    });

    it('continues polling after error', async () => {
      // First call fails, second succeeds
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('RPC error'))
        .mockResolvedValue([]);

      await processor.start();

      // Advance to trigger another poll
      await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 2);

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledTimes(2);
    });

    it('handles removeOnLogsListener failure', async () => {
      (mockConnection.removeOnLogsListener as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Cleanup error')
      );

      await processor.start();

      // Should not throw
      expect(() => processor.stop()).not.toThrow();
    });
  });
});
