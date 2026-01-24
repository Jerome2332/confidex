import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { OrderMonitor } from '../../crank/order-monitor.js';
import { OrderStatus, Side } from '../../crank/types.js';

// V5 order account size
const ORDER_ACCOUNT_SIZE_V5 = 366;

// Helper to create mock V5 order data
function createMockOrderData(
  maker: PublicKey,
  pair: PublicKey,
  side: Side,
  status: OrderStatus,
  isMatching: boolean,
  eligibilityProofVerified: boolean,
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

  // orderType (1 byte)
  data.writeUInt8(0, offset); // Limit order
  offset += 1;

  // encryptedAmount (64 bytes)
  offset += 64;

  // encryptedPrice (64 bytes)
  offset += 64;

  // encryptedFilled (64 bytes)
  offset += 64;

  // status (1 byte)
  data.writeUInt8(status, offset);
  offset += 1;

  // createdAtHour (8 bytes)
  data.writeBigInt64LE(BigInt(Math.floor(Date.now() / 3600000)), offset);
  offset += 8;

  // orderId (16 bytes)
  offset += 16;

  // orderNonce (8 bytes)
  offset += 8;

  // eligibilityProofVerified (1 byte)
  data.writeUInt8(eligibilityProofVerified ? 1 : 0, offset);
  offset += 1;

  // pendingMatchRequest (32 bytes)
  pendingMatchRequest.toBuffer().copy(data, offset);
  offset += 32;

  // isMatching (1 byte)
  data.writeUInt8(isMatching ? 1 : 0, offset);
  offset += 1;

  // bump (1 byte)
  data.writeUInt8(255, offset);
  offset += 1;

  // ephemeralPubkey (32 bytes)
  // Remaining bytes are zeroed by default

  return data;
}

describe('OrderMonitor', () => {
  let monitor: OrderMonitor;
  let mockConnection: Connection;
  const programId = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnection = {
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;

    monitor = new OrderMonitor(mockConnection, programId);
  });

  describe('constructor', () => {
    it('initializes with connection and program ID', () => {
      expect(monitor).toBeDefined();
    });
  });

  describe('derivePairPda', () => {
    it('derives PDA for trading pair', () => {
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;

      const [pda, bump] = monitor.derivePairPda(baseMint, quoteMint);

      expect(pda).toBeInstanceOf(PublicKey);
      expect(typeof bump).toBe('number');
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('returns consistent PDA for same mints', () => {
      const baseMint = Keypair.generate().publicKey;
      const quoteMint = Keypair.generate().publicKey;

      const [pda1] = monitor.derivePairPda(baseMint, quoteMint);
      const [pda2] = monitor.derivePairPda(baseMint, quoteMint);

      expect(pda1.equals(pda2)).toBe(true);
    });

    it('returns different PDAs for different mint orders', () => {
      const mintA = Keypair.generate().publicKey;
      const mintB = Keypair.generate().publicKey;

      const [pdaAB] = monitor.derivePairPda(mintA, mintB);
      const [pdaBA] = monitor.derivePairPda(mintB, mintA);

      expect(pdaAB.equals(pdaBA)).toBe(false);
    });
  });

  describe('fetchOpenOrdersForPair', () => {
    it('queries for V5 orders only', async () => {
      const pairPda = Keypair.generate().publicKey;

      await monitor.fetchOpenOrdersForPair(pairPda);

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        programId,
        expect.objectContaining({
          filters: expect.arrayContaining([
            { dataSize: ORDER_ACCOUNT_SIZE_V5 },
          ]),
        })
      );
    });

    it('filters by pair PDA', async () => {
      const pairPda = Keypair.generate().publicKey;

      await monitor.fetchOpenOrdersForPair(pairPda);

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        programId,
        expect.objectContaining({
          filters: expect.arrayContaining([
            { memcmp: { offset: 8 + 32, bytes: pairPda.toBase58() } },
          ]),
        })
      );
    });

    it('returns active orders that are not matching', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(
        maker,
        pair,
        Side.Buy,
        OrderStatus.Active,
        false, // not matching
        true // verified
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: orderPda, account: { data: orderData } },
      ]);

      const orders = await monitor.fetchOpenOrdersForPair(pair);

      expect(orders).toHaveLength(1);
      expect(orders[0].pda.equals(orderPda)).toBe(true);
      expect(orders[0].order.status).toBe(OrderStatus.Active);
    });

    it('excludes orders that are currently matching', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(
        maker,
        pair,
        Side.Buy,
        OrderStatus.Active,
        true, // is matching - should be excluded
        true
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: orderPda, account: { data: orderData } },
      ]);

      const orders = await monitor.fetchOpenOrdersForPair(pair);

      expect(orders).toHaveLength(0);
    });

    it('excludes inactive orders', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(
        maker,
        pair,
        Side.Buy,
        OrderStatus.Inactive, // inactive - should be excluded
        false,
        true
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: orderPda, account: { data: orderData } },
      ]);

      const orders = await monitor.fetchOpenOrdersForPair(pair);

      expect(orders).toHaveLength(0);
    });

    it('caches fetched orders', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(
        maker,
        pair,
        Side.Buy,
        OrderStatus.Active,
        false,
        true
      );

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: orderPda, account: { data: orderData } },
      ]);

      await monitor.fetchOpenOrdersForPair(pair);

      const cached = monitor.getCachedOrder(orderPda.toString());

      expect(cached).toBeDefined();
      expect(cached?.pda.equals(orderPda)).toBe(true);
    });

    it('throws error on RPC failure', async () => {
      const pair = Keypair.generate().publicKey;

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('RPC connection failed')
      );

      await expect(monitor.fetchOpenOrdersForPair(pair)).rejects.toThrow('RPC connection failed');
    });
  });

  describe('fetchAllOpenOrders', () => {
    it('queries for all V5 orders', async () => {
      await monitor.fetchAllOpenOrders();

      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        programId,
        expect.objectContaining({
          filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
        })
      );
    });

    it('returns only active, verified orders that are not matching', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;

      // Active, verified, not matching - should be included
      const goodOrder = createMockOrderData(maker, pair, Side.Buy, OrderStatus.Active, false, true);

      // Unverified - should be excluded
      const unverifiedOrder = createMockOrderData(maker, pair, Side.Sell, OrderStatus.Active, false, false);

      // Matching - should be excluded
      const matchingOrder = createMockOrderData(maker, pair, Side.Buy, OrderStatus.Active, true, true);

      // Inactive - should be excluded
      const inactiveOrder = createMockOrderData(maker, pair, Side.Sell, OrderStatus.Inactive, false, true);

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: Keypair.generate().publicKey, account: { data: goodOrder } },
        { pubkey: Keypair.generate().publicKey, account: { data: unverifiedOrder } },
        { pubkey: Keypair.generate().publicKey, account: { data: matchingOrder } },
        { pubkey: Keypair.generate().publicKey, account: { data: inactiveOrder } },
      ]);

      const orders = await monitor.fetchAllOpenOrders();

      expect(orders).toHaveLength(1);
      expect(orders[0].order.eligibilityProofVerified).toBe(true);
      expect(orders[0].order.isMatching).toBe(false);
      expect(orders[0].order.status).toBe(OrderStatus.Active);
    });
  });

  describe('fetchOrder', () => {
    it('fetches single order by PDA', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(maker, pair, Side.Buy, OrderStatus.Active, false, true);

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: orderData,
      });

      const result = await monitor.fetchOrder(orderPda);

      expect(result).not.toBeNull();
      expect(result?.pda.equals(orderPda)).toBe(true);
    });

    it('returns null for non-existent order', async () => {
      const orderPda = Keypair.generate().publicKey;

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await monitor.fetchOrder(orderPda);

      expect(result).toBeNull();
    });

    it('removes from cache when order not found', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      // First, add to cache via fetchOpenOrdersForPair
      const orderData = createMockOrderData(maker, pair, Side.Buy, OrderStatus.Active, false, true);

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: orderPda, account: { data: orderData } },
      ]);

      await monitor.fetchOpenOrdersForPair(pair);
      expect(monitor.getCachedOrder(orderPda.toString())).toBeDefined();

      // Now fetch with null response
      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await monitor.fetchOrder(orderPda);

      expect(monitor.getCachedOrder(orderPda.toString())).toBeUndefined();
    });

    it('updates cache on successful fetch', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(maker, pair, Side.Sell, OrderStatus.Active, false, true);

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: orderData,
      });

      await monitor.fetchOrder(orderPda);

      const cached = monitor.getCachedOrder(orderPda.toString());
      expect(cached).toBeDefined();
      expect(cached?.order.side).toBe(Side.Sell);
    });

    it('returns null on error', async () => {
      const orderPda = Keypair.generate().publicKey;

      (mockConnection.getAccountInfo as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('RPC error')
      );

      const result = await monitor.fetchOrder(orderPda);

      expect(result).toBeNull();
    });
  });

  describe('getCachedOrder', () => {
    it('returns undefined for non-cached order', () => {
      const result = monitor.getCachedOrder('non-existent-key');

      expect(result).toBeUndefined();
    });
  });

  describe('clearCache', () => {
    it('clears all cached orders', async () => {
      const maker = Keypair.generate().publicKey;
      const pair = Keypair.generate().publicKey;
      const orderPda = Keypair.generate().publicKey;

      const orderData = createMockOrderData(maker, pair, Side.Buy, OrderStatus.Active, false, true);

      (mockConnection.getProgramAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
        { pubkey: orderPda, account: { data: orderData } },
      ]);

      await monitor.fetchOpenOrdersForPair(pair);
      expect(monitor.getCachedOrder(orderPda.toString())).toBeDefined();

      monitor.clearCache();

      expect(monitor.getCachedOrder(orderPda.toString())).toBeUndefined();
    });
  });

  describe('groupOrdersByPair', () => {
    it('groups orders by trading pair', () => {
      const pair1 = Keypair.generate().publicKey;
      const pair2 = Keypair.generate().publicKey;

      const orders = [
        {
          pda: Keypair.generate().publicKey,
          order: { pair: pair1, side: Side.Buy } as any,
        },
        {
          pda: Keypair.generate().publicKey,
          order: { pair: pair1, side: Side.Sell } as any,
        },
        {
          pda: Keypair.generate().publicKey,
          order: { pair: pair2, side: Side.Buy } as any,
        },
      ];

      const grouped = monitor.groupOrdersByPair(orders);

      expect(grouped.size).toBe(2);
      expect(grouped.get(pair1.toString())).toHaveLength(2);
      expect(grouped.get(pair2.toString())).toHaveLength(1);
    });

    it('returns empty map for empty orders array', () => {
      const grouped = monitor.groupOrdersByPair([]);

      expect(grouped.size).toBe(0);
    });
  });

  describe('getOrderCounts', () => {
    it('counts buy and sell orders', () => {
      const orders = [
        { pda: Keypair.generate().publicKey, order: { side: Side.Buy } as any },
        { pda: Keypair.generate().publicKey, order: { side: Side.Buy } as any },
        { pda: Keypair.generate().publicKey, order: { side: Side.Sell } as any },
      ];

      const counts = monitor.getOrderCounts(orders);

      expect(counts.buy).toBe(2);
      expect(counts.sell).toBe(1);
    });

    it('returns zero counts for empty array', () => {
      const counts = monitor.getOrderCounts([]);

      expect(counts.buy).toBe(0);
      expect(counts.sell).toBe(0);
    });
  });
});
