/**
 * PNP SDK Integration for Confidex
 *
 * Enables prediction market functionality using
 * confidential tokens as collateral.
 *
 * Prize track: $2.5K PNP integration
 *
 * Architecture:
 * - Read operations: SDK read-only client
 * - Write operations: Transaction builders + wallet adapter signing
 * - Market creation: Backend API (requires server wallet)
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  fetchMarketData,
  fetchAllMarkets,
  fetchUserPositions,
  buildBuyTokensTransaction,
  buildSellTokensTransaction,
  calculateTokensReceived,
  calculateUsdcReceived,
  calculatePrice,
} from './pnp-client';
import type { CreateMarketResponse } from './pnp-types';

// PNP configuration
const PNP_API_URL =
  process.env.NEXT_PUBLIC_PNP_API_URL || 'https://api.pnp.exchange';

// Feature flag: Use SDK vs REST API fallback
const USE_SDK = process.env.NEXT_PUBLIC_PNP_USE_SDK !== 'false';

// Feature flag: Use mock data when API unavailable (for development/demo)
const USE_MOCK_FALLBACK = process.env.NEXT_PUBLIC_PNP_USE_MOCK !== 'false';

/**
 * Mock markets for development/demo when PNP API is unavailable
 */
function getMockMarkets(): PredictionMarket[] {
  // Generate deterministic mock addresses
  const mockMarkets: PredictionMarket[] = [
    {
      id: new PublicKey('11111111111111111111111111111112'),
      question: 'Will Bitcoin reach $150,000 by end of 2026?',
      creator: new PublicKey('11111111111111111111111111111111'),
      yesToken: {
        mint: new PublicKey('YESt1111111111111111111111111111111111111111'),
        symbol: 'YES',
        supply: BigInt(500000 * 1e6),
        price: 0.42,
      },
      noToken: {
        mint: new PublicKey('NOoo1111111111111111111111111111111111111111'),
        symbol: 'NO',
        supply: BigInt(500000 * 1e6),
        price: 0.58,
      },
      collateralMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      totalLiquidity: BigInt(100000 * 1e6),
      endTime: new Date('2026-12-31T23:59:59Z'),
      resolved: false,
    },
    {
      id: new PublicKey('22222222222222222222222222222222'),
      question: 'Will Solana TPS exceed 100,000 in Q1 2026?',
      creator: new PublicKey('11111111111111111111111111111111'),
      yesToken: {
        mint: new PublicKey('YESt2222222222222222222222222222222222222222'),
        symbol: 'YES',
        supply: BigInt(300000 * 1e6),
        price: 0.65,
      },
      noToken: {
        mint: new PublicKey('NOoo2222222222222222222222222222222222222222'),
        symbol: 'NO',
        supply: BigInt(300000 * 1e6),
        price: 0.35,
      },
      collateralMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      totalLiquidity: BigInt(50000 * 1e6),
      endTime: new Date('2026-03-31T23:59:59Z'),
      resolved: false,
    },
    {
      id: new PublicKey('33333333333333333333333333333333'),
      question: 'Will Ethereum ETF see $10B inflows in 2026?',
      creator: new PublicKey('11111111111111111111111111111111'),
      yesToken: {
        mint: new PublicKey('YESt3333333333333333333333333333333333333333'),
        symbol: 'YES',
        supply: BigInt(750000 * 1e6),
        price: 0.55,
      },
      noToken: {
        mint: new PublicKey('NOoo3333333333333333333333333333333333333333'),
        symbol: 'NO',
        supply: BigInt(750000 * 1e6),
        price: 0.45,
      },
      collateralMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      totalLiquidity: BigInt(200000 * 1e6),
      endTime: new Date('2026-12-31T23:59:59Z'),
      resolved: false,
    },
    {
      id: new PublicKey('44444444444444444444444444444444'),
      question: 'Will a major country adopt Bitcoin as legal tender in 2026?',
      creator: new PublicKey('11111111111111111111111111111111'),
      yesToken: {
        mint: new PublicKey('YESt4444444444444444444444444444444444444444'),
        symbol: 'YES',
        supply: BigInt(400000 * 1e6),
        price: 0.28,
      },
      noToken: {
        mint: new PublicKey('NOoo4444444444444444444444444444444444444444'),
        symbol: 'NO',
        supply: BigInt(400000 * 1e6),
        price: 0.72,
      },
      collateralMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      totalLiquidity: BigInt(80000 * 1e6),
      endTime: new Date('2026-12-31T23:59:59Z'),
      resolved: false,
    },
  ];

  console.log('[PNP] Using mock markets (API unavailable)');
  return mockMarkets;
}

/**
 * Market outcome token
 */
export interface OutcomeToken {
  mint: PublicKey;
  symbol: 'YES' | 'NO';
  supply: bigint;
  price: number; // 0-1 probability
}

/**
 * Prediction market details
 */
export interface PredictionMarket {
  id: PublicKey;
  question: string;
  creator: PublicKey;
  yesToken: OutcomeToken;
  noToken: OutcomeToken;
  collateralMint: PublicKey; // USDC or C-USDC
  totalLiquidity: bigint;
  endTime: Date;
  resolved: boolean;
  outcome?: 'YES' | 'NO';
}

/**
 * User position in a market
 */
export interface MarketPosition {
  marketId: PublicKey;
  yesBalance: bigint;
  noBalance: bigint;
  avgYesCost: number;
  avgNoCost: number;
}

/**
 * Wallet interface for transaction signing
 */
export interface WalletAdapter {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  sendTransaction?: (tx: Transaction, connection: Connection) => Promise<string>;
}

/**
 * Create a new prediction market via backend API
 * Uses server-side wallet since PNP SDK requires private key
 */
export async function createMarket(
  question: string,
  endTime: Date,
  initialLiquidity: number
): Promise<PredictionMarket> {
  console.log('[PNP] Creating market via backend API:', {
    question: question.substring(0, 50) + '...',
    endTime: endTime.toISOString(),
    initialLiquidity,
  });

  const response = await fetch('/api/pnp/create-market', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      endTime: endTime.toISOString(),
      initialLiquidity,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create market');
  }

  const data: CreateMarketResponse = await response.json();

  return {
    id: new PublicKey(data.market),
    question: data.marketDetails.question,
    creator: new PublicKey(data.marketDetails.creator),
    yesToken: {
      mint: new PublicKey(data.yesTokenMint),
      symbol: 'YES',
      supply: BigInt(data.marketDetails.yesTokenSupply),
      price: 0.5,
    },
    noToken: {
      mint: new PublicKey(data.noTokenMint),
      symbol: 'NO',
      supply: BigInt(data.marketDetails.noTokenSupply),
      price: 0.5,
    },
    collateralMint: new PublicKey(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    ),
    totalLiquidity: BigInt(data.marketDetails.initialLiquidity),
    endTime: new Date(data.marketDetails.endTime * 1000),
    resolved: data.marketDetails.resolved,
  };
}

/**
 * Buy outcome tokens using wallet adapter signing
 */
export async function buyOutcomeTokens(
  connection: Connection,
  marketId: PublicKey,
  outcome: 'YES' | 'NO',
  amount: number, // In USDC
  maxPrice: number, // Max price willing to pay (0-1)
  wallet: WalletAdapter
): Promise<{ signature: string; tokensReceived: bigint }> {
  console.log('[PNP] Buying outcome tokens:', {
    market: marketId.toBase58(),
    outcome,
    amount,
    maxPrice,
  });

  if (!USE_SDK) {
    // Fallback to simulated mode
    console.warn('[PNP] SDK disabled, using simulation');
    const tokensReceived = calculateTokensReceived(amount, maxPrice);
    return {
      signature: 'simulated_' + Date.now(),
      tokensReceived,
    };
  }

  try {
    // Build transaction using SDK
    const transaction = await buildBuyTokensTransaction(
      connection,
      marketId,
      outcome === 'YES',
      amount,
      wallet.publicKey
    );

    // If SDK returned null, use simulation mode
    if (!transaction) {
      console.warn('[PNP] Transaction building unavailable, using simulation');
      const tokensReceived = calculateTokensReceived(amount, maxPrice);
      return {
        signature: 'simulated_' + Date.now(),
        tokensReceived,
      };
    }

    // Sign and send via wallet adapter
    let signature: string;
    if (wallet.sendTransaction) {
      signature = await wallet.sendTransaction(transaction, connection);
    } else {
      const signedTx = await wallet.signTransaction(transaction);
      signature = await connection.sendRawTransaction(signedTx.serialize());
    }

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    const tokensReceived = calculateTokensReceived(amount, maxPrice);

    console.log('[PNP] Buy transaction confirmed:', signature);
    return { signature, tokensReceived };
  } catch (error) {
    console.error('[PNP] Buy transaction failed:', error);
    throw error;
  }
}

/**
 * Sell outcome tokens using wallet adapter signing
 */
export async function sellOutcomeTokens(
  connection: Connection,
  marketId: PublicKey,
  outcome: 'YES' | 'NO',
  tokenAmount: bigint,
  minPrice: number, // Min price willing to accept (0-1)
  wallet: WalletAdapter
): Promise<{ signature: string; usdcReceived: number }> {
  console.log('[PNP] Selling outcome tokens:', {
    market: marketId.toBase58(),
    outcome,
    tokenAmount: tokenAmount.toString(),
    minPrice,
  });

  if (!USE_SDK) {
    console.warn('[PNP] SDK disabled, using simulation');
    const usdcReceived = calculateUsdcReceived(tokenAmount, minPrice);
    return {
      signature: 'simulated_' + Date.now(),
      usdcReceived,
    };
  }

  try {
    const transaction = await buildSellTokensTransaction(
      connection,
      marketId,
      outcome === 'YES',
      tokenAmount,
      wallet.publicKey
    );

    // If SDK returned null, use simulation mode
    if (!transaction) {
      console.warn('[PNP] Transaction building unavailable, using simulation');
      const usdcReceived = calculateUsdcReceived(tokenAmount, minPrice);
      return {
        signature: 'simulated_' + Date.now(),
        usdcReceived,
      };
    }

    let signature: string;
    if (wallet.sendTransaction) {
      signature = await wallet.sendTransaction(transaction, connection);
    } else {
      const signedTx = await wallet.signTransaction(transaction);
      signature = await connection.sendRawTransaction(signedTx.serialize());
    }

    await connection.confirmTransaction(signature, 'confirmed');

    const usdcReceived = calculateUsdcReceived(tokenAmount, minPrice);

    console.log('[PNP] Sell transaction confirmed:', signature);
    return { signature, usdcReceived };
  } catch (error) {
    console.error('[PNP] Sell transaction failed:', error);
    throw error;
  }
}

/**
 * Redeem winning tokens after market resolution
 */
export async function redeemWinnings(
  connection: Connection,
  marketId: PublicKey,
  wallet: WalletAdapter
): Promise<{ signature: string; amount: number }> {
  console.log('[PNP] Redeeming winnings for market:', marketId.toBase58());

  // TODO: Implement using SDK when redemption API is available
  // For now, return simulation
  return {
    signature: 'simulated_' + Date.now(),
    amount: 0,
  };
}

/**
 * Fetch market details using SDK or REST API fallback
 */
export async function fetchMarket(
  connection: Connection,
  marketId: PublicKey
): Promise<PredictionMarket | null> {
  if (USE_SDK) {
    try {
      const data = await fetchMarketData(marketId);
      if (!data) return null;

      return {
        id: data.market,
        question: data.marketDetails.question,
        creator: new PublicKey(data.marketDetails.creator),
        yesToken: {
          mint: data.yesTokenMint,
          symbol: 'YES',
          supply: BigInt(data.marketDetails.yesTokenSupply),
          price: calculatePrice(
            BigInt(data.marketDetails.yesTokenSupply),
            BigInt(data.marketDetails.marketReserves)
          ),
        },
        noToken: {
          mint: data.noTokenMint,
          symbol: 'NO',
          supply: BigInt(data.marketDetails.noTokenSupply),
          price: calculatePrice(
            BigInt(data.marketDetails.noTokenSupply),
            BigInt(data.marketDetails.marketReserves)
          ),
        },
        collateralMint: data.collateralMint,
        totalLiquidity: BigInt(data.marketDetails.initialLiquidity),
        endTime: new Date(data.marketDetails.endTime * 1000),
        resolved: data.marketDetails.resolved,
      };
    } catch (error) {
      console.warn('[PNP] SDK fetch failed, trying REST API:', error);
      // Fall through to REST API
    }
  }

  // REST API fallback
  try {
    const response = await fetch(
      `${PNP_API_URL}/markets/${marketId.toBase58()}`
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    return {
      id: new PublicKey(data.market),
      question: data.marketDetails.question,
      creator: new PublicKey(data.marketDetails.creator),
      yesToken: {
        mint: new PublicKey(data.yesTokenMint),
        symbol: 'YES',
        supply: BigInt(data.marketDetails.yesTokenSupply),
        price: calculatePrice(
          BigInt(data.marketDetails.yesTokenSupply),
          BigInt(data.marketDetails.marketReserves)
        ),
      },
      noToken: {
        mint: new PublicKey(data.noTokenMint),
        symbol: 'NO',
        supply: BigInt(data.marketDetails.noTokenSupply),
        price: calculatePrice(
          BigInt(data.marketDetails.noTokenSupply),
          BigInt(data.marketDetails.marketReserves)
        ),
      },
      collateralMint: new PublicKey(
        data.collateralMint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      ),
      totalLiquidity: BigInt(data.marketDetails.initialLiquidity),
      endTime: new Date(data.marketDetails.endTime * 1000),
      resolved: data.marketDetails.resolved,
    };
  } catch (error) {
    console.error('[PNP] Failed to fetch market:', error);

    // Try to find in mock data if enabled
    if (USE_MOCK_FALLBACK) {
      const mockMarket = getMockMarkets().find(
        (m) => m.id.toBase58() === marketId.toBase58()
      );
      if (mockMarket) {
        console.log('[PNP] Found market in mock data');
        return mockMarket;
      }
    }

    return null;
  }
}

/**
 * Fetch all active markets using SDK or REST API fallback
 */
export async function fetchActiveMarkets(
  connection: Connection,
  limit: number = 10
): Promise<PredictionMarket[]> {
  // Check if we should skip API calls entirely (known unavailable)
  const apiLikelyUnavailable = PNP_API_URL.includes('api.pnp.exchange');

  if (USE_SDK && !apiLikelyUnavailable) {
    try {
      const markets = await fetchAllMarkets(limit);

      // If SDK returned results, map and return them
      if (markets.length > 0) {
        return markets.map((m) => ({
          id: m.market,
          question: m.marketDetails.question,
          creator: new PublicKey(m.marketDetails.creator),
          yesToken: {
            mint: m.yesTokenMint,
            symbol: 'YES' as const,
            supply: BigInt(m.marketDetails.yesTokenSupply),
            price: calculatePrice(
              BigInt(m.marketDetails.yesTokenSupply),
              BigInt(m.marketDetails.marketReserves)
            ),
          },
          noToken: {
            mint: m.noTokenMint,
            symbol: 'NO' as const,
            supply: BigInt(m.marketDetails.noTokenSupply),
            price: calculatePrice(
              BigInt(m.marketDetails.noTokenSupply),
              BigInt(m.marketDetails.marketReserves)
            ),
          },
          collateralMint: m.collateralMint,
          totalLiquidity: BigInt(m.marketDetails.initialLiquidity),
          endTime: new Date(m.marketDetails.endTime * 1000),
          resolved: m.marketDetails.resolved,
        }));
      }
      // Empty results - fall through to REST API / mock
      console.log('[PNP] SDK returned no markets, trying fallback');
    } catch (error) {
      console.warn('[PNP] SDK fetch markets failed, trying REST API:', error);
      // Fall through to REST API
    }
  }

  // Skip REST API if known unavailable - go directly to mock
  if (apiLikelyUnavailable) {
    console.log('[PNP] API unavailable, using mock data');
    if (USE_MOCK_FALLBACK) {
      return getMockMarkets().slice(0, limit);
    }
    return [];
  }

  // REST API fallback
  try {
    const response = await fetch(
      `${PNP_API_URL}/markets?limit=${limit}&active=true`
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    return data.markets.map((m: Record<string, unknown>) => ({
      id: new PublicKey(m.id as string),
      question: m.question as string,
      creator: new PublicKey(m.creator as string),
      yesToken: {
        mint: new PublicKey(m.yesTokenMint as string),
        symbol: 'YES' as const,
        supply: BigInt(m.yesTokenSupply as string),
        price: m.yesPrice as number,
      },
      noToken: {
        mint: new PublicKey(m.noTokenMint as string),
        symbol: 'NO' as const,
        supply: BigInt(m.noTokenSupply as string),
        price: m.noPrice as number,
      },
      collateralMint: new PublicKey(m.collateralMint as string),
      totalLiquidity: BigInt(m.liquidity as string),
      endTime: new Date(m.endTime as number),
      resolved: false,
    }));
  } catch (error) {
    console.error('[PNP] Failed to fetch active markets:', error);

    // Return mock data if enabled
    if (USE_MOCK_FALLBACK) {
      return getMockMarkets().slice(0, limit);
    }

    return [];
  }
}

/**
 * Get user's positions across all markets
 */
export async function getUserPositions(
  connection: Connection,
  userPubkey: PublicKey
): Promise<MarketPosition[]> {
  if (USE_SDK) {
    try {
      const positions = await fetchUserPositions(userPubkey);
      return positions;
    } catch (error) {
      console.warn('[PNP] SDK fetch positions failed, trying REST API:', error);
      // Fall through to REST API
    }
  }

  // REST API fallback
  try {
    const response = await fetch(
      `${PNP_API_URL}/users/${userPubkey.toBase58()}/positions`
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return data.positions.map((p: Record<string, unknown>) => ({
      marketId: new PublicKey(p.marketId as string),
      yesBalance: BigInt(p.yesBalance as string),
      noBalance: BigInt(p.noBalance as string),
      avgYesCost: p.avgYesCost as number,
      avgNoCost: p.avgNoCost as number,
    }));
  } catch (error) {
    console.error('[PNP] Failed to fetch user positions:', error);
    return [];
  }
}

/**
 * Calculate potential winnings
 */
export function calculatePotentialWinnings(
  amount: number,
  currentPrice: number
): number {
  if (currentPrice >= 1 || currentPrice <= 0) return 0;
  return amount / currentPrice;
}

/**
 * Confidex-specific: Create market with C-SPL collateral
 * Enables privacy-preserving prediction markets
 */
export async function createConfidentialMarket(
  connection: Connection,
  question: string,
  endTime: Date,
  encryptedLiquidity: Uint8Array, // Encrypted initial liquidity
  cUsdcMint: PublicKey, // Confidential USDC mint
  wallet: WalletAdapter
): Promise<PredictionMarket> {
  console.log('[PNP] Creating confidential prediction market:', {
    question: question.substring(0, 50) + '...',
    endTime,
    collateral: cUsdcMint.toBase58(),
  });

  // This would integrate with both PNP SDK and Arcium
  // The liquidity amount remains encrypted throughout

  // TODO: Implement when Arcium + PNP integration is available
  const marketId = PublicKey.unique();
  const yesTokenMint = PublicKey.unique();
  const noTokenMint = PublicKey.unique();

  return {
    id: marketId,
    question,
    creator: wallet.publicKey,
    yesToken: {
      mint: yesTokenMint,
      symbol: 'YES',
      supply: BigInt(0), // Hidden
      price: 0.5,
    },
    noToken: {
      mint: noTokenMint,
      symbol: 'NO',
      supply: BigInt(0), // Hidden
      price: 0.5,
    },
    collateralMint: cUsdcMint,
    totalLiquidity: BigInt(0), // Hidden
    endTime,
    resolved: false,
  };
}

// Re-export utility functions
export { calculatePrice, calculateTokensReceived, calculateUsdcReceived };
