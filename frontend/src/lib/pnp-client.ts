/**
 * PNP SDK Client Wrapper
 *
 * Provides read-only SDK access and transaction builders
 * for wallet adapter signing (browser-safe)
 *
 * Note: pnp-sdk v0.2.3 has compatibility issues with @coral-xyz/anchor 0.32.1
 * (expects 'Wallet' export that doesn't exist in newer anchor versions).
 * We use REST API fallback until pnp-sdk is updated.
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { RPC_ENDPOINT, PNP_API_URL } from './constants';
import type { PNPMarketData } from './pnp-types';

// REST API base URL
const API_URL = PNP_API_URL;

/**
 * Fetch market data using REST API
 */
export async function fetchMarketData(
  marketId: PublicKey
): Promise<PNPMarketData | null> {
  try {
    const response = await fetch(`${API_URL}/markets/${marketId.toBase58()}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    return {
      market: new PublicKey(data.market),
      yesTokenMint: new PublicKey(data.yesTokenMint),
      noTokenMint: new PublicKey(data.noTokenMint),
      collateralMint: new PublicKey(
        data.collateralMint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      ),
      marketDetails: {
        id: data.marketDetails?.id || data.market,
        question: data.marketDetails?.question || data.question,
        creator: data.marketDetails?.creator || data.creator,
        initialLiquidity: data.marketDetails?.initialLiquidity || '0',
        marketReserves: data.marketDetails?.marketReserves || '0',
        yesTokenSupply: data.marketDetails?.yesTokenSupply || '0',
        noTokenSupply: data.marketDetails?.noTokenSupply || '0',
        endTime: data.marketDetails?.endTime || 0,
        resolved: data.marketDetails?.resolved || false,
      },
    };
  } catch (error) {
    console.error('[PNP Client] Failed to fetch market:', error);
    return null;
  }
}

/**
 * Fetch all active markets using REST API
 */
export async function fetchAllMarkets(
  limit: number = 20
): Promise<PNPMarketData[]> {
  try {
    const response = await fetch(`${API_URL}/markets?limit=${limit}&active=true`);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (!data.markets) {
      return [];
    }

    return data.markets.map(
      (m: Record<string, unknown>) => ({
        market: new PublicKey((m.id as string) || (m.market as string)),
        yesTokenMint: new PublicKey(m.yesTokenMint as string),
        noTokenMint: new PublicKey(m.noTokenMint as string),
        collateralMint: new PublicKey(
          (m.collateralMint as string) || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        ),
        marketDetails: {
          id: (m.id as string) || '',
          question: m.question as string,
          creator: m.creator as string,
          initialLiquidity: (m.initialLiquidity as string) || (m.liquidity as string) || '0',
          marketReserves: (m.marketReserves as string) || '0',
          yesTokenSupply: (m.yesTokenSupply as string) || '0',
          noTokenSupply: (m.noTokenSupply as string) || '0',
          endTime: (m.endTime as number) || 0,
          resolved: (m.resolved as boolean) || false,
        },
      })
    );
  } catch (error) {
    console.error('[PNP Client] Failed to fetch markets:', error);
    return [];
  }
}

/**
 * Build a buy tokens transaction for wallet adapter signing
 *
 * Note: SDK-based transaction building is disabled due to anchor compatibility.
 * Returns null to trigger simulation mode in pnp.ts
 *
 * TODO: Enable when pnp-sdk is updated for anchor 0.32.1+
 */
export async function buildBuyTokensTransaction(
  connection: Connection,
  marketId: PublicKey,
  isYes: boolean,
  amountUsdc: number,
  buyerPubkey: PublicKey
): Promise<Transaction | null> {
  console.warn('[PNP Client] SDK not available, transaction building disabled');
  return null;
}

/**
 * Build a sell tokens transaction for wallet adapter signing
 *
 * Note: SDK-based transaction building is disabled due to anchor compatibility.
 * Returns null to trigger simulation mode in pnp.ts
 *
 * TODO: Enable when pnp-sdk is updated for anchor 0.32.1+
 */
export async function buildSellTokensTransaction(
  connection: Connection,
  marketId: PublicKey,
  isYes: boolean,
  tokenAmount: bigint,
  sellerPubkey: PublicKey
): Promise<Transaction | null> {
  console.warn('[PNP Client] SDK not available, transaction building disabled');
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
    console.error('[PNP Client] Failed to fetch positions:', error);
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
 * Calculate price from token supply and reserves (CPMM formula)
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
 * Check if SDK is available (currently disabled due to anchor compatibility)
 */
export function isSDKAvailable(): boolean {
  return false;
}
