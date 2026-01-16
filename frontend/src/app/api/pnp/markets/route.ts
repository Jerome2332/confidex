/**
 * PNP Markets API
 *
 * Server-side endpoint for fetching PNP market data.
 * Uses the SDK server-side where Wallet class is available.
 *
 * This allows us to use SDK features for read operations while
 * the client-side falls back to REST API or mock data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:pnp:markets');

// PNP uses mainnet by default (has 862+ markets with real USDC)
// Set NEXT_PUBLIC_PNP_NETWORK=devnet to use devnet instead
const PNP_NETWORK = process.env.NEXT_PUBLIC_PNP_NETWORK || 'mainnet';
const RPC_URL =
  PNP_NETWORK === 'mainnet'
    ? process.env.NEXT_PUBLIC_PNP_MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
    : process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

// SDK loading state
let sdkLoadAttempted = false;
let sdkLoadError: string | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PNPClientClass: any = null;

function loadSDK(): boolean {
  if (sdkLoadAttempted) {
    return PNPClientClass !== null;
  }

  sdkLoadAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('pnp-sdk');
    PNPClientClass = sdk.PNPClient;
    log.info('SDK loaded successfully');
    return true;
  } catch (error) {
    sdkLoadError = error instanceof Error ? error.message : 'Unknown error';
    log.error('SDK load failed', { error: sdkLoadError });
    return false;
  }
}

// GET /api/pnp/markets - List all markets
// GET /api/pnp/markets?id=<pubkey> - Get specific market
export async function GET(request: NextRequest) {
  try {
    const sdkAvailable = loadSDK();

    if (!sdkAvailable || !PNPClientClass) {
      return NextResponse.json(
        {
          error: 'SDK not available',
          details: sdkLoadError,
          markets: [],
        },
        { status: 503 }
      );
    }

    // Create read-only client
    const client = new PNPClientClass(RPC_URL);

    // Check for specific market ID
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('id');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (marketId) {
      // Fetch specific market
      try {
        const pubkey = new PublicKey(marketId);
        const market = await client.fetchMarket(pubkey);

        if (!market) {
          return NextResponse.json({ error: 'Market not found' }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          market: serializeMarket(market),
        });
      } catch (error) {
        log.error('Failed to fetch market', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            error: 'Failed to fetch market',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    }

    // Fetch all markets
    try {
      const response = await client.fetchMarkets();

      // SDK returns { count, data: [...] }
      const marketList = response?.data || [];

      // Filter to active (non-expired) markets only
      const now = Math.floor(Date.now() / 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activeMarkets = marketList.filter((item: any) => {
        const market = item.account;
        let endTime = market.end_time;
        if (endTime && typeof endTime.toNumber === 'function') {
          endTime = endTime.toNumber();
        }
        return typeof endTime === 'number' && endTime > now;
      });

      // Sort by end time (soonest first)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeMarkets.sort((a: any, b: any) => {
        let aTime = a.account.end_time;
        let bTime = b.account.end_time;
        if (aTime && typeof aTime.toNumber === 'function') aTime = aTime.toNumber();
        if (bTime && typeof bTime.toNumber === 'function') bTime = bTime.toNumber();
        return aTime - bTime;
      });

      const limitedMarkets = activeMarkets.slice(0, limit);

      return NextResponse.json({
        success: true,
        count: limitedMarkets.length,
        totalCount: activeMarkets.length,
        markets: limitedMarkets.map(serializeMarket),
      });
    } catch (error) {
      log.error('Failed to fetch markets', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'Failed to fetch markets',
          details: error instanceof Error ? error.message : 'Unknown error',
          markets: [],
        },
        { status: 500 }
      );
    }
  } catch (error) {
    log.error('Request failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'Request failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Helper to serialize market data (converts PublicKey to string, BigInt to string, etc.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeMarket(item: any): Record<string, unknown> {
  if (!item) return {};

  // SDK returns { publicKey: string, account: MarketType }
  const pubkey = item.publicKey;
  const market = item.account || item;

  // Parse end_time - handles BN objects, hex strings, and numbers
  let endTime = market.end_time || market.endTime;

  // Handle BN object from Anchor (has toNumber() method)
  if (endTime && typeof endTime === 'object') {
    if (typeof endTime.toNumber === 'function') {
      endTime = endTime.toNumber();
    } else if (typeof endTime.toString === 'function') {
      endTime = endTime.toString();
    }
  }

  // Handle string formats (BN.toJSON() returns hex string like "691b4680")
  if (typeof endTime === 'string') {
    // Handle BN serialized string like "<BN: 691b4680>"
    const bnMatch = endTime.match(/<BN:\s*([0-9a-f]+)>/i);
    if (bnMatch) {
      endTime = parseInt(bnMatch[1], 16);
    } else if (/^[0-9a-f]+$/i.test(endTime)) {
      // Could be hex - check if it looks like a reasonable timestamp
      const asHex = parseInt(endTime, 16);
      const asDecimal = parseInt(endTime, 10);

      // If hex interpretation gives a reasonable future timestamp (2020-2030 range)
      // and decimal interpretation gives an unreasonable value, use hex
      const minTimestamp = 1577836800; // 2020-01-01
      const maxTimestamp = 1893456000; // 2030-01-01

      if (asHex >= minTimestamp && asHex <= maxTimestamp) {
        endTime = asHex;
      } else if (asDecimal >= minTimestamp && asDecimal <= maxTimestamp) {
        endTime = asDecimal;
      } else {
        // Default to hex if it contains letters
        endTime = /[a-f]/i.test(endTime) ? asHex : asDecimal;
      }
    } else {
      endTime = parseInt(endTime, 10);
    }
  }

  // Ensure it's a valid number
  if (typeof endTime !== 'number' || isNaN(endTime)) {
    endTime = 0;
  }

  return {
    id: pubkey || market.publicKey?.toBase58?.() || market.id,
    market: pubkey || market.market,
    question: market.question,
    creator: market.creator?.toBase58?.() || market.creator,
    yesTokenMint: market.yes_token_mint?.toBase58?.() || market.yes_token_mint || market.yesTokenMint,
    noTokenMint: market.no_token_mint?.toBase58?.() || market.no_token_mint || market.noTokenMint,
    collateralMint: market.collateral_token?.toBase58?.() || market.collateral_token || market.collateralMint,
    yesTokenSupply: market.yes_token_supply_minted?.toString?.() || market.yes_token_supply_minted || market.yesTokenSupply,
    noTokenSupply: market.no_token_supply_minted?.toString?.() || market.no_token_supply_minted || market.noTokenSupply,
    marketReserves: market.market_reserves?.toString?.() || market.market_reserves || market.marketReserves,
    initialLiquidity: market.initial_liquidity?.toString?.() || market.initial_liquidity || market.initialLiquidity,
    endTime,
    resolved: market.resolved,
    resolvable: market.resolvable,
    winningOutcome: market.winning_token_id?.Yes ? 'YES' : market.winning_token_id?.No ? 'NO' : null,
  };
}
