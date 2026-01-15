import { PublicKey } from '@solana/web3.js';

// Program IDs (devnet)
export const CONFIDEX_PROGRAM_ID = new PublicKey(
  '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);

export const MXE_PROGRAM_ID = new PublicKey(
  'CKRX2k2Fsa3t2yYUxtr8Gy5D9poW2ut3wKCyLUc51SgX'
);

// Placeholder - set after deploying verifier
export const VERIFIER_PROGRAM_ID = new PublicKey(
  '11111111111111111111111111111111'
);

// Arcium devnet clusters (offsets: 123, 456, 789)
export const ARCIUM_CLUSTERS = {
  CLUSTER_123: new PublicKey('11111111111111111111111111111111'), // Placeholder
  CLUSTER_456: new PublicKey('11111111111111111111111111111111'),
  CLUSTER_789: new PublicKey('11111111111111111111111111111111'),
};

// Encrypted value sizes
export const ENCRYPTED_VALUE_SIZE = 64; // bytes
export const GROTH16_PROOF_SIZE = 388; // bytes
export const MERKLE_TREE_DEPTH = 20;

// Fee limits (basis points)
export const MAX_FEE_BPS = 10000; // 100%
export const DEFAULT_MAKER_FEE_BPS = 10; // 0.10%
export const DEFAULT_TAKER_FEE_BPS = 30; // 0.30%
