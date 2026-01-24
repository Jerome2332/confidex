/**
 * Jito bundle types
 */

// =============================================================================
// Configuration Types
// =============================================================================

export interface JitoConfig {
  /** Block engine URL */
  readonly blockEngineUrl: string;
  /** Authentication token (optional) */
  readonly authToken?: string;
  /** Default tip in lamports */
  readonly defaultTipLamports: number;
  /** Minimum tip in lamports */
  readonly minTipLamports: number;
  /** Maximum tip in lamports */
  readonly maxTipLamports: number;
  /** Bundle submission timeout in ms */
  readonly submissionTimeoutMs: number;
  /** Status poll interval in ms */
  readonly statusPollIntervalMs: number;
  /** Maximum status poll attempts */
  readonly maxStatusPollAttempts: number;
}

// =============================================================================
// Bundle Types
// =============================================================================

/**
 * Bundle submission request
 */
export interface BundleSubmission {
  /** Serialized transactions (base58 or base64) */
  readonly transactions: string[];
}

/**
 * Bundle submission response
 */
export interface BundleSubmissionResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: string; // Bundle UUID
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

/**
 * Bundle status
 */
export type BundleStatus =
  | 'pending'
  | 'landed'
  | 'failed'
  | 'dropped'
  | 'invalid'
  | 'timeout';

/**
 * Bundle status response
 */
export interface BundleStatusResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: {
    readonly bundleId: string;
    readonly status: string;
    readonly slot?: number;
    readonly error?: string;
  };
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

/**
 * Bundle result
 */
export interface BundleResult {
  /** Bundle ID (UUID) */
  readonly bundleId: string;
  /** Final status */
  readonly status: BundleStatus;
  /** First transaction signature */
  readonly signature?: string;
  /** Slot where bundle landed */
  readonly slot?: number;
  /** Error message if failed */
  readonly error?: string;
  /** Total tip paid in lamports */
  readonly tipPaid?: number;
}

// =============================================================================
// Tip Account Types
// =============================================================================

/**
 * Jito tip accounts (rotated for load balancing)
 */
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
] as const;

// =============================================================================
// Block Engine URLs
// =============================================================================

export const JITO_BLOCK_ENGINES = {
  /** Mainnet block engines */
  mainnet: {
    amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
    frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
    ny: 'https://ny.mainnet.block-engine.jito.wtf',
    tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
    default: 'https://mainnet.block-engine.jito.wtf',
  },
  /** Devnet block engine */
  devnet: 'https://devnet.block-engine.jito.wtf',
} as const;
