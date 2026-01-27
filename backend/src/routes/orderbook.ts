/**
 * Order Book API Routes
 *
 * Public endpoints for querying order book state.
 * Returns aggregated order book data without exposing individual order details.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { rateLimiters, createCustomRateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../lib/logger.js';

const router: RouterType = Router();
const log = logger.http;

// Apply higher rate limit for order book queries (for load testing)
const orderbookRateLimiter = process.env.LOAD_TEST_MODE === 'true'
  ? createCustomRateLimiter(5000)
  : rateLimiters.standard;

router.use(orderbookRateLimiter);

// RPC connection (lazy initialized)
let connection: Connection | null = null;

function getConnection(): Connection {
  if (!connection) {
    const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
    connection = new Connection(rpcUrl, 'confirmed');
  }
  return connection;
}

// Program ID for the DEX
const PROGRAM_ID = process.env.CONFIDEX_PROGRAM_ID || '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB';

// V5 Order account size (366 bytes)
const V5_ORDER_SIZE = 366;

// =============================================================================
// Types
// =============================================================================

interface OrderBookEntry {
  /** Number of orders at this level (privacy-preserving) */
  count: number;
  /** Approximate depth (total encrypted orders) */
  depth: number;
}

interface OrderBookResponse {
  pair: string;
  timestamp: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  totalBids: number;
  totalAsks: number;
  lastUpdate: number;
}

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /api/orderbook/:pair
 *
 * Get aggregated order book for a trading pair.
 * Returns privacy-preserving order book data (counts only, no amounts/prices).
 *
 * @param pair - Trading pair PDA address
 */
router.get('/:pair', async (req: Request, res: Response) => {
  const { pair } = req.params;
  const startTime = Date.now();

  try {
    // Validate pair address
    let pairPubkey: PublicKey;
    try {
      pairPubkey = new PublicKey(pair);
    } catch {
      return res.status(400).json({
        error: 'Invalid pair address',
        message: 'Pair must be a valid Solana public key',
      });
    }

    // Fetch all V5 orders for the program
    const conn = getConnection();
    const programId = new PublicKey(PROGRAM_ID);

    // Get all order accounts (V5 size: 366 bytes)
    const orderAccounts = await conn.getProgramAccounts(programId, {
      filters: [
        { dataSize: V5_ORDER_SIZE },
      ],
      dataSlice: {
        offset: 0,
        length: 80, // Just enough to get discriminator, maker, pair, side, status
      },
    });

    // Filter orders for this pair and count by side
    let buyCount = 0;
    let sellCount = 0;

    for (const { account } of orderAccounts) {
      const data = account.data;

      // Skip if account data is too short
      if (data.length < 80) continue;

      // Parse pair PDA (offset 40, 32 bytes after discriminator + maker)
      const orderPairBytes = data.slice(40, 72);
      const orderPair = new PublicKey(orderPairBytes);

      // Check if this order belongs to the requested pair
      if (!orderPair.equals(pairPubkey)) continue;

      // Parse side (offset 72, 1 byte): 0 = buy, 1 = sell
      const side = data[72];

      // Parse status (offset 73, 1 byte): 0 = Active, 1 = Matching, etc.
      const status = data[73];

      // Only count Active or Matching orders
      if (status > 1) continue;

      if (side === 0) {
        buyCount++;
      } else {
        sellCount++;
      }
    }

    const response: OrderBookResponse = {
      pair,
      timestamp: Date.now(),
      bids: buyCount > 0 ? [{ count: buyCount, depth: buyCount }] : [],
      asks: sellCount > 0 ? [{ count: sellCount, depth: sellCount }] : [],
      totalBids: buyCount,
      totalAsks: sellCount,
      lastUpdate: Date.now(),
    };

    log.debug({
      pair: pair.slice(0, 8),
      buyCount,
      sellCount,
      durationMs: Date.now() - startTime,
    }, 'Order book query completed');

    return res.status(200).json(response);
  } catch (error) {
    log.error({ error, pair }, 'Order book query error');
    return res.status(500).json({
      error: 'Failed to fetch order book',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/orderbook/:pair/summary
 *
 * Get a summary of the order book for a trading pair.
 * Returns high-level statistics without detailed order data.
 */
router.get('/:pair/summary', async (req: Request, res: Response) => {
  const { pair } = req.params;

  try {
    // Validate pair address
    let pairPubkey: PublicKey;
    try {
      pairPubkey = new PublicKey(pair);
    } catch {
      return res.status(400).json({
        error: 'Invalid pair address',
      });
    }

    // For now, return a simplified summary
    // In production, this would cache and aggregate data
    return res.status(200).json({
      pair,
      status: 'active',
      timestamp: Date.now(),
      summary: {
        hasOrders: true,
        lastActivity: Date.now(),
        tradingEnabled: true,
      },
    });
  } catch (error) {
    log.error({ error, pair }, 'Order book summary error');
    return res.status(500).json({
      error: 'Failed to fetch order book summary',
    });
  }
});

/**
 * GET /api/orderbook
 *
 * List all available trading pairs with order book status.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Return known trading pairs
    // In production, this would be fetched from on-chain pair accounts
    const pairs = [
      {
        pda: process.env.DEFAULT_PAIR_PDA || '3WRnHKvVgyZKXk9roscEkq4xaG62Uc7vhjAhd5zUZ5vV',
        baseMint: 'So11111111111111111111111111111111111111112',
        quoteMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
        baseSymbol: 'SOL',
        quoteSymbol: 'USDC',
        status: 'active',
      },
    ];

    return res.status(200).json({
      pairs,
      count: pairs.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error({ error }, 'List pairs error');
    return res.status(500).json({
      error: 'Failed to list trading pairs',
    });
  }
});

export const orderbookRouter: RouterType = router;
