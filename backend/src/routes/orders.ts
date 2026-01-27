/**
 * Orders API Routes
 *
 * Public endpoints for order operations including order simulation
 * and order book queries.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { rateLimiters, createCustomRateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../lib/logger.js';

const router: RouterType = Router();
const log = logger.http;

// Apply higher rate limit for order simulation (for load testing)
// Use LOAD_TEST_MODE=true to enable high throughput
const ordersRateLimiter = process.env.LOAD_TEST_MODE === 'true'
  ? createCustomRateLimiter(5000) // Very high limit for load testing
  : rateLimiters.standard;        // Standard 100/min for production

router.use(ordersRateLimiter);

// =============================================================================
// Request Validation Schemas
// =============================================================================

/**
 * Order simulation request schema
 * Validates encrypted order data for simulation
 */
const orderSimulationSchema = z.object({
  pair: z.string().min(32).max(64).describe('Trading pair PDA'),
  side: z.enum(['buy', 'sell']).describe('Order side'),
  encryptedAmount: z.string().min(64).describe('Encrypted order amount (hex)'),
  encryptedPrice: z.string().min(64).describe('Encrypted order price (hex)'),
  eligibilityProof: z.object({
    a: z.array(z.string()),
    b: z.array(z.array(z.string())),
    c: z.array(z.string()),
  }).optional().describe('ZK eligibility proof'),
});

type OrderSimulationRequest = z.infer<typeof orderSimulationSchema>;

// =============================================================================
// Simulation Response Types
// =============================================================================

interface OrderSimulationResponse {
  success: boolean;
  orderId: string;
  estimatedGas: number;
  validUntil: number;
  warnings: string[];
}

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /api/orders/simulate
 *
 * Simulate an order placement without executing it on-chain.
 * Returns estimated gas, validation results, and a simulated order ID.
 *
 * This endpoint is useful for:
 * - Validating order parameters before submission
 * - Estimating transaction costs
 * - Testing order flow without spending SOL
 */
router.post('/simulate', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Validate request body
    const validation = orderSimulationSchema.safeParse(req.body);

    if (!validation.success) {
      const errors = validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      log.debug({ errors }, 'Order simulation validation failed');
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }

    const orderData: OrderSimulationRequest = validation.data;
    const warnings: string[] = [];

    // Validate encrypted data format (must be hex, correct length)
    if (!/^[0-9a-fA-F]+$/.test(orderData.encryptedAmount)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid encryptedAmount: must be hexadecimal',
      });
    }

    if (!/^[0-9a-fA-F]+$/.test(orderData.encryptedPrice)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid encryptedPrice: must be hexadecimal',
      });
    }

    // Check encrypted data length (V2 format: 64 bytes = 128 hex chars)
    if (orderData.encryptedAmount.length < 128) {
      warnings.push('encryptedAmount appears shorter than expected V2 format (64 bytes)');
    }

    if (orderData.encryptedPrice.length < 128) {
      warnings.push('encryptedPrice appears shorter than expected V2 format (64 bytes)');
    }

    // Validate eligibility proof if provided
    if (orderData.eligibilityProof) {
      const proof = orderData.eligibilityProof;
      if (!proof.a || !proof.b || !proof.c) {
        warnings.push('Eligibility proof appears incomplete');
      }
    } else {
      warnings.push('No eligibility proof provided - order may be rejected on-chain');
    }

    // Generate simulated order ID (deterministic from inputs for testing)
    const orderId = generateSimulatedOrderId(orderData);

    // Estimate gas (approximate CU cost for order placement)
    const estimatedGas = estimateOrderGas(orderData);

    // Calculate validity window (5 minutes)
    const validUntil = Date.now() + 5 * 60 * 1000;

    const response: OrderSimulationResponse = {
      success: true,
      orderId,
      estimatedGas,
      validUntil,
      warnings,
    };

    log.debug({
      pair: orderData.pair.slice(0, 8),
      side: orderData.side,
      durationMs: Date.now() - startTime,
    }, 'Order simulation completed');

    return res.status(200).json(response);
  } catch (error) {
    log.error({ error }, 'Order simulation error');
    return res.status(500).json({
      success: false,
      error: 'Internal server error during order simulation',
    });
  }
});

/**
 * GET /api/orders/:orderId
 *
 * Get order details by order ID (PDA)
 */
router.get('/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;

  if (!orderId || orderId.length < 32) {
    return res.status(400).json({
      error: 'Invalid order ID',
    });
  }

  // For now, return a mock response indicating the order would need
  // to be fetched from the blockchain
  return res.status(200).json({
    orderId,
    status: 'lookup_required',
    message: 'Order details must be fetched from on-chain data',
    hint: 'Use RPC getAccountInfo with the order PDA',
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a deterministic simulated order ID from order data
 */
function generateSimulatedOrderId(orderData: OrderSimulationRequest): string {
  // Create a simple hash from the order data for simulation
  const input = `${orderData.pair}:${orderData.side}:${orderData.encryptedAmount.slice(0, 16)}:${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Convert to hex and pad to look like a Solana pubkey
  const hexHash = Math.abs(hash).toString(16).padStart(8, '0');
  return `SIM${hexHash}${Date.now().toString(16)}`.slice(0, 44);
}

/**
 * Estimate gas (compute units) for an order placement
 */
function estimateOrderGas(orderData: OrderSimulationRequest): number {
  // Base cost for order placement instruction
  let gas = 50000;

  // Add cost for eligibility proof verification if present
  if (orderData.eligibilityProof) {
    gas += 200000; // ZK proof verification is expensive
  }

  // Add small variance based on data size
  gas += orderData.encryptedAmount.length * 10;
  gas += orderData.encryptedPrice.length * 10;

  return gas;
}

export const ordersRouter: RouterType = router;
