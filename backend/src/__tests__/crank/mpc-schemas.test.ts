/**
 * MPC Schema Validation Tests
 *
 * Tests the Zod schemas for MPC callback validation:
 * - Price comparison results
 * - Fill calculation results
 * - Liquidation check results
 * - Callback validation functions
 * - Type guards
 */

import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  priceCompareResultSchema,
  fillCalculationResultSchema,
  liquidationCheckResultSchema,
  marginRatioResultSchema,
  pnlCalculationResultSchema,
  fundingRateResultSchema,
  mpcResultSchema,
  mpcCallbackSchema,
  priceCompareEventSchema,
  fillCalculationEventSchema,
  validateMpcCallback,
  validateMpcResult,
  validatePriceCompareEvent,
  validateFillCalculationEvent,
  verifyMpcSignature,
  isPriceCompareResult,
  isFillCalculationResult,
  isLiquidationCheckResult,
  type MpcCallback,
  type MpcResult,
} from '../../crank/mpc-schemas.js';
import { MpcError, ValidationError } from '../../lib/errors.js';

describe('MPC Schema Validation', () => {
  describe('priceCompareResultSchema', () => {
    it('should validate correct price compare result', () => {
      const result = priceCompareResultSchema.parse({
        type: 'compare_prices',
        matched: true,
        buyOrderPrice: 1000n,
        sellOrderPrice: 1000n,
      });

      expect(result.type).toBe('compare_prices');
      expect(result.matched).toBe(true);
      expect(result.buyOrderPrice).toBe(1000n);
      expect(result.sellOrderPrice).toBe(1000n);
    });

    it('should validate result without optional fields', () => {
      const result = priceCompareResultSchema.parse({
        type: 'compare_prices',
        matched: false,
      });

      expect(result.type).toBe('compare_prices');
      expect(result.matched).toBe(false);
      expect(result.buyOrderPrice).toBeUndefined();
    });

    it('should reject invalid type', () => {
      expect(() =>
        priceCompareResultSchema.parse({
          type: 'invalid_type',
          matched: true,
        })
      ).toThrow();
    });

    it('should reject missing matched field', () => {
      expect(() =>
        priceCompareResultSchema.parse({
          type: 'compare_prices',
        })
      ).toThrow();
    });
  });

  describe('fillCalculationResultSchema', () => {
    it('should validate correct fill calculation result', () => {
      const result = fillCalculationResultSchema.parse({
        type: 'calculate_fill',
        fillAmount: 1000n,
        fillValue: 5000n,
        buyFullyFilled: true,
        sellFullyFilled: false,
      });

      expect(result.type).toBe('calculate_fill');
      expect(result.fillAmount).toBe(1000n);
      expect(result.fillValue).toBe(5000n);
      expect(result.buyFullyFilled).toBe(true);
      expect(result.sellFullyFilled).toBe(false);
    });

    it('should reject non-positive fillAmount', () => {
      expect(() =>
        fillCalculationResultSchema.parse({
          type: 'calculate_fill',
          fillAmount: 0n,
          fillValue: 5000n,
          buyFullyFilled: true,
          sellFullyFilled: false,
        })
      ).toThrow();
    });

    it('should reject negative fillValue', () => {
      expect(() =>
        fillCalculationResultSchema.parse({
          type: 'calculate_fill',
          fillAmount: 1000n,
          fillValue: -1n,
          buyFullyFilled: true,
          sellFullyFilled: false,
        })
      ).toThrow();
    });
  });

  describe('liquidationCheckResultSchema', () => {
    it('should validate correct liquidation check result', () => {
      const result = liquidationCheckResultSchema.parse({
        type: 'check_liquidation',
        shouldLiquidate: true,
        marginRatio: 500n,
        threshold: 1000n,
      });

      expect(result.type).toBe('check_liquidation');
      expect(result.shouldLiquidate).toBe(true);
      expect(result.marginRatio).toBe(500n);
      expect(result.threshold).toBe(1000n);
    });

    it('should validate without optional fields', () => {
      const result = liquidationCheckResultSchema.parse({
        type: 'check_liquidation',
        shouldLiquidate: false,
      });

      expect(result.shouldLiquidate).toBe(false);
      expect(result.marginRatio).toBeUndefined();
    });
  });

  describe('marginRatioResultSchema', () => {
    it('should validate correct margin ratio result', () => {
      const result = marginRatioResultSchema.parse({
        type: 'calculate_margin_ratio',
        marginRatio: 2000n,
        collateral: 10000n,
        position: 5000n,
      });

      expect(result.type).toBe('calculate_margin_ratio');
      expect(result.marginRatio).toBe(2000n);
      expect(result.collateral).toBe(10000n);
      expect(result.position).toBe(5000n);
    });
  });

  describe('pnlCalculationResultSchema', () => {
    it('should validate profit result', () => {
      const result = pnlCalculationResultSchema.parse({
        type: 'calculate_pnl',
        pnl: 500n,
        isProfit: true,
      });

      expect(result.type).toBe('calculate_pnl');
      expect(result.pnl).toBe(500n);
      expect(result.isProfit).toBe(true);
    });

    it('should validate loss result', () => {
      const result = pnlCalculationResultSchema.parse({
        type: 'calculate_pnl',
        pnl: 500n,
        isProfit: false,
      });

      expect(result.isProfit).toBe(false);
    });
  });

  describe('fundingRateResultSchema', () => {
    it('should validate funding payment result', () => {
      const result = fundingRateResultSchema.parse({
        type: 'calculate_funding',
        fundingAmount: 100n,
        isPayment: true,
      });

      expect(result.type).toBe('calculate_funding');
      expect(result.fundingAmount).toBe(100n);
      expect(result.isPayment).toBe(true);
    });

    it('should validate funding receipt result', () => {
      const result = fundingRateResultSchema.parse({
        type: 'calculate_funding',
        fundingAmount: 100n,
        isPayment: false,
      });

      expect(result.isPayment).toBe(false);
    });
  });

  describe('mpcResultSchema (discriminated union)', () => {
    it('should correctly discriminate price compare result', () => {
      const result = mpcResultSchema.parse({
        type: 'compare_prices',
        matched: true,
      });

      expect(result.type).toBe('compare_prices');
      expect(isPriceCompareResult(result)).toBe(true);
      expect(isFillCalculationResult(result)).toBe(false);
    });

    it('should correctly discriminate fill calculation result', () => {
      const result = mpcResultSchema.parse({
        type: 'calculate_fill',
        fillAmount: 1000n,
        fillValue: 5000n,
        buyFullyFilled: true,
        sellFullyFilled: false,
      });

      expect(result.type).toBe('calculate_fill');
      expect(isFillCalculationResult(result)).toBe(true);
      expect(isPriceCompareResult(result)).toBe(false);
    });

    it('should correctly discriminate liquidation check result', () => {
      const result = mpcResultSchema.parse({
        type: 'check_liquidation',
        shouldLiquidate: false,
      });

      expect(result.type).toBe('check_liquidation');
      expect(isLiquidationCheckResult(result)).toBe(true);
    });

    it('should reject unknown result type', () => {
      expect(() =>
        mpcResultSchema.parse({
          type: 'unknown_type',
          data: 'test',
        })
      ).toThrow();
    });
  });

  describe('mpcCallbackSchema', () => {
    it('should validate complete callback', () => {
      const callback = mpcCallbackSchema.parse({
        requestId: 'a'.repeat(64), // 64 hex chars = 32 bytes
        result: {
          type: 'compare_prices',
          matched: true,
        },
        signature: 'b'.repeat(128),
        timestamp: Date.now(),
        clusterOffset: 456,
      });

      expect(callback.requestId).toHaveLength(64);
      expect(callback.result.type).toBe('compare_prices');
      expect(callback.clusterOffset).toBe(456);
    });

    it('should validate callback with error', () => {
      const callback = mpcCallbackSchema.parse({
        requestId: 'c'.repeat(64),
        result: {
          type: 'calculate_fill',
          fillAmount: 1000n,
          fillValue: 5000n,
          buyFullyFilled: false,
          sellFullyFilled: false,
        },
        signature: 'd'.repeat(64),
        timestamp: Date.now(),
        clusterOffset: 456,
        error: {
          code: 1001,
          message: 'Computation failed',
        },
      });

      expect(callback.error).toBeDefined();
      expect(callback.error?.code).toBe(1001);
    });

    it('should reject invalid request ID length', () => {
      expect(() =>
        mpcCallbackSchema.parse({
          requestId: 'abc', // Too short
          result: {
            type: 'compare_prices',
            matched: true,
          },
          signature: 'b'.repeat(64),
          timestamp: Date.now(),
          clusterOffset: 456,
        })
      ).toThrow();
    });

    it('should reject non-hex request ID', () => {
      expect(() =>
        mpcCallbackSchema.parse({
          requestId: 'g'.repeat(64), // 'g' is not hex
          result: {
            type: 'compare_prices',
            matched: true,
          },
          signature: 'b'.repeat(64),
          timestamp: Date.now(),
          clusterOffset: 456,
        })
      ).toThrow();
    });

    it('should reject negative cluster offset', () => {
      expect(() =>
        mpcCallbackSchema.parse({
          requestId: 'a'.repeat(64),
          result: {
            type: 'compare_prices',
            matched: true,
          },
          signature: 'b'.repeat(64),
          timestamp: Date.now(),
          clusterOffset: -1,
        })
      ).toThrow();
    });

    it('should reject signature that is too short', () => {
      expect(() =>
        mpcCallbackSchema.parse({
          requestId: 'a'.repeat(64),
          result: {
            type: 'compare_prices',
            matched: true,
          },
          signature: 'short',
          timestamp: Date.now(),
          clusterOffset: 456,
        })
      ).toThrow();
    });
  });

  describe('priceCompareEventSchema', () => {
    it('should validate correct event', () => {
      const buyOrder = PublicKey.default;
      const sellOrder = PublicKey.default;
      const requestId = new Uint8Array(32);

      const result = priceCompareEventSchema.parse({
        computationOffset: 100n,
        pricesMatch: true,
        requestId,
        buyOrder,
        sellOrder,
        nonce: 12345n,
      });

      expect(result.computationOffset).toBe(100n);
      expect(result.pricesMatch).toBe(true);
    });

    it('should reject request ID with wrong length', () => {
      expect(() =>
        priceCompareEventSchema.parse({
          computationOffset: 100n,
          pricesMatch: true,
          requestId: new Uint8Array(16), // Wrong length
          buyOrder: PublicKey.default,
          sellOrder: PublicKey.default,
          nonce: 12345n,
        })
      ).toThrow();
    });
  });

  describe('fillCalculationEventSchema', () => {
    it('should validate correct event', () => {
      const result = fillCalculationEventSchema.parse({
        computationOffset: 200n,
        encryptedFillAmount: new Uint8Array(64),
        buyFullyFilled: true,
        sellFullyFilled: false,
        requestId: new Uint8Array(32),
        buyOrder: PublicKey.default,
        sellOrder: PublicKey.default,
      });

      expect(result.computationOffset).toBe(200n);
      expect(result.buyFullyFilled).toBe(true);
      expect(result.sellFullyFilled).toBe(false);
    });

    it('should reject encrypted fill with wrong length', () => {
      expect(() =>
        fillCalculationEventSchema.parse({
          computationOffset: 200n,
          encryptedFillAmount: new Uint8Array(32), // Wrong length
          buyFullyFilled: true,
          sellFullyFilled: false,
          requestId: new Uint8Array(32),
          buyOrder: PublicKey.default,
          sellOrder: PublicKey.default,
        })
      ).toThrow();
    });
  });

  describe('validateMpcCallback', () => {
    it('should return validated callback for valid data', () => {
      const data = {
        requestId: 'a'.repeat(64),
        result: {
          type: 'compare_prices',
          matched: true,
        },
        signature: 'b'.repeat(64),
        timestamp: Date.now(),
        clusterOffset: 456,
      };

      const callback = validateMpcCallback(data);

      expect(callback.requestId).toBe(data.requestId);
      expect(callback.result.type).toBe('compare_prices');
    });

    it('should throw MpcError for invalid data', () => {
      const data = {
        requestId: 'invalid',
        result: {
          type: 'compare_prices',
          matched: true,
        },
        signature: 'b'.repeat(64),
        timestamp: Date.now(),
        clusterOffset: 456,
      };

      expect(() => validateMpcCallback(data)).toThrow(MpcError);
    });

    it('should include validation errors in MpcError context', () => {
      const data = {
        requestId: 'short',
        result: {
          type: 'compare_prices',
        }, // Missing matched
        signature: 'x',
        timestamp: -1,
        clusterOffset: -1,
      };

      try {
        validateMpcCallback(data);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MpcError);
        const mpcErr = err as MpcError;
        expect(mpcErr.message).toContain('Invalid MPC callback');
      }
    });
  });

  describe('validateMpcResult', () => {
    it('should return validated result for valid data', () => {
      const data = {
        type: 'calculate_fill',
        fillAmount: 1000n,
        fillValue: 5000n,
        buyFullyFilled: true,
        sellFullyFilled: false,
      };

      const result = validateMpcResult(data);

      expect(result.type).toBe('calculate_fill');
    });

    it('should throw ValidationError for invalid data', () => {
      const data = {
        type: 'invalid_type',
      };

      expect(() => validateMpcResult(data)).toThrow(ValidationError);
    });
  });

  describe('validatePriceCompareEvent', () => {
    it('should return validated event for valid data', () => {
      const data = {
        computationOffset: 100n,
        pricesMatch: true,
        requestId: new Uint8Array(32),
        buyOrder: PublicKey.default,
        sellOrder: PublicKey.default,
        nonce: 12345n,
      };

      const event = validatePriceCompareEvent(data);

      expect(event.pricesMatch).toBe(true);
    });

    it('should throw ValidationError for invalid data', () => {
      const data = {
        computationOffset: 100n,
        pricesMatch: 'not-boolean', // Invalid type
        requestId: new Uint8Array(32),
        buyOrder: PublicKey.default,
        sellOrder: PublicKey.default,
        nonce: 12345n,
      };

      expect(() => validatePriceCompareEvent(data)).toThrow(ValidationError);
    });
  });

  describe('validateFillCalculationEvent', () => {
    it('should return validated event for valid data', () => {
      const data = {
        computationOffset: 200n,
        encryptedFillAmount: new Uint8Array(64),
        buyFullyFilled: true,
        sellFullyFilled: false,
        requestId: new Uint8Array(32),
        buyOrder: PublicKey.default,
        sellOrder: PublicKey.default,
      };

      const event = validateFillCalculationEvent(data);

      expect(event.buyFullyFilled).toBe(true);
    });

    it('should throw ValidationError for missing fields', () => {
      const data = {
        computationOffset: 200n,
        // Missing encryptedFillAmount
      };

      expect(() => validateFillCalculationEvent(data)).toThrow(ValidationError);
    });
  });

  describe('verifyMpcSignature', () => {
    const validCallback: MpcCallback = {
      requestId: 'a'.repeat(64),
      result: {
        type: 'compare_prices',
        matched: true,
      },
      signature: 'b'.repeat(64),
      timestamp: Date.now(),
      clusterOffset: 456,
    };

    it('should return true in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const result = verifyMpcSignature(validCallback, new Uint8Array(32));

      expect(result).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });

    it('should throw in production mode (not implemented)', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      expect(() =>
        verifyMpcSignature(validCallback, new Uint8Array(32))
      ).toThrow(MpcError);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Type Guards', () => {
    it('isPriceCompareResult should correctly identify price compare results', () => {
      const priceCompare: MpcResult = {
        type: 'compare_prices',
        matched: true,
      };

      expect(isPriceCompareResult(priceCompare)).toBe(true);

      const fillCalc: MpcResult = {
        type: 'calculate_fill',
        fillAmount: 1000n,
        fillValue: 5000n,
        buyFullyFilled: true,
        sellFullyFilled: false,
      };

      expect(isPriceCompareResult(fillCalc)).toBe(false);
    });

    it('isFillCalculationResult should correctly identify fill calculation results', () => {
      const fillCalc: MpcResult = {
        type: 'calculate_fill',
        fillAmount: 1000n,
        fillValue: 5000n,
        buyFullyFilled: true,
        sellFullyFilled: false,
      };

      expect(isFillCalculationResult(fillCalc)).toBe(true);

      const priceCompare: MpcResult = {
        type: 'compare_prices',
        matched: true,
      };

      expect(isFillCalculationResult(priceCompare)).toBe(false);
    });

    it('isLiquidationCheckResult should correctly identify liquidation results', () => {
      const liquidation: MpcResult = {
        type: 'check_liquidation',
        shouldLiquidate: true,
        marginRatio: 500n,
        threshold: 1000n,
      };

      expect(isLiquidationCheckResult(liquidation)).toBe(true);

      const fillCalc: MpcResult = {
        type: 'calculate_fill',
        fillAmount: 1000n,
        fillValue: 5000n,
        buyFullyFilled: true,
        sellFullyFilled: false,
      };

      expect(isLiquidationCheckResult(fillCalc)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle maximum bigint values', () => {
      const maxBigint = 2n ** 64n - 1n;

      const result = fillCalculationResultSchema.parse({
        type: 'calculate_fill',
        fillAmount: maxBigint,
        fillValue: maxBigint,
        buyFullyFilled: true,
        sellFullyFilled: true,
      });

      expect(result.fillAmount).toBe(maxBigint);
    });

    it('should handle minimum positive bigint values', () => {
      const result = fillCalculationResultSchema.parse({
        type: 'calculate_fill',
        fillAmount: 1n,
        fillValue: 1n,
        buyFullyFilled: true,
        sellFullyFilled: true,
      });

      expect(result.fillAmount).toBe(1n);
    });

    it('should handle empty error message in callback', () => {
      const callback = mpcCallbackSchema.parse({
        requestId: 'a'.repeat(64),
        result: {
          type: 'compare_prices',
          matched: false,
        },
        signature: 'b'.repeat(64),
        timestamp: Date.now(),
        clusterOffset: 456,
        error: {
          code: 0,
          message: '',
        },
      });

      expect(callback.error?.message).toBe('');
    });

    it('should handle large cluster offset values', () => {
      const callback = mpcCallbackSchema.parse({
        requestId: 'a'.repeat(64),
        result: {
          type: 'compare_prices',
          matched: true,
        },
        signature: 'b'.repeat(64),
        timestamp: Date.now(),
        clusterOffset: 10000, // Large value allowed
      });

      expect(callback.clusterOffset).toBe(10000);
    });

    it('should reject negative cluster offset', () => {
      expect(() =>
        mpcCallbackSchema.parse({
          requestId: 'a'.repeat(64),
          result: {
            type: 'compare_prices',
            matched: true,
          },
          signature: 'b'.repeat(64),
          timestamp: Date.now(),
          clusterOffset: -1, // Negative not allowed
        })
      ).toThrow();
    });
  });
});
