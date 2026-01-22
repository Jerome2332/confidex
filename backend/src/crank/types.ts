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

// On-chain OrderStatus: Active (can be matched) or Inactive (filled/cancelled)
// The is_matching field separately tracks if order is in MPC matching flow
export enum OrderStatus {
  Active = 0,    // Order can be matched
  Inactive = 1,  // Order is filled or cancelled
}

/**
 * V5 ConfidentialOrder - Privacy hardened, no plaintext fields
 * Total on-chain size: 366 bytes (8 discriminator + 358 data)
 */
export interface ConfidentialOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: Uint8Array;   // 64 bytes
  encryptedPrice: Uint8Array;    // 64 bytes
  encryptedFilled: Uint8Array;   // 64 bytes - first byte != 0 means order has fill
  status: OrderStatus;
  createdAtHour: bigint;         // V5: Coarse timestamp (hour precision)
  orderId: Uint8Array;           // 16 bytes hash-based ID
  orderNonce: Uint8Array;        // 8 bytes for PDA derivation
  eligibilityProofVerified: boolean;
  pendingMatchRequest: PublicKey; // V5: PublicKey for easier comparison
  isMatching: boolean;
  bump: number;
  ephemeralPubkey: Uint8Array;   // 32 bytes - X25519 for MPC decryption
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
  /** Computation offset for MPC tracking (only on success) */
  computationOffset?: string;
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

// ============================================
// Position Types (V7 - includes close tracking)
// ============================================

export enum PositionStatus {
  Open = 0,
  Closed = 1,
  Liquidated = 2,
  AutoDeleveraged = 3,
  PendingLiquidationCheck = 4,
}

export enum PositionSide {
  Long = 0,
  Short = 1,
}

/**
 * V7 ConfidentialPosition - includes async close position tracking
 * Total on-chain size: 692 bytes (8 discriminator + 684 data)
 */
export interface ConfidentialPosition {
  trader: PublicKey;
  market: PublicKey;
  positionId: Uint8Array;           // 16 bytes
  createdAtHour: bigint;
  lastUpdatedHour: bigint;
  side: PositionSide;
  leverage: number;
  encryptedSize: Uint8Array;        // 64 bytes
  encryptedEntryPrice: Uint8Array;  // 64 bytes
  encryptedCollateral: Uint8Array;  // 64 bytes
  encryptedRealizedPnl: Uint8Array; // 64 bytes
  encryptedLiqBelow: Uint8Array;    // 64 bytes
  encryptedLiqAbove: Uint8Array;    // 64 bytes
  thresholdCommitment: Uint8Array;  // 32 bytes
  lastThresholdUpdateHour: bigint;
  thresholdVerified: boolean;
  entryCumulativeFunding: bigint;   // i128
  status: PositionStatus;
  eligibilityProofVerified: boolean;
  partialCloseCount: number;
  autoDeleveragePriority: bigint;
  lastMarginAddHour: bigint;
  marginAddCount: number;
  bump: number;
  positionSeed: bigint;
  // V6 fields
  pendingMpcRequest: Uint8Array;    // 32 bytes
  pendingMarginAmount: bigint;
  pendingMarginIsAdd: boolean;
  isLiquidatable: boolean;
  // V7 fields (close position tracking)
  pendingClose: boolean;
  pendingCloseExitPrice: bigint;
  pendingCloseFull: boolean;
  pendingCloseSize: Uint8Array;     // 64 bytes
}

export interface PositionWithPda {
  pda: PublicKey;
  position: ConfidentialPosition;
}

// ============================================
// Close Position Event Types
// ============================================

export interface ClosePositionInitiatedEvent {
  position: PublicKey;
  trader: PublicKey;
  market: PublicKey;
  exitPrice: bigint;
  fullClose: boolean;
  requestId: Uint8Array;  // 32 bytes
  timestamp: bigint;
}

export interface PositionClosedEvent {
  position: PublicKey;
  trader: PublicKey;
  market: PublicKey;
  payoutAmount: bigint;
  isProfit: boolean;
  partialCloseCount: number;
  timestamp: bigint;
}

export interface PositionCloseFailedEvent {
  position: PublicKey;
  trader: PublicKey;
  requestId: Uint8Array;  // 32 bytes
  errorCode: number;
  timestamp: bigint;
}
