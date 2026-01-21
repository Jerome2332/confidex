/**
 * Matching Algorithm
 *
 * Finds candidate order pairs for matching.
 * Since prices are encrypted, we identify potential matches and let MPC verify.
 */

import { PublicKey } from '@solana/web3.js';
import { OrderWithPda, MatchCandidate, Side, OrderStatus } from './types.js';

export class MatchingAlgorithm {
  /**
   * Find matchable order pairs from a list of orders
   *
   * Algorithm:
   * 1. Separate orders into buy and sell lists
   * 2. Filter for verified eligibility
   * 3. Sort by timestamp (FIFO - oldest first)
   * 4. Pair oldest buy with oldest sell
   * 5. Return all potential matches
   *
   * Note: Since prices are encrypted, we can't compare them client-side.
   * The on-chain MPC will verify price compatibility.
   */
  findMatchCandidates(
    orders: OrderWithPda[],
    lockedOrders: Set<string>
  ): MatchCandidate[] {
    // Filter for matchable orders (Active, verified, not locked, not in matching flow)
    const matchableOrders = orders.filter(o =>
      o.order.status === OrderStatus.Active &&
      o.order.eligibilityProofVerified &&
      !o.order.isMatching &&
      !lockedOrders.has(o.pda.toString())
    );

    // Separate by side
    const buyOrders = matchableOrders.filter(o => o.order.side === Side.Buy);
    const sellOrders = matchableOrders.filter(o => o.order.side === Side.Sell);

    // Sort by creation time (FIFO) - V5 uses createdAtHour
    buyOrders.sort((a, b) => Number(a.order.createdAtHour - b.order.createdAtHour));
    sellOrders.sort((a, b) => Number(a.order.createdAtHour - b.order.createdAtHour));

    const candidates: MatchCandidate[] = [];

    // Group by pair PDA
    const buysByPair = this.groupByPair(buyOrders);
    const sellsByPair = this.groupByPair(sellOrders);

    // Find matches within each pair
    for (const [pairKey, pairBuys] of buysByPair) {
      const pairSells = sellsByPair.get(pairKey);
      if (!pairSells || pairSells.length === 0) continue;

      const pairPda = new PublicKey(pairKey);

      // Pair each buy with each sell (excluding same maker)
      for (const buy of pairBuys) {
        for (const sell of pairSells) {
          // Don't match orders from the same maker
          if (buy.order.maker.equals(sell.order.maker)) continue;

          candidates.push({
            buyOrder: buy,
            sellOrder: sell,
            pairPda,
          });
        }
      }
    }

    console.log(`[MatchingAlgorithm] Found ${candidates.length} match candidates`);
    return candidates;
  }

  /**
   * Prioritize match candidates
   *
   * Priority:
   * 1. Oldest orders first (FIFO fairness)
   * 2. Larger potential fill amounts (could be inferred from partial fills)
   */
  prioritizeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
    return candidates.sort((a, b) => {
      // Primary: oldest buy order first (V5 uses createdAtHour)
      const buyTimeDiff = Number(a.buyOrder.order.createdAtHour - b.buyOrder.order.createdAtHour);
      if (buyTimeDiff !== 0) return buyTimeDiff;

      // Secondary: oldest sell order first
      return Number(a.sellOrder.order.createdAtHour - b.sellOrder.order.createdAtHour);
    });
  }

  /**
   * Select top N candidates for matching
   */
  selectTopCandidates(candidates: MatchCandidate[], maxCount: number): MatchCandidate[] {
    const prioritized = this.prioritizeCandidates(candidates);
    return prioritized.slice(0, maxCount);
  }

  /**
   * Group orders by trading pair
   */
  private groupByPair(orders: OrderWithPda[]): Map<string, OrderWithPda[]> {
    const grouped = new Map<string, OrderWithPda[]>();

    for (const order of orders) {
      const pairKey = order.order.pair.toString();
      if (!grouped.has(pairKey)) {
        grouped.set(pairKey, []);
      }
      grouped.get(pairKey)!.push(order);
    }

    return grouped;
  }

  /**
   * Check if two orders can potentially match
   * (Basic sanity checks - actual price comparison happens via MPC)
   */
  canPotentiallyMatch(buyOrder: OrderWithPda, sellOrder: OrderWithPda): boolean {
    // Must be opposite sides
    if (buyOrder.order.side !== Side.Buy || sellOrder.order.side !== Side.Sell) {
      return false;
    }

    // Must be same trading pair
    if (!buyOrder.order.pair.equals(sellOrder.order.pair)) {
      return false;
    }

    // Both must be verified
    if (!buyOrder.order.eligibilityProofVerified || !sellOrder.order.eligibilityProofVerified) {
      return false;
    }

    // Both must be Active and not in matching flow
    if (buyOrder.order.status !== OrderStatus.Active || sellOrder.order.status !== OrderStatus.Active) {
      return false;
    }
    if (buyOrder.order.isMatching || sellOrder.order.isMatching) {
      return false;
    }

    // Must be different makers
    if (buyOrder.order.maker.equals(sellOrder.order.maker)) {
      return false;
    }

    return true;
  }
}
