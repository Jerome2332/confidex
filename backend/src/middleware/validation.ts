/**
 * Input Validation Middleware
 *
 * Zod-based request validation for body, query, and params.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * Format Zod errors into a user-friendly response
 */
function formatZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.errors.map((err) => ({
    field: err.path.join('.') || 'body',
    message: err.message,
  }));
}

/**
 * Validate request body against Zod schema
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: formatZodErrors(result.error),
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Validate query parameters against Zod schema
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: formatZodErrors(result.error),
      });
      return;
    }

    req.query = result.data as typeof req.query;
    next();
  };
}

/**
 * Validate URL parameters against Zod schema
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid URL parameters',
        details: formatZodErrors(result.error),
      });
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
}

// ============================================================================
// Common Validation Schemas
// ============================================================================

/**
 * Solana public key validation (base58)
 */
export const publicKeySchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana public key');

/**
 * Hex string validation
 */
export function hexStringSchema(byteLength?: number) {
  const pattern = byteLength
    ? new RegExp(`^[0-9a-fA-F]{${byteLength * 2}}$`)
    : /^[0-9a-fA-F]+$/;
  const message = byteLength
    ? `Must be ${byteLength} bytes (${byteLength * 2} hex characters)`
    : 'Must be valid hexadecimal';
  return z.string().regex(pattern, message);
}

/**
 * Transaction signature validation
 */
export const signatureSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/, 'Invalid transaction signature');

/**
 * Positive integer amount
 */
export const amountSchema = z
  .number()
  .int('Amount must be an integer')
  .positive('Amount must be positive');

/**
 * Positive price
 */
export const priceSchema = z
  .number()
  .positive('Price must be positive');

/**
 * Pagination schema
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Order side schema
 */
export const orderSideSchema = z.enum(['buy', 'sell', 'Buy', 'Sell']);

/**
 * Order status schema
 */
export const orderStatusSchema = z.enum([
  'Open',
  'PartiallyFilled',
  'Filled',
  'Cancelled',
  'Matching',
]);

// ============================================================================
// Route-Specific Schemas
// ============================================================================

/**
 * Proof request validation schema
 */
export const proveRequestSchema = z.object({
  address: publicKeySchema,
  blacklistRoot: hexStringSchema(32),
  merklePath: z.array(hexStringSchema(32)).length(20),
  pathIndices: z.array(z.boolean()).length(20),
});

/**
 * Blacklist add/remove request schema
 */
export const blacklistModifySchema = z.object({
  address: publicKeySchema,
});

/**
 * Order query schema
 */
export const orderQuerySchema = z.object({
  tradingPair: publicKeySchema.optional(),
  side: orderSideSchema.optional(),
  status: orderStatusSchema.optional(),
  ...paginationSchema.shape,
});

/**
 * Match request schema (for manual matching)
 */
export const matchRequestSchema = z.object({
  buyOrderPda: publicKeySchema,
  sellOrderPda: publicKeySchema,
});

// Export all schemas in a namespace for easy access
export const schemas = {
  publicKey: publicKeySchema,
  hexString: hexStringSchema,
  signature: signatureSchema,
  amount: amountSchema,
  price: priceSchema,
  pagination: paginationSchema,
  orderSide: orderSideSchema,
  orderStatus: orderStatusSchema,
  proveRequest: proveRequestSchema,
  blacklistModify: blacklistModifySchema,
  orderQuery: orderQuerySchema,
  matchRequest: matchRequestSchema,
};
