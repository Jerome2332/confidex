import { createHash } from 'crypto';

// Empty blacklist root (Poseidon hash of empty tree)
// This is the default when no addresses are blacklisted
const EMPTY_BLACKLIST_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Blacklist tree depth (matches circuit)
const TREE_DEPTH = 8;

/**
 * Fetch the current blacklist Merkle root
 * For now, returns empty root (no blacklist)
 * In production, this would query on-chain or a database
 */
export async function fetchBlacklistRoot(): Promise<string> {
  // TODO: Query actual blacklist root from on-chain verifier program
  // For now, use empty root (all addresses eligible)
  return EMPTY_BLACKLIST_ROOT;
}

/**
 * Generate Merkle proof for an address
 * Returns path proving address is NOT in the blacklist
 */
export async function getMerkleProof(
  address: string,
  root: string
): Promise<{
  isEligible: boolean;
  path: string[];
  indices: number[];
}> {
  // With empty blacklist, all addresses are eligible
  // Generate a valid empty tree proof

  if (root === EMPTY_BLACKLIST_ROOT) {
    // Empty tree - generate proof of non-membership
    const emptyPath: string[] = [];
    const emptyIndices: number[] = [];

    // Generate zero hashes for each level
    let currentHash = EMPTY_BLACKLIST_ROOT;
    for (let i = 0; i < TREE_DEPTH; i++) {
      emptyPath.push(currentHash);
      emptyIndices.push(0); // All left branches in empty tree

      // Next level hash
      currentHash = hashPair(currentHash, currentHash);
    }

    return {
      isEligible: true,
      path: emptyPath,
      indices: emptyIndices,
    };
  }

  // TODO: Implement actual blacklist lookup
  // For now, all addresses are eligible
  return {
    isEligible: true,
    path: Array(TREE_DEPTH).fill(EMPTY_BLACKLIST_ROOT),
    indices: Array(TREE_DEPTH).fill(0),
  };
}

/**
 * Check if an address is blacklisted
 */
export async function isAddressBlacklisted(address: string): Promise<boolean> {
  // TODO: Check actual blacklist
  // For now, no addresses are blacklisted
  return false;
}

/**
 * Simple hash pair function (placeholder for Poseidon)
 */
function hashPair(left: string, right: string): string {
  const hash = createHash('sha256')
    .update(left)
    .update(right)
    .digest('hex');
  return `0x${hash}`;
}
