/**
 * Crank Service Type Definitions
 *
 * Shared types for the automated order matching crank.
 */

import { PublicKey } from '@solana/web3.js';

// ============================================
// Order Types (matching on-chain state)
// ============================================

export enum Side {
  Buy = 0,
  Sell = 1,
}

export enum OrderType {
  Limit = 0,
  Market = 1,
}

export enum OrderStatus {
  Open = 0,
  PartiallyFilled = 1,
  Filled = 2,
  Cancelled = 3,
  Matching = 4,
}

export interface ConfidentialOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  encryptedFilled: Uint8Array;
  status: OrderStatus;
  createdAt: bigint;
  orderId: bigint;
  eligibilityProofVerified: boolean;
  pendingMatchRequest: Uint8Array;
  bump: number;
}

export interface OrderWithPda {
  pda: PublicKey;
  order: ConfidentialOrder;
}

// ============================================
// Matching Types
// ============================================

export interface MatchCandidate {
  buyOrder: OrderWithPda;
  sellOrder: OrderWithPda;
  pairPda: PublicKey;
}

export interface MatchResult {
  success: boolean;
  signature?: string;
  error?: string;
  buyOrderPda: PublicKey;
  sellOrderPda: PublicKey;
  timestamp: number;
}

// ============================================
// Service Status Types
// ============================================

export type CrankStatus = 'stopped' | 'starting' | 'running' | 'paused' | 'error';

export interface CrankMetrics {
  status: CrankStatus;
  startedAt: number | null;
  lastPollAt: number | null;
  totalPolls: number;
  totalMatchAttempts: number;
  successfulMatches: number;
  failedMatches: number;
  consecutiveErrors: number;
  walletBalance: number | null;
  openOrderCount: number;
  pendingMatches: number;
}

export interface CrankStatusResponse {
  status: CrankStatus;
  metrics: CrankMetrics;
  config: {
    pollingIntervalMs: number;
    useAsyncMpc: boolean;
    maxConcurrentMatches: number;
  };
}

// ============================================
// Order Lock Types
// ============================================

export interface OrderLock {
  orderPda: string;
  lockedAt: number;
  matchPartner?: string;
  requestId?: string;
}

// ============================================
// Trading Pair Types
// ============================================

export interface TradingPairInfo {
  pda: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  active: boolean;
}
