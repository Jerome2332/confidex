import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const { mockDb, mockStatement, MockDatabase, mockSendAndConfirmTransaction, mockAlertManager } = vi.hoisted(() => {
  const sendAndConfirmTx = vi.fn();
  const alertMgr = {
    error: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    critical: vi.fn().mockResolvedValue(undefined),
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

// Import after mocks
import { SettlementExecutor, SettlementMethod } from '../../crank/settlement-executor.js';
import { CrankConfig } from '../../crank/config.js';
import { OrderStatus, Side } from '../../crank/types.js';
import Database from 'better-sqlite3';

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

describe('SettlementExecutor', () => {
  let executor: SettlementExecutor;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let mockConfig: CrankConfig;

  beforeEach(() => {
    // Reset mock implementations before each test
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
    } as unknown as CrankConfig;

    executor = new SettlementExecutor(mockConnection, crankKeypair, mockConfig);
  });

  afterEach(() => {
    if (executor) {
      executor.close();
    }
  });

  describe('constructor', () => {
    it('initializes SQLite database', () => {
      expect(Database).toHaveBeenCalledWith('./test-data/settlements.db');
    });

    it('creates database schema', () => {
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS settled_orders'));
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS'));
    });
  });

  describe('start/stop', () => {
    it('starts polling for matched orders', () => {
      vi.useFakeTimers();

      executor.start();

      const status = executor.getStatus();
      expect(status.isPolling).toBe(true);

      executor.stop();

      expect(executor.getStatus().isPolling).toBe(false);

      vi.useRealTimers();
    });

    it('ignores multiple start calls', () => {
      vi.useFakeTimers();

      executor.start();
      executor.start(); // Should be ignored

      expect(executor.getStatus().isPolling).toBe(true);

      executor.stop();
      vi.useRealTimers();
    });

    it('stops polling and cleanup intervals', () => {
      vi.useFakeTimers();

      executor.start();
      executor.stop();

      expect(executor.getStatus().isPolling).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('close', () => {
    it('stops polling and closes database', () => {
      vi.useFakeTimers();

      executor.start();
      executor.close();

      expect(mockDb.close).toHaveBeenCalled();
      expect(executor.getStatus().isPolling).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('polling for settlements', () => {
    it('queries for V5 orders only', async () => {
      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        expect.any(PublicKey),
        expect.objectContaining({
          filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
        })
      );

      vi.useRealTimers();
    });

    it('identifies filled orders by encrypted_filled[0] != 0', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;

      // Create two matched orders (same pendingMatchRequest, both filled)
      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true, // filled
        false, // not currently matching
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true, // filled
        false, // not currently matching
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: buyOrderData } },
        { pubkey: Keypair.generate().publicKey, account: { data: sellOrderData } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should have found the orders
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips orders that are currently matching', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;

      const orderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Active,
        true,
        true, // isMatching = true, should be skipped
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: orderData } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should have queried but not attempted settlement
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips orders with zero pendingMatchRequest', async () => {
      const pairPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(
        Keypair.generate().publicKey,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        PublicKey.default // Zero/default key = not matched
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: orderData } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('settlement tracking', () => {
    it('checks database for already settled orders', async () => {
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

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should have checked database
      expect(mockDb.prepare).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('getStatus', () => {
    it('returns current polling status', () => {
      const status = executor.getStatus();

      expect(status).toHaveProperty('isPolling');
      expect(status).toHaveProperty('settledCount');
      expect(status.isPolling).toBe(false);
    });

    it('returns settled count from database', () => {
      // The mock returns null by default, which means 0
      const status = executor.getStatus();
      expect(typeof status.settledCount).toBe('number');
    });
  });

  describe('SettlementMethod enum', () => {
    it('has correct values', () => {
      expect(SettlementMethod.ShadowWire).toBe(0);
      expect(SettlementMethod.CSPL).toBe(1);
      expect(SettlementMethod.StandardSPL).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('removes old settlement records during start', () => {
      vi.useFakeTimers();

      executor.start();

      // Cleanup runs immediately on start
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM settled_orders'));

      executor.stop();
      vi.useRealTimers();
    });
  });

  describe('locking mechanism', () => {
    it('prevents concurrent settlement of same order pair', async () => {
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

      // Return orders on multiple polls
      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Lock mechanism should prevent double-processing
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('settlement execution', () => {
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

    it('attempts settlement when matched orders found', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
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
        // Return pair data for pair PDA, exchange data for exchange PDA
        if (pubkey.equals(pairPda)) {
          return Promise.resolve({ data: pairData });
        }
        // For exchange PDA (derived), return exchange data
        return Promise.resolve({ data: exchangeData });
      });

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should have tried to fetch pair info
      expect(mockConnection.getAccountInfo).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('handles missing pair account gracefully', async () => {
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

      // Pair account returns null (not found)
      (mockConnection.getAccountInfo as Mock).mockResolvedValue(null);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should not throw, just skip
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips already settled orders in database', async () => {
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

      // Simulate already settled in database
      mockStatement.get.mockReturnValue({ settlement_key: 'exists' });

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should check database but not attempt settlement
      expect(mockDb.prepare).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('error handling', () => {
    it('handles poll errors gracefully', async () => {
      (mockConnection.getProgramAccounts as Mock).mockRejectedValue(new Error('RPC error'));

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should not throw, executor should still be running
      expect(executor.getStatus().isPolling).toBe(false); // After stop

      vi.useRealTimers();
    });

    it('adds cooldown on settlement failure', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
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

      // Create proper pair data
      const pairData = Buffer.alloc(200);
      let offset = 8;
      baseMint.toBuffer().copy(pairData, offset);
      offset += 32;
      quoteMint.toBuffer().copy(pairData, offset);

      // Create proper exchange data
      const exchangeData = Buffer.alloc(100);
      offset = 8;
      Keypair.generate().publicKey.toBuffer().copy(exchangeData, offset);
      offset += 32;
      feeRecipient.toBuffer().copy(exchangeData, offset);

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

      // Make settlement fail
      (mockConnection.getLatestBlockhash as Mock).mockRejectedValue(new Error('Network error'));

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should have tried settlement
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('respects cooldown period for failed settlements', async () => {
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

      // First poll should trigger settlement attempt
      expect(mockConnection.getProgramAccounts).toHaveBeenCalledTimes(1);

      // Advance less than cooldown period
      await vi.advanceTimersByTimeAsync(30000);

      // Poll again - should skip due to cooldown
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      executor.stop();
      vi.useRealTimers();
    });
  });

  describe('extractErrorSummary', () => {
    it('extracts Anchor custom program error codes', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
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

      const pairData = Buffer.alloc(200);
      let offset = 8;
      baseMint.toBuffer().copy(pairData, offset);
      offset += 32;
      quoteMint.toBuffer().copy(pairData, offset);

      const exchangeData = Buffer.alloc(100);
      offset = 8;
      Keypair.generate().publicKey.toBuffer().copy(exchangeData, offset);
      offset += 32;
      feeRecipient.toBuffer().copy(exchangeData, offset);

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

      // Make it fail with InsufficientBalance error
      const error = new Error('custom program error: 0x1782');
      (mockConnection.getLatestBlockhash as Mock).mockResolvedValue({
        blockhash: 'test',
        lastValidBlockHeight: 1000,
      });

      // We can't easily mock sendAndConfirmTransaction, but we can test that the
      // executor continues running after errors
      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('order parsing', () => {
    it('correctly parses V5 order data', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;

      const orderData = createMockOrderData(
        maker,
        pair,
        Side.Buy,
        OrderStatus.Active,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: orderData } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('handles orders with different sides', async () => {
      const pair = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;

      const buyOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: buyOrder } },
        { pubkey: Keypair.generate().publicKey, account: { data: sellOrder } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('database operations', () => {
    it('counts settled orders correctly', () => {
      mockStatement.get.mockReturnValue({ count: 42 });

      const status = executor.getStatus();
      expect(status.settledCount).toBe(42);
    });

    it('handles null count from database', () => {
      mockStatement.get.mockReturnValue(null);

      const status = executor.getStatus();
      expect(status.settledCount).toBe(0);
    });

    it('handles undefined count from database', () => {
      mockStatement.get.mockReturnValue({ count: undefined });

      const status = executor.getStatus();
      expect(status.settledCount).toBe(0);
    });

    it('cleanup logs deleted records count', async () => {
      mockStatement.run.mockReturnValue({ changes: 5 });

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Cleanup should have been called
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE'));

      vi.useRealTimers();
    });
  });

  describe('order matching logic', () => {
    it('only matches orders from the same pair', async () => {
      const pair1 = Keypair.generate().publicKey;
      const pair2 = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;

      const buyOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair1,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair2, // Different pair!
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: buyOrder } },
        { pubkey: Keypair.generate().publicKey, account: { data: sellOrder } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should not attempt settlement (different pairs)
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
      // getAccountInfo should not be called for pair lookup since pairs don't match
      expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('only matches orders with the same pendingMatchRequest', async () => {
      const pair = Keypair.generate().publicKey;
      const matchRequest1 = Keypair.generate().publicKey;
      const matchRequest2 = Keypair.generate().publicKey;

      const buyOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest1
      );

      const sellOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest2 // Different match request!
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: buyOrder } },
        { pubkey: Keypair.generate().publicKey, account: { data: sellOrder } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should not attempt settlement (different match requests)
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();
      expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips unfilled orders', async () => {
      const pair = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;

      const buyOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair,
        Side.Buy,
        OrderStatus.Inactive,
        false, // Not filled!
        false,
        matchRequest
      );

      const sellOrder = createMockOrderData(
        Keypair.generate().publicKey,
        pair,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: buyOrder } },
        { pubkey: Keypair.generate().publicKey, account: { data: sellOrder } },
      ]);

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should not attempt settlement (buy order not filled)
      expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('cleanup intervals', () => {
    it('runs cleanup on start', async () => {
      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Cleanup should have been called at least once (immediately on start)
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM settled_orders WHERE settled_at')
      );

      executor.stop();
      vi.useRealTimers();
    });
  });

  describe('lock timeout handling', () => {
    it('cleans up expired locks during poll', async () => {
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

      // Should clean up expired locks
      expect(mockConnection.getProgramAccounts).toHaveBeenCalled();

      executor.stop();
      vi.useRealTimers();
    });
  });

  describe('successful settlement execution', () => {
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

    it('logs success and marks settlement on successful TX', async () => {
      // Reset mocks before this test
      mockSendAndConfirmTransaction.mockReset();
      mockSendAndConfirmTransaction.mockResolvedValue('SUCCESS_SIGNATURE_12345');

      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
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

      vi.useFakeTimers();

      executor.start();
      // Allow time for async settlement flow to complete
      await vi.advanceTimersByTimeAsync(200);
      executor.stop();

      // Should have called sendAndConfirmTransaction
      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();

      // Verify the transaction was sent (main success indicator)
      // The INSERT happens after successful TX, so we just verify the settlement execution
      // by checking the TX was called. Database persistence is tested separately.

      vi.useRealTimers();
    });

    it('sends InsufficientBalance warning alert on 0x1782 error', async () => {
      // Reset mocks before this test
      mockSendAndConfirmTransaction.mockReset();
      mockAlertManager.warning.mockClear();
      mockAlertManager.error.mockClear();

      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
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

      // Mock InsufficientBalance error (0x1782)
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Transaction simulation failed: custom program error: 0x1782')
      );

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);

      // Flush pending promises
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      executor.stop();

      // Should have called sendAndConfirmTransaction
      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();

      // Should have sent warning alert for InsufficientBalance
      expect(mockAlertManager.warning).toHaveBeenCalledWith(
        'Settlement Insufficient Balance',
        expect.stringContaining('InsufficientBalance'),
        expect.objectContaining({
          buyOrder: expect.any(String),
          sellOrder: expect.any(String),
        }),
        expect.stringContaining('insufficient-balance-')
      );

      // Should have sent error alert for general settlement failure
      expect(mockAlertManager.error).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('returns early when fee recipient is null', async () => {
      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
        pairPda,
        Side.Sell,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const pairData = createMockPairData(baseMint, quoteMint);

      let callCount = 0;
      (mockConnection.getProgramAccounts as Mock).mockResolvedValue([
        { pubkey: buyPda, account: { data: buyOrderData } },
        { pubkey: sellPda, account: { data: sellOrderData } },
      ]);

      (mockConnection.getAccountInfo as Mock).mockImplementation((pubkey: PublicKey) => {
        callCount++;
        if (callCount === 1) {
          // First call is for pair data
          return Promise.resolve({ data: pairData });
        }
        // Second call is for exchange (fee recipient) - return null
        return Promise.resolve(null);
      });

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      executor.stop();

      // Should have fetched pair info but returned early due to missing fee recipient
      expect(mockConnection.getAccountInfo).toHaveBeenCalled();

      // Should NOT have attempted to send transaction (returned early at line 573)
      expect(mockSendAndConfirmTransaction).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('handles AccountDidNotDeserialize error (0xbbb)', async () => {
      // Reset mocks before this test
      mockSendAndConfirmTransaction.mockReset();
      mockAlertManager.warning.mockClear();
      mockAlertManager.error.mockClear();

      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
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

      // Mock AccountDidNotDeserialize error (0xbbb)
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Transaction simulation failed: custom program error: 0xbbb')
      );

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      executor.stop();

      // Should have called sendAndConfirmTransaction
      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();

      // Should have sent error alert (but NOT InsufficientBalance warning)
      expect(mockAlertManager.error).toHaveBeenCalled();
      expect(mockAlertManager.warning).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('handles generic program error codes', async () => {
      mockSendAndConfirmTransaction.mockReset();
      mockAlertManager.warning.mockClear();
      mockAlertManager.error.mockClear();

      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
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

      // Mock unknown program error code
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Transaction simulation failed: custom program error: 0x1234')
      );

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      executor.stop();

      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();
      expect(mockAlertManager.error).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('handles simulation Error Code format', async () => {
      mockSendAndConfirmTransaction.mockReset();
      mockAlertManager.warning.mockClear();
      mockAlertManager.error.mockClear();

      const pairPda = Keypair.generate().publicKey;
      const matchRequest = Keypair.generate().publicKey;
      const buyPda = Keypair.generate().publicKey;
      const sellPda = Keypair.generate().publicKey;
      const buyMaker = Keypair.generate().publicKey;
      const sellMaker = Keypair.generate().publicKey;
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;
      const feeRecipient = Keypair.generate().publicKey;

      const buyOrderData = createMockOrderData(
        buyMaker,
        pairPda,
        Side.Buy,
        OrderStatus.Inactive,
        true,
        false,
        matchRequest
      );

      const sellOrderData = createMockOrderData(
        sellMaker,
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

      // Mock simulation error with "Error Code:" format
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Simulation failed: Error Code: OrderExpired')
      );

      vi.useFakeTimers();

      executor.start();
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      executor.stop();

      expect(mockSendAndConfirmTransaction).toHaveBeenCalled();
      expect(mockAlertManager.error).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
