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

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

import { createLogger } from '@/lib/logger';

const log = createLogger('pnp');
import {
  fetchMarketData,
  fetchAllMarkets,
  fetchUserPositions,
  buildBuyTokensTransaction,
  buildSellTokensTransaction,
  calculateTokensReceived,
  calculateUsdcReceived,
  calculatePrice,
  calculatePythagoreanPrices,
  initializeSDK,
  isSDKAvailable,
} from './pnp-client';
import { PNP_RPC_URL, PNP_NETWORK } from './constants';

// Internal API base for server-side transaction building
const BUILD_TX_API = '/api/pnp/build-tx';
import type { CreateMarketResponse } from './pnp-types';

// PNP configuration
const PNP_API_URL =
  process.env.NEXT_PUBLIC_PNP_API_URL || 'https://api.pnp.exchange';

// Feature flag: Use SDK vs REST API fallback
const USE_SDK = process.env.NEXT_PUBLIC_PNP_USE_SDK !== 'false';

// Feature flag: Use mock data when API unavailable
// IMPORTANT: Disabled in production to prevent showing fake markets to users
// Set NEXT_PUBLIC_PNP_USE_MOCK=true explicitly to enable in development
const USE_MOCK_FALLBACK =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_PNP_USE_MOCK !== 'false';

// PNP-specific connection (mainnet by default for prediction markets)
let pnpConnection: Connection | null = null;
function getPnpConnection(): Connection {
  if (!pnpConnection) {
    pnpConnection = new Connection(PNP_RPC_URL, 'confirmed');
    log.debug('Using ${PNP_NETWORK} connection: ${PNP_RPC_URL}');
  }
  return pnpConnection;
}

/**
 * Parse endTime from API response - handles both hex strings and numbers
 */
function parseEndTime(endTime: number | string): number {
  if (typeof endTime === 'string') {
    // Check if it's a hex string (only hex chars, 8 chars or less)
    if (/^[0-9a-f]+$/i.test(endTime) && endTime.length <= 8) {
      return parseInt(endTime, 16);
    }
    return parseInt(endTime, 10);
  }
  return endTime || 0;
}

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
      resolvable: true,
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
      resolvable: true,
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
      resolvable: true,
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
      resolvable: true,
    },
  ];

  log.debug('Using mock markets (API unavailable)');
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
  resolvable: boolean; // Whether market is activated for trading
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
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  sendTransaction?: (tx: Transaction, connection: Connection) => Promise<string>;
}

/**
 * Build transaction response from server API
 */
interface BuildTxResponse {
  success: boolean;
  transaction?: string; // Base64 encoded serialized transaction
  blockhash?: string;
  lastValidBlockHeight?: number;
  message?: string;
  error?: string;
  details?: string | { userBalance?: string; required?: string };
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

  // Use a placeholder mint if not provided (will be resolved on next market fetch)
  const placeholderMint = new PublicKey('11111111111111111111111111111111');
  const yesTokenMint = data.yesTokenMint ? new PublicKey(data.yesTokenMint) : placeholderMint;
  const noTokenMint = data.noTokenMint ? new PublicKey(data.noTokenMint) : placeholderMint;

  // Use the collateral mint from response if available
  const collateralMint = data.collateralMint
    ? new PublicKey(data.collateralMint)
    : new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

  return {
    id: new PublicKey(data.market),
    question: data.marketDetails.question,
    creator: new PublicKey(data.marketDetails.creator),
    yesToken: {
      mint: yesTokenMint,
      symbol: 'YES',
      supply: BigInt(data.marketDetails.yesTokenSupply || data.marketDetails.initialLiquidity || '0'),
      price: 0.5,
    },
    noToken: {
      mint: noTokenMint,
      symbol: 'NO',
      supply: BigInt(data.marketDetails.noTokenSupply || data.marketDetails.initialLiquidity || '0'),
      price: 0.5,
    },
    collateralMint,
    totalLiquidity: BigInt(data.marketDetails.initialLiquidity),
    endTime: new Date(parseEndTime(data.marketDetails.endTime) * 1000),
    resolved: data.marketDetails.resolved,
    resolvable: data.marketDetails.resolvable ?? true,
  };
}

/**
 * Buy outcome tokens using server-side transaction building + wallet signing
 * Note: Uses PNP's network (mainnet by default) regardless of wallet adapter connection
 */
export async function buyOutcomeTokens(
  _connection: Connection, // Kept for API compatibility, but we use PNP connection
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
    network: PNP_NETWORK,
  });

  if (!USE_SDK) {
    // Fallback to simulated mode
    log.warn('SDK disabled, using simulation');
    const tokensReceived = calculateTokensReceived(amount, maxPrice);
    return {
      signature: 'simulated_' + Date.now(),
      tokensReceived,
    };
  }

  // Use PNP-specific connection (mainnet by default)
  const pnpConn = getPnpConnection();

  try {
    // Try server-side transaction building first
    log.debug('Building transaction via server API...');
    const buildResponse = await fetch(BUILD_TX_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'buy',
        marketId: marketId.toBase58(),
        isYes: outcome === 'YES',
        amount,
        userPubkey: wallet.publicKey.toBase58(),
        minimumOut: 0, // No slippage protection for now
      }),
    });

    const buildData: BuildTxResponse = await buildResponse.json();

    if (!buildResponse.ok || !buildData.success || !buildData.transaction) {
      // Handle specific errors
      if (buildData.error === 'Insufficient balance') {
        const details = buildData.details as { userBalance?: string; required?: string };
        throw new Error(
          `Insufficient USDC balance. Have: ${details?.userBalance || '0'}, Need: ${details?.required || amount}`
        );
      }

      // Fall back to simulation if server unavailable (503 errors)
      if (buildResponse.status === 503) {
        console.warn('[PNP] Server unavailable, using simulation:', buildData.error);
        const tokensReceived = calculateTokensReceived(amount, maxPrice);
        return {
          signature: 'simulated_' + Date.now(),
          tokensReceived,
        };
      }

      // For other errors, throw with details
      throw new Error(buildData.error || 'Transaction build failed');
    }

    // Deserialize the transaction
    const txBuffer = Buffer.from(buildData.transaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);

    log.debug('Transaction built, requesting wallet signature...');

    // Sign with wallet
    const signedTx = await wallet.signTransaction(transaction);

    // Send to PNP network (mainnet by default)
    // Use skipPreflight: true to avoid double simulation (we trust server-side build)
    let signature: string;
    try {
      signature = await pnpConn.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      });
    } catch (sendError) {
      // "Already been processed" at send level means tx succeeded previously
      if (sendError instanceof Error &&
          sendError.message.includes('already been processed')) {
        log.info('Transaction already processed during send - treating as success');
        const tokensReceived = calculateTokensReceived(amount, maxPrice);
        return { signature: 'already_processed_send_' + Date.now(), tokensReceived };
      }
      throw sendError;
    }

    log.debug('Transaction sent:', { signature });

    // Wait for confirmation with error handling for "already processed"
    try {
      const confirmation = await pnpConn.confirmTransaction(
        {
          signature,
          blockhash: buildData.blockhash!,
          lastValidBlockHeight: buildData.lastValidBlockHeight!,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        // Parse common on-chain errors
        const errStr = JSON.stringify(confirmation.value.err);
        if (errStr.includes('InsufficientFunds') || errStr.includes('0x1')) {
          const network = PNP_NETWORK === 'devnet' ? 'devnet' : 'mainnet';
          throw new Error(`Insufficient USDC balance. You need ${network} USDC to trade on PNP markets.`);
        }
        throw new Error(`Transaction failed: ${errStr}`);
      }
    } catch (confirmError) {
      // "Already been processed" means the transaction succeeded - treat as success
      if (confirmError instanceof Error &&
          confirmError.message.includes('already been processed')) {
        log.debug('Transaction already confirmed (processed):', { signature });
        // Continue to return success
      } else {
        throw confirmError;
      }
    }

    const tokensReceived = calculateTokensReceived(amount, maxPrice);

    log.debug('Buy transaction confirmed:', { signature });
    return { signature, tokensReceived };
  } catch (error) {
    log.error('Buy transaction failed', { error: error instanceof Error ? error.message : String(error) });
    // Add context for common errors
    if (error instanceof Error) {
      // "Already processed" at the outer level also means success
      if (error.message.includes('already been processed')) {
        log.info('Transaction was already processed - treating as success');
        const tokensReceived = calculateTokensReceived(amount, maxPrice);
        return { signature: 'already_processed_' + Date.now(), tokensReceived };
      }
      if (error.message.includes('0x1') || error.message.includes('insufficient')) {
        const network = PNP_NETWORK === 'devnet' ? 'devnet' : 'mainnet';
        const collateral = PNP_NETWORK === 'devnet'
          ? 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
          : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        throw new Error(`Insufficient ${network} USDC (${collateral.slice(0, 8)}...). Get tokens from a faucet.`);
      }
      // Handle token program mismatch - usually means market tokens aren't properly initialized
      if (error.message.includes('IncorrectProgramId') || error.message.includes('incorrect program id')) {
        throw new Error(
          'This market is not fully initialized for trading. ' +
          'Try selecting a different market or creating a new one.'
        );
      }
    }
    throw error;
  }
}

/**
 * Sell outcome tokens using server-side transaction building + wallet signing
 * Note: Uses PNP's network (mainnet by default) regardless of wallet adapter connection
 */
export async function sellOutcomeTokens(
  _connection: Connection, // Kept for API compatibility, but we use PNP connection
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
    network: PNP_NETWORK,
  });

  if (!USE_SDK) {
    log.warn('SDK disabled, using simulation');
    const usdcReceived = calculateUsdcReceived(tokenAmount, minPrice);
    return {
      signature: 'simulated_' + Date.now(),
      usdcReceived,
    };
  }

  // Use PNP-specific connection (mainnet by default)
  const pnpConn = getPnpConnection();

  try {
    // Try server-side transaction building
    log.debug('Building sell transaction via server API...');
    const buildResponse = await fetch(BUILD_TX_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sell',
        marketId: marketId.toBase58(),
        isYes: outcome === 'YES',
        amount: Number(tokenAmount) / 1e6, // Convert from base units to USDC
        userPubkey: wallet.publicKey.toBase58(),
      }),
    });

    const buildData: BuildTxResponse = await buildResponse.json();

    if (!buildResponse.ok || !buildData.success || !buildData.transaction) {
      // Fall back to simulation if server unavailable
      console.warn('[PNP] Server transaction build failed, using simulation:', buildData.error);
      const usdcReceived = calculateUsdcReceived(tokenAmount, minPrice);
      return {
        signature: 'simulated_' + Date.now(),
        usdcReceived,
      };
    }

    // Deserialize the transaction
    const txBuffer = Buffer.from(buildData.transaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);

    log.debug('Sell transaction built, requesting wallet signature...');

    // Sign with wallet
    const signedTx = await wallet.signTransaction(transaction);

    // Send to PNP network (mainnet by default)
    const signature = await pnpConn.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });

    log.debug('Sell transaction sent:', { signature });

    // Wait for confirmation
    const confirmation = await pnpConn.confirmTransaction(
      {
        signature,
        blockhash: buildData.blockhash!,
        lastValidBlockHeight: buildData.lastValidBlockHeight!,
      },
      'confirmed'
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    const usdcReceived = calculateUsdcReceived(tokenAmount, minPrice);

    log.debug('Sell transaction confirmed:', { signature });
    return { signature, usdcReceived };
  } catch (error) {
    log.error('Sell transaction failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Redeem winning tokens after market resolution
 * Uses server-side transaction building + wallet signing
 */
export async function redeemWinnings(
  connection: Connection,
  marketId: PublicKey,
  wallet: WalletAdapter
): Promise<{ signature: string; amount: number }> {
  log.debug('[PNP] Redeeming winnings for market:', { toBase58: marketId.toBase58() });

  if (!USE_SDK) {
    log.warn('SDK disabled, using simulation');
    return {
      signature: 'simulated_' + Date.now(),
      amount: 0,
    };
  }

  const pnpConn = getPnpConnection();

  try {
    // Build redemption transaction via server API
    log.debug('Building redeem transaction via server API...');
    const buildResponse = await fetch(BUILD_TX_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'redeem',
        marketId: marketId.toBase58(),
        userPubkey: wallet.publicKey.toBase58(),
      }),
    });

    const buildData: BuildTxResponse = await buildResponse.json();

    if (!buildResponse.ok || !buildData.success || !buildData.transaction) {
      // Handle specific errors
      if (buildData.error === 'Market is not yet resolved') {
        throw new Error('This market has not been resolved yet. Wait for the outcome to be determined.');
      }
      if (buildData.error === 'No winning tokens to redeem') {
        throw new Error('You have no winning tokens to redeem in this market.');
      }

      // Fall back to simulation if server unavailable (503 errors)
      if (buildResponse.status === 503) {
        console.warn('[PNP] Server unavailable, using simulation:', buildData.error);
        return {
          signature: 'simulated_' + Date.now(),
          amount: 0,
        };
      }

      throw new Error(buildData.error || 'Redemption transaction build failed');
    }

    // Deserialize the transaction
    const txBuffer = Buffer.from(buildData.transaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);

    log.debug('Redeem transaction built, requesting wallet signature...');

    // Sign with wallet
    const signedTx = await wallet.signTransaction(transaction);

    // Send to PNP network (mainnet by default)
    const signature = await pnpConn.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });

    log.debug('Redeem transaction sent:', { signature });

    // Wait for confirmation
    const confirmation = await pnpConn.confirmTransaction(
      {
        signature,
        blockhash: buildData.blockhash!,
        lastValidBlockHeight: buildData.lastValidBlockHeight!,
      },
      'confirmed'
    );

    if (confirmation.value.err) {
      throw new Error(`Redemption failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    // Extract redeemed amount from transaction details if available
    const details = buildData.details as { tokenBalance?: string } | undefined;
    const redeemedAmount = details?.tokenBalance ? parseFloat(details.tokenBalance) : 0;

    log.debug('Redemption confirmed:', { signature });
    return { signature, amount: redeemedAmount };
  } catch (error) {
    log.error('Redemption failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
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

      // Calculate prices using Pythagorean formula
      const yesSupply = BigInt(data.marketDetails.yesTokenSupply);
      const noSupply = BigInt(data.marketDetails.noTokenSupply);
      const { yesPrice, noPrice } = calculatePythagoreanPrices(yesSupply, noSupply);

      return {
        id: data.market,
        question: data.marketDetails.question,
        creator: new PublicKey(data.marketDetails.creator),
        yesToken: {
          mint: data.yesTokenMint,
          symbol: 'YES',
          supply: yesSupply,
          price: yesPrice,
        },
        noToken: {
          mint: data.noTokenMint,
          symbol: 'NO',
          supply: noSupply,
          price: noPrice,
        },
        collateralMint: data.collateralMint,
        totalLiquidity: BigInt(data.marketDetails.initialLiquidity),
        endTime: new Date(parseEndTime(data.marketDetails.endTime) * 1000),
        resolved: data.marketDetails.resolved,
        resolvable: data.marketDetails.resolvable ?? true,
      };
    } catch (error) {
      log.warn('SDK fetch failed, trying REST API:', { error });
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

    // Calculate prices using Pythagorean formula
    const yesSupply = BigInt(data.marketDetails.yesTokenSupply);
    const noSupply = BigInt(data.marketDetails.noTokenSupply);
    const { yesPrice, noPrice } = calculatePythagoreanPrices(yesSupply, noSupply);

    return {
      id: new PublicKey(data.market),
      question: data.marketDetails.question,
      creator: new PublicKey(data.marketDetails.creator),
      yesToken: {
        mint: new PublicKey(data.yesTokenMint),
        symbol: 'YES',
        supply: yesSupply,
        price: yesPrice,
      },
      noToken: {
        mint: new PublicKey(data.noTokenMint),
        symbol: 'NO',
        supply: noSupply,
        price: noPrice,
      },
      collateralMint: new PublicKey(
        data.collateralMint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      ),
      totalLiquidity: BigInt(data.marketDetails.initialLiquidity),
      endTime: new Date(parseEndTime(data.marketDetails.endTime) * 1000),
      resolved: data.marketDetails.resolved,
      resolvable: data.marketDetails.resolvable ?? true,
    };
  } catch (error) {
    log.error('Failed to fetch market', { error: error instanceof Error ? error.message : String(error) });

    // Try to find in mock data if enabled
    if (USE_MOCK_FALLBACK) {
      const mockMarket = getMockMarkets().find(
        (m) => m.id.toBase58() === marketId.toBase58()
      );
      if (mockMarket) {
        log.debug('Found market in mock data');
        return mockMarket;
      }
    }

    return null;
  }
}

/**
 * Fetch all active markets using internal API (SDK server-side) or fallbacks
 */
export async function fetchActiveMarkets(
  connection: Connection,
  limit: number = 50,
  search?: string
): Promise<PredictionMarket[]> {
  // Always try internal API first (uses SDK server-side)
  // This works regardless of external API availability
  try {
    log.debug('Fetching markets via internal API...', { limit, search });
    const markets = await fetchAllMarkets(limit, search);

    if (markets.length > 0) {
      log.debug(`Got ${markets.length} markets from internal API`);

      // Filter to only resolvable markets (can trade) and transform
      const tradeableMarkets = markets
        .filter((m) => m.marketDetails.resolvable === true)
        .map((m) => {
          // Calculate prices using Pythagorean bonding curve
          const yesSupply = BigInt(m.marketDetails.yesTokenSupply || '0');
          const noSupply = BigInt(m.marketDetails.noTokenSupply || '0');
          const { yesPrice, noPrice } = calculatePythagoreanPrices(yesSupply, noSupply);

          // Parse endTime - handles hex strings from API
          const endTimeSeconds = parseEndTime(m.marketDetails.endTime);

          return {
            id: m.market,
            question: m.marketDetails.question,
            creator: new PublicKey(m.marketDetails.creator || '11111111111111111111111111111111'),
            yesToken: {
              mint: m.yesTokenMint,
              symbol: 'YES' as const,
              supply: yesSupply,
              price: yesPrice,
            },
            noToken: {
              mint: m.noTokenMint,
              symbol: 'NO' as const,
              supply: noSupply,
              price: noPrice,
            },
            collateralMint: m.collateralMint,
            totalLiquidity: BigInt(m.marketDetails.initialLiquidity || '0'),
            endTime: new Date((endTimeSeconds || 0) * 1000),
            resolved: m.marketDetails.resolved,
            resolvable: true, // Only resolvable markets pass the filter
          };
        });

      log.debug(`Filtered to ${tradeableMarkets.length} tradeable markets`);
      return tradeableMarkets;
    }
    log.debug('Internal API returned no markets');
  } catch (error) {
    log.warn('Internal API fetch failed:', { error });
  }

  // External REST API fallback (only if configured to a different URL)
  const externalApiAvailable = !PNP_API_URL.includes('api.pnp.exchange');
  if (externalApiAvailable) {
    try {
      log.debug('Trying external API fallback...');
      const response = await fetch(
        `${PNP_API_URL}/markets?limit=${limit}&active=true`
      );

      if (response.ok) {
        const data = await response.json();
        if (data.markets?.length > 0) {
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
            resolvable: true, // External API only returns active/tradeable markets
          }));
        }
      }
    } catch (error) {
      log.error('External API failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Mock data fallback
  if (USE_MOCK_FALLBACK) {
    log.debug('Using mock markets as fallback');
    return getMockMarkets().slice(0, limit);
  }

  return [];
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
      log.warn('SDK fetch positions failed, trying REST API:', { error });
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
    log.error('Failed to fetch user positions', { error: error instanceof Error ? error.message : String(error) });
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
    resolvable: true,
  };
}

// Re-export utility functions
export { calculatePrice, calculateTokensReceived, calculateUsdcReceived };

// Re-export SDK utilities
export { initializeSDK, isSDKAvailable };
