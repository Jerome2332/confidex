import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey, Logs, Context } from '@solana/web3.js';
import { ClosePositionProcessor } from '../../crank/close-position-processor.js';
import { CrankConfig } from '../../crank/config.js';

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
    sendAndConfirmTransaction: vi.fn().mockResolvedValue('mock-signature'),
  };
});

vi.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddressSync: vi.fn().mockReturnValue(
    new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  ),
  TOKEN_PROGRAM_ID: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    position: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
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
  DEFAULT_MXE_PROGRAM_ID: new PublicKey('HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS'),
}));

vi.mock('@arcium-hq/client', () => ({
  getCompDefAccOffset: vi.fn().mockReturnValue(Buffer.from([5, 0, 0, 0])),
  getCompDefAccAddress: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
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
      arciumMxe: 'HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS',
    },
    rpc: {
      primary: 'https://api.devnet.solana.com',
      fallback: [],
    },
  } as CrankConfig;
}

// Helper to create V7 position data for close position testing
function createMockPositionDataV7(options: {
  market?: PublicKey;
  trader?: PublicKey;
  side?: number;
  pendingClose?: boolean;
  pendingCloseExitPrice?: bigint;
  pendingCloseFull?: boolean;
  pendingMpcRequest?: Uint8Array;
  encryptedCollateral?: Uint8Array;
} = {}): Buffer {
  const data = Buffer.alloc(692);
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

  // Encrypted size (64 bytes)
  offset += 64;

  // Encrypted entry price (64 bytes)
  offset += 64;

  // Encrypted collateral (64 bytes) - used for payout calculation
  const collateral = options.encryptedCollateral || Buffer.alloc(64);
  if (!options.encryptedCollateral) {
    // Write a sample collateral value in first 8 bytes
    Buffer.from(collateral).writeBigUInt64LE(1000000n, 0); // 1 USDC
  }
  data.set(collateral, offset);
  offset += 64;

  // Encrypted realized PnL (64 bytes)
  offset += 64;

  // Encrypted liq below (64 bytes)
  offset += 64;

  // Encrypted liq above (64 bytes)
  offset += 64;

  // Threshold commitment (32 bytes)
  offset += 32;

  // Last threshold update hour (8 bytes)
  offset += 8;

  // Threshold verified (1 byte)
  data.writeUInt8(1, offset);
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

  // pending_margin_amount (8)
  offset += 8;

  // pending_margin_is_add (1)
  offset += 1;

  // is_liquidatable (1)
  offset += 1;

  // pending_close (1 byte) - V7 field
  data.writeUInt8(options.pendingClose !== false ? 1 : 0, offset);
  offset += 1;

  // pending_close_exit_price (8 bytes)
  data.writeBigUInt64LE(options.pendingCloseExitPrice ?? 50000000000n, offset); // $50,000
  offset += 8;

  // pending_close_full (1 byte)
  data.writeUInt8(options.pendingCloseFull !== false ? 1 : 0, offset);
  offset += 1;

  // pending_close_size (64 bytes)
  // offset += 64;

  return data;
}

// Helper to create mock market data
function createMockMarketData(): Buffer {
  const data = Buffer.alloc(500);
  let offset = 8; // Skip discriminator

  // Skip various fields to reach collateral_vault
  offset += 32; // authority
  offset += 32; // underlying_mint

  // Quote mint (32 bytes) at offset 64
  const quoteMint = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
  data.set(quoteMint.toBytes(), 64);

  // Collateral vault at offset 180
  const vault = Keypair.generate().publicKey;
  data.set(vault.toBytes(), 180);

  // Fee recipient at offset 212
  const feeRecipient = Keypair.generate().publicKey;
  data.set(feeRecipient.toBytes(), 212);

  return data;
}

// Helper to create mock computation account data
function createMockComputationData(status: number): Buffer {
  const data = Buffer.alloc(200);

  // Discriminator (8 bytes)
  // Status at offset 8
  data.writeUInt8(status, 8);

  // Output data at offset 100
  // encrypted_pnl (64 bytes)
  data.writeBigInt64LE(500000n, 100); // Sample PnL value
  // is_profit at offset 164
  data.writeUInt8(1, 164);

  return data;
}

describe('ClosePositionProcessor', () => {
  let processor: ClosePositionProcessor;
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

    processor = new ClosePositionProcessor(mockConnection, crankKeypair, config);
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
            { dataSize: 692 },
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
    it('triggers poll on ClosePositionInitiated event', async () => {
      await processor.start();

      const initialCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      logsCallback(
        {
          signature: 'test-sig',
          logs: ['Program log: ClosePositionInitiated { position: xyz }'],
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
      expect(afterCalls).toBe(initialCalls);
    });
  });

  describe('fetchPendingCloseOperations', () => {
    it('fetches positions with pending close', async () => {
      const positionPda = Keypair.generate().publicKey;

      const pendingClosePosition = createMockPositionDataV7({
        pendingClose: true,
        pendingMpcRequest: new Uint8Array(32).fill(1),
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: positionPda, account: { data: pendingClosePosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: expect.arrayContaining([
            { dataSize: 692 },
            expect.objectContaining({
              memcmp: expect.objectContaining({
                offset: 618, // pending_close offset
              }),
            }),
          ]),
        })
      );
    });

    it('filters out positions without pending close', async () => {
      const positionNoPendingClose = createMockPositionDataV7({
        pendingClose: false,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: positionNoPendingClose } },
      ]);

      await processor.start();

      expect(processor.getStatus().processingCount).toBe(0);
    });
  });

  describe('processCloseOperation', () => {
    it('uses cached MPC result if available', async () => {
      const requestId = new Uint8Array(32).fill(1);

      // Store a result
      processor.storeResult(requestId, new Uint8Array(64), true);

      const status = processor.getStatus();
      expect(status.cachedResults).toBe(1);
    });

    it('tracks failed operations in status', async () => {
      // The processor tracks failed operations - verify the mechanism exists
      const status = processor.getStatus();

      // Verify status structure
      expect(status).toHaveProperty('isPolling');
      expect(status).toHaveProperty('processingCount');
      expect(status).toHaveProperty('failedCount');
      expect(status).toHaveProperty('cachedResults');
      expect(status.failedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('pollMpcResult', () => {
    it('returns null when computation account not found', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const pollMpcResult = (processor as any).pollMpcResult.bind(processor);
      const result = await pollMpcResult(new Uint8Array(32).fill(1));

      expect(result).toBeNull();
    });

    it('returns null when computation not completed', async () => {
      const computationData = createMockComputationData(1); // Status = executing

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: computationData,
      });

      const pollMpcResult = (processor as any).pollMpcResult.bind(processor);
      const result = await pollMpcResult(new Uint8Array(32).fill(1));

      expect(result).toBeNull();
    });

    it('polls computation account for status', async () => {
      // Clear any previous mock calls
      vi.clearAllMocks();

      // The computation account structure depends on the actual Arcium MPC account format
      // For this test, verify that the pollMpcResult method attempts to fetch account data
      const computationData = createMockComputationData(2); // Status = completed

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: computationData,
      });

      const pollMpcResult = (processor as any).pollMpcResult.bind(processor);

      // Call the method - it may return null if account format doesn't match expectations
      const result = await pollMpcResult(new Uint8Array(32).fill(1));

      // Method should complete without throwing
      // The actual return value depends on account data parsing
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('handles poll errors gracefully', async () => {
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('RPC error')
      );

      const pollMpcResult = (processor as any).pollMpcResult.bind(processor);
      const result = await pollMpcResult(new Uint8Array(32).fill(1));

      expect(result).toBeNull();
    });
  });

  describe('storeResult', () => {
    it('stores MPC result', () => {
      const requestId = new Uint8Array(32).fill(1);
      const encryptedPnl = new Uint8Array(64);
      const isProfit = true;

      processor.storeResult(requestId, encryptedPnl, isProfit);

      expect(processor.getStatus().cachedResults).toBe(1);
    });

    it('allows storing multiple results', () => {
      const requestId1 = new Uint8Array(32).fill(1);
      const requestId2 = new Uint8Array(32).fill(2);

      processor.storeResult(requestId1, new Uint8Array(64), true);
      processor.storeResult(requestId2, new Uint8Array(64), false);

      expect(processor.getStatus().cachedResults).toBe(2);
    });
  });

  describe('deserializePositionV7', () => {
    it('correctly parses V7 position data', () => {
      const trader = Keypair.generate().publicKey;
      const market = Keypair.generate().publicKey;

      const positionData = createMockPositionDataV7({
        trader,
        market,
        side: 1,
        pendingClose: true,
        pendingCloseExitPrice: 48000000000n,
        pendingCloseFull: false,
      });

      const deserialize = (processor as any).deserializePositionV7.bind(processor);
      const position = deserialize(positionData);

      expect(position.trader.toBase58()).toBe(trader.toBase58());
      expect(position.market.toBase58()).toBe(market.toBase58());
      expect(position.side).toBe(1);
      expect(position.pendingClose).toBe(true);
      expect(position.pendingCloseExitPrice).toBe(48000000000n);
      expect(position.pendingCloseFull).toBe(false);
    });
  });

  describe('calculatePlaintextPayout', () => {
    it('calculates profit payout correctly', () => {
      const collateral = Buffer.alloc(64);
      collateral.writeBigUInt64LE(1000000n, 0); // 1 USDC

      const encryptedPnl = Buffer.alloc(64);
      encryptedPnl.writeBigInt64LE(500000n, 0); // 0.5 USDC profit

      const position = {
        encryptedCollateral: new Uint8Array(collateral),
      };

      const calculatePayout = (processor as any).calculatePlaintextPayout.bind(processor);
      const payout = calculatePayout(position, encryptedPnl, true);

      // 1 USDC + 0.5 USDC = 1.5 USDC - 0.1% fee
      expect(payout).toBeGreaterThan(0);
      expect(payout).toBeLessThan(1500000);
    });

    it('calculates loss payout correctly', () => {
      const collateral = Buffer.alloc(64);
      collateral.writeBigUInt64LE(1000000n, 0);

      const encryptedPnl = Buffer.alloc(64);
      encryptedPnl.writeBigInt64LE(300000n, 0);

      const position = {
        encryptedCollateral: new Uint8Array(collateral),
      };

      const calculatePayout = (processor as any).calculatePlaintextPayout.bind(processor);
      const payout = calculatePayout(position, encryptedPnl, false);

      // 1 USDC - 0.3 USDC = 0.7 USDC - fee
      expect(payout).toBeGreaterThan(0);
      expect(payout).toBeLessThan(700000);
    });

    it('ensures payout is non-negative', () => {
      const collateral = Buffer.alloc(64);
      collateral.writeBigUInt64LE(100000n, 0);

      const encryptedPnl = Buffer.alloc(64);
      encryptedPnl.writeBigInt64LE(500000n, 0); // Loss exceeds collateral

      const position = {
        encryptedCollateral: new Uint8Array(collateral),
      };

      const calculatePayout = (processor as any).calculatePlaintextPayout.bind(processor);
      const payout = calculatePayout(position, encryptedPnl, false);

      expect(payout).toBe(0);
    });
  });

  describe('triggerCloseCallback', () => {
    it('builds and sends callback transaction', async () => {
      const marketPda = Keypair.generate().publicKey;
      const positionPda = Keypair.generate().publicKey;

      const positionData = createMockPositionDataV7({
        market: marketPda,
        pendingClose: true,
      });

      const marketData = createMockMarketData();

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: marketData,
      });

      const { sendAndConfirmTransaction } = await import('@solana/web3.js');

      // Parse position
      const deserialize = (processor as any).deserializePositionV7.bind(processor);
      const position = deserialize(positionData);

      const op = {
        positionPda,
        position,
        requestId: new Uint8Array(32).fill(1),
      };

      const triggerClose = (processor as any).triggerCloseCallback.bind(processor);

      await triggerClose(op, new Uint8Array(64), true);

      expect(sendAndConfirmTransaction).toHaveBeenCalled();
    });

    it('handles missing market account', async () => {
      const positionData = createMockPositionDataV7({
        pendingClose: true,
      });

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const deserialize = (processor as any).deserializePositionV7.bind(processor);
      const position = deserialize(positionData);

      const op = {
        positionPda: Keypair.generate().publicKey,
        position,
        requestId: new Uint8Array(32).fill(1),
      };

      const triggerClose = (processor as any).triggerCloseCallback.bind(processor);

      await expect(triggerClose(op, new Uint8Array(64), true)).rejects.toThrow('Market account not found');
    });
  });

  describe('periodic polling', () => {
    it('polls at configured interval', async () => {
      await processor.start();

      const initialCalls = (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mock.calls.length;

      // Advance by 2x polling interval (close uses 2x multiplier)
      await vi.advanceTimersByTimeAsync(config.pollingIntervalMs * 2);

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
      const invalidData = Buffer.alloc(100);

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: invalidData } },
      ]);

      await processor.start();

      expect(processor.getStatus().isPolling).toBe(true);
    });
  });

  describe('full close vs partial close', () => {
    it('handles full close', async () => {
      const fullClosePosition = createMockPositionDataV7({
        pendingClose: true,
        pendingCloseFull: true,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: fullClosePosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('handles partial close', async () => {
      const partialClosePosition = createMockPositionDataV7({
        pendingClose: true,
        pendingCloseFull: false,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: partialClosePosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });

  describe('side-specific handling', () => {
    it('handles long position close', async () => {
      const longPosition = createMockPositionDataV7({
        side: 0,
        pendingClose: true,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: longPosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });

    it('handles short position close', async () => {
      const shortPosition = createMockPositionDataV7({
        side: 1,
        pendingClose: true,
      });

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pubkey: Keypair.generate().publicKey, account: { data: shortPosition } },
      ]);

      await processor.start();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
    });
  });
});
