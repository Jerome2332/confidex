/**
 * Settlement Layer Type Definitions
 *
 * Defines the interface for settlement providers (ShadowWire, C-SPL, etc.)
 * Enables easy switching between providers via feature flags.
 */

/**
 * Available settlement methods
 */
export type SettlementMethod = 'shadowwire' | 'cspl' | 'light' | 'auto';

/**
 * Token symbols supported for settlement
 */
export type SettlementToken =
  | 'SOL'
  | 'USDC'
  | 'RADR'
  | 'ORE'
  | 'BONK'
  | 'JIM'
  | 'GODL'
  | 'HUSTLE'
  | 'ZEC'
  | 'CRT'
  | 'BLACKCOIN'
  | 'GIL'
  | 'ANON'
  | 'WLFI'
  | 'USD1'
  | 'AOL'
  | 'IQLABS';

/**
 * Transfer type for privacy level
 */
export type TransferType = 'internal' | 'external';

/**
 * Privacy level provided by the settlement method
 */
export type PrivacyLevel = 'full' | 'partial' | 'none';

/**
 * Capabilities of a settlement provider
 */
export interface SettlementCapabilities {
  /** Unique identifier for this method */
  id: SettlementMethod;
  /** Display name */
  name: string;
  /** Whether this provider is currently available */
  isAvailable: boolean;
  /** Fee in basis points (100 = 1%) */
  feeBps: number;
  /** Tokens supported by this provider */
  supportedTokens: SettlementToken[];
  /** Privacy guarantee level */
  privacyLevel: PrivacyLevel;
  /** Estimated processing time in milliseconds */
  estimatedTimeMs: number;
  /** Human-readable description */
  description: string;
}

/**
 * Parameters for a settlement transfer
 */
export interface SettlementTransferParams {
  /** Sender's wallet address */
  sender: string;
  /** Recipient's wallet address */
  recipient: string;
  /** Amount to transfer (in token units) */
  amount: number;
  /** Token to transfer */
  token: SettlementToken;
  /** Transfer type (affects privacy level) */
  type: TransferType;
  /** Wallet interface for signing */
  wallet: {
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  };
}

/**
 * Result of a settlement transfer
 */
export interface SettlementTransferResult {
  /** Transaction was successful */
  success: boolean;
  /** Transaction signature */
  txSignature: string;
  /** Amount that was sent (null if hidden) */
  amountSent: number | null;
  /** Whether the amount is hidden */
  amountHidden: boolean;
  /** Proof PDA address (for ShadowWire) */
  proofPda?: string;
  /** Fee charged (in token units) */
  feeCharged: number;
}

/**
 * Balance information from a settlement provider
 */
export interface SettlementBalance {
  /** Wallet address */
  wallet: string;
  /** Available balance */
  available: number;
  /** Deposited but not yet available */
  deposited: number;
  /** Withdrawn to escrow */
  withdrawnToEscrow: number;
  /** Whether migration is complete */
  migrated: boolean;
  /** Pool address (for ShadowWire) */
  poolAddress?: string;
}

/**
 * Settlement provider interface
 * All providers must implement this interface
 */
export interface ISettlementProvider {
  /** Provider capabilities (static info) */
  readonly capabilities: SettlementCapabilities;

  /**
   * Initialize the provider (WASM loading, SDK setup, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Check if provider is ready for use
   */
  isReady(): boolean;

  /**
   * Execute a transfer
   */
  transfer(params: SettlementTransferParams): Promise<SettlementTransferResult>;

  /**
   * Get balance for a wallet
   */
  getBalance(
    wallet: string,
    token: SettlementToken
  ): Promise<SettlementBalance | null>;

  /**
   * Generate a proof for a transfer (if applicable)
   */
  generateProof?(
    amount: number,
    token: SettlementToken
  ): Promise<{
    proofBytes: string;
    commitmentBytes: string;
    blindingFactorBytes: string;
  }>;
}

/**
 * Settlement manager configuration
 */
export interface SettlementConfig {
  /** Preferred settlement method */
  preferredMethod: SettlementMethod;
  /** Whether to show fees in UI */
  showFees: boolean;
  /** Auto-fallback to available provider */
  autoFallback: boolean;
}

/**
 * Event emitted when settlement state changes
 */
export interface SettlementStateChange {
  type: 'initialized' | 'transfer_started' | 'transfer_complete' | 'error';
  provider: SettlementMethod;
  details?: unknown;
}
