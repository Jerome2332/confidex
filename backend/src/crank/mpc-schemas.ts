/**
 * MPC Callback Validation Schemas
 *
 * Zod schemas for validating MPC computation results and callbacks.
 * Ensures data integrity before processing MPC responses.
 */

import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { MpcError, ErrorCode, ValidationError } from '../lib/errors.js';

// =============================================================================
// Custom Validators
// =============================================================================

/**
 * Validate Solana public key
 */
const publicKeySchema = z.string().refine(
  (value) => {
    try {
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid Solana public key' }
);

/**
 * Validate 32-byte hex string (for request IDs)
 */
const bytes32HexSchema = z.string().length(64).regex(/^[0-9a-fA-F]+$/, {
  message: 'Must be a 64-character hexadecimal string (32 bytes)',
});

/**
 * Validate Uint8Array of specific length
 */
const bytesSchema = (length: number) =>
  z.instanceof(Uint8Array).refine(
    (arr) => arr.length === length,
    { message: `Expected ${length} bytes` }
  );

// =============================================================================
// MPC Computation Type Schemas
// =============================================================================

/**
 * Price comparison result schema
 */
export const priceCompareResultSchema = z.object({
  type: z.literal('compare_prices'),
  matched: z.boolean(),
  buyOrderPrice: z.bigint().optional(),
  sellOrderPrice: z.bigint().optional(),
});

/**
 * Fill calculation result schema
 */
export const fillCalculationResultSchema = z.object({
  type: z.literal('calculate_fill'),
  fillAmount: z.bigint().positive(),
  fillValue: z.bigint().positive(),
  buyFullyFilled: z.boolean(),
  sellFullyFilled: z.boolean(),
});

/**
 * Liquidation check result schema
 */
export const liquidationCheckResultSchema = z.object({
  type: z.literal('check_liquidation'),
  shouldLiquidate: z.boolean(),
  marginRatio: z.bigint().optional(),
  threshold: z.bigint().optional(),
});

/**
 * Margin ratio calculation result schema
 */
export const marginRatioResultSchema = z.object({
  type: z.literal('calculate_margin_ratio'),
  marginRatio: z.bigint(),
  collateral: z.bigint(),
  position: z.bigint(),
});

/**
 * PnL calculation result schema
 */
export const pnlCalculationResultSchema = z.object({
  type: z.literal('calculate_pnl'),
  pnl: z.bigint(),
  isProfit: z.boolean(),
});

/**
 * Funding rate calculation result schema
 */
export const fundingRateResultSchema = z.object({
  type: z.literal('calculate_funding'),
  fundingAmount: z.bigint(),
  isPayment: z.boolean(), // true = position pays funding, false = position receives
});

/**
 * Discriminated union of all MPC result types
 */
export const mpcResultSchema = z.discriminatedUnion('type', [
  priceCompareResultSchema,
  fillCalculationResultSchema,
  liquidationCheckResultSchema,
  marginRatioResultSchema,
  pnlCalculationResultSchema,
  fundingRateResultSchema,
]);

export type MpcResult = z.infer<typeof mpcResultSchema>;

// =============================================================================
// MPC Callback Schema
// =============================================================================

/**
 * Complete MPC callback schema
 */
export const mpcCallbackSchema = z.object({
  /** 32-byte request ID as hex string */
  requestId: bytes32HexSchema,

  /** Computation result */
  result: mpcResultSchema,

  /** MPC cluster signature (Ed25519) */
  signature: z.string().min(64).max(128),

  /** Timestamp when computation completed (Unix ms) */
  timestamp: z.number().int().positive(),

  /** Cluster that performed the computation */
  clusterOffset: z.number().int().min(0),

  /** Optional error information */
  error: z.object({
    code: z.number().int(),
    message: z.string(),
  }).optional(),
});

export type MpcCallback = z.infer<typeof mpcCallbackSchema>;

// =============================================================================
// Event Schemas (for log parsing)
// =============================================================================

/**
 * PriceCompareResult event schema
 */
export const priceCompareEventSchema = z.object({
  computationOffset: z.bigint(),
  pricesMatch: z.boolean(),
  requestId: z.instanceof(Uint8Array).refine((arr) => arr.length === 32),
  buyOrder: z.instanceof(PublicKey),
  sellOrder: z.instanceof(PublicKey),
  nonce: z.bigint(),
});

export type PriceCompareEvent = z.infer<typeof priceCompareEventSchema>;

/**
 * FillCalculationResult event schema
 */
export const fillCalculationEventSchema = z.object({
  computationOffset: z.bigint(),
  encryptedFillAmount: z.instanceof(Uint8Array).refine((arr) => arr.length === 64),
  buyFullyFilled: z.boolean(),
  sellFullyFilled: z.boolean(),
  requestId: z.instanceof(Uint8Array).refine((arr) => arr.length === 32),
  buyOrder: z.instanceof(PublicKey),
  sellOrder: z.instanceof(PublicKey),
});

export type FillCalculationEvent = z.infer<typeof fillCalculationEventSchema>;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate MPC callback data
 *
 * @param data - Raw callback data
 * @returns Validated callback
 * @throws MpcError if validation fails
 */
export function validateMpcCallback(data: unknown): MpcCallback {
  const result = mpcCallbackSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new MpcError(
      `Invalid MPC callback: ${errors.join(', ')}`,
      ErrorCode.MPC_INVALID_RESPONSE,
      undefined,
      { validationErrors: errors },
      false // Not retryable - data is malformed
    );
  }

  return result.data;
}

/**
 * Validate MPC result data
 *
 * @param data - Raw result data
 * @returns Validated result
 * @throws ValidationError if validation fails
 */
export function validateMpcResult(data: unknown): MpcResult {
  const result = mpcResultSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw ValidationError.invalidInput('mpcResult', errors.join(', '));
  }

  return result.data;
}

/**
 * Validate price compare event from log data
 *
 * @param data - Parsed event data
 * @returns Validated event
 * @throws ValidationError if validation fails
 */
export function validatePriceCompareEvent(data: unknown): PriceCompareEvent {
  const result = priceCompareEventSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw ValidationError.invalidInput('priceCompareEvent', errors.join(', '));
  }

  return result.data;
}

/**
 * Validate fill calculation event from log data
 *
 * @param data - Parsed event data
 * @returns Validated event
 * @throws ValidationError if validation fails
 */
export function validateFillCalculationEvent(data: unknown): FillCalculationEvent {
  const result = fillCalculationEventSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw ValidationError.invalidInput('fillCalculationEvent', errors.join(', '));
  }

  return result.data;
}

// =============================================================================
// Signature Verification (Placeholder)
// =============================================================================

/**
 * Verify MPC cluster signature
 *
 * In production, this would verify the Ed25519 signature from the Arcium cluster.
 * The signature proves the result came from a legitimate MPC computation.
 *
 * @param callback - MPC callback with signature
 * @param clusterPubkey - Expected cluster public key
 * @returns True if signature is valid
 */
export function verifyMpcSignature(
  callback: MpcCallback,
  _clusterPubkey: Uint8Array
): boolean {
  // TODO: Implement Ed25519 signature verification
  // For now, log a warning and return true in development
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[MPC] Signature verification skipped in development mode');
    return true;
  }

  // In production, verify the signature
  // const message = JSON.stringify(callback.result);
  // return nacl.sign.detached.verify(
  //   Buffer.from(message),
  //   Buffer.from(callback.signature, 'hex'),
  //   clusterPubkey
  // );

  // For now, reject in production until signature verification is implemented
  throw new MpcError(
    'MPC signature verification not implemented',
    ErrorCode.MPC_SIGNATURE_INVALID,
    undefined,
    { clusterOffset: callback.clusterOffset },
    false
  );
}

// =============================================================================
// Type Guards
// =============================================================================

export function isPriceCompareResult(result: MpcResult): result is z.infer<typeof priceCompareResultSchema> {
  return result.type === 'compare_prices';
}

export function isFillCalculationResult(result: MpcResult): result is z.infer<typeof fillCalculationResultSchema> {
  return result.type === 'calculate_fill';
}

export function isLiquidationCheckResult(result: MpcResult): result is z.infer<typeof liquidationCheckResultSchema> {
  return result.type === 'check_liquidation';
}
