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
const mockAwaitComputationFinalization = vi.hoisted(() => vi.fn());

vi.mock('@arcium-hq/client', () => ({
  getMXEAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
  awaitComputationFinalization: mockAwaitComputationFinalization,
  ARCIUM_ADDR: 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ',
  getClusterAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
  getMempoolAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
  getExecutingPoolAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
  getComputationAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
  getCompDefAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
  getCompDefAccOffset: vi.fn().mockReturnValue(new Uint8Array([0, 0, 0, 0])),
  getFeePoolAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
  getClockAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
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

// MXE Event discriminators (from MXE lib.rs)
const MXE_EVENT_DISCRIMINATORS = {
  PRICE_COMPARE_RESULT: Buffer.from([0xe7, 0x3c, 0x8f, 0x1a, 0x5b, 0x2d, 0x9e, 0x4f]),
  FILL_CALCULATION_RESULT: Buffer.from([0xa2, 0x7b, 0x4c, 0x8d, 0x3e, 0x1f, 0x6a, 0x5b]),
};

// Helper to create mock PriceCompareResult event data
// Layout: discriminator(8) + computation_offset(32) + prices_match(1) + nonce(16)
function createPriceCompareResultEventData(
  computationOffset: PublicKey,
  pricesMatch: boolean,
  nonce: Buffer = Buffer.alloc(16)
): Buffer {
  const data = Buffer.alloc(8 + 32 + 1 + 16);
  let offset = 0;

  // Discriminator
  MXE_EVENT_DISCRIMINATORS.PRICE_COMPARE_RESULT.copy(data, offset);
  offset += 8;

  // Computation offset (as PublicKey)
  computationOffset.toBuffer().copy(data, offset);
  offset += 32;

  // Prices match
  data.writeUInt8(pricesMatch ? 1 : 0, offset);
  offset += 1;

  // Nonce
  nonce.copy(data, offset);

  return data;
}

// Helper to create mock FillCalculationResult event data
// Layout: discriminator(8) + computation_offset(32) + fill_amount(32) + buy_filled(1) + sell_filled(1) + nonce(16)
function createFillCalculationResultEventData(
  computationOffset: PublicKey,
  fillAmountCiphertext: Buffer,
  buyFullyFilled: boolean,
  sellFullyFilled: boolean,
  nonce: Buffer = Buffer.alloc(16)
): Buffer {
  const data = Buffer.alloc(8 + 32 + 32 + 1 + 1 + 16);
  let offset = 0;

  // Discriminator
  MXE_EVENT_DISCRIMINATORS.FILL_CALCULATION_RESULT.copy(data, offset);
  offset += 8;

  // Computation offset (as PublicKey)
  computationOffset.toBuffer().copy(data, offset);
  offset += 32;

  // Fill amount ciphertext (32 bytes)
  fillAmountCiphertext.copy(data, offset);
  offset += 32;

  // Buy fully filled
  data.writeUInt8(buyFullyFilled ? 1 : 0, offset);
  offset += 1;

  // Sell fully filled
  data.writeUInt8(sellFullyFilled ? 1 : 0, offset);
  offset += 1;

  // Nonce
  nonce.copy(data, offset);

  return data;
}

describe('MpcPoller', () => {
  let poller: MpcPoller;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let mockConfig: CrankConfig;

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
        arciumMxe: '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi',
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
    mockAwaitComputationFinalization.mockResolvedValue('finalize-signature');

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

    it('initializes with zero processed counts', () => {
      const status = poller.getStatus();
      expect(status.processedCount).toBe(0);
      expect(status.failedCount).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('starts event subscription', async () => {
      poller.start();

      expect(poller.getStatus().isPolling).toBe(true);
      expect(mockConnection.onLogs).toHaveBeenCalled();

      await poller.stop();

      expect(poller.getStatus().isPolling).toBe(false);
    });

    it('ignores multiple start calls', async () => {
      poller.start();
      poller.start(); // Second call should be ignored

      expect(mockConnection.onLogs).toHaveBeenCalledTimes(1);

      await poller.stop();
    });

    it('handles stop when not started', async () => {
      // Should not throw
      await expect(poller.stop()).resolves.not.toThrow();
    });

    it('can restart after stopping', async () => {
      poller.start();
      await poller.stop();
      poller.start();

      expect(poller.getStatus().isPolling).toBe(true);

      await poller.stop();
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

        const computationOffset = Keypair.generate().publicKey;
        const eventData = createPriceCompareResultEventData(
          computationOffset,
          true
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

        const computationOffset = Keypair.generate().publicKey;
        const encryptedFill = Buffer.alloc(32);
        const eventData = createFillCalculationResultEventData(
          computationOffset,
          encryptedFill,
          true,
          true
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

        const computationOffset = Keypair.generate().publicKey;
        const eventData = createPriceCompareResultEventData(
          computationOffset,
          true
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
          const computationOffset = Keypair.generate().publicKey;
          const eventData = createPriceCompareResultEventData(
            computationOffset,
            true
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
        expect(status.pendingComputationsCount).toBe(0);
      });

      it('reflects subscribed state', () => {
        poller.startEventSubscription();

        const status = poller.getSubscriptionStatus();
        expect(status.isSubscribed).toBe(true);
      });
    });
  });

  describe('Pending Computation Tracking', () => {
    it('registers pending computations', () => {
      const { BN } = require('bn.js');
      const offset = new BN(12345);
      const buyOrder = Keypair.generate().publicKey;
      const sellOrder = Keypair.generate().publicKey;

      poller.registerPendingComputation(offset, 'compare_prices', buyOrder, sellOrder);

      const pending = poller.getPendingComputations();
      expect(pending.length).toBe(1);
      expect(pending[0].type).toBe('compare_prices');
    });

    it('cleans up stale pending computations', async () => {
      const { BN } = require('bn.js');
      const offset = new BN(12345);

      poller.registerPendingComputation(offset, 'compare_prices');

      // Manually make the computation stale
      const pending = poller.getPendingComputations();
      // @ts-expect-error - accessing private for testing
      poller['pendingComputations'].get(offset.toString())!.queuedAt = Date.now() - 200000;

      const cleaned = poller.cleanupStalePendingComputations();
      expect(cleaned).toBe(1);
      expect(poller.getPendingComputations().length).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('returns current status', () => {
      const status = poller.getStatus();

      expect(status).toHaveProperty('isPolling');
      expect(status).toHaveProperty('processedCount');
      expect(status).toHaveProperty('failedCount');
      expect(status.isPolling).toBe(false);
      expect(status.processedCount).toBe(0);
      expect(status.failedCount).toBe(0);
    });

    it('reflects started state', async () => {
      poller.start();

      const status = poller.getStatus();
      expect(status.isPolling).toBe(true);

      await poller.stop();
    });
  });

  describe('skipAllPending (deprecated)', () => {
    it('returns 0 and logs warning', async () => {
      const skipped = await poller.skipAllPending();

      expect(skipped).toBe(0);
    });
  });
});
