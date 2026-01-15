import { Connection, PublicKey } from '@solana/web3.js';

// Exchange program ID
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'FWkEu3vnS2ctMUU3BRBnkAQAqK7PhW8HtwnS5AR2tjGr'
);

// RPC connection
const connection = new Connection(
  process.env.RPC_URL || 'https://api.devnet.solana.com',
  'confirmed'
);

// Tree depth for SMT
const TREE_DEPTH = 20;

// In-memory blacklist for development
// In production, this would be stored in a database or fetched from IPFS
const blacklistSet = new Set<string>([
  // Example blacklisted addresses (for testing)
  // 'BlacklistedAddress111111111111111111111111111',
]);

/**
 * Fetch the current blacklist merkle root from on-chain
 */
export async function fetchBlacklistRoot(): Promise<string> {
  try {
    // Derive ExchangeState PDA
    const [exchangeStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('exchange')],
      PROGRAM_ID
    );

    // Fetch account data
    const accountInfo = await connection.getAccountInfo(exchangeStatePda);

    if (!accountInfo) {
      console.warn('ExchangeState not found, using empty root');
      return '0x' + '00'.repeat(32);
    }

    // Parse blacklist_root from account data
    // ExchangeState layout:
    // - discriminator: 8 bytes
    // - authority: 32 bytes
    // - fee_recipient: 32 bytes
    // - maker_fee_bps: 2 bytes
    // - taker_fee_bps: 2 bytes
    // - paused: 1 byte
    // - blacklist_root: 32 bytes (offset 77)

    const blacklistRootOffset = 8 + 32 + 32 + 2 + 2 + 1;
    const blacklistRoot = accountInfo.data.slice(
      blacklistRootOffset,
      blacklistRootOffset + 32
    );

    return '0x' + Buffer.from(blacklistRoot).toString('hex');
  } catch (error) {
    console.error('Failed to fetch blacklist root:', error);
    // Return empty root on error
    return '0x' + '00'.repeat(32);
  }
}

/**
 * Get merkle proof for an address
 * Returns the sibling hashes and path indices for SMT verification
 */
export async function getMerkleProof(
  address: string,
  _blacklistRoot: string
): Promise<{
  isEligible: boolean;
  path: string[];
  indices: number[];
}> {
  // Check if address is blacklisted
  const isBlacklisted = blacklistSet.has(address);

  if (isBlacklisted) {
    return {
      isEligible: false,
      path: [],
      indices: [],
    };
  }

  // Generate merkle proof for non-membership
  // For an empty or sparse tree, most proofs are paths to empty leaves

  // Compute path indices from address hash
  const addressHash = hashAddress(address);
  const indices = computePathIndices(addressHash);

  // Get sibling hashes along the path
  const path = await getSiblingHashes(address, indices);

  return {
    isEligible: true,
    path,
    indices,
  };
}

/**
 * Hash an address to determine its position in the SMT
 */
function hashAddress(address: string): Buffer {
  const crypto = require('crypto');
  // Use SHA256 for simplicity; in circuit we use Poseidon
  // The position derivation just needs to be consistent
  return crypto.createHash('sha256').update(address).digest();
}

/**
 * Compute path indices (0=left, 1=right) from address hash
 */
function computePathIndices(addressHash: Buffer): number[] {
  const indices: number[] = [];

  for (let i = 0; i < TREE_DEPTH; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const bit = (addressHash[byteIndex] >> bitIndex) & 1;
    indices.push(bit);
  }

  return indices;
}

/**
 * Get sibling hashes for the merkle path
 * For an empty tree, all siblings are empty subtree roots
 */
async function getSiblingHashes(
  _address: string,
  _indices: number[]
): Promise<string[]> {
  // For an empty tree, compute empty subtree roots at each level
  const emptySubtreeRoots = computeEmptySubtreeRoots();

  // In a real implementation, we'd query the actual tree
  // For now, return empty subtree siblings (valid for empty tree)
  return emptySubtreeRoots.map((root) => '0x' + root.toString('hex'));
}

/**
 * Compute empty subtree roots for each level
 * Level 0: hash of empty leaf (0)
 * Level n: hash(level_{n-1}, level_{n-1})
 */
function computeEmptySubtreeRoots(): Buffer[] {
  const crypto = require('crypto');
  const roots: Buffer[] = [];

  // Start with empty leaf
  let current = Buffer.alloc(32, 0);

  for (let i = 0; i < TREE_DEPTH; i++) {
    roots.push(current);

    // Compute next level: H(current, current)
    // Using SHA256 for simplicity; circuit uses Poseidon
    current = crypto.createHash('sha256')
      .update(Buffer.concat([current, current]))
      .digest();
  }

  return roots;
}

/**
 * Add an address to the blacklist
 * In production, this would update the on-chain merkle tree
 */
export async function addToBlacklist(address: string): Promise<void> {
  blacklistSet.add(address);
  console.log(`Added ${address} to blacklist`);
}

/**
 * Remove an address from the blacklist
 */
export async function removeFromBlacklist(address: string): Promise<void> {
  blacklistSet.delete(address);
  console.log(`Removed ${address} from blacklist`);
}

/**
 * Check if an address is blacklisted
 */
export function isBlacklisted(address: string): boolean {
  return blacklistSet.has(address);
}
