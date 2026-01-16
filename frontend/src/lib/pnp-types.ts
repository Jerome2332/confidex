/**
 * PNP SDK Type Definitions
 *
 * TypeScript types aligned with pnp-sdk v0.2.3
 * Used for prediction market integration
 */

import { PublicKey } from '@solana/web3.js';

/**
 * Raw market data structure from PNP SDK
 */
export interface PNPMarketData {
  market: PublicKey;
  yesTokenMint: PublicKey;
  noTokenMint: PublicKey;
  collateralMint: PublicKey;
  marketDetails: PNPMarketDetails;
}

/**
 * Market details from SDK response
 */
export interface PNPMarketDetails {
  id: string;
  question: string;
  creator: string;
  initialLiquidity: string;
  marketReserves: string;
  yesTokenSupply: string;
  noTokenSupply: string;
  endTime: number | string; // Can be unix timestamp (number) or hex string
  resolved: boolean;
  outcome?: 'YES' | 'NO';
}

/**
 * Create market request payload
 */
export interface CreateMarketRequest {
  question: string;
  endTime: Date;
  initialLiquidity: number;
  collateralMint?: string;
}

/**
 * Create market response from backend API
 */
export interface CreateMarketResponse {
  success: boolean;
  market: string;
  yesTokenMint: string;
  noTokenMint: string;
  marketDetails: PNPMarketDetails;
}

/**
 * Buy/Sell tokens request
 */
export interface TradeTokensRequest {
  marketId: PublicKey;
  outcome: 'YES' | 'NO';
  amount: number;
  maxPrice?: number; // For buys: max price willing to pay
  minPrice?: number; // For sells: min price willing to accept
}

/**
 * Trade result
 */
export interface TradeResult {
  signature: string;
  tokensReceived?: bigint; // For buys
  usdcReceived?: number; // For sells
}

/**
 * User position in a market
 */
export interface PNPUserPosition {
  marketId: PublicKey;
  yesBalance: bigint;
  noBalance: bigint;
  avgYesCost: number;
  avgNoCost: number;
}

/**
 * Wallet interface for transaction signing
 * Compatible with @solana/wallet-adapter-react
 */
export interface PNPWalletAdapter {
  publicKey: PublicKey;
  signTransaction: <T extends import('@solana/web3.js').Transaction>(
    tx: T
  ) => Promise<T>;
  sendTransaction?: (
    tx: import('@solana/web3.js').Transaction,
    connection: import('@solana/web3.js').Connection
  ) => Promise<string>;
}

/**
 * Outcome token data
 */
export interface OutcomeTokenData {
  mint: PublicKey;
  symbol: 'YES' | 'NO';
  supply: bigint;
  price: number; // 0-1 probability
}

/**
 * API error response
 */
export interface PNPApiError {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Type guard for API errors
 */
export function isPNPApiError(obj: unknown): obj is PNPApiError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'error' in obj &&
    typeof (obj as PNPApiError).error === 'string'
  );
}
