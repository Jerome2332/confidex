import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  validateBody,
  validateQuery,
  validateParams,
  publicKeySchema,
  hexStringSchema,
  signatureSchema,
  amountSchema,
  priceSchema,
  paginationSchema,
  proveRequestSchema,
} from '../../middleware/validation.js';
import { z } from 'zod';

// Mock request/response/next
function createMockReq(
  body: unknown = {},
  query: unknown = {},
  params: unknown = {}
): Partial<Request> {
  return {
    body,
    query: query as Request['query'],
    params: params as Request['params'],
  };
}

function createMockRes(): Partial<Response> & { statusCode: number; body: unknown } {
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(data: unknown) {
      this.body = data;
      return this as Response;
    },
  };
  return res;
}

describe('Validation Middleware', () => {
  describe('validateBody', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int().positive(),
    });

    it('passes valid body', () => {
      const req = createMockReq({ name: 'Alice', age: 30 });
      const res = createMockRes();
      const next = vi.fn();

      validateBody(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(req.body).toEqual({ name: 'Alice', age: 30 });
    });

    it('rejects invalid body', () => {
      const req = createMockReq({ name: 'Alice', age: -5 });
      const res = createMockRes();
      const next = vi.fn();

      validateBody(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        error: 'Validation Error',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'age' }),
        ]),
      });
    });

    it('rejects missing required fields', () => {
      const req = createMockReq({ name: 'Alice' });
      const res = createMockRes();
      const next = vi.fn();

      validateBody(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
    });
  });

  describe('validateQuery', () => {
    const schema = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    });

    it('passes valid query with defaults', () => {
      const req = createMockReq({}, {});
      const res = createMockRes();
      const next = vi.fn();

      validateQuery(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(req.query).toEqual({ page: 1, limit: 20 });
    });

    it('coerces string query params to numbers', () => {
      const req = createMockReq({}, { page: '5', limit: '50' });
      const res = createMockRes();
      const next = vi.fn();

      validateQuery(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(req.query).toEqual({ page: 5, limit: 50 });
    });

    it('rejects out-of-range values', () => {
      const req = createMockReq({}, { limit: '200' });
      const res = createMockRes();
      const next = vi.fn();

      validateQuery(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
    });
  });

  describe('validateParams', () => {
    const schema = z.object({
      id: z.string().uuid(),
    });

    it('passes valid params', () => {
      const req = createMockReq({}, {}, { id: '123e4567-e89b-12d3-a456-426614174000' });
      const res = createMockRes();
      const next = vi.fn();

      validateParams(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('rejects invalid params', () => {
      const req = createMockReq({}, {}, { id: 'not-a-uuid' });
      const res = createMockRes();
      const next = vi.fn();

      validateParams(schema)(req as Request, res as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
    });
  });
});

describe('Validation Schemas', () => {
  describe('publicKeySchema', () => {
    it('accepts valid Solana public keys', () => {
      const validKeys = [
        '11111111111111111111111111111111', // System program
        '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB', // 44 chars
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token program
      ];

      for (const key of validKeys) {
        expect(publicKeySchema.safeParse(key).success).toBe(true);
      }
    });

    it('rejects invalid public keys', () => {
      const invalidKeys = [
        '', // Empty
        'short', // Too short
        '0x1234567890abcdef', // Ethereum-style
        '111111111111111111111111111111110', // Invalid chars (0 at end)
        'OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO', // Invalid chars (O)
      ];

      for (const key of invalidKeys) {
        expect(publicKeySchema.safeParse(key).success).toBe(false);
      }
    });
  });

  describe('hexStringSchema', () => {
    it('accepts valid hex strings', () => {
      expect(hexStringSchema().safeParse('deadbeef').success).toBe(true);
      expect(hexStringSchema().safeParse('0123456789abcdef').success).toBe(true);
      expect(hexStringSchema().safeParse('ABCDEF').success).toBe(true);
    });

    it('validates specific byte length', () => {
      const schema32 = hexStringSchema(32);
      const valid32 = 'a'.repeat(64); // 32 bytes = 64 hex chars
      const invalid32 = 'a'.repeat(62);

      expect(schema32.safeParse(valid32).success).toBe(true);
      expect(schema32.safeParse(invalid32).success).toBe(false);
    });

    it('rejects non-hex strings', () => {
      expect(hexStringSchema().safeParse('xyz').success).toBe(false);
      expect(hexStringSchema().safeParse('0x1234').success).toBe(false); // Has 0x prefix
    });
  });

  describe('signatureSchema', () => {
    it('accepts valid transaction signatures', () => {
      // Solana signatures are 88 base58 chars
      const validSig = '5R4vHzBEsVkJBQZLMEBp9aRamZjEpvsbtwyEVGZhF2JvdcRGXWFWMqCdLPJkqxZuckBJr1Voa3Mcnh1WaBXC547p';
      expect(signatureSchema.safeParse(validSig).success).toBe(true);
    });

    it('rejects invalid signatures', () => {
      expect(signatureSchema.safeParse('short').success).toBe(false);
      expect(signatureSchema.safeParse('x'.repeat(100)).success).toBe(false);
    });
  });

  describe('amountSchema', () => {
    it('accepts positive integers', () => {
      expect(amountSchema.safeParse(1).success).toBe(true);
      expect(amountSchema.safeParse(1000000).success).toBe(true);
    });

    it('rejects non-positive or non-integer amounts', () => {
      expect(amountSchema.safeParse(0).success).toBe(false);
      expect(amountSchema.safeParse(-1).success).toBe(false);
      expect(amountSchema.safeParse(1.5).success).toBe(false);
    });
  });

  describe('priceSchema', () => {
    it('accepts positive numbers', () => {
      expect(priceSchema.safeParse(1.5).success).toBe(true);
      expect(priceSchema.safeParse(0.001).success).toBe(true);
      expect(priceSchema.safeParse(100).success).toBe(true);
    });

    it('rejects non-positive prices', () => {
      expect(priceSchema.safeParse(0).success).toBe(false);
      expect(priceSchema.safeParse(-1).success).toBe(false);
    });
  });

  describe('paginationSchema', () => {
    it('provides defaults', () => {
      const result = paginationSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ limit: 20, offset: 0 });
    });

    it('coerces string values', () => {
      const result = paginationSchema.safeParse({ limit: '50', offset: '10' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ limit: 50, offset: 10 });
    });

    it('enforces max limit', () => {
      const result = paginationSchema.safeParse({ limit: 200 });
      expect(result.success).toBe(false);
    });
  });

  describe('proveRequestSchema', () => {
    it('accepts valid proof request', () => {
      const validRequest = {
        address: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
        blacklistRoot: 'a'.repeat(64), // 32 bytes hex
        merklePath: Array(20).fill('b'.repeat(64)), // 20 x 32 bytes hex
        pathIndices: Array(20).fill(false), // 20 booleans
      };

      const result = proveRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('rejects invalid address', () => {
      const invalidRequest = {
        address: 'invalid',
        blacklistRoot: 'a'.repeat(64),
        merklePath: Array(20).fill('b'.repeat(64)),
        pathIndices: Array(20).fill(false),
      };

      const result = proveRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('rejects wrong merkle path length', () => {
      const invalidRequest = {
        address: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
        blacklistRoot: 'a'.repeat(64),
        merklePath: Array(10).fill('b'.repeat(64)), // Only 10 elements
        pathIndices: Array(20).fill(false),
      };

      const result = proveRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });
});
