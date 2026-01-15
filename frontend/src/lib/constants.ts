import { PublicKey } from '@solana/web3.js';

// Program IDs (devnet)
export const CONFIDEX_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);

export const MXE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_MXE_PROGRAM_ID ||
    'CKRX2k2Fsa3t2yYUxtr8Gy5D9poW2ut3wKCyLUc51SgX'
);

// Verifier program (placeholder until deployed)
export const VERIFIER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VERIFIER_PROGRAM_ID ||
    '11111111111111111111111111111111'
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
    baseMint: '11111111111111111111111111111111', // Native SOL wrapped
    quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC devnet
    minOrderSize: 0.1,
    tickSize: 0.01,
    active: true,
  },
];

// Fee configuration
export const MAKER_FEE_BPS = 10; // 0.10%
export const TAKER_FEE_BPS = 30; // 0.30%
export const SHADOWWIRE_FEE_BPS = 100; // 1%

// Encryption settings
export const ENCRYPTED_VALUE_SIZE = 64;
export const GROTH16_PROOF_SIZE = 388;
