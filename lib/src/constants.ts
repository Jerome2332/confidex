import { PublicKey } from '@solana/web3.js';

// =============================================================================
// PROGRAM IDs - Source of Truth for All Layers (Rust, Frontend, Backend)
// =============================================================================
// Update these values when programs are redeployed.
// All other files should import from this module.

export const CONFIDEX_PROGRAM_ID = new PublicKey(
  '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);

// Full Arcium MXE deployed via `arcium deploy` - production MPC (Jan 22, 2026)
export const MXE_PROGRAM_ID = new PublicKey(
  '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi'
);

// Eligibility verifier program (Sunspot Groth16)
export const VERIFIER_PROGRAM_ID = new PublicKey(
  '9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W'
);

// Core Arcium program (official)
export const ARCIUM_PROGRAM_ID = new PublicKey(
  'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ'
);

// Inco Lightning program (optional TEE-based alternative)
export const INCO_PROGRAM_ID = new PublicKey(
  '5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj'
);

// String versions for environments that can't use PublicKey
export const PROGRAM_ID_STRINGS = {
  CONFIDEX_DEX: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
  ARCIUM_MXE: '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi',
  ARCIUM_CORE: 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ',
  VERIFIER: '9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W',
  INCO: '5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj',
} as const;

// =============================================================================
// ARCIUM CLUSTER CONFIGURATION
// =============================================================================
// NOTE: Cluster 123 does NOT exist on devnet (Jan 2026)
// Valid clusters: 456 (v0.6.3), 789 (v0.5.1 backup)
// Recovery set size on cluster 456: 4 nodes

export const DEFAULT_ARCIUM_CLUSTER_OFFSET = 456;

export const ARCIUM_CLUSTERS = {
  // CLUSTER_123 DOES NOT EXIST - removed to prevent accidental use
  CLUSTER_456: 456 as const, // Primary devnet cluster (v0.6.3)
  CLUSTER_789: 789 as const, // Backup devnet cluster (v0.5.1)
};

// =============================================================================
// PDA SEEDS - Canonical Seeds for All PDA Derivations
// =============================================================================

export const PDA_SEEDS = {
  EXCHANGE: Buffer.from('exchange'),
  PAIR: Buffer.from('pair'),
  ORDER: Buffer.from('order'),
  USER_BALANCE: Buffer.from('user_balance'),
  TRADER_ELIGIBILITY: Buffer.from('trader_eligibility'),
  MPC_REQUEST: Buffer.from('mpc_request'),
  COMPUTATION: Buffer.from('computation'),
  MXE_CONFIG: Buffer.from('mxe_config'),
  MXE_AUTHORITY: Buffer.from('mxe_authority'),
  POSITION: Buffer.from('position'),
  PERP_MARKET: Buffer.from('perp_market'),
  FUNDING: Buffer.from('funding'),
  VAULT: Buffer.from('vault'),
} as const;

// =============================================================================
// INSTRUCTION DISCRIMINATORS
// =============================================================================
// Pre-computed sha256("global:<instruction_name>")[0..8]
// These MUST match the Anchor-generated discriminators in the Rust program.

export const DISCRIMINATORS = {
  // Spot trading
  PLACE_ORDER: new Uint8Array([0x33, 0xc2, 0x9b, 0xaf, 0x6d, 0x82, 0x60, 0x6a]),
  MATCH_ORDERS: new Uint8Array([0x11, 0x01, 0xc9, 0x5d, 0x07, 0x33, 0xfb, 0x86]),
  CANCEL_ORDER: new Uint8Array([0x5f, 0x81, 0xed, 0xf0, 0x08, 0x31, 0xdf, 0x84]),
  SETTLE_ORDER: new Uint8Array([0x50, 0x4a, 0xcc, 0x22, 0x0c, 0xb7, 0x42, 0x42]),

  // Token wrapping
  WRAP_TOKENS: new Uint8Array([0xf4, 0x89, 0x39, 0xfb, 0xe8, 0xe0, 0x36, 0x0e]),
  UNWRAP_TOKENS: new Uint8Array([0x11, 0x79, 0x03, 0xfa, 0x43, 0x69, 0xe8, 0x71]),

  // Perpetuals
  OPEN_POSITION: new Uint8Array([0x7b, 0x86, 0x51, 0x00, 0x31, 0x44, 0x62, 0x62]),
  CLOSE_POSITION: new Uint8Array([0x7b, 0x86, 0x51, 0x00, 0x31, 0x44, 0x62, 0x62]),
  VERIFY_ELIGIBILITY: new Uint8Array([0x9a, 0x8b, 0x7c, 0x6d, 0x5e, 0x4f, 0x30, 0x21]),
} as const;

// =============================================================================
// TOKEN MINTS (Devnet)
// =============================================================================

export const TOKEN_MINTS = {
  WSOL: new PublicKey('So11111111111111111111111111111111111111112'),
  // Dummy USDC for devnet testing (unlimited supply)
  USDC_DEVNET: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'),
  // Circle USDC devnet (limited supply)
  USDC_CIRCLE_DEVNET: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
  // Mainnet USDC
  USDC_MAINNET: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
} as const;

export const TOKEN_MINT_STRINGS = {
  WSOL: 'So11111111111111111111111111111111111111112',
  USDC_DEVNET: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
  USDC_CIRCLE_DEVNET: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  USDC_MAINNET: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
} as const;

// =============================================================================
// CRYPTOGRAPHIC CONSTANTS
// =============================================================================

export const ENCRYPTED_VALUE_SIZE = 64; // bytes (V2 pure ciphertext format)
export const GROTH16_PROOF_SIZE = 388; // bytes
export const MERKLE_TREE_DEPTH = 20;
export const X25519_PUBKEY_SIZE = 32; // bytes

// =============================================================================
// FEE CONFIGURATION
// =============================================================================

export const MAX_FEE_BPS = 10000; // 100%
export const DEFAULT_MAKER_FEE_BPS = 10; // 0.10%
export const DEFAULT_TAKER_FEE_BPS = 30; // 0.30%

// =============================================================================
// MXE ENCRYPTION KEY (Production)
// =============================================================================
// X25519 public key from deployed MXE (keygen completed Jan 26, 2026 on cluster 456)
export const MXE_X25519_PUBKEY = '113364f169338f3fa0d1e76bf2ba71d40aff857dd5f707f1ea2abdaf52e2d06c';
