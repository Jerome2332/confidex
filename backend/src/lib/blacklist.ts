import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';
import { proofCache } from './prover.js';
import { poseidon2Hash as computePoseidon2Hash } from './poseidon2.js';

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Exchange program ID
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);

// RPC connection
const connection = new Connection(
  process.env.RPC_URL || 'https://api.devnet.solana.com',
  'confirmed'
);

// Tree depth for SMT (matches circuit)
const TREE_DEPTH = 20;

// Storage path for blacklist data
const STORAGE_DIR = join(dirname(dirname(dirname(__dirname))), 'data');
const BLACKLIST_FILE = join(STORAGE_DIR, 'blacklist.json');

// Pre-computed empty tree hashes using Poseidon2
// These MUST match the circuit's hash function output
// Computed via: nargo test print_empty_tree_values --show-output
const POSEIDON2_EMPTY_SUBTREE_ROOTS: bigint[] = [
  0x0000000000000000000000000000000000000000000000000000000000000000n, // Level 0: empty leaf
  0x18dfb8dc9b82229cff974efefc8df78b1ce96d9d844236b496785c698bc6732en, // Level 1: H(0, 0)
  0x2c0d184fc7a25c124a27a67b2c46220b039b1a5072c3b693a18ffee458f6425dn, // Level 2
  0x268b2b93ac5fe540e618a378b8a71b8f2407232744d71e501ce8699980b306e5n, // Level 3
  0x2d436f654e14cc4febcafdf4a753b149dd8c88a75df9e5d6707e83a853b5f791n, // Level 4
  0x0b66fdef5a7f00f6fb45d1498b4d7131218e69ccf0a2751b6a1fb1bcd982867dn, // Level 5
  0x1d542b476c671bb6f0d2ab2939335d7cbad03476f1e3bcba70973b1adfe88b91n, // Level 6
  0x0680c6388c5798caf80642a1e84316b8b2f7caa99da076f3057d2962a46c5358n, // Level 7
  0x03c53ce5296e3e895171f89aa09f84214e3fb0755fe7a423b87888e4b3d731b8n, // Level 8
  0x2dd4e2510b33275359bba6edf72e6bdacad259950b024b2cc19d63c3a5b761dfn, // Level 9
  0x11cb221f69d954d521fb5393767e77fe4d14133757a706b318e62fa984f98157n, // Level 10
  0x039d78bac8f890788eefe39af15eee5825056648f99210054fd03c25213f4de7n, // Level 11
  0x0c55b828a83062a77d2b3e0a66bbb50cb6040990d9f368da8b24c0e82b692349n, // Level 12
  0x24c866ac88715851268d808487e20e6986084fc222d7188e2a8e0f5b9f8457efn, // Level 13
  0x0f6a94e437b9dfb35cdedf41e2e154c3ae449b7c04c13add0996a7b53cde5400n, // Level 14
  0x22afe7696b87cb782742e2d3ecb0f749a9beefbbb2159d178b09000e55b22cabn, // Level 15
  0x121b01164d32e9ab841ba8f5602b0ec58b576e62552c96911d4d988d49468cddn, // Level 16
  0x05f3810707b1336c953b7db191215dab2b5772f93025aa345b954b43135b627bn, // Level 17
  0x287515b2d5975c74e3fd85a20d68611a463ffe605a1c54d8140ab16d1b77f57bn, // Level 18
  0x276ff13fde3afa1adb26149ddc3aa67240d603b6a91da5e494c8e58706381a38n, // Level 19
];

// Empty tree root (Poseidon2)
const EMPTY_TREE_ROOT = 0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387n;

/**
 * Convert a field element to hex string (0x prefixed, 64 chars)
 */
function fieldToHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Convert hex string to bigint field element
 */
function hexToField(hex: string): bigint {
  return BigInt(hex);
}

/**
 * Compute address leaf position in the SMT
 * Uses first 20 bits of keccak256(address) as index
 */
function computeAddressIndex(address: string): bigint {
  // Use the first 20 bits of the address bytes as the index
  // For Solana addresses, decode from base58 and use bytes
  const bytes = bs58.decode(address);

  // Take first 3 bytes (24 bits) and mask to 20 bits
  let index = 0n;
  for (let i = 0; i < 3 && i < bytes.length; i++) {
    index = (index << 8n) | BigInt(bytes[i]);
  }
  // Mask to TREE_DEPTH bits
  return index & ((1n << BigInt(TREE_DEPTH)) - 1n);
}

/**
 * Poseidon2 hash using the real implementation that matches Noir's stdlib
 */
function poseidon2Hash(left: bigint, right: bigint): bigint {
  return computePoseidon2Hash(left, right);
}

/**
 * Blacklist storage format
 */
interface BlacklistStorage {
  addresses: string[];
  merkleRoot: string;
  lastUpdated: string;
  version: number;
}

/**
 * Sparse Merkle Tree for blacklist management
 *
 * This implementation uses proper Poseidon2 hashing that matches Noir's stdlib.
 * It maintains a full in-memory tree structure for efficient proof generation.
 *
 * Key properties:
 * - Tree depth: 20 levels (supports ~1M addresses)
 * - Hash function: Poseidon2 over BN254
 * - Empty leaf: 0
 * - Leaf value for blacklisted address: 1 (non-zero marks presence)
 */
class SparseMerkleTree {
  private root: bigint;
  private addresses: Set<string>;

  // Cache of (index -> Set<address>) for addresses at each leaf position
  // Multiple addresses can map to the same index (collision handling)
  private leafAddresses: Map<bigint, Set<string>>;

  // Cache of computed subtree hashes
  // Key format: "level:index" where index is the node's position at that level
  private subtreeCache: Map<string, bigint>;

  constructor() {
    this.root = EMPTY_TREE_ROOT;
    this.addresses = new Set();
    this.leafAddresses = new Map();
    this.subtreeCache = new Map();
  }

  /**
   * Get current merkle root
   */
  getRoot(): bigint {
    return this.root;
  }

  /**
   * Get all blacklisted addresses
   */
  getAddresses(): string[] {
    return Array.from(this.addresses);
  }

  /**
   * Check if address is blacklisted
   */
  has(address: string): boolean {
    return this.addresses.has(address);
  }

  /**
   * Add address to blacklist
   */
  add(address: string): void {
    if (this.addresses.has(address)) return;

    this.addresses.add(address);
    const index = computeAddressIndex(address);

    // Track address at this leaf index (handles collisions)
    if (!this.leafAddresses.has(index)) {
      this.leafAddresses.set(index, new Set());
    }
    this.leafAddresses.get(index)!.add(address);

    this.recomputeRoot();
  }

  /**
   * Remove address from blacklist
   */
  remove(address: string): void {
    if (!this.addresses.has(address)) return;

    this.addresses.delete(address);
    const index = computeAddressIndex(address);

    // Remove address from leaf index tracking
    const addrSet = this.leafAddresses.get(index);
    if (addrSet) {
      addrSet.delete(address);
      // Only clear leaf if no more addresses at this index
      if (addrSet.size === 0) {
        this.leafAddresses.delete(index);
      }
    }

    this.recomputeRoot();
  }

  /**
   * Recompute the merkle root from scratch
   * Uses bottom-up computation with caching for efficiency
   */
  private recomputeRoot(): void {
    const oldRoot = this.root;

    // Clear cache for fresh computation
    this.subtreeCache.clear();

    if (this.addresses.size === 0) {
      this.root = EMPTY_TREE_ROOT;
    } else {
      // Compute root by traversing from leaves to root
      this.root = this.computeSubtreeHash(TREE_DEPTH, 0n);
    }

    // Invalidate cached proofs when root changes
    if (oldRoot !== this.root) {
      const invalidated = proofCache.invalidateByRoot(fieldToHex(oldRoot));
      if (invalidated > 0) {
        console.log(`[blacklist] Invalidated ${invalidated} cached proofs for old root`);
      }
    }
  }

  /**
   * Compute the hash of a subtree rooted at (level, nodeIndex)
   * level 0 = leaf level, level TREE_DEPTH = root
   * nodeIndex is the position of this node at its level (0 to 2^(TREE_DEPTH-level) - 1)
   */
  private computeSubtreeHash(level: number, nodeIndex: bigint): bigint {
    // Check cache first
    const cacheKey = `${level}:${nodeIndex}`;
    const cached = this.subtreeCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let hash: bigint;

    if (level === 0) {
      // Leaf level - return 1 if any address is at this index, 0 otherwise
      hash = this.leafAddresses.has(nodeIndex) ? 1n : 0n;
    } else {
      // Internal node - compute from children
      const leftChildIndex = nodeIndex * 2n;
      const rightChildIndex = nodeIndex * 2n + 1n;

      const leftHash = this.computeSubtreeHash(level - 1, leftChildIndex);
      const rightHash = this.computeSubtreeHash(level - 1, rightChildIndex);

      // Optimization: if both children are empty subtrees, use pre-computed value
      if (leftHash === POSEIDON2_EMPTY_SUBTREE_ROOTS[level - 1] &&
          rightHash === POSEIDON2_EMPTY_SUBTREE_ROOTS[level - 1]) {
        hash = POSEIDON2_EMPTY_SUBTREE_ROOTS[level];
      } else {
        hash = poseidon2Hash(leftHash, rightHash);
      }
    }

    this.subtreeCache.set(cacheKey, hash);
    return hash;
  }

  /**
   * Get the hash of a subtree that may or may not contain blacklisted addresses
   * This is used when computing sibling hashes for proofs
   */
  private getSubtreeHash(level: number, nodeIndex: bigint): bigint {
    // Check if any blacklisted address falls within this subtree
    const subtreeStartLeaf = nodeIndex * (1n << BigInt(level));
    const subtreeEndLeaf = subtreeStartLeaf + (1n << BigInt(level));

    let hasBlacklistedInSubtree = false;
    for (const [leafIndex] of this.leafAddresses) {
      if (leafIndex >= subtreeStartLeaf && leafIndex < subtreeEndLeaf) {
        hasBlacklistedInSubtree = true;
        break;
      }
    }

    if (!hasBlacklistedInSubtree) {
      // No blacklisted addresses in this subtree, use empty subtree root
      return POSEIDON2_EMPTY_SUBTREE_ROOTS[level];
    }

    // Need to compute actual subtree hash
    return this.computeSubtreeHash(level, nodeIndex);
  }

  /**
   * Generate non-membership proof for an address
   * Returns sibling path and indices for circuit verification
   */
  generateNonMembershipProof(address: string): {
    isEligible: boolean;
    path: string[];
    indices: number[];
  } {
    // If address is blacklisted, it's not eligible
    if (this.addresses.has(address)) {
      return {
        isEligible: false,
        path: [],
        indices: [],
      };
    }

    const index = computeAddressIndex(address);
    const path: string[] = [];
    const indices: number[] = [];

    // For an empty tree (no blacklisted addresses), the proof is straightforward
    if (this.addresses.size === 0) {
      for (let level = 0; level < TREE_DEPTH; level++) {
        const bit = (index >> BigInt(level)) & 1n;
        indices.push(Number(bit));
        path.push(fieldToHex(POSEIDON2_EMPTY_SUBTREE_ROOTS[level]));
      }
      return {
        isEligible: true,
        path,
        indices,
      };
    }

    // For a non-empty tree, compute the sibling path
    // We walk from leaf to root, collecting sibling hashes at each level
    let currentNodeIndex = index;

    for (let level = 0; level < TREE_DEPTH; level++) {
      // Determine if we're a left or right child
      const isRight = (currentNodeIndex & 1n) === 1n;
      indices.push(isRight ? 1 : 0);

      // Get sibling's node index at this level
      const siblingNodeIndex = isRight ? currentNodeIndex - 1n : currentNodeIndex + 1n;

      // Get sibling's subtree hash
      const siblingHash = this.getSubtreeHash(level, siblingNodeIndex);
      path.push(fieldToHex(siblingHash));

      // Move to parent level
      currentNodeIndex = currentNodeIndex >> 1n;
    }

    return {
      isEligible: true,
      path,
      indices,
    };
  }

  /**
   * Verify that a proof is valid
   * This recomputes the root from the proof and compares with stored root
   */
  verifyProof(address: string, path: string[], indices: number[]): boolean {
    if (path.length !== TREE_DEPTH || indices.length !== TREE_DEPTH) {
      return false;
    }

    const index = computeAddressIndex(address);

    // For non-membership proof, the leaf should be empty (0)
    let current = 0n;

    for (let level = 0; level < TREE_DEPTH; level++) {
      const sibling = hexToField(path[level]);
      const isRight = indices[level] === 1;

      // Verify the index bit matches the path direction
      const expectedBit = (index >> BigInt(level)) & 1n;
      if ((isRight ? 1n : 0n) !== expectedBit) {
        return false;
      }

      // Compute parent hash
      const [left, right] = isRight ? [sibling, current] : [current, sibling];
      current = poseidon2Hash(left, right);
    }

    return current === this.root;
  }

  /**
   * Load from storage
   */
  static async load(): Promise<SparseMerkleTree> {
    const tree = new SparseMerkleTree();

    try {
      if (existsSync(BLACKLIST_FILE)) {
        const data = await readFile(BLACKLIST_FILE, 'utf-8');
        const storage: BlacklistStorage = JSON.parse(data);

        // Add all addresses (this will compute indices and recompute root)
        for (const addr of storage.addresses) {
          tree.addresses.add(addr);
          const index = computeAddressIndex(addr);
          // Track address at this leaf index (handles collisions)
          if (!tree.leafAddresses.has(index)) {
            tree.leafAddresses.set(index, new Set());
          }
          tree.leafAddresses.get(index)!.add(addr);
        }

        // Recompute root (don't trust stored root, compute fresh)
        if (tree.addresses.size > 0) {
          tree.subtreeCache.clear();
          tree.root = tree.computeSubtreeHash(TREE_DEPTH, 0n);
        }

        console.log(`[blacklist] Loaded ${tree.addresses.size} blacklisted addresses from storage`);
        console.log(`[blacklist] Computed merkle root: ${fieldToHex(tree.root)}`);

        // Warn if stored root differs (indicates potential inconsistency)
        if (storage.merkleRoot && hexToField(storage.merkleRoot) !== tree.root) {
          console.warn(`[blacklist] Stored root differs from computed root, using computed`);
        }
      }
    } catch (error) {
      console.warn('[blacklist] Failed to load blacklist from storage:', error);
    }

    return tree;
  }

  /**
   * Save to storage
   */
  async save(): Promise<void> {
    const storage: BlacklistStorage = {
      addresses: Array.from(this.addresses),
      merkleRoot: fieldToHex(this.root),
      lastUpdated: new Date().toISOString(),
      version: 1,
    };

    try {
      await mkdir(STORAGE_DIR, { recursive: true });
      await writeFile(BLACKLIST_FILE, JSON.stringify(storage, null, 2));
      console.log(`[blacklist] Saved ${this.addresses.size} blacklisted addresses to storage`);
    } catch (error) {
      console.error('[blacklist] Failed to save blacklist to storage:', error);
      throw error;
    }
  }
}

// Singleton instance
let smtInstance: SparseMerkleTree | null = null;

/**
 * Get the SMT instance (singleton)
 */
async function getSMT(): Promise<SparseMerkleTree> {
  if (!smtInstance) {
    smtInstance = await SparseMerkleTree.load();
  }
  return smtInstance;
}

/**
 * Reset the SMT singleton (for testing only)
 * This clears the in-memory instance, forcing a fresh load on next access
 */
export function _resetSMTForTesting(): void {
  smtInstance = null;
}

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
      console.warn('ExchangeState not found, using empty tree root');
      return fieldToHex(EMPTY_TREE_ROOT);
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

    // Check if it's all zeros (uninitialized)
    const isZero = blacklistRoot.every((b: number) => b === 0);
    if (isZero) {
      console.log('On-chain blacklist root is empty, using computed empty tree root');
      return fieldToHex(EMPTY_TREE_ROOT);
    }

    return '0x' + Buffer.from(blacklistRoot).toString('hex');
  } catch (error) {
    console.error('Failed to fetch blacklist root:', error);
    // Return empty tree root on error
    return fieldToHex(EMPTY_TREE_ROOT);
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
  const smt = await getSMT();
  return smt.generateNonMembershipProof(address);
}

/**
 * Get the empty tree root (useful for initialization)
 */
export function getEmptyTreeRoot(): string {
  return fieldToHex(EMPTY_TREE_ROOT);
}

/**
 * Get the current local merkle root
 */
export async function getMerkleRoot(): Promise<string> {
  const smt = await getSMT();
  return fieldToHex(smt.getRoot());
}

/**
 * Add an address to the blacklist
 * Updates local storage, returns new merkle root
 */
export async function addToBlacklist(address: string): Promise<string> {
  const smt = await getSMT();
  smt.add(address);
  await smt.save();
  console.log(`Added ${address} to blacklist`);
  return fieldToHex(smt.getRoot());
}

/**
 * Remove an address from the blacklist
 * Updates local storage, returns new merkle root
 */
export async function removeFromBlacklist(address: string): Promise<string> {
  const smt = await getSMT();
  smt.remove(address);
  await smt.save();
  console.log(`Removed ${address} from blacklist`);
  return fieldToHex(smt.getRoot());
}

/**
 * Check if an address is blacklisted
 */
export async function isBlacklisted(address: string): Promise<boolean> {
  const smt = await getSMT();
  return smt.has(address);
}

/**
 * Get all blacklisted addresses
 */
export async function getBlacklistedAddresses(): Promise<string[]> {
  const smt = await getSMT();
  return smt.getAddresses();
}

/**
 * Sync the local merkle root to on-chain
 * Requires admin authority keypair
 */
export async function syncToOnChain(adminKeypair: Keypair): Promise<string> {
  const smt = await getSMT();
  const newRoot = smt.getRoot();
  const rootBytes = Buffer.from(newRoot.toString(16).padStart(64, '0'), 'hex');

  // Derive ExchangeState PDA
  const [exchangeStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    PROGRAM_ID
  );

  // Build update_blacklist instruction
  // Anchor instruction discriminator = sha256("global:update_blacklist")[0..8]
  // sha256("global:update_blacklist") = c6b8f938c73e5d26...
  const discriminator = Buffer.from([0xc6, 0xb8, 0xf9, 0x38, 0xc7, 0x3e, 0x5d, 0x26]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangeStatePda, isSigner: false, isWritable: true },
      { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([discriminator, rootBytes]),
  });

  const tx = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(connection, tx, [adminKeypair]);

  console.log(`Synced blacklist root to on-chain: ${signature}`);
  return signature;
}
