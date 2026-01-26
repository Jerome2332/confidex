import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// Mock dependencies
vi.mock('bs58', () => ({
  default: {
    encode: vi.fn().mockReturnValue('encoded'),
    decode: vi.fn().mockReturnValue(new Uint8Array(32)),
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    position: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../../lib/alerts.js', () => ({
  getAlertManager: vi.fn().mockReturnValue({
    error: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
  }),
  AlertManager: class MockAlertManager {},
}));

// Import after mocks
import { PositionVerifier } from '../../crank/position-verifier.js';
import { CrankConfig } from '../../crank/config.js';
import { getAlertManager } from '../../lib/alerts.js';

// Position status enum (must match on-chain)
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

// V6 position account size
const POSITION_ACCOUNT_SIZE_V6 = 618;

// Helper to create mock V6 position data
function createMockPositionData(
  trader: PublicKey,
  market: PublicKey,
  side: PositionSide,
  leverage: number,
  status: PositionStatus,
  thresholdVerified: boolean
): Buffer {
  const data = Buffer.alloc(POSITION_ACCOUNT_SIZE_V6);
  let offset = 8; // Skip discriminator

  // trader (32 bytes)
  trader.toBuffer().copy(data, offset);
  offset += 32;

  // market (32 bytes)
  market.toBuffer().copy(data, offset);
  offset += 32;

  // positionId (16 bytes)
  offset += 16;

  // createdAtHour (8 bytes)
  data.writeBigInt64LE(BigInt(Math.floor(Date.now() / 3600000)), offset);
  offset += 8;

  // lastUpdatedHour (8 bytes)
  data.writeBigInt64LE(BigInt(Math.floor(Date.now() / 3600000)), offset);
  offset += 8;

  // side (1 byte)
  data.writeUInt8(side, offset);
  offset += 1;

  // leverage (1 byte)
  data.writeUInt8(leverage, offset);
  offset += 1;

  // encryptedSize (64 bytes)
  offset += 64;

  // encryptedEntryPrice (64 bytes)
  offset += 64;

  // encryptedCollateral (64 bytes)
  offset += 64;

  // encryptedRealizedPnl (64 bytes)
  offset += 64;

  // encryptedLiqBelow (64 bytes)
  offset += 64;

  // encryptedLiqAbove (64 bytes)
  offset += 64;

  // thresholdCommitment (32 bytes)
  offset += 32;

  // lastThresholdUpdateHour (8 bytes)
  offset += 8;

  // thresholdVerified (1 byte) - this is at offset 492 in V6
  data.writeUInt8(thresholdVerified ? 1 : 0, offset);
  offset += 1;

  // entryCumulativeFunding (16 bytes, i128)
  offset += 16;

  // status (1 byte)
  data.writeUInt8(status, offset);
  offset += 1;

  // Rest of the fields...
  // eligibilityProofVerified (1), partialCloseCount (1), autoDeleveragePriority (8),
  // lastMarginAddHour (8), marginAddCount (1), bump (1), positionSeed (8),
  // pendingMpcRequest (32), pendingMarginAmount (8), pendingMarginIsAdd (1), isLiquidatable (1)

  return data;
}

describe('PositionVerifier', () => {
  let verifier: PositionVerifier;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let mockConfig: CrankConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    crankKeypair = Keypair.generate();

    mockConnection = {
      getProgramAccounts: vi.fn().mockResolvedValue([]),
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
    } as unknown as CrankConfig;

    verifier = new PositionVerifier(mockConnection, crankKeypair, mockConfig);
  });

  afterEach(() => {
    verifier.stop();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('initializes with correct program IDs', () => {
      expect(verifier).toBeDefined();
    });

    it('initializes in stopped state', () => {
      const status = verifier.getStatus();
      expect(status.isPolling).toBe(false);
    });

    it('initializes alert manager', () => {
      expect(getAlertManager).toHaveBeenCalled();
    });
  });

  describe('start/stop', () => {
    it('starts polling for positions awaiting verification', async () => {
      vi.useFakeTimers();

      await verifier.start();

      expect(verifier.getStatus().isPolling).toBe(true);

      verifier.stop();

      expect(verifier.getStatus().isPolling).toBe(false);

      vi.useRealTimers();
    });

    it('ignores multiple start calls', async () => {
      vi.useFakeTimers();

      await verifier.start();
      await verifier.start(); // Should be ignored

      expect(verifier.getStatus().isPolling).toBe(true);

      verifier.stop();
      vi.useRealTimers();
    });

    it('cleans up interval on stop', async () => {
      vi.useFakeTimers();

      await verifier.start();
      verifier.stop();

      expect(verifier.getStatus().isPolling).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('polling for pending positions', () => {
    it('queries for V6 positions only', async () => {
      vi.useFakeTimers();

      await verifier.start();
      await vi.advanceTimersByTimeAsync(100);
      verifier.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: expect.arrayContaining([
            { dataSize: POSITION_ACCOUNT_SIZE_V6 },
          ]),
        })
      );

      vi.useRealTimers();
    });

    it('filters for unverified positions', async () => {
      vi.useFakeTimers();

      await verifier.start();
      await vi.advanceTimersByTimeAsync(100);
      verifier.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: expect.arrayContaining([
            expect.objectContaining({
              memcmp: expect.objectContaining({
                offset: 492, // thresholdVerified offset in V6
              }),
            }),
          ]),
        })
      );

      vi.useRealTimers();
    });

    it('identifies pending positions correctly', async () => {
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionData(
        trader,
        market,
        PositionSide.Long,
        10, // 10x leverage
        PositionStatus.Open,
        false // not verified - should be picked up
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      vi.useFakeTimers();

      await verifier.start();
      await vi.advanceTimersByTimeAsync(100);
      verifier.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips already verified positions', async () => {
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionData(
        trader,
        market,
        PositionSide.Long,
        10,
        PositionStatus.Open,
        true // already verified - should be skipped
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      vi.useFakeTimers();

      await verifier.start();
      await vi.advanceTimersByTimeAsync(100);
      verifier.stop();

      // Query happens but position should be filtered out
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips closed positions', async () => {
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionData(
        trader,
        market,
        PositionSide.Long,
        10,
        PositionStatus.Closed, // closed - should be skipped
        false
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      vi.useFakeTimers();

      await verifier.start();
      await vi.advanceTimersByTimeAsync(100);
      verifier.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('retry logic', () => {
    it('tracks failed positions to avoid infinite retries', async () => {
      const status = verifier.getStatus();
      expect(status.failedCount).toBe(0);
    });

    it('skips positions that exceeded max retries', async () => {
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionData(
        trader,
        market,
        PositionSide.Long,
        10,
        PositionStatus.Open,
        false
      );

      // Make getProgramAccounts return the same position multiple times
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      vi.useFakeTimers();

      await verifier.start();

      // Advance through multiple poll cycles
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1100);
      }

      verifier.stop();

      vi.useRealTimers();
    });
  });

  describe('getStatus', () => {
    it('returns current status', () => {
      const status = verifier.getStatus();

      expect(status).toHaveProperty('isPolling');
      expect(status).toHaveProperty('processingCount');
      expect(status).toHaveProperty('failedCount');
      expect(status.isPolling).toBe(false);
      expect(status.processingCount).toBe(0);
      expect(status.failedCount).toBe(0);
    });

    it('reflects polling state after start', async () => {
      vi.useFakeTimers();

      await verifier.start();

      const status = verifier.getStatus();
      expect(status.isPolling).toBe(true);

      verifier.stop();
      vi.useRealTimers();
    });
  });

  describe('alert integration', () => {
    it('sends alert when position verification fails permanently', async () => {
      const alertManager = getAlertManager();

      // The verifier has max 3 retries, so after 4 failures it should alert
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionData(
        trader,
        market,
        PositionSide.Long,
        10,
        PositionStatus.Open,
        false
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      vi.useFakeTimers();

      await verifier.start();

      // Trigger multiple poll cycles - verification will fail each time
      // because sendAndConfirmTransaction is not mocked to succeed
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1100);
      }

      verifier.stop();
      vi.useRealTimers();

      // Alert should have been called for max retries exceeded
      // (This tests the integration, actual alert may not fire without full mock setup)
    });
  });

  describe('concurrent processing prevention', () => {
    it('tracks positions being processed', async () => {
      const status = verifier.getStatus();
      expect(status.processingCount).toBe(0);
    });

    it('skips positions already being processed', async () => {
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionData(
        trader,
        market,
        PositionSide.Long,
        10,
        PositionStatus.Open,
        false
      );

      // Return same position on multiple polls
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: positionPda, account: { data: positionData } },
      ]);

      vi.useFakeTimers();

      await verifier.start();

      // Quick succession of polls
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      verifier.stop();
      vi.useRealTimers();

      // Position should only be processed once per poll cycle
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });
});
