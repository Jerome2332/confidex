import { describe, it, expect, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { MatchingAlgorithm } from '../matching-algorithm.js';
import { OrderWithPda, Side, OrderType, OrderStatus, ConfidentialOrder, MatchCandidate } from '../types.js';

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

describe('MatchingAlgorithm', () => {
  let algorithm: MatchingAlgorithm;
  let commonPair: PublicKey;

  beforeEach(() => {
    algorithm = new MatchingAlgorithm();
    commonPair = Keypair.generate().publicKey;
  });

  describe('findMatchCandidates', () => {
    it('returns empty array when no orders', () => {
      const candidates = algorithm.findMatchCandidates([], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('returns empty array when only buy orders exist', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));

      const candidates = algorithm.findMatchCandidates([buyOrder], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('returns empty array when only sell orders exist', () => {
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates = algorithm.findMatchCandidates([sellOrder], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('finds match candidate when buy and sell exist for same pair', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates = algorithm.findMatchCandidates([buyOrder, sellOrder], new Set());
      expect(candidates).toHaveLength(1);
      expect(candidates[0].buyOrder).toBe(buyOrder);
      expect(candidates[0].sellOrder).toBe(sellOrder);
      expect(candidates[0].pairPda.equals(commonPair)).toBe(true);
    });

    it('excludes locked orders', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      // Lock the buy order
      const lockedOrders = new Set([buyOrder.pda.toString()]);

      const candidates = algorithm.findMatchCandidates([buyOrder, sellOrder], lockedOrders);
      expect(candidates).toHaveLength(0);
    });

    it('excludes orders that are already matching', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        isMatching: true,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates = algorithm.findMatchCandidates([buyOrder, sellOrder], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('excludes orders without verified eligibility', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        eligibilityProofVerified: false,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates = algorithm.findMatchCandidates([buyOrder, sellOrder], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('excludes inactive orders', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        status: OrderStatus.Inactive,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates = algorithm.findMatchCandidates([buyOrder, sellOrder], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('does not match orders from the same maker', () => {
      const sameMaker = Keypair.generate().publicKey;
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        maker: sameMaker,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
        maker: sameMaker,
      }));

      const candidates = algorithm.findMatchCandidates([buyOrder, sellOrder], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('only matches orders from the same trading pair', () => {
      const pair1 = Keypair.generate().publicKey;
      const pair2 = Keypair.generate().publicKey;

      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: pair1,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: pair2,
      }));

      const candidates = algorithm.findMatchCandidates([buyOrder, sellOrder], new Set());
      expect(candidates).toHaveLength(0);
    });

    it('finds multiple match candidates with multiple orders', () => {
      const buyOrder1 = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const buyOrder2 = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder1 = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));
      const sellOrder2 = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates = algorithm.findMatchCandidates(
        [buyOrder1, buyOrder2, sellOrder1, sellOrder2],
        new Set()
      );

      // 2 buys x 2 sells = 4 potential matches
      expect(candidates).toHaveLength(4);
    });
  });

  describe('prioritizeCandidates', () => {
    it('prioritizes older buy orders first', () => {
      const oldBuy = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        createdAtHour: BigInt(1000),
      }));
      const newBuy = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        createdAtHour: BigInt(2000),
      }));
      const sell = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates: MatchCandidate[] = [
        { buyOrder: newBuy, sellOrder: sell, pairPda: commonPair },
        { buyOrder: oldBuy, sellOrder: sell, pairPda: commonPair },
      ];

      const prioritized = algorithm.prioritizeCandidates(candidates);

      // Older buy should be first
      expect(prioritized[0].buyOrder).toBe(oldBuy);
      expect(prioritized[1].buyOrder).toBe(newBuy);
    });

    it('uses sell order timestamp as tiebreaker', () => {
      const buy = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        createdAtHour: BigInt(1000),
      }));
      const oldSell = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
        createdAtHour: BigInt(1500),
      }));
      const newSell = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
        createdAtHour: BigInt(2500),
      }));

      const candidates: MatchCandidate[] = [
        { buyOrder: buy, sellOrder: newSell, pairPda: commonPair },
        { buyOrder: buy, sellOrder: oldSell, pairPda: commonPair },
      ];

      const prioritized = algorithm.prioritizeCandidates(candidates);

      // Same buy, older sell should be first
      expect(prioritized[0].sellOrder).toBe(oldSell);
      expect(prioritized[1].sellOrder).toBe(newSell);
    });
  });

  describe('selectTopCandidates', () => {
    it('returns at most maxCount candidates', () => {
      const buy = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));

      const sells = Array.from({ length: 10 }, () =>
        createOrderWithPda(createMockOrder({
          side: Side.Sell,
          pair: commonPair,
        }))
      );

      const candidates: MatchCandidate[] = sells.map(sell => ({
        buyOrder: buy,
        sellOrder: sell,
        pairPda: commonPair,
      }));

      const selected = algorithm.selectTopCandidates(candidates, 5);
      expect(selected).toHaveLength(5);
    });

    it('returns all candidates if fewer than maxCount', () => {
      const buy = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sell = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates: MatchCandidate[] = [
        { buyOrder: buy, sellOrder: sell, pairPda: commonPair },
      ];

      const selected = algorithm.selectTopCandidates(candidates, 5);
      expect(selected).toHaveLength(1);
    });

    it('returns prioritized candidates', () => {
      const oldBuy = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        createdAtHour: BigInt(1000),
      }));
      const newBuy = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        createdAtHour: BigInt(2000),
      }));
      const sell = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      const candidates: MatchCandidate[] = [
        { buyOrder: newBuy, sellOrder: sell, pairPda: commonPair },
        { buyOrder: oldBuy, sellOrder: sell, pairPda: commonPair },
      ];

      const selected = algorithm.selectTopCandidates(candidates, 1);

      // Should return the older buy order match
      expect(selected).toHaveLength(1);
      expect(selected[0].buyOrder).toBe(oldBuy);
    });
  });

  describe('canPotentiallyMatch', () => {
    it('returns true for valid matching pair', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(true);
    });

    it('returns false if both are buy orders', () => {
      const buyOrder1 = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const buyOrder2 = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder1, buyOrder2)).toBe(false);
    });

    it('returns false if both are sell orders', () => {
      const sellOrder1 = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));
      const sellOrder2 = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      expect(algorithm.canPotentiallyMatch(sellOrder1, sellOrder2)).toBe(false);
    });

    it('returns false if different trading pairs', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: Keypair.generate().publicKey,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: Keypair.generate().publicKey,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });

    it('returns false if buy order not verified', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        eligibilityProofVerified: false,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });

    it('returns false if sell order not verified', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
        eligibilityProofVerified: false,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });

    it('returns false if buy order inactive', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        status: OrderStatus.Inactive,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });

    it('returns false if sell order inactive', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
        status: OrderStatus.Inactive,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });

    it('returns false if buy order is matching', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        isMatching: true,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });

    it('returns false if sell order is matching', () => {
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
        isMatching: true,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });

    it('returns false if same maker', () => {
      const sameMaker = Keypair.generate().publicKey;
      const buyOrder = createOrderWithPda(createMockOrder({
        side: Side.Buy,
        pair: commonPair,
        maker: sameMaker,
      }));
      const sellOrder = createOrderWithPda(createMockOrder({
        side: Side.Sell,
        pair: commonPair,
        maker: sameMaker,
      }));

      expect(algorithm.canPotentiallyMatch(buyOrder, sellOrder)).toBe(false);
    });
  });
});
