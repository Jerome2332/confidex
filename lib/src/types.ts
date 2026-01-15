import { PublicKey } from '@solana/web3.js';

// Order types
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
}

// Encrypted value (64 bytes)
export type EncryptedU64 = Uint8Array;

// Account structures
export interface ExchangeState {
  authority: PublicKey;
  feeRecipient: PublicKey;
  makerFeeBps: number;
  takerFeeBps: number;
  paused: boolean;
  blacklistRoot: Uint8Array;
  arciumCluster: PublicKey;
  pairCount: bigint;
  orderCount: bigint;
  bump: number;
}

export interface TradingPair {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  cBaseMint: PublicKey;
  cQuoteMint: PublicKey;
  cBaseVault: PublicKey;
  cQuoteVault: PublicKey;
  minOrderSize: bigint;
  tickSize: bigint;
  active: boolean;
  openOrderCount: bigint;
  index: bigint;
  bump: number;
}

export interface ConfidentialOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: EncryptedU64;
  encryptedPrice: EncryptedU64;
  encryptedFilled: EncryptedU64;
  status: OrderStatus;
  createdAt: bigint;
  orderId: bigint;
  eligibilityProofVerified: boolean;
  bump: number;
}

export interface UserConfidentialBalance {
  owner: PublicKey;
  mint: PublicKey;
  encryptedBalance: EncryptedU64;
  totalDeposited: bigint;
  totalWithdrawn: bigint;
  bump: number;
}

// Proof types
export interface EligibilityProof {
  proof: Uint8Array; // 388 bytes Groth16
  blacklistRoot: Uint8Array; // 32 bytes
}

export interface MerkleProof {
  path: Uint8Array[]; // 20 x 32-byte hashes
  indices: boolean[]; // 20 direction bits
}

// Order placement input
export interface PlaceOrderInput {
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  amount: bigint;
  price: bigint;
  eligibilityProof: EligibilityProof;
}

// Encryption context for client-side use
export interface EncryptionContext {
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
}
