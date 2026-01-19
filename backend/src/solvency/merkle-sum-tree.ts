/**
 * Merkle-Sum-Tree Implementation for Solvency Proofs
 *
 * A Merkle-Sum-Tree is a variant where each node contains both a hash
 * and a sum. This allows proving:
 * 1. A value is included in the tree (inclusion proof)
 * 2. The total sum at the root equals the sum of all leaves
 *
 * Used for proof-of-reserves where:
 * - Leaves represent user balances
 * - Root sum equals total liabilities
 * - Exchange proves reserves >= root sum
 */

import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Storage paths
const DATA_DIR = join(dirname(dirname(dirname(__dirname))), 'data');
const SOLVENCY_FILE = join(DATA_DIR, 'solvency.json');

/**
 * Simplified Poseidon2 hash simulation for demo
 * In production, this should use an actual Poseidon2 implementation
 * that matches the Noir circuit
 */
function poseidon2Hash(inputs: bigint[]): bigint {
  // Combine inputs into bytes
  const buffer = Buffer.alloc(inputs.length * 32);
  for (let i = 0; i < inputs.length; i++) {
    const hex = inputs[i].toString(16).padStart(64, '0');
    Buffer.from(hex, 'hex').copy(buffer, i * 32);
  }

  // Hash using SHA-256 as a placeholder
  // NOTE: In production, use actual Poseidon2 with Noir's parameters
  const hash = createHash('sha256').update(buffer).digest();

  // Convert to bigint
  return BigInt('0x' + hash.toString('hex'));
}

/**
 * Merkle-Sum-Tree node
 */
interface MSTNode {
  hash: bigint;
  sum: bigint;
  left?: MSTNode;
  right?: MSTNode;
  // For leaf nodes
  userId?: string;
  balance?: bigint;
}

/**
 * User balance entry
 */
interface UserBalance {
  userId: string;
  balance: bigint;
  salt: bigint;
}

/**
 * Inclusion proof for a user's balance
 */
interface InclusionProof {
  userId: string;
  balance: bigint;
  leafHash: bigint;
  pathHashes: bigint[];
  pathSums: bigint[];
  pathIndices: number[];
}

/**
 * Solvency report data
 */
interface SolvencyData {
  timestamp: string;
  rootHash: string;
  totalLiabilities: string;
  reserves: string;
  reservesCommitment: string;
  solvencyRatioBps: number;
  userCount: number;
}

/**
 * Merkle-Sum-Tree for exchange solvency proofs
 */
export class MerkleSumTree {
  private root: MSTNode | null = null;
  private leaves: Map<string, MSTNode> = new Map();
  private balances: Map<string, UserBalance> = new Map();
  private treeDepth: number;

  constructor(maxUsers: number = 65536) {
    // Calculate required tree depth
    this.treeDepth = Math.ceil(Math.log2(maxUsers));
    if (this.treeDepth < 1) this.treeDepth = 1;
  }

  /**
   * Compute leaf hash: H(userId, balance, salt)
   */
  private computeLeafHash(userId: string, balance: bigint, salt: bigint): bigint {
    const userIdBigInt = BigInt('0x' + Buffer.from(userId).toString('hex'));
    return poseidon2Hash([userIdBigInt, balance, salt]);
  }

  /**
   * Compute internal node: H(leftHash, rightHash, sum)
   */
  private computeNodeHash(leftHash: bigint, rightHash: bigint, sum: bigint): bigint {
    return poseidon2Hash([leftHash, rightHash, sum]);
  }

  /**
   * Add or update a user's balance
   */
  addBalance(userId: string, balance: bigint, salt?: bigint): void {
    const userSalt = salt ?? BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

    this.balances.set(userId, {
      userId,
      balance,
      salt: userSalt,
    });

    // Invalidate cached tree
    this.root = null;
    this.leaves.clear();
  }

  /**
   * Remove a user's balance
   */
  removeBalance(userId: string): void {
    this.balances.delete(userId);
    this.root = null;
    this.leaves.clear();
  }

  /**
   * Get user's current balance
   */
  getBalance(userId: string): bigint | undefined {
    return this.balances.get(userId)?.balance;
  }

  /**
   * Get all user balances
   */
  getAllBalances(): UserBalance[] {
    return Array.from(this.balances.values());
  }

  /**
   * Build the merkle-sum-tree from current balances
   */
  private buildTree(): void {
    if (this.root !== null) return; // Already built

    const userList = Array.from(this.balances.values());

    // Pad to power of 2
    const treeSize = 1 << this.treeDepth;
    const paddedUsers: (UserBalance | null)[] = [...userList];
    while (paddedUsers.length < treeSize) {
      paddedUsers.push(null);
    }

    // Build leaves
    const leafNodes: MSTNode[] = paddedUsers.map((user) => {
      if (user) {
        const hash = this.computeLeafHash(user.userId, user.balance, user.salt);
        const node: MSTNode = {
          hash,
          sum: user.balance,
          userId: user.userId,
          balance: user.balance,
        };
        this.leaves.set(user.userId, node);
        return node;
      } else {
        // Empty leaf
        return {
          hash: 0n,
          sum: 0n,
        };
      }
    });

    // Build tree bottom-up
    let currentLevel = leafNodes;
    while (currentLevel.length > 1) {
      const nextLevel: MSTNode[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || { hash: 0n, sum: 0n };

        const sum = left.sum + right.sum;
        const hash = this.computeNodeHash(left.hash, right.hash, sum);

        nextLevel.push({
          hash,
          sum,
          left,
          right,
        });
      }

      currentLevel = nextLevel;
    }

    this.root = currentLevel[0] || { hash: 0n, sum: 0n };
  }

  /**
   * Get the root hash and total sum
   */
  getRoot(): { hash: bigint; sum: bigint } {
    this.buildTree();
    return {
      hash: this.root?.hash ?? 0n,
      sum: this.root?.sum ?? 0n,
    };
  }

  /**
   * Generate inclusion proof for a user
   */
  generateInclusionProof(userId: string): InclusionProof | null {
    const userBalance = this.balances.get(userId);
    if (!userBalance) return null;

    this.buildTree();

    const userList = Array.from(this.balances.keys());
    const userIndex = userList.indexOf(userId);
    if (userIndex < 0) return null;

    const pathHashes: bigint[] = [];
    const pathSums: bigint[] = [];
    const pathIndices: number[] = [];

    // Walk up the tree collecting siblings
    let currentIndex = userIndex;

    // Rebuild leaf level to get siblings
    const treeSize = 1 << this.treeDepth;
    const paddedUsers = [...Array.from(this.balances.values())];
    while (paddedUsers.length < treeSize) {
      paddedUsers.push({ userId: '', balance: 0n, salt: 0n });
    }

    let currentLevel: { hash: bigint; sum: bigint }[] = paddedUsers.map((user) => {
      if (user.userId && user.balance > 0n) {
        return {
          hash: this.computeLeafHash(user.userId, user.balance, user.salt),
          sum: user.balance,
        };
      }
      return { hash: 0n, sum: 0n };
    });

    for (let level = 0; level < this.treeDepth; level++) {
      const siblingIndex = currentIndex ^ 1; // XOR with 1 to get sibling
      const sibling = currentLevel[siblingIndex] || { hash: 0n, sum: 0n };

      pathHashes.push(sibling.hash);
      pathSums.push(sibling.sum);
      pathIndices.push(currentIndex % 2); // 0 = left, 1 = right

      // Move to next level
      currentIndex = Math.floor(currentIndex / 2);

      // Build next level
      const nextLevel: { hash: bigint; sum: bigint }[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || { hash: 0n, sum: 0n };
        const sum = left.sum + right.sum;
        const hash = this.computeNodeHash(left.hash, right.hash, sum);
        nextLevel.push({ hash, sum });
      }
      currentLevel = nextLevel;
    }

    return {
      userId,
      balance: userBalance.balance,
      leafHash: this.computeLeafHash(userId, userBalance.balance, userBalance.salt),
      pathHashes,
      pathSums,
      pathIndices,
    };
  }

  /**
   * Verify an inclusion proof
   */
  verifyInclusionProof(proof: InclusionProof): boolean {
    const { hash: rootHash, sum: totalSum } = this.getRoot();

    let currentHash = proof.leafHash;
    let currentSum = proof.balance;

    for (let i = 0; i < proof.pathHashes.length; i++) {
      const siblingHash = proof.pathHashes[i];
      const siblingSum = proof.pathSums[i];
      const isRight = proof.pathIndices[i] === 1;

      currentSum = currentSum + siblingSum;

      const [leftHash, rightHash] = isRight
        ? [siblingHash, currentHash]
        : [currentHash, siblingHash];

      currentHash = this.computeNodeHash(leftHash, rightHash, currentSum);
    }

    return currentHash === rootHash && currentSum === totalSum;
  }

  /**
   * Get tree statistics
   */
  getStats(): { userCount: number; totalLiabilities: bigint; treeDepth: number } {
    const root = this.getRoot();
    return {
      userCount: this.balances.size,
      totalLiabilities: root.sum,
      treeDepth: this.treeDepth,
    };
  }

  /**
   * Save tree state to disk
   */
  async save(): Promise<void> {
    const balancesArray = Array.from(this.balances.entries()).map(([userId, data]) => ({
      userId,
      balance: data.balance.toString(),
      salt: data.salt.toString(),
    }));

    const root = this.getRoot();

    const data = {
      version: 1,
      treeDepth: this.treeDepth,
      rootHash: root.hash.toString(),
      totalLiabilities: root.sum.toString(),
      userCount: this.balances.size,
      balances: balancesArray,
      lastUpdated: new Date().toISOString(),
    };

    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SOLVENCY_FILE, JSON.stringify(data, null, 2));

    console.log(`Saved merkle-sum-tree with ${this.balances.size} users`);
  }

  /**
   * Load tree state from disk
   */
  static async load(): Promise<MerkleSumTree> {
    const tree = new MerkleSumTree();

    try {
      if (existsSync(SOLVENCY_FILE)) {
        const content = await readFile(SOLVENCY_FILE, 'utf-8');
        const data = JSON.parse(content);

        tree.treeDepth = data.treeDepth || 16;

        for (const entry of data.balances || []) {
          tree.balances.set(entry.userId, {
            userId: entry.userId,
            balance: BigInt(entry.balance),
            salt: BigInt(entry.salt),
          });
        }

        console.log(`Loaded merkle-sum-tree with ${tree.balances.size} users`);
      }
    } catch (error) {
      console.warn('Failed to load merkle-sum-tree:', error);
    }

    return tree;
  }

  /**
   * Generate solvency proof inputs for the ZK circuit
   */
  generateSolvencyProofInputs(
    actualReserves: bigint,
    reservesBlinding: bigint
  ): {
    liabilitiesRoot: string;
    totalLiabilities: string;
    reservesCommitment: string;
    solvencyRatioBps: string;
    actualReserves: string;
    reservesBlinding: string;
  } {
    const root = this.getRoot();
    const commitment = poseidon2Hash([actualReserves, reservesBlinding]);

    // Calculate solvency ratio in basis points
    let ratioBps: bigint;
    if (root.sum === 0n) {
      ratioBps = 10000n; // 100% if no liabilities
    } else {
      ratioBps = (actualReserves * 10000n) / root.sum;
    }

    return {
      liabilitiesRoot: '0x' + root.hash.toString(16).padStart(64, '0'),
      totalLiabilities: '0x' + root.sum.toString(16).padStart(64, '0'),
      reservesCommitment: '0x' + commitment.toString(16).padStart(64, '0'),
      solvencyRatioBps: '0x' + ratioBps.toString(16).padStart(64, '0'),
      actualReserves: '0x' + actualReserves.toString(16).padStart(64, '0'),
      reservesBlinding: '0x' + reservesBlinding.toString(16).padStart(64, '0'),
    };
  }
}

// Singleton instance
let mstInstance: MerkleSumTree | null = null;

/**
 * Get the MST instance (singleton)
 */
export async function getMST(): Promise<MerkleSumTree> {
  if (!mstInstance) {
    mstInstance = await MerkleSumTree.load();
  }
  return mstInstance;
}

/**
 * Generate a solvency report
 */
export async function generateSolvencyReport(
  reserves: bigint,
  reservesBlinding?: bigint
): Promise<SolvencyData> {
  const mst = await getMST();
  const root = mst.getRoot();

  const blinding = reservesBlinding ?? BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const commitment = poseidon2Hash([reserves, blinding]);

  let ratioBps: number;
  if (root.sum === 0n) {
    ratioBps = 10000;
  } else {
    ratioBps = Number((reserves * 10000n) / root.sum);
  }

  return {
    timestamp: new Date().toISOString(),
    rootHash: '0x' + root.hash.toString(16).padStart(64, '0'),
    totalLiabilities: root.sum.toString(),
    reserves: reserves.toString(),
    reservesCommitment: '0x' + commitment.toString(16).padStart(64, '0'),
    solvencyRatioBps: ratioBps,
    userCount: mst.getStats().userCount,
  };
}
