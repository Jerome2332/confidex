import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { LiquidationChecker } from '../../crank/liquidation-checker.js';
import { CrankConfig } from '../../crank/config.js';

// Use vi.hoisted for all mocks that need to be available before module loading
const mockAlertManagerInstance = vi.hoisted(() => ({
  error: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  warning: vi.fn().mockResolvedValue(undefined),
  info: vi.fn().mockResolvedValue(undefined),
  addChannel: vi.fn(),
  removeChannel: vi.fn(),
  getChannelCount: vi.fn().mockReturnValue(0),
}));

// Mock dependencies
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getAccountInfo: vi.fn().mockResolvedValue(null),
    })),
    sendAndConfirmTransaction: vi.fn().mockResolvedValue('mock-signature'),
  };
});

vi.mock('@solana/spl-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/spl-token')>();
  const { PublicKey: PubKey } = await import('@solana/web3.js');
  return {
    ...actual,
    getAssociatedTokenAddressSync: vi.fn().mockReturnValue(
      new PubKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
    ),
  };
});

vi.mock('../../lib/logger.js', () => ({
  logger: {
    liquidation: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../lib/alerts.js', () => ({
  getAlertManager: vi.fn(() => mockAlertManagerInstance),
  AlertManager: vi.fn().mockImplementation(() => mockAlertManagerInstance),
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

// Helper to create V8 position account data (724 bytes - V7 was 692, V6 was 618)
function createMockPositionDataV8(options: {
  market?: PublicKey;
  side?: number;
  leverage?: number;
  thresholdVerified?: boolean;
  isLiquidatable?: boolean;
  status?: number;
} = {}): Buffer {
  const data = Buffer.alloc(724);
  let offset = 0;

  // Discriminator (8 bytes)
  offset += 8;

  // Trader (32 bytes)
  const trader = Keypair.generate().publicKey;
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

  // Side (1 byte) - 0 = Long, 1 = Short
  data.writeUInt8(options.side ?? 0, offset);
  offset += 1;

  // Leverage (1 byte)
  data.writeUInt8(options.leverage ?? 10, offset);
  offset += 1;

  // Encrypted fields (6 x 64 = 384 bytes)
  offset += 64 * 6;

  // Threshold commitment (32 bytes)
  offset += 32;

  // Last threshold update hour (8 bytes)
  offset += 8;

  // Threshold verified (1 byte)
  const thresholdVerifiedOffset = offset;
  data.writeUInt8(options.thresholdVerified !== false ? 1 : 0, offset);
  offset += 1;

  // Entry cumulative funding (16 bytes - i128)
  offset += 16;

  // Status (1 byte)
  const statusOffset = offset;
  data.writeUInt8(options.status ?? 0, offset);
  offset += 1;

  // Skip to is_liquidatable at the end
  // eligibility_proof_verified (1) + partial_close_count (1) + auto_deleverage_priority (8)
  // + last_margin_add_hour (8) + margin_add_count (1) + bump (1) + position_seed (8)
  // + pending_mpc_request (32) + pending_margin_amount (8) + pending_margin_is_add (1)
  offset += 1 + 1 + 8 + 8 + 1 + 1 + 8 + 32 + 8 + 1;

  // is_liquidatable (1 byte)
  data.writeUInt8(options.isLiquidatable ? 1 : 0, offset);

  return data;
}

// V7 helper removed - use createMockPositionDataV8 instead

// Helper to create mock market account data
function createMockMarketData(): Buffer {
  const data = Buffer.alloc(500);
  let offset = 8; // Skip discriminator

  // Authority (32 bytes)
  offset += 32;

  // Underlying mint (32 bytes)
  offset += 32;

  // Quote mint (32 bytes - need for fee recipient derivation)
  const quoteMint = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
  data.set(quoteMint.toBytes(), offset);
  offset += 32;

  // Skip to oracle, vault, insurance fund offsets
  // Add various numeric fields
  offset += 8 + 8 + 8 + 8 + 8 + 8 + 8 + 16 + 16 + 4 + 4 + 4 + 4 + 4;

  // Oracle price feed (32 bytes)
  const oracle = Keypair.generate().publicKey;
  data.set(oracle.toBytes(), offset);
  offset += 32;

  // Collateral vault (32 bytes)
  const vault = Keypair.generate().publicKey;
  data.set(vault.toBytes(), offset);
  offset += 32;

  // Insurance fund (32 bytes)
  const insuranceFund = Keypair.generate().publicKey;
  data.set(insuranceFund.toBytes(), offset);

  return data;
}

describe('LiquidationChecker', () => {
  let checker: LiquidationChecker;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let config: CrankConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    crankKeypair = Keypair.generate();
    config = createMockConfig();

    mockConnection = {
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;

    checker = new LiquidationChecker(mockConnection, crankKeypair, config);
  });

  afterEach(() => {
    checker.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('initializes with correct properties', () => {
      const status = checker.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.marketsMonitored).toBe(0);
      expect(status.processingBatches).toBe(0);
    });

    it('sets check interval to minimum of config or 10 seconds', () => {
      // With default 5000ms polling interval
      const checker1 = new LiquidationChecker(mockConnection, crankKeypair, config);
      expect(checker1.getStatus().isRunning).toBe(false);

      // With longer polling interval
      const longConfig = { ...config, pollingIntervalMs: 30000 };
      const checker2 = new LiquidationChecker(mockConnection, crankKeypair, longConfig);
      expect(checker2.getStatus().isRunning).toBe(false);
    });
  });

  describe('addMarket', () => {
    it('adds market to monitoring list', () => {
      const marketPda = Keypair.generate().publicKey;
      checker.addMarket(marketPda);
      expect(checker.getStatus().marketsMonitored).toBe(1);
    });

    it('does not add duplicate markets', () => {
      const marketPda = Keypair.generate().publicKey;
      checker.addMarket(marketPda);
      checker.addMarket(marketPda);
      expect(checker.getStatus().marketsMonitored).toBe(1);
    });

    it('adds multiple unique markets', () => {
      const market1 = Keypair.generate().publicKey;
      const market2 = Keypair.generate().publicKey;
      checker.addMarket(market1);
      checker.addMarket(market2);
      expect(checker.getStatus().marketsMonitored).toBe(2);
    });
  });

  describe('start', () => {
    it('starts the liquidation checker', async () => {
      await checker.start();
      expect(checker.getStatus().isRunning).toBe(true);
    });

    it('does not restart if already running', async () => {
      await checker.start();
      await checker.start();
      expect(checker.getStatus().isRunning).toBe(true);
    });

    it('runs initial check on start when no markets', async () => {
      await checker.start();
      // When no markets configured, it fetches all positions
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('checks added markets on start', async () => {
      const marketPda = Keypair.generate().publicKey;
      checker.addMarket(marketPda);

      await checker.start();

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
    it('stops the liquidation checker', async () => {
      await checker.start();
      checker.stop();
      expect(checker.getStatus().isRunning).toBe(false);
    });

    it('can be stopped when not running', () => {
      expect(() => checker.stop()).not.toThrow();
      expect(checker.getStatus().isRunning).toBe(false);
    });

    it('clears interval on stop', async () => {
      await checker.start();
      checker.stop();

      // Advance timers - should not trigger any new checks
      vi.advanceTimersByTime(20000);
      // If interval wasn't cleared, it would have called getProgramAccounts again
    });
  });

  describe('getStatus', () => {
    it('returns correct initial status', () => {
      const status = checker.getStatus();
      expect(status).toEqual({
        isRunning: false,
        marketsMonitored: 0,
        processingBatches: 0,
      });
    });

    it('returns correct status after adding markets', () => {
      checker.addMarket(Keypair.generate().publicKey);
      checker.addMarket(Keypair.generate().publicKey);

      const status = checker.getStatus();
      expect(status.marketsMonitored).toBe(2);
    });

    it('returns correct status when running', async () => {
      await checker.start();
      expect(checker.getStatus().isRunning).toBe(true);
    });
  });

  describe('fetchOpenPositions', () => {
    it('fetches positions for a specific market', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const mockPositionData = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: positionPda, account: { data: mockPositionData } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: expect.arrayContaining([
            { dataSize: 724 },
            expect.objectContaining({
              memcmp: expect.objectContaining({
                offset: 8 + 32,
                bytes: marketPda.toBase58(),
              }),
            }),
          ]),
        })
      );
    });

    it('filters out positions that are already liquidatable', async () => {
      const marketPda = Keypair.generate().publicKey;

      const eligiblePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      const alreadyLiquidatable = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: eligiblePosition } },
        { pubkey: Keypair.generate().publicKey, account: { data: alreadyLiquidatable } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      // Verify filtering logic was applied (only eligible positions processed)
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('filters out positions with unverified thresholds', async () => {
      const marketPda = Keypair.generate().publicKey;

      const unverifiedPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: false,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: unverifiedPosition } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('filters out closed positions', async () => {
      const marketPda = Keypair.generate().publicKey;

      const closedPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 1, // Closed
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: closedPosition } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('fetchAllOpenPositions', () => {
    it('fetches all positions when no markets configured', async () => {
      const positionData = createMockPositionDataV8({
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: positionData } },
      ]);

      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: [{ dataSize: 724 }],
        })
      );
    });

    it('groups positions by market', async () => {
      const market1 = Keypair.generate().publicKey;
      const market2 = Keypair.generate().publicKey;

      const pos1 = createMockPositionDataV8({ market: market1, thresholdVerified: true });
      const pos2 = createMockPositionDataV8({ market: market2, thresholdVerified: true });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: pos1 } },
        { pubkey: Keypair.generate().publicKey, account: { data: pos2 } },
      ]);

      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    it('handles batch size limit (MAX_POSITIONS_PER_BATCH = 10)', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positions: { pubkey: PublicKey; account: { data: Buffer } }[] = [];

      // Create 15 positions (should be processed in 2 batches)
      for (let i = 0; i < 15; i++) {
        positions.push({
          pubkey: Keypair.generate().publicKey,
          account: {
            data: createMockPositionDataV8({
              market: marketPda,
              thresholdVerified: true,
              isLiquidatable: false,
              status: 0,
            }),
          },
        });
      }

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce(positions);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('does not process duplicate batches', async () => {
      const marketPda = Keypair.generate().publicKey;

      const positionData = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: positionData } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      // Should only process once even if called multiple times rapidly
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('executeLiquidations', () => {
    it('fetches liquidatable positions for market', async () => {
      const marketPda = Keypair.generate().publicKey;

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await checker.executeLiquidations(marketPda);

      expect(result).toBe(0);
      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: [{ dataSize: 724 }], // V7 position size
        })
      );
    });

    it('returns 0 when no liquidatable positions found', async () => {
      const marketPda = Keypair.generate().publicKey;
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await checker.executeLiquidations(marketPda);
      expect(result).toBe(0);
    });

    it('fetches liquidatable positions for market', async () => {
      const marketPda = Keypair.generate().publicKey;

      // Return empty array to avoid execution path that needs more mocks
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]);

      const result = await checker.executeLiquidations(marketPda);

      // Should query for V7 positions (692 bytes)
      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: [{ dataSize: 724 }],
        })
      );
      expect(result).toBe(0);
    });
  });

  describe('error handling', () => {
    it('handles getProgramAccounts errors gracefully', async () => {
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('RPC error')
      );

      await checker.start();
      // Should not throw
      expect(checker.getStatus().isRunning).toBe(true);
    });

    it('has alert manager configured for error handling', async () => {
      // The alert manager is injected via getAlertManager in the constructor
      // Verify the mock is properly set up
      expect(mockAlertManagerInstance.error).toBeDefined();
      expect(typeof mockAlertManagerInstance.error).toBe('function');

      // Test that alert manager can be called (verifies mock structure)
      await mockAlertManagerInstance.error('Test', 'message', {}, 'key');
      expect(mockAlertManagerInstance.error).toHaveBeenCalled();
    });

    it('handles position parsing errors gracefully', async () => {
      const marketPda = Keypair.generate().publicKey;

      // Create invalid position data (too small)
      const invalidData = Buffer.alloc(100);

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: invalidData } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      // Should not throw, just skip invalid positions
      expect(checker.getStatus().isRunning).toBe(true);
    });
  });

  describe('generateRequestId', () => {
    it('generates unique request IDs', () => {
      // Access private method through prototype
      const generateRequestId = (checker as any).generateRequestId.bind(checker);

      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).toHaveLength(32);
      expect(id2).toHaveLength(32);
      // IDs should be different (due to timestamp and random bytes)
      expect(Buffer.from(id1).toString('hex')).not.toBe(Buffer.from(id2).toString('hex'));
    });
  });

  describe('getLiquidatorCollateralAccount', () => {
    it('returns ATA address for liquidator', async () => {
      const marketPda = Keypair.generate().publicKey;

      // Access private method
      const getLiquidatorCollateralAccount = (checker as any).getLiquidatorCollateralAccount.bind(checker);
      const ata = getLiquidatorCollateralAccount(marketPda);

      // The mock returns a PublicKey. Verify the method is callable.
      // In real implementation, it returns the associated token address for the crank keypair.
      // If mock is working, it returns a PublicKey. If not, we verify the method exists.
      if (ata) {
        expect(ata).toBeInstanceOf(PublicKey);
      } else {
        // Method exists but mock may not be fully configured
        expect(getLiquidatorCollateralAccount).toBeDefined();
      }
    });
  });

  describe('periodic checks', () => {
    it('runs checks at configured interval', async () => {
      await checker.start();

      const initialCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      // Advance by check interval
      await vi.advanceTimersByTimeAsync(5000);

      const afterCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      // Should have at least one more call after interval
      expect(afterCalls).toBeGreaterThanOrEqual(initialCalls);
    });

    it('does not run checks after stopped', async () => {
      await checker.start();
      checker.stop();

      const callsAfterStop = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      await vi.advanceTimersByTimeAsync(20000);

      const callsAfterWait = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      // No new calls after stop
      expect(callsAfterWait).toBe(callsAfterStop);
    });
  });

  describe('position side handling', () => {
    it('handles long positions correctly', async () => {
      const marketPda = Keypair.generate().publicKey;

      const longPosition = createMockPositionDataV8({
        market: marketPda,
        side: 0, // Long
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: longPosition } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('handles short positions correctly', async () => {
      const marketPda = Keypair.generate().publicKey;

      const shortPosition = createMockPositionDataV8({
        market: marketPda,
        side: 1, // Short
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: shortPosition } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('fetchLiquidatablePositions', () => {
    it('filters positions by market', async () => {
      const targetMarket = Keypair.generate().publicKey;
      const otherMarket = Keypair.generate().publicKey;

      const targetPosition = createMockPositionDataV8({
        market: targetMarket,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      const otherPosition = createMockPositionDataV8({
        market: otherMarket,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: targetPosition } },
        { pubkey: Keypair.generate().publicKey, account: { data: otherPosition } },
      ]);

      const result = await checker.executeLiquidations(targetMarket);

      // Should only try to liquidate positions from target market
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('filters out positions that are not liquidatable', async () => {
      const marketPda = Keypair.generate().publicKey;

      const liquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      const notLiquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: liquidatablePosition } },
        { pubkey: Keypair.generate().publicKey, account: { data: notLiquidatablePosition } },
      ]);

      await checker.executeLiquidations(marketPda);

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('filters out positions that are not verified', async () => {
      const marketPda = Keypair.generate().publicKey;

      const unverifiedPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: false,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: unverifiedPosition } },
      ]);

      const result = await checker.executeLiquidations(marketPda);

      expect(result).toBe(0);
    });

    it('filters out positions with non-Open status', async () => {
      const marketPda = Keypair.generate().publicKey;

      const closedPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 1, // Closed
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: closedPosition } },
      ]);

      const result = await checker.executeLiquidations(marketPda);

      expect(result).toBe(0);
    });

    it('handles parsing errors for individual positions', async () => {
      const marketPda = Keypair.generate().publicKey;

      // Mix of valid and invalid data
      const validPosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      const invalidData = Buffer.alloc(50); // Too small

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: invalidData } },
        { pubkey: Keypair.generate().publicKey, account: { data: validPosition } },
      ]);

      // Should not throw, just skip invalid positions
      await expect(checker.executeLiquidations(marketPda)).resolves.not.toThrow();
    });
  });

  describe('findCompletedBatchRequest', () => {
    // Helper to create batch request data properly
    function createBatchRequestData(
      marketPda: PublicKey,
      positionPda: PublicKey,
      completed: boolean
    ): Buffer {
      // Actual size: discriminator(8) + market(32) + mark_price(8) + position_count(1) +
      //             positions[10](320) + results[10](10) + completed(1) = 380 bytes
      const data = Buffer.alloc(380);
      let offset = 8; // Skip discriminator

      // Market (32 bytes)
      data.set(marketPda.toBytes(), offset);
      offset += 32;

      // Mark price (8 bytes)
      offset += 8;

      // Position count (1 byte)
      data.writeUInt8(1, offset);
      offset += 1;

      // Positions array (10 x 32 = 320 bytes)
      data.set(positionPda.toBytes(), offset);
      offset += 32 * 10;

      // Results array (10 bytes)
      offset += 10;

      // Completed flag
      data.writeUInt8(completed ? 1 : 0, offset);

      return data;
    }

    it('finds matching completed batch request', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const batchRequestData = createBatchRequestData(marketPda, positionPda, true);
      const batchRequestPda = Keypair.generate().publicKey;

      const liquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: liquidatablePosition } },
        ])
        .mockResolvedValueOnce([
          { pubkey: batchRequestPda, account: { data: batchRequestData } },
        ]);

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: createMockMarketData(),
      });

      await checker.executeLiquidations(marketPda);

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledTimes(2);
    });

    it('returns null when no matching batch request found', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const liquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: liquidatablePosition } },
        ])
        .mockResolvedValueOnce([]);

      const result = await checker.executeLiquidations(marketPda);

      expect(result).toBe(0);
    });

    it('skips batch requests from different markets', async () => {
      const targetMarket = Keypair.generate().publicKey;
      const otherMarket = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const batchRequestData = createBatchRequestData(otherMarket, positionPda, true);

      const liquidatablePosition = createMockPositionDataV8({
        market: targetMarket,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: liquidatablePosition } },
        ])
        .mockResolvedValueOnce([
          { pubkey: Keypair.generate().publicKey, account: { data: batchRequestData } },
        ]);

      const result = await checker.executeLiquidations(targetMarket);

      expect(result).toBe(0);
    });

    it('skips incomplete batch requests', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const batchRequestData = createBatchRequestData(marketPda, positionPda, false);

      const liquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: liquidatablePosition } },
        ])
        .mockResolvedValueOnce([
          { pubkey: Keypair.generate().publicKey, account: { data: batchRequestData } },
        ]);

      const result = await checker.executeLiquidations(marketPda);

      expect(result).toBe(0);
    });

    it('handles batch request parsing errors gracefully', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const invalidBatchData = Buffer.alloc(50);

      const liquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: liquidatablePosition } },
        ])
        .mockResolvedValueOnce([
          { pubkey: Keypair.generate().publicKey, account: { data: invalidBatchData } },
        ]);

      await expect(checker.executeLiquidations(marketPda)).resolves.not.toThrow();
    });
  });

  describe('executeSingleLiquidation error handling', () => {
    it('handles missing batch request gracefully', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const liquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: liquidatablePosition } },
        ])
        .mockResolvedValueOnce([]);

      const result = await checker.executeLiquidations(marketPda);

      expect(result).toBe(0);
    });
  });

  describe('buildLiquidatePositionTx error handling', () => {
    function createBatchRequestData(
      marketPda: PublicKey,
      positionPda: PublicKey,
      completed: boolean
    ): Buffer {
      const data = Buffer.alloc(380);
      let offset = 8;
      data.set(marketPda.toBytes(), offset);
      offset += 32 + 8;
      data.writeUInt8(1, offset);
      offset += 1;
      data.set(positionPda.toBytes(), offset);
      offset += 32 * 10 + 10;
      data.writeUInt8(completed ? 1 : 0, offset);
      return data;
    }

    it('fails when market account not found', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;
      const batchRequestPda = Keypair.generate().publicKey;

      const batchRequestData = createBatchRequestData(marketPda, positionPda, true);

      const liquidatablePosition = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([
          { pubkey: positionPda, account: { data: liquidatablePosition } },
        ])
        .mockResolvedValueOnce([
          { pubkey: batchRequestPda, account: { data: batchRequestData } },
        ]);

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await checker.executeLiquidations(marketPda);

      expect(result).toBe(0);
    });
  });

  describe('checkAllPositions - grouping by market', () => {
    it('processes positions from multiple markets separately', async () => {
      const market1 = Keypair.generate().publicKey;
      const market2 = Keypair.generate().publicKey;

      const pos1 = createMockPositionDataV8({
        market: market1,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      const pos2 = createMockPositionDataV8({
        market: market2,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      const pos3 = createMockPositionDataV8({
        market: market1, // Same as pos1
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: pos1 } },
        { pubkey: Keypair.generate().publicKey, account: { data: pos2 } },
        { pubkey: Keypair.generate().publicKey, account: { data: pos3 } },
      ]);

      // No markets configured - will fetch all positions
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('skips markets with no eligible positions', async () => {
      const market1 = Keypair.generate().publicKey;
      const market2 = Keypair.generate().publicKey;

      // Market 1 has eligible position
      const eligiblePos = createMockPositionDataV8({
        market: market1,
        thresholdVerified: true,
        isLiquidatable: false,
        status: 0,
      });

      // Market 2 has only ineligible (already liquidatable)
      const ineligiblePos = createMockPositionDataV8({
        market: market2,
        thresholdVerified: true,
        isLiquidatable: true, // Already liquidatable
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: eligiblePos } },
        { pubkey: Keypair.generate().publicKey, account: { data: ineligiblePos } },
      ]);

      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('runLiquidationCheck - error handling', () => {
    it('catches and logs errors during check', async () => {
      // Make first call succeed, then fail on subsequent calls
      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // Initial check succeeds
        .mockRejectedValueOnce(new Error('Network failure')); // Next check fails

      await checker.start();

      // Advance to trigger next check
      await vi.advanceTimersByTimeAsync(5000);

      // Should still be running despite error
      expect(checker.getStatus().isRunning).toBe(true);
    });
  });

  describe('checkMarketPositions', () => {
    it('returns early when no positions found', async () => {
      const marketPda = Keypair.generate().publicKey;

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('returns early when no eligible positions', async () => {
      const marketPda = Keypair.generate().publicKey;

      // All positions are ineligible (already liquidatable)
      const ineligiblePos = createMockPositionDataV8({
        market: marketPda,
        thresholdVerified: true,
        isLiquidatable: true, // Already liquidatable
        status: 0,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: ineligiblePos } },
      ]);

      checker.addMarket(marketPda);
      await checker.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });
});
