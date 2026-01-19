/**
 * PNP SDK Client Wrapper
 *
 * Client-side: Uses internal API routes that proxy to the SDK server-side
 * Server-side: SDK loads via require() bypassing webpack
 *
 * Architecture:
 * - pnp-sdk can't load client-side (imports Wallet which is server-only in Anchor)
 * - Server-side API routes (/api/pnp/*) load SDK via require() and expose endpoints
 * - Client calls these internal APIs for SDK functionality
 * - Falls back to mock data if APIs fail
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import { RPC_ENDPOINT, PNP_API_URL } from './constants';
import type { PNPMarketData } from './pnp-types';
import { logger } from './logger';

// SDK is not available client-side due to Anchor compatibility issue
// But we can access it via server-side API routes
const SDK_AVAILABLE_CLIENT_SIDE = false;

// Internal API routes (server-side SDK access)
const INTERNAL_API_BASE = '/api/pnp';

// External REST API base URL (fallback)
const API_URL = PNP_API_URL;

// Check if external API is likely to resolve
const EXTERNAL_API_AVAILABLE = !API_URL.includes('api.pnp.exchange');

/**
 * Fetch market data using internal API (which uses SDK server-side)
 */
export async function fetchMarketData(
  marketId: PublicKey
): Promise<PNPMarketData | null> {
  try {
    // Try internal API first (uses SDK server-side)
    const response = await fetch(`${INTERNAL_API_BASE}/markets?id=${marketId.toBase58()}`);

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.market) {
        return mapMarketResponse(data.market);
      }
    }

    // Fall back to external API if available
    if (EXTERNAL_API_AVAILABLE) {
      const extResponse = await fetch(`${API_URL}/markets/${marketId.toBase58()}`);
      if (extResponse.ok) {
        const data = await extResponse.json();
        return mapMarketResponse(data);
      }
    }

    return null;
  } catch (error) {
    logger.pnp.error('Failed to fetch market', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Map API response to PNPMarketData format
 */
function mapMarketResponse(data: Record<string, unknown>): PNPMarketData {
  const market = (data.market as string) || (data.id as string);
  return {
    market: new PublicKey(market),
    yesTokenMint: new PublicKey((data.yesTokenMint as string) || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    noTokenMint: new PublicKey((data.noTokenMint as string) || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    collateralMint: new PublicKey(
      (data.collateralMint as string) || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    ),
    marketDetails: {
      id: market,
      question: (data.question as string) || '',
      creator: (data.creator as string) || '',
      initialLiquidity: String(data.initialLiquidity || '0'),
      marketReserves: String(data.marketReserves || '0'),
      yesTokenSupply: String(data.yesTokenSupply || '0'),
      noTokenSupply: String(data.noTokenSupply || '0'),
      endTime: Number(data.endTime) || 0,
      resolved: Boolean(data.resolved),
      resolvable: Boolean(data.resolvable),
    },
  };
}

/**
 * Fetch all active markets using internal API (which uses SDK server-side)
 * @param limit - Maximum number of markets to return
 * @param search - Optional search query to filter by question text
 */
export async function fetchAllMarkets(
  limit: number = 50,
  search?: string
): Promise<PNPMarketData[]> {
  try {
    // Build query params
    const params = new URLSearchParams({ limit: String(limit) });
    if (search?.trim()) {
      params.set('search', search.trim());
    }

    // Try internal API first (uses SDK server-side)
    const response = await fetch(`${INTERNAL_API_BASE}/markets?${params}`);

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.markets) {
        logger.pnp.info('Fetched markets via SDK', {
          count: data.count,
          total: data.totalCount,
          search: data.searchQuery || null,
        });
        return data.markets.map(mapMarketResponse);
      }
    }

    // Fall back to external API if available (no search support)
    if (EXTERNAL_API_AVAILABLE && !search) {
      const extResponse = await fetch(`${API_URL}/markets?limit=${limit}&active=true`);
      if (extResponse.ok) {
        const data = await extResponse.json();
        if (data.markets) {
          return data.markets.map(mapMarketResponse);
        }
      }
    }

    logger.pnp.debug('No markets available from APIs');
    return [];
  } catch (error) {
    logger.pnp.error('Failed to fetch markets', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Build a buy tokens transaction for wallet adapter signing
 *
 * Note: SDK unavailable due to Anchor compatibility.
 * Returns null to trigger simulation mode.
 */
export async function buildBuyTokensTransaction(
  connection: Connection,
  marketId: PublicKey,
  isYes: boolean,
  amountUsdc: number,
  buyerPubkey: PublicKey,
  provider?: AnchorProvider
): Promise<Transaction | null> {
  if (!SDK_AVAILABLE_CLIENT_SIDE) {
    // SDK not available - pnp-sdk imports 'Wallet' from anchor which doesn't exist in 0.32.1
    // See: https://github.com/coral-xyz/anchor/issues/1933
    logger.pnp.debug('SDK unavailable client-side, using simulation mode');
    return null;
  }

  // This code path is unreachable until SDK is updated
  return null;
}

/**
 * Build a sell tokens transaction for wallet adapter signing
 *
 * Note: SDK unavailable due to Anchor compatibility.
 * Returns null to trigger simulation mode.
 */
export async function buildSellTokensTransaction(
  connection: Connection,
  marketId: PublicKey,
  isYes: boolean,
  tokenAmount: bigint,
  sellerPubkey: PublicKey,
  provider?: AnchorProvider
): Promise<Transaction | null> {
  if (!SDK_AVAILABLE_CLIENT_SIDE) {
    logger.pnp.debug('SDK unavailable client-side, using simulation mode');
    return null;
  }

  return null;
}

/**
 * Get user's positions across all markets using REST API
 */
export async function fetchUserPositions(
  userPubkey: PublicKey
): Promise<
  Array<{
    marketId: PublicKey;
    yesBalance: bigint;
    noBalance: bigint;
    avgYesCost: number;
    avgNoCost: number;
  }>
> {
  // Skip network call if API is known to be unavailable
  if (!EXTERNAL_API_AVAILABLE) {
    // Return empty positions silently (not an error)
    return [];
  }

  try {
    const response = await fetch(
      `${API_URL}/users/${userPubkey.toBase58()}/positions`
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (!data.positions) {
      return [];
    }

    return data.positions.map(
      (p: {
        marketId: string;
        yesBalance: string;
        noBalance: string;
        avgYesCost: number;
        avgNoCost: number;
      }) => ({
        marketId: new PublicKey(p.marketId),
        yesBalance: BigInt(p.yesBalance || '0'),
        noBalance: BigInt(p.noBalance || '0'),
        avgYesCost: p.avgYesCost || 0,
        avgNoCost: p.avgNoCost || 0,
      })
    );
  } catch (error) {
    logger.pnp.error('Failed to fetch positions', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Calculate tokens received for a given USDC amount and price
 */
export function calculateTokensReceived(
  usdcAmount: number,
  price: number
): bigint {
  if (price <= 0 || price >= 1) return BigInt(0);
  // Tokens = USDC / price (with 6 decimals)
  const tokens = (usdcAmount / price) * 1e6;
  return BigInt(Math.floor(tokens));
}

/**
 * Calculate USDC received for selling tokens at a price
 */
export function calculateUsdcReceived(
  tokenAmount: bigint,
  price: number
): number {
  // USDC = tokens * price (tokens have 6 decimals)
  return (Number(tokenAmount) / 1e6) * price;
}

/**
 * Calculate prices for prediction market based on token supplies
 *
 * Uses standard AMM formula where prices sum to 1:
 * - yesPrice = noSupply / (yesSupply + noSupply)
 * - noPrice = yesSupply / (yesSupply + noSupply)
 *
 * When more YES tokens are minted (demand), YES supply increases,
 * which means YES price decreases (inversely proportional).
 *
 * Note: PNP's "Pythagorean curve" refers to the bonding curve math,
 * but for display prices we use the standard summing-to-1 formula.
 */
export function calculatePythagoreanPrices(
  yesSupply: bigint,
  noSupply: bigint
): { yesPrice: number; noPrice: number } {
  const yes = Number(yesSupply);
  const no = Number(noSupply);

  // Edge case: no tokens minted yet
  if (yes === 0 && no === 0) {
    return { yesPrice: 0.5, noPrice: 0.5 };
  }

  const total = yes + no;

  // Price is inversely proportional to supply (more supply = lower price)
  // This ensures prices sum to 1.0
  return {
    yesPrice: no / total,
    noPrice: yes / total,
  };
}

/**
 * @deprecated Use calculatePythagoreanPrices instead
 * Legacy CPMM formula - kept for compatibility
 */
export function calculatePrice(
  tokenSupply: bigint,
  reserves: bigint
): number {
  if (reserves === BigInt(0)) return 0.5;
  const total = tokenSupply + reserves;
  return Number(reserves) / Number(total);
}

/**
 * Check if SDK is available (client-side: no, but server API routes work)
 */
export function isSDKAvailable(): boolean {
  return SDK_AVAILABLE_CLIENT_SIDE;
}

/**
 * Check server-side SDK availability via API health check
 */
export async function checkServerSDK(): Promise<boolean> {
  try {
    const response = await fetch(`${INTERNAL_API_BASE}/build-tx`);
    if (response.ok) {
      const data = await response.json();
      return data.sdkAvailable === true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Initialize SDK - checks server-side availability
 */
export async function initializeSDK(): Promise<boolean> {
  const serverAvailable = await checkServerSDK();
  if (serverAvailable) {
    logger.pnp.info('SDK available via server-side API routes');
  }
  return serverAvailable;
}
