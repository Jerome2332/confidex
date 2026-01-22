import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { MatchExecutor } from '../match-executor.js';
import { MatchCandidate, Side, OrderType, OrderStatus, ConfidentialOrder, OrderWithPda } from '../types.js';
import { CrankConfig } from '../config.js';

// Mock @solana/web3.js
vi.mock('@solana/web3.js', async () => {
  const actual = await vi.importActual('@solana/web3.js');
  return {
    ...actual,
    sendAndConfirmTransaction: vi.fn(),
  };
});

import { sendAndConfirmTransaction } from '@solana/web3.js';

const mockSendAndConfirmTransaction = sendAndConfirmTransaction as ReturnType<typeof vi.fn>;

// Helper to create a mock V5 order
function createMockOrder(overrides: Partial<ConfidentialOrder> = {}): ConfidentialOrder {
  return {
    maker: Keypair.generate().publicKey,
    pair: Keypair.generate().publicKey,
    side: Side.Buy,
    orderType: OrderType.Limit,
    encryptedAmount: new Uint8Array(64),
    encryptedPrice: new Uint8Array(64),
    encryptedFilled: new Uint8Array(64),
    status: OrderStatus.Active,
    createdAtHour: BigInt(Math.floor(Date.now() / 3600000) * 3600), // V5: hour precision
    orderId: new Uint8Array(16),
    orderNonce: new Uint8Array(8),
    eligibilityProofVerified: true,
    pendingMatchRequest: PublicKey.default, // V5: PublicKey type
    isMatching: false,
    bump: 255,
    ephemeralPubkey: new Uint8Array(32),
    ...overrides,
  };
}

// Helper to create an OrderWithPda
function createOrderWithPda(order: ConfidentialOrder): OrderWithPda {
  return {
    pda: Keypair.generate().publicKey,
    order,
  };
}

describe('MatchExecutor', () => {
  let executor: MatchExecutor;
  let mockConnection: Connection;
  let crankKeypair: Keypair;
  let config: CrankConfig;
  let commonPair: PublicKey;

  beforeEach(() => {
    vi.clearAllMocks();

    crankKeypair = Keypair.generate();
    commonPair = Keypair.generate().publicKey;

    config = {
      programs: {
        confidexDex: Keypair.generate().publicKey.toString(),
        arciumMxe: Keypair.generate().publicKey.toString(),
      },
      pollingIntervalMs: 5000,
      useAsyncMpc: false, // Use sync mode for simpler tests
      maxConcurrentMatches: 5,
    } as CrankConfig;

    // Create mock connection
    mockConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({
        data: Buffer.alloc(200), // Enough space for MXE config
      }),
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'test-blockhash-123',
        lastValidBlockHeight: 1000,
      }),
    } as unknown as Connection;

    executor = new MatchExecutor(mockConnection, crankKeypair, config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildMatchTransaction', () => {
    it('builds a valid transaction with correct accounts', async () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.buildMatchTransaction(candidate);

      expect(result).toBeDefined();
      expect(result.transaction).toBeDefined();
      expect(result.computationOffset).toBeDefined();
      expect(result.ephemeralPrivateKey).toBeDefined();
      expect(result.transaction.instructions).toHaveLength(1);
      expect(result.transaction.recentBlockhash).toBe('test-blockhash-123');
      expect(result.transaction.feePayer?.equals(crankKeypair.publicKey)).toBe(true);
    });

    it('includes buy and sell order PDAs in accounts', async () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.buildMatchTransaction(candidate);
      const instruction = result.transaction.instructions[0];

      // Check that buy and sell PDAs are in the accounts
      const accountKeys = instruction.keys.map((k: { pubkey: PublicKey }) => k.pubkey.toString());
      expect(accountKeys).toContain(buyOrder.pda.toString());
      expect(accountKeys).toContain(sellOrder.pda.toString());
    });

    it('includes pair PDA in accounts', async () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.buildMatchTransaction(candidate);
      const instruction = result.transaction.instructions[0];

      const accountKeys = instruction.keys.map((k: { pubkey: PublicKey }) => k.pubkey.toString());
      expect(accountKeys).toContain(commonPair.toString());
    });

    it('sets crank as signer and writable', async () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.buildMatchTransaction(candidate);
      const instruction = result.transaction.instructions[0];

      const crankAccount = instruction.keys.find(
        (k: { pubkey: PublicKey }) => k.pubkey.equals(crankKeypair.publicKey)
      );

      expect(crankAccount).toBeDefined();
      expect(crankAccount?.isSigner).toBe(true);
      expect(crankAccount?.isWritable).toBe(true);
    });
  });

  describe('executeMatch', () => {
    it('returns success result on successful match', async () => {
      mockSendAndConfirmTransaction.mockResolvedValue('test-signature-123');

      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.executeMatch(candidate);

      expect(result.success).toBe(true);
      expect(result.signature).toBe('test-signature-123');
      expect(result.buyOrderPda.equals(buyOrder.pda)).toBe(true);
      expect(result.sellOrderPda.equals(sellOrder.pda)).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it('returns failure result on transaction error', async () => {
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('custom program error: 0x1782')
      );

      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.executeMatch(candidate);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.signature).toBeUndefined();
    });

    it('retries on retryable errors', async () => {
      // First call fails with timeout, second succeeds
      mockSendAndConfirmTransaction
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce('test-signature-retry');

      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.executeMatch(candidate);

      expect(result.success).toBe(true);
      expect(result.signature).toBe('test-signature-retry');
      expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-retryable errors', async () => {
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('custom program error: insufficient funds')
      );

      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.executeMatch(candidate);

      expect(result.success).toBe(false);
      // Should only be called once for non-retryable errors
      expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
    });

    it('gives up after max retries', async () => {
      mockSendAndConfirmTransaction.mockRejectedValue(new Error('ECONNRESET'));

      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidate: MatchCandidate = {
        buyOrder,
        sellOrder,
        pairPda: commonPair,
      };

      const result = await executor.executeMatch(candidate);

      expect(result.success).toBe(false);
      // Default max retries is 3
      expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('executeMatches', () => {
    it('executes multiple matches sequentially', async () => {
      mockSendAndConfirmTransaction
        .mockResolvedValueOnce('signature-1')
        .mockResolvedValueOnce('signature-2');

      const candidate1: MatchCandidate = {
        buyOrder: createOrderWithPda(createMockOrder({ side: Side.Buy, pair: commonPair })),
        sellOrder: createOrderWithPda(createMockOrder({ side: Side.Sell, pair: commonPair })),
        pairPda: commonPair,
      };

      const candidate2: MatchCandidate = {
        buyOrder: createOrderWithPda(createMockOrder({ side: Side.Buy, pair: commonPair })),
        sellOrder: createOrderWithPda(createMockOrder({ side: Side.Sell, pair: commonPair })),
        pairPda: commonPair,
      };

      const results = await executor.executeMatches([candidate1, candidate2]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].signature).toBe('signature-1');
      expect(results[1].success).toBe(true);
      expect(results[1].signature).toBe('signature-2');
    });

    it('returns partial success when some matches fail', async () => {
      mockSendAndConfirmTransaction
        .mockResolvedValueOnce('signature-1')
        .mockRejectedValueOnce(new Error('custom program error'));

      const candidate1: MatchCandidate = {
        buyOrder: createOrderWithPda(createMockOrder({ side: Side.Buy, pair: commonPair })),
        sellOrder: createOrderWithPda(createMockOrder({ side: Side.Sell, pair: commonPair })),
        pairPda: commonPair,
      };

      const candidate2: MatchCandidate = {
        buyOrder: createOrderWithPda(createMockOrder({ side: Side.Buy, pair: commonPair })),
        sellOrder: createOrderWithPda(createMockOrder({ side: Side.Sell, pair: commonPair })),
        pairPda: commonPair,
      };

      const results = await executor.executeMatches([candidate1, candidate2]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    it('returns empty array for empty input', async () => {
      const results = await executor.executeMatches([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('isRetryable (private method tested via executeMatch)', () => {
    const retryableErrors = [
      'blockhash not found',
      'Connection timeout',
      'rate limit exceeded',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
    ];

    const nonRetryableErrors = [
      'custom program error: 0x1',
      'instruction error',
      'insufficient funds',
      'account not found',
    ];

    retryableErrors.forEach(errorMessage => {
      it(`retries for "${errorMessage}"`, async () => {
        mockSendAndConfirmTransaction
          .mockRejectedValueOnce(new Error(errorMessage))
          .mockResolvedValueOnce('success-after-retry');

        const candidate: MatchCandidate = {
          buyOrder: createOrderWithPda(createMockOrder({ side: Side.Buy, pair: commonPair })),
          sellOrder: createOrderWithPda(createMockOrder({ side: Side.Sell, pair: commonPair })),
          pairPda: commonPair,
        };

        const result = await executor.executeMatch(candidate);

        expect(result.success).toBe(true);
        expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(2);
      });
    });

    nonRetryableErrors.forEach(errorMessage => {
      it(`does not retry for "${errorMessage}"`, async () => {
        mockSendAndConfirmTransaction.mockRejectedValue(new Error(errorMessage));

        const candidate: MatchCandidate = {
          buyOrder: createOrderWithPda(createMockOrder({ side: Side.Buy, pair: commonPair })),
          sellOrder: createOrderWithPda(createMockOrder({ side: Side.Sell, pair: commonPair })),
          pairPda: commonPair,
        };

        const result = await executor.executeMatch(candidate);

        expect(result.success).toBe(false);
        expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
      });
    });
  });
});
