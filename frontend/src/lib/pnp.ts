/**
 * PNP SDK Integration for Confidex
 *
 * Enables prediction market functionality using
 * confidential tokens as collateral.
 *
 * Prize track: $2.5K PNP integration
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';

// PNP configuration
const PNP_API_URL = process.env.NEXT_PUBLIC_PNP_API_URL || 'https://api.pnp.exchange';

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
 * Create a new prediction market
 */
export async function createMarket(
  connection: Connection,
  question: string,
  endTime: Date,
  initialLiquidity: number,
  collateralMint: PublicKey,
  wallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  }
): Promise<PredictionMarket> {
  // In production, this would use the PNP SDK
  // For demo, we simulate the market creation

  console.log('Creating prediction market:', {
    question,
    endTime,
    initialLiquidity,
    collateral: collateralMint.toBase58(),
  });

  // Simulated market for development
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
      supply: BigInt(initialLiquidity * 1e6),
      price: 0.5,
    },
    noToken: {
      mint: noTokenMint,
      symbol: 'NO',
      supply: BigInt(initialLiquidity * 1e6),
      price: 0.5,
    },
    collateralMint,
    totalLiquidity: BigInt(initialLiquidity * 1e6),
    endTime,
    resolved: false,
  };
}

/**
 * Buy outcome tokens
 */
export async function buyOutcomeTokens(
  connection: Connection,
  marketId: PublicKey,
  outcome: 'YES' | 'NO',
  amount: number, // In USDC
  maxPrice: number, // Max price willing to pay (0-1)
  wallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  }
): Promise<{ signature: string; tokensReceived: bigint }> {
  console.log('Buying outcome tokens:', {
    market: marketId.toBase58(),
    outcome,
    amount,
    maxPrice,
  });

  // In production: use PNP SDK
  // const client = new PNPClient(connection.rpcEndpoint);
  // return client.trading.buyTokensUsdc(marketId, outcome, amount);

  // Simulated for development
  const tokensReceived = BigInt(Math.floor((amount / maxPrice) * 1e6));

  return {
    signature: 'simulated_' + Date.now(),
    tokensReceived,
  };
}

/**
 * Sell outcome tokens
 */
export async function sellOutcomeTokens(
  connection: Connection,
  marketId: PublicKey,
  outcome: 'YES' | 'NO',
  tokenAmount: bigint,
  minPrice: number, // Min price willing to accept (0-1)
  wallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  }
): Promise<{ signature: string; usdcReceived: number }> {
  console.log('Selling outcome tokens:', {
    market: marketId.toBase58(),
    outcome,
    tokenAmount: tokenAmount.toString(),
    minPrice,
  });

  // Simulated for development
  const usdcReceived = (Number(tokenAmount) / 1e6) * minPrice;

  return {
    signature: 'simulated_' + Date.now(),
    usdcReceived,
  };
}

/**
 * Redeem winning tokens after market resolution
 */
export async function redeemWinnings(
  connection: Connection,
  marketId: PublicKey,
  wallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  }
): Promise<{ signature: string; amount: number }> {
  console.log('Redeeming winnings for market:', marketId.toBase58());

  // Simulated for development
  return {
    signature: 'simulated_' + Date.now(),
    amount: 0,
  };
}

/**
 * Fetch market details
 */
export async function fetchMarket(
  connection: Connection,
  marketId: PublicKey
): Promise<PredictionMarket | null> {
  try {
    // In production: fetch from PNP API or on-chain
    const response = await fetch(`${PNP_API_URL}/markets/${marketId.toBase58()}`);

    if (!response.ok) {
      return null;
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
      collateralMint: new PublicKey(data.collateralMint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      totalLiquidity: BigInt(data.marketDetails.initialLiquidity),
      endTime: new Date(data.marketDetails.endTime * 1000),
      resolved: data.marketDetails.resolved,
    };
  } catch (error) {
    console.error('Failed to fetch market:', error);
    return null;
  }
}

/**
 * Fetch all active markets
 */
export async function fetchActiveMarkets(
  connection: Connection,
  limit: number = 10
): Promise<PredictionMarket[]> {
  try {
    const response = await fetch(`${PNP_API_URL}/markets?limit=${limit}&active=true`);

    if (!response.ok) {
      return [];
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
    console.error('Failed to fetch active markets:', error);
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
    console.error('Failed to fetch user positions:', error);
    return [];
  }
}

/**
 * Calculate price using CPMM formula
 */
function calculatePrice(tokenSupply: bigint, reserves: bigint): number {
  if (reserves === BigInt(0)) return 0.5;
  const total = tokenSupply + reserves;
  return Number(reserves) / Number(total);
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
  wallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  }
): Promise<PredictionMarket> {
  console.log('Creating confidential prediction market:', {
    question,
    endTime,
    collateral: cUsdcMint.toBase58(),
  });

  // This would integrate with both PNP SDK and Arcium
  // The liquidity amount remains encrypted throughout

  // Simulated for development
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
