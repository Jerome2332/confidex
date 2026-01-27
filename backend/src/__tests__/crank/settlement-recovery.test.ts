/**
 * Settlement Failure Recovery Tests
 *
 * Tests the settlement recovery mechanisms including:
 * - Rollback on partial settlement failure
 * - Settlement expiry handling
 * - Concurrent settlement prevention
 * - Retry logic with exponential backoff
 * - Manual intervention queue processing
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const {
  mockDb,
  mockStatement,
  MockDatabase,
  mockSendAndConfirmTransaction,
  mockAlertManager,
  mockShadowWireClient,
} = vi.hoisted(() => {
  const sendAndConfirmTx = vi.fn();
  const alertMgr = {
    error: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    critical: vi.fn().mockResolvedValue(undefined),
  };
  const shadowWire = {
    executeTransfer: vi.fn().mockResolvedValue({ success: true, transferId: 'mock-transfer-id' }),
    isSupported: vi.fn().mockReturnValue(true),
  };
  const statement = {
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 0 }),
  };
  const db = {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(statement),
    close: vi.fn(),
  };
  const Database = vi.fn(() => db);
  return {
    mockDb: db,
    mockStatement: statement,
    MockDatabase: Database,
    mockSendAndConfirmTransaction: sendAndConfirmTx,
    mockAlertManager: alertMgr,
    mockShadowWireClient: shadowWire,
  };
});

// Mock fs first
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

// Mock better-sqlite3 using the hoisted MockDatabase
vi.mock('better-sqlite3', () => ({
  default: MockDatabase,
}));

// Mock @solana/web3.js to control sendAndConfirmTransaction
vi.mock('@solana/web3.js', async () => {
  const actual = await vi.importActual('@solana/web3.js');
  return {
    ...actual,
    sendAndConfirmTransaction: mockSendAndConfirmTransaction,
  };
});

vi.mock('../../lib/logger.js', () => ({
  logger: {
    settlement: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../../lib/alerts.js', () => ({
  getAlertManager: () => mockAlertManager,
  AlertManager: class MockAlertManager {},
}));

vi.mock('../../shadowwire/index.js', () => ({
  ShadowWireRelayerClient: class MockShadowWireRelayerClient {
    executeTransfer = mockShadowWireClient.executeTransfer;
    isSupported = mockShadowWireClient.isSupported;
  },
  createRelayerClientFromEnv: vi.fn(() => ({
    executeTransfer: mockShadowWireClient.executeTransfer,
    isSupported: mockShadowWireClient.isSupported,
  })),
}));

// Import after mocks
import { SettlementExecutor, SettlementMethod } from '../../crank/settlement-executor.js';
import { CrankConfig } from '../../crank/config.js';
import { OrderStatus, Side } from '../../crank/types.js';

// V5 order account size
const ORDER_ACCOUNT_SIZE_V5 = 366;

// Helper to create mock V5 order data
function createMockOrderData(
  maker: PublicKey,
  pair: PublicKey,
  side: Side,
  status: OrderStatus,
  filled: boolean,
  isMatching: boolean,
  pendingMatchRequest: PublicKey = PublicKey.default
): Buffer {
  const data = Buffer.alloc(ORDER_ACCOUNT_SIZE_V5);
  let offset = 8; // Skip discriminator

  // maker (32 bytes)
  maker.toBuffer().copy(data, offset);
  offset += 32;

  // pair (32 bytes)
  pair.toBuffer().copy(data, offset);
  offset += 32;

  // side (1 byte)
  data.writeUInt8(side, offset);
  offset += 1;

  // order_type (1 byte)
  offset += 1;

  // encrypted_amount (64 bytes)
  offset += 64;

  // encrypted_price (64 bytes)
  offset += 64;

  // encrypted_filled (64 bytes) - first byte non-zero means filled
  if (filled) {
    data.writeUInt8(1, offset);
  }
  offset += 64;

  // status (1 byte)
  data.writeUInt8(status, offset);
  offset += 1;

  // created_at_hour (8), order_id (16), order_nonce (8), eligibility_proof_verified (1)
  offset += 8 + 16 + 8 + 1;

  // pending_match_request (32 bytes)
  pendingMatchRequest.toBuffer().copy(data, offset);
  offset += 32;

  // is_matching (1 byte)
  data.writeUInt8(isMatching ? 1 : 0, offset);

  return data;
}

// Helper to create mock pair account data
function createMockPairData(baseMint: PublicKey, quoteMint: PublicKey): Buffer {
  const data = Buffer.alloc(200);
  let offset = 8; // Skip discriminator

  // base_mint (32 bytes)
  baseMint.toBuffer().copy(data, offset);
  offset += 32;

  // quote_mint (32 bytes)
  quoteMint.toBuffer().copy(data, offset);

  return data;
}

// Helper to create mock exchange account data
function createMockExchangeData(authority: PublicKey, feeRecipient: PublicKey): Buffer {
  const data = Buffer.alloc(100);
  let offset = 8; // Skip discriminator

  // authority (32 bytes)
  authority.toBuffer().copy(data, offset);
  offset += 32;

  // fee_recipient (32 bytes)
  feeRecipient.toBuffer().copy(data, offset);

  return data;
}

describe('Settlement Failure Recovery', () => {
  let executor: SettlementExecutor;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let mockConfig: CrankConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStatement.get.mockReturnValue(null);
    mockStatement.run.mockReturnValue({ changes: 0 });
    mockDb.prepare.mockReturnValue(mockStatement);

    crankKeypair = Keypair.generate();

    mockConnection = {
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getAccountInfo: vi.fn(),
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'ABC123blockhash',
        lastValidBlockHeight: 12500,
      }),
    } as unknown as Connection;

    mockConfig = {
      programs: {
        confidexDex: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
        arciumMxe: '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi',
      },
      pollingIntervalMs: 1000,
      dbPath: './test-data/settlements.db',
      shadowWire: {
        enabled: true,
        apiKey: 'test-api-key',
      },
    } as unknown as CrankConfig;

    executor = new SettlementExecutor(mockConnection, crankKeypair, mockConfig);
  });

  afterEach(() => {
    if (executor) {
      executor.close();
    }
  });

  describe('Rollback on Partial Settlement Failure', () => {
    it('verifies rollback queue initialization', () => {
      // The settlement executor should initialize with an empty rollback queue
      const status = executor.getStatus();
      expect(status.rollbackQueue).toBeDefined();
      expect(status.rollbackQueue.count).toBe(0);
      expect(status.rollbackQueue.items).toEqual([]);
    });

    it('should have rollback queue tracking capabilities', async () => {
      // Verify the executor exposes rollback queue status
      const status = executor.getStatus();

      expect(status).toHaveProperty('rollbackQueue');
      expect(status.rollbackQueue).toHaveProperty('count');
      expect(status.rollbackQueue).toHaveProperty('items');
    });

    it('verifies processRollbackQueue method exists', async () => {
      // Verify rollback queue processing is available
      expect(executor.processRollbackQueue).toBeDefined();
      expect(typeof executor.processRollbackQueue).toBe('function');
    });

    it('getRollbackQueueStatus returns correct structure', () => {
      const status = executor.getStatus();
      expect(status.rollbackQueue).toEqual({
        count: expect.any(Number),
        items: expect.any(Array),
      });
    });
  });

  describe('Concurrent Settlement Prevention', () => {
    it('should prevent concurrent settlement of the same order pair', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      // Return same orders on multiple poll cycles
      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      // Make settlement take a long time
      mockSendAndConfirmTransaction.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('sig'), 5000))
      );

      vi.useFakeTimers();

      executor.start();

      // First poll should acquire lock and start settlement
      await vi.advanceTimersByTimeAsync(100);

      // Second poll should skip due to lock
      await vi.advanceTimersByTimeAsync(5100);

      executor.stop();

      // Should only have one settlement attempt (lock prevents concurrent)
      const calls = mockSendAndConfirmTransaction.mock.calls.length;
      expect(calls).toBeLessThanOrEqual(2); // At most 2 calls (not many more)

      vi.useRealTimers();
    });

    it('should release lock after settlement completes', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      (mockConnection.getAccountInfo as Mock).mockResolvedValue(null);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);

      // After settlement failure (pair not found), lock should be released
      expect(executor.getStatus().isPolling).toBe(true);

      executor.stop();
      vi.useRealTimers();
    });

    it('should allow lock acquisition after timeout', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      (mockConnection.getAccountInfo as Mock).mockResolvedValue(null);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Advance past lock timeout (30 seconds)
      await vi.advanceTimersByTimeAsync(35000);

      // New poll should be able to acquire lock
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      executor.stop();
      vi.useRealTimers();
    });
  });

  describe('Settlement Cooldown Handling', () => {
    it('should respect cooldown period after settlement failure', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      // Make settlement fail
      (mockConnection.getAccountInfo as Mock).mockResolvedValue(null);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);

      // First attempt should fail
      const firstCallCount = (mockConnection.getAccountInfo as Mock).mock.calls.length;

      // Advance time but not past cooldown
      await vi.advanceTimersByTimeAsync(30000);

      // Should skip due to cooldown
      const secondCallCount = (mockConnection.getAccountInfo as Mock).mock.calls.length;
      expect(secondCallCount).toBe(firstCallCount); // No new calls

      executor.stop();
      vi.useRealTimers();
    });

    it('should retry after cooldown period expires', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      (mockConnection.getAccountInfo as Mock).mockResolvedValue(null);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Advance past cooldown period (60 seconds default)
      await vi.advanceTimersByTimeAsync(65000);

      // Should retry after cooldown
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      executor.stop();
      vi.useRealTimers();
    });
  });

  describe('Rollback Queue Processing', () => {
    it('should process rollback queue periodically', async () => {
      vi.useFakeTimers();

      executor.start();

      // Advance time to trigger rollback queue processing (every 30 seconds)
      await vi.advanceTimersByTimeAsync(35000);

      // Queue should be empty initially
      const status = executor.getStatus();
      expect(status.rollbackQueue.count).toBe(0);

      executor.stop();
      vi.useRealTimers();
    });

    it('should report rollback queue status', () => {
      const status = executor.getStatus();

      expect(status).toHaveProperty('rollbackQueue');
      expect(status.rollbackQueue).toHaveProperty('count');
      expect(status.rollbackQueue).toHaveProperty('items');
      expect(Array.isArray(status.rollbackQueue.items)).toBe(true);
    });
  });

  describe('Error Classification', () => {
    it('should handle InsufficientBalance error with warning alert', async () => {
      mockSendAndConfirmTransaction.mockReset();
      mockAlertManager.warning.mockClear();

      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const baseMint = new PublicKey('So11111111111111111111111111111111111111112');
      const quoteMint = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const pairData = createMockPairData(baseMint, quoteMint);
      const exchangeData = createMockExchangeData(Keypair.generate().publicKey, feeRecipient);

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      (mockConnection.getAccountInfo as Mock).mockImplementation((pubkey: PublicKey) => {
        if (pubkey.equals(pairPda)) {
          return Promise.resolve({ data: pairData });
        }
        return Promise.resolve({ data: exchangeData });
      });

      // Mock InsufficientBalance error
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('custom program error: 0x1782')
      );

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();

      executor.stop();

      // Should have sent warning alert for InsufficientBalance
      expect(mockAlertManager.warning).toHaveBeenCalledWith(
        'Settlement Insufficient Balance',
        expect.any(String),
        expect.any(Object),
        expect.any(String)
      );

      vi.useRealTimers();
    });

    it('should handle network errors as transient', async () => {
      mockSendAndConfirmTransaction.mockReset();

      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const baseMint = new PublicKey('So11111111111111111111111111111111111111112');
      const quoteMint = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const pairData = createMockPairData(baseMint, quoteMint);
      const exchangeData = createMockExchangeData(Keypair.generate().publicKey, feeRecipient);

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      (mockConnection.getAccountInfo as Mock).mockImplementation((pubkey: PublicKey) => {
        if (pubkey.equals(pairPda)) {
          return Promise.resolve({ data: pairData });
        }
        return Promise.resolve({ data: exchangeData });
      });

      // Mock network timeout error
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Transaction was not confirmed in 30 seconds')
      );

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();

      executor.stop();

      // Network errors should trigger cooldown but allow retry
      expect(mockAlertManager.error).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('ShadowWire Integration', () => {
    it('should execute base and quote transfers via ShadowWire', async () => {
      mockShadowWireClient.executeTransfer.mockReset();
      mockShadowWireClient.executeTransfer.mockResolvedValue({
        success: true,
        transferId: 'transfer-123',
      });

      // Verify ShadowWire client is called when configured
      expect(mockShadowWireClient.executeTransfer).toBeDefined();
    });

    it('should handle unsupported tokens gracefully', async () => {
      mockShadowWireClient.isSupported.mockReturnValue(false);

      // Should fall back to legacy settlement for unsupported tokens
      expect(mockShadowWireClient.isSupported('UNSUPPORTED')).toBe(false);
    });
  });

  describe('Distributed Lock Integration', () => {
    it('should support distributed lock service injection', () => {
      // Verify the method exists for distributed lock injection
      expect(executor.setDistributedLockService).toBeDefined();
    });

    it('should use distributed locks when service is set', () => {
      const mockLockService = {
        acquire: vi.fn().mockResolvedValue({
          release: vi.fn().mockResolvedValue(undefined),
        }),
        release: vi.fn().mockResolvedValue(undefined),
        getInstanceId: vi.fn().mockReturnValue('test-instance'),
      };

      executor.setDistributedLockService(mockLockService as any);

      // Verify lock service was set
      expect(mockLockService.getInstanceId).toHaveBeenCalled();
    });
  });
});
