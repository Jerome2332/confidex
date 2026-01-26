import { PublicKey } from '@solana/web3.js';

// Program IDs (devnet)
const rawProgramId = process.env.NEXT_PUBLIC_PROGRAM_ID || '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB';
export const CONFIDEX_PROGRAM_ID = new PublicKey(rawProgramId);

// Debug: Log the Program ID being used (helps diagnose env var issues)
if (typeof window !== 'undefined') {
  console.log('[Constants] CONFIDEX_PROGRAM_ID:', rawProgramId);
  console.log('[Constants] NEXT_PUBLIC_PROGRAM_ID env:', process.env.NEXT_PUBLIC_PROGRAM_ID);
}

export const MXE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_MXE_PROGRAM_ID ||
    'HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS'
);

// ZK Eligibility Verifier (deployed via Sunspot)
// Rebuilt on Jan 17 2026 with updated verification key
export const VERIFIER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VERIFIER_PROGRAM_ID ||
    '9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W'
);

// RPC endpoints
// Priority: NEXT_PUBLIC_RPC_ENDPOINT > NEXT_PUBLIC_RPC_URL > Helius constructed URL > devnet
export const RPC_ENDPOINT = (() => {
  // Check for direct endpoint first
  if (process.env.NEXT_PUBLIC_RPC_ENDPOINT) {
    return process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  }
  if (process.env.NEXT_PUBLIC_RPC_URL) {
    return process.env.NEXT_PUBLIC_RPC_URL;
  }
  // Construct Helius URL if API key is available
  if (process.env.NEXT_PUBLIC_HELIUS_API_KEY) {
    return `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`;
  }
  // Fallback to public devnet (rate limited!)
  return 'https://api.devnet.solana.com';
})();

export const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY;

// Proof server
export const PROOF_SERVER_URL =
  process.env.NEXT_PUBLIC_PROOF_SERVER_URL || 'http://localhost:3001';

// Trading pairs (initial list)
export const TRADING_PAIRS = [
  {
    id: 'SOL/USDC',
    base: 'SOL',
    quote: 'USDC',
    baseMint: 'So11111111111111111111111111111111111111112', // Wrapped SOL (WSOL)
    quoteMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr', // Dummy USDC devnet
    minOrderSize: 0.1,
    tickSize: 0.01,
    active: true,
  },
];

// Derived PDAs (for reference)
export const EXCHANGE_PDA = 'AzYUvLiRgUz5juG24rvLMQBuKD7AmnJ3eh8GKp7exVWb';
export const SOL_USDC_PAIR_PDA = '3WRnHKvVgyZKXk9roscEkq4xaG62Uc7vhjAhd5zUZ5vV'; // Uses Dummy USDC (Gh9Zw...)

// Fee configuration
export const MAKER_FEE_BPS = 10; // 0.10%
export const TAKER_FEE_BPS = 30; // 0.30%
export const SHADOWWIRE_FEE_BPS = 100; // 1%

// Encryption settings
export const ENCRYPTED_VALUE_SIZE = 64;
// Groth16 proof size: A(64) + B(128) + C(64) + num_commitments(4) + commitment_pok(64) = 324 bytes
export const GROTH16_PROOF_SIZE = 324;

// PNP Prediction Markets
export const PNP_API_URL =
  process.env.NEXT_PUBLIC_PNP_API_URL || 'https://api.pnp.exchange';
export const PNP_USE_SDK = process.env.NEXT_PUBLIC_PNP_USE_SDK !== 'false';

// PNP Network Configuration
// Set to 'mainnet' to use mainnet-beta with real USDC, 'devnet' for devnet with test tokens
export const PNP_NETWORK = process.env.NEXT_PUBLIC_PNP_NETWORK || 'mainnet';
export const PNP_RPC_URL =
  PNP_NETWORK === 'mainnet'
    ? process.env.NEXT_PUBLIC_PNP_MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
    : process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

// USDC mint addresses
export const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DEVNET = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'; // Dummy USDC (devnet testing)
export const USDC_DEVNET_CIRCLE = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'; // Circle's official devnet USDC (limited supply)
export const PNP_DEVNET_COLLATERAL = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'; // Use dummy USDC for PNP devnet testing

// Settlement layer feature flags
export const CSPL_ENABLED = false; // Flip to true when C-SPL SDK releases
export const SHADOWWIRE_ENABLED = true; // Production-ready

// MXE Configuration (from init-mxe.ts)
export const MXE_CONFIG_PDA = 'GqZ3v32aFzr1s5N4vSo6piur8pHuWw4jZpKW5xEy31qK';
export const MXE_AUTHORITY_PDA = '9WH1PNEpvHQDLTUm1W3MuwSdsbTtLMK8eoy2SyNBLnyn';

// Pyth Oracle Price Feeds (devnet)
// See: https://pyth.network/developers/price-feed-ids
export const PYTH_SOL_USD_FEED = new PublicKey(
  'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix' // SOL/USD on devnet
);

// Perpetual Market PDAs (devnet)
export const SOL_PERP_MARKET_PDA = new PublicKey(
  'FFU5bwpju8Hrb2bgrrWPK4LgGG1rD1ReK9ieVHavcW6n'
);
export const SOL_PERP_FUNDING_PDA = new PublicKey(
  '7eiG5J7ntca6k6ChFDygxE835zJaAVfTcp9ewCNPgT7o'
);
export const LIQUIDATION_CONFIG_PDA = new PublicKey(
  '6sUqk2qFq5yc4dZ13BUQfcr76xTXF5y8FNjZr5qncobe'
);

// Perpetual Market Vault Addresses (devnet)
// Vault Authority PDA - seeds = ["vault", perp_market] - signs token transfers from vault
export const SOL_PERP_VAULT_AUTHORITY = new PublicKey(
  'Bj4ZZtvbg7CJzbCJMomYzW5MLkxiRGcZbmPSrjyR3sVE'
);
// Collateral Vault - USDC token account owned by vault authority
export const SOL_PERP_COLLATERAL_VAULT = new PublicKey(
  'DF8HbGMS6gLjQRjWgpaUV4G4C1CcJczseWJFtd1Jx32q'
);
// Fee Recipient - receives trading fees
export const SOL_PERP_FEE_RECIPIENT = new PublicKey(
  '2HmZ5C68M3m9WBdzDGHw4oUiUEJ7f9pxJddi2GUL2jGt'
);
// Insurance Fund - for socialized losses and ADL
export const SOL_PERP_INSURANCE_FUND = new PublicKey(
  'F9f1r3kRHF265Xme5qkjskzvByVYZ1jt1iWVVySTZbK6'
);

// Perpetual Market Registry
// Maps market PDA addresses to their symbols and metadata
export interface PerpMarketConfig {
  symbol: string;
  underlyingMint: PublicKey;
  quoteMint: PublicKey;
  oracleFeed: PublicKey;
  maxLeverage: number;
  maintenanceMarginBps: number;
  tickSize: number;
}

export const PERP_MARKET_REGISTRY: Record<string, PerpMarketConfig> = {
  [SOL_PERP_MARKET_PDA.toBase58()]: {
    symbol: 'SOL-PERP',
    underlyingMint: new PublicKey('So11111111111111111111111111111111111111112'),
    quoteMint: new PublicKey(USDC_DEVNET),
    oracleFeed: PYTH_SOL_USD_FEED,
    maxLeverage: 20,
    maintenanceMarginBps: 500, // 5%
    tickSize: 0.01,
  },
};

/**
 * Get market symbol from market PDA address
 * Returns 'UNKNOWN' if market not found in registry
 */
export function getMarketSymbol(marketPda: PublicKey | string): string {
  const key = typeof marketPda === 'string' ? marketPda : marketPda.toBase58();
  return PERP_MARKET_REGISTRY[key]?.symbol ?? 'UNKNOWN';
}

/**
 * Get full market config from market PDA address
 * Returns null if market not found in registry
 */
export function getMarketConfig(marketPda: PublicKey | string): PerpMarketConfig | null {
  const key = typeof marketPda === 'string' ? marketPda : marketPda.toBase58();
  return PERP_MARKET_REGISTRY[key] ?? null;
}

// Arcium Program (for MPC)
export const ARCIUM_PROGRAM_ID = new PublicKey(
  'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ'
);

// Arcium Cluster Configuration (devnet)
// Cluster 123: v0.5.4 (available)
// Cluster 456: v0.6.3 (recommended)
// Recovery set size: 4 nodes (required for devnet)
// Reference: https://docs.arcium.com/developers/deployment
export const ARCIUM_CLUSTER_OFFSET = parseInt(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || '456',
  10
);

// Inco Lightning (TEE-based confidential computing)
// Program ID for devnet - see https://docs.inco.org/svm
export const INCO_PROGRAM_ID = new PublicKey(
  '5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj'
);
export const INCO_ENABLED = process.env.NEXT_PUBLIC_INCO_ENABLED === 'true';

// Encryption provider selection
// Priority: env override > Arcium SDK > Inco (if enabled) > demo mode
export type EncryptionProvider = 'arcium' | 'inco' | 'demo';

// Preferred provider type for user settings
export type PreferredProvider = 'auto' | 'arcium' | 'inco';

// Environment variable overrides for encryption providers
// These take precedence over user settings when set

/**
 * Force a specific encryption provider (admin emergency switch)
 * When set, overrides all user settings and auto-selection logic
 */
export const ENV_FORCE_PROVIDER =
  process.env.NEXT_PUBLIC_FORCE_ENCRYPTION_PROVIDER as EncryptionProvider | undefined;

/**
 * Default preferred provider from environment
 * Used as initial value if user hasn't set preference
 */
export const ENV_PREFERRED_PROVIDER =
  (process.env.NEXT_PUBLIC_PREFERRED_ENCRYPTION_PROVIDER as PreferredProvider) || undefined;

/**
 * Enable/disable Arcium MPC from environment (default: true)
 * Set to 'false' to completely disable Arcium
 */
export const ENV_ARCIUM_ENABLED =
  process.env.NEXT_PUBLIC_ARCIUM_ENABLED !== 'false';

/**
 * Enable/disable auto-fallback from environment (default: true)
 * When false, system won't switch providers if preferred is unavailable
 */
export const ENV_AUTO_FALLBACK_ENABLED =
  process.env.NEXT_PUBLIC_AUTO_FALLBACK_ENABLED !== 'false';

// Light Protocol ZK Compression
// Enables rent-free token accounts via state compression
// See: https://www.zkcompression.com
export const LIGHT_PROTOCOL_ENABLED =
  process.env.NEXT_PUBLIC_LIGHT_PROTOCOL_ENABLED !== 'false';

// Light Protocol program IDs (mainnet/devnet)
export const LIGHT_COMPRESSED_TOKEN_PROGRAM = new PublicKey(
  'cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m'
);
export const LIGHT_ACCOUNT_COMPRESSION_PROGRAM = new PublicKey(
  'CbjvJc1SNx1aav8tU49dJGHu8EUdzQJSMtkjDmV8miqK'
);
export const LIGHT_SYSTEM_PROGRAM = new PublicKey(
  'SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7'
);

// Rent savings: ~0.00203928 SOL per regular token account
// Compressed accounts cost ~0.000005 SOL (400x cheaper)
export const REGULAR_TOKEN_ACCOUNT_RENT_LAMPORTS = BigInt(2039280);
export const COMPRESSED_ACCOUNT_COST_LAMPORTS = BigInt(5000);

// =============================================================================
// Streaming Infrastructure (WebSocket)
// =============================================================================

/**
 * Backend API URL for REST endpoints and WebSocket connection
 * WebSocket connects to this URL with /ws path
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * WebSocket path (relative to API_URL)
 */
export const WS_PATH = '/ws';

/**
 * Whether streaming is enabled
 * When false, the app uses polling-only mode
 */
export const STREAMING_ENABLED = process.env.NEXT_PUBLIC_STREAMING_ENABLED !== 'false';

/**
 * WebSocket reconnection settings
 */
export const WS_RECONNECT_ATTEMPTS = 5;
export const WS_RECONNECT_DELAY_MS = 1000;
