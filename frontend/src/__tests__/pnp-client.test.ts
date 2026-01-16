import { describe, it, expect } from 'vitest';
import {
  calculatePythagoreanPrices,
  calculateTokensReceived,
  calculateUsdcReceived,
  calculatePrice,
} from '../lib/pnp-client';

describe('PNP Client Price Calculations', () => {
  describe('calculatePythagoreanPrices', () => {
    it('returns 50/50 when both supplies are zero', () => {
      const result = calculatePythagoreanPrices(BigInt(0), BigInt(0));
      expect(result.yesPrice).toBe(0.5);
      expect(result.noPrice).toBe(0.5);
    });

    it('calculates prices correctly when supplies are equal', () => {
      const result = calculatePythagoreanPrices(BigInt(1000000), BigInt(1000000));
      expect(result.yesPrice).toBe(0.5);
      expect(result.noPrice).toBe(0.5);
    });

    it('calculates prices correctly when YES has more supply', () => {
      // More YES tokens = lower YES price (inverse relationship)
      const result = calculatePythagoreanPrices(BigInt(3000000), BigInt(1000000));
      expect(result.yesPrice).toBe(0.25); // 1M / 4M = 0.25
      expect(result.noPrice).toBe(0.75); // 3M / 4M = 0.75
    });

    it('calculates prices correctly when NO has more supply', () => {
      // More NO tokens = lower NO price (inverse relationship)
      const result = calculatePythagoreanPrices(BigInt(1000000), BigInt(3000000));
      expect(result.yesPrice).toBe(0.75); // 3M / 4M = 0.75
      expect(result.noPrice).toBe(0.25); // 1M / 4M = 0.25
    });

    it('prices sum to 1', () => {
      const testCases = [
        [BigInt(500), BigInt(500)],
        [BigInt(1000), BigInt(2000)],
        [BigInt(999999), BigInt(1)],
        [BigInt(1), BigInt(999999)],
        [BigInt(12345678), BigInt(87654321)],
      ];

      for (const [yesSupply, noSupply] of testCases) {
        const result = calculatePythagoreanPrices(yesSupply, noSupply);
        expect(result.yesPrice + result.noPrice).toBeCloseTo(1, 10);
      }
    });
  });

  describe('calculateTokensReceived', () => {
    it('calculates tokens correctly for given USDC and price', () => {
      // $10 USDC at 0.5 price = 20 tokens (in base units)
      const tokens = calculateTokensReceived(10, 0.5);
      expect(tokens).toBe(BigInt(20000000)); // 20 * 1e6
    });

    it('handles high prices correctly', () => {
      // $10 USDC at 0.9 price = ~11.11 tokens
      const tokens = calculateTokensReceived(10, 0.9);
      expect(Number(tokens)).toBeCloseTo(11111111, -3);
    });

    it('handles low prices correctly', () => {
      // $10 USDC at 0.1 price = 100 tokens
      const tokens = calculateTokensReceived(10, 0.1);
      expect(tokens).toBe(BigInt(100000000)); // 100 * 1e6
    });

    it('returns 0 when price is 0', () => {
      const tokens = calculateTokensReceived(10, 0);
      expect(tokens).toBe(BigInt(0));
    });
  });

  describe('calculateUsdcReceived', () => {
    it('calculates USDC correctly for given tokens and price', () => {
      // 20 tokens at 0.5 price = $10 USDC
      const usdc = calculateUsdcReceived(BigInt(20000000), 0.5);
      expect(usdc).toBe(10);
    });

    it('handles fractional amounts', () => {
      // 15.5 tokens at 0.4 price = $6.2 USDC
      const usdc = calculateUsdcReceived(BigInt(15500000), 0.4);
      expect(usdc).toBeCloseTo(6.2, 5);
    });

    it('returns 0 when tokens is 0', () => {
      const usdc = calculateUsdcReceived(BigInt(0), 0.5);
      expect(usdc).toBe(0);
    });
  });

  describe('calculatePrice (legacy)', () => {
    it('returns 0.5 when reserves are 0', () => {
      const price = calculatePrice(BigInt(1000), BigInt(0));
      expect(price).toBe(0.5);
    });

    it('calculates price based on supply and reserves', () => {
      // price = reserves / (supply + reserves)
      const price = calculatePrice(BigInt(3000), BigInt(1000));
      expect(price).toBe(0.25); // 1000 / 4000
    });
  });
});

describe('Edge Cases', () => {
  it('handles very large numbers', () => {
    const largeSupply = BigInt('1000000000000000'); // 1 quadrillion
    const result = calculatePythagoreanPrices(largeSupply, largeSupply);
    expect(result.yesPrice).toBe(0.5);
    expect(result.noPrice).toBe(0.5);
  });

  it('handles asymmetric large numbers', () => {
    const yesSupply = BigInt('900000000000000');
    const noSupply = BigInt('100000000000000');
    const result = calculatePythagoreanPrices(yesSupply, noSupply);
    expect(result.yesPrice).toBe(0.1);
    expect(result.noPrice).toBe(0.9);
  });
});
