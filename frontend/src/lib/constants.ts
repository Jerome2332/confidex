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
export const VERIFIER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VERIFIER_PROGRAM_ID ||
    '6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF'
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
export const SOL_USDC_PAIR_PDA = '37LAjGxjZz196xNrYFX4NsCyxVY2bS3X5imypA2AX9Wx';

// Fee configuration
export const MAKER_FEE_BPS = 10; // 0.10%
export const TAKER_FEE_BPS = 30; // 0.30%
export const SHADOWWIRE_FEE_BPS = 100; // 1%

// Encryption settings
export const ENCRYPTED_VALUE_SIZE = 64;
export const GROTH16_PROOF_SIZE = 388;

// PNP Prediction Markets
export const PNP_API_URL =
  process.env.NEXT_PUBLIC_PNP_API_URL || 'https://api.pnp.exchange';
export const PNP_USE_SDK = process.env.NEXT_PUBLIC_PNP_USE_SDK !== 'false';

// Settlement layer feature flags
export const CSPL_ENABLED = false; // Flip to true when C-SPL SDK releases
export const SHADOWWIRE_ENABLED = true; // Production-ready
