import { describe, it, expect } from 'vitest';
import { calculateSettlementAmounts } from '../hooks/use-settlement';

describe('Settlement Utilities', () => {
  describe('calculateSettlementAmounts', () => {
    it('calculates base amount in SOL correctly', () => {
      // 1 SOL = 1e9 lamports
      const { baseAmount, quoteAmount } = calculateSettlementAmounts(
        BigInt(1_000_000_000), // 1 SOL in lamports
        BigInt(100_000_000),   // 100 USDC price in micro-units
        'buy'
      );
      expect(baseAmount).toBe(1); // 1 SOL
      expect(quoteAmount).toBe(100); // 100 USDC
    });

    it('calculates fractional SOL amounts', () => {
      const { baseAmount, quoteAmount } = calculateSettlementAmounts(
        BigInt(500_000_000), // 0.5 SOL
        BigInt(100_000_000), // 100 USDC price
        'buy'
      );
      expect(baseAmount).toBe(0.5);
      expect(quoteAmount).toBe(50);
    });

    it('handles small amounts correctly', () => {
      const { baseAmount, quoteAmount } = calculateSettlementAmounts(
        BigInt(1_000_000), // 0.001 SOL
        BigInt(100_000_000), // 100 USDC price
        'buy'
      );
      expect(baseAmount).toBe(0.001);
      expect(quoteAmount).toBeCloseTo(0.1, 5);
    });

    it('handles large amounts correctly', () => {
      const { baseAmount, quoteAmount } = calculateSettlementAmounts(
        BigInt(100_000_000_000), // 100 SOL
        BigInt(150_000_000),     // 150 USDC price
        'sell'
      );
      expect(baseAmount).toBe(100);
      expect(quoteAmount).toBe(15000);
    });

    it('handles zero amount', () => {
      const { baseAmount, quoteAmount } = calculateSettlementAmounts(
        BigInt(0),
        BigInt(100_000_000),
        'buy'
      );
      expect(baseAmount).toBe(0);
      expect(quoteAmount).toBe(0);
    });
  });
});
