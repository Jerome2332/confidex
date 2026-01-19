import { PublicKey } from '@solana/web3.js';

// Program IDs (devnet)
export const CONFIDEX_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);

export const MXE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_MXE_PROGRAM_ID ||
    'CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE'
);

// ZK Eligibility Verifier (deployed via Sunspot)
// Rebuilt on Jan 17 2026 with updated verification key
export const VERIFIER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VERIFIER_PROGRAM_ID ||
    '9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W'
);

// RPC endpoints
export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

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

// Arcium Program (for MPC)
export const ARCIUM_PROGRAM_ID = new PublicKey(
  'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ'
);
