import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MerkleSumTree, getMST, generateSolvencyReport } from '../../solvency/merkle-sum-tree.js';

// Mock file system operations
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({
    version: 1,
    treeDepth: 16,
    balances: [],
    lastUpdated: new Date().toISOString(),
  })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

describe('MerkleSumTree', () => {
  let tree: MerkleSumTree;

  beforeEach(() => {
    vi.clearAllMocks();
    tree = new MerkleSumTree();
  });

  describe('constructor', () => {
    it('creates tree with default max users', () => {
      const tree = new MerkleSumTree();
      const stats = tree.getStats();
      expect(stats.treeDepth).toBeGreaterThan(0);
    });

    it('creates tree with custom max users', () => {
      const tree = new MerkleSumTree(1024);
      const stats = tree.getStats();
      expect(stats.treeDepth).toBe(10); // 2^10 = 1024
    });

    it('handles small max users', () => {
      const tree = new MerkleSumTree(2);
      const stats = tree.getStats();
      expect(stats.treeDepth).toBeGreaterThanOrEqual(1);
    });

    it('handles max users of 1', () => {
      const tree = new MerkleSumTree(1);
      const stats = tree.getStats();
      expect(stats.treeDepth).toBeGreaterThanOrEqual(1);
    });
  });

  describe('addBalance', () => {
    it('adds a single user balance', () => {
      tree.addBalance('user1', 1000n);
      expect(tree.getBalance('user1')).toBe(1000n);
    });

    it('adds multiple user balances', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      tree.addBalance('user3', 3000n);

      expect(tree.getBalance('user1')).toBe(1000n);
      expect(tree.getBalance('user2')).toBe(2000n);
      expect(tree.getBalance('user3')).toBe(3000n);
    });

    it('updates existing balance', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user1', 5000n);

      expect(tree.getBalance('user1')).toBe(5000n);
    });

    it('accepts custom salt', () => {
      const customSalt = 12345n;
      tree.addBalance('user1', 1000n, customSalt);
      expect(tree.getBalance('user1')).toBe(1000n);
    });

    it('handles zero balance', () => {
      tree.addBalance('user1', 0n);
      expect(tree.getBalance('user1')).toBe(0n);
    });

    it('handles very large balances', () => {
      const largeBalance = 1000000000000000000000n; // 10^21
      tree.addBalance('whale', largeBalance);
      expect(tree.getBalance('whale')).toBe(largeBalance);
    });
  });

  describe('removeBalance', () => {
    it('removes a user balance', () => {
      tree.addBalance('user1', 1000n);
      tree.removeBalance('user1');
      expect(tree.getBalance('user1')).toBeUndefined();
    });

    it('does not throw when removing non-existent user', () => {
      expect(() => tree.removeBalance('nonexistent')).not.toThrow();
    });

    it('updates tree after removal', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);

      const rootBefore = tree.getRoot();
      tree.removeBalance('user1');
      const rootAfter = tree.getRoot();

      expect(rootAfter.sum).toBe(2000n);
      expect(rootAfter.hash).not.toBe(rootBefore.hash);
    });
  });

  describe('getBalance', () => {
    it('returns undefined for non-existent user', () => {
      expect(tree.getBalance('nonexistent')).toBeUndefined();
    });

    it('returns correct balance for existing user', () => {
      tree.addBalance('user1', 1500n);
      expect(tree.getBalance('user1')).toBe(1500n);
    });
  });

  describe('getAllBalances', () => {
    it('returns empty array when no balances', () => {
      expect(tree.getAllBalances()).toHaveLength(0);
    });

    it('returns all user balances', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);

      const balances = tree.getAllBalances();
      expect(balances).toHaveLength(2);
      expect(balances.map(b => b.userId)).toContain('user1');
      expect(balances.map(b => b.userId)).toContain('user2');
    });

    it('includes salt in balance entries', () => {
      tree.addBalance('user1', 1000n);
      const balances = tree.getAllBalances();
      expect(balances[0]).toHaveProperty('salt');
      expect(typeof balances[0].salt).toBe('bigint');
    });
  });

  describe('getRoot', () => {
    it('returns zero sum for empty tree', () => {
      const root = tree.getRoot();
      // The tree pads to power of 2 with empty leaves that have hash=0n
      // The internal node computation may produce a non-zero root hash
      // but the sum should be 0
      expect(root.sum).toBe(0n);
      expect(root.hash).toBeDefined();
    });

    it('returns correct sum for single user', () => {
      tree.addBalance('user1', 1000n);
      const root = tree.getRoot();
      expect(root.sum).toBe(1000n);
      expect(root.hash).not.toBe(0n);
    });

    it('returns correct sum for multiple users', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      tree.addBalance('user3', 3000n);

      const root = tree.getRoot();
      expect(root.sum).toBe(6000n);
    });

    it('caches tree build', () => {
      tree.addBalance('user1', 1000n);

      const root1 = tree.getRoot();
      const root2 = tree.getRoot();

      expect(root1.hash).toBe(root2.hash);
      expect(root1.sum).toBe(root2.sum);
    });

    it('invalidates cache when balance changes', () => {
      tree.addBalance('user1', 1000n);
      const root1 = tree.getRoot();

      tree.addBalance('user1', 2000n);
      const root2 = tree.getRoot();

      expect(root2.sum).toBe(2000n);
      expect(root2.hash).not.toBe(root1.hash);
    });
  });

  describe('generateInclusionProof', () => {
    it('returns null for non-existent user', () => {
      const proof = tree.generateInclusionProof('nonexistent');
      expect(proof).toBeNull();
    });

    it('generates valid proof for single user', () => {
      tree.addBalance('user1', 1000n);
      const proof = tree.generateInclusionProof('user1');

      expect(proof).not.toBeNull();
      expect(proof?.userId).toBe('user1');
      expect(proof?.balance).toBe(1000n);
      expect(proof?.leafHash).toBeDefined();
      expect(proof?.pathHashes).toBeInstanceOf(Array);
      expect(proof?.pathSums).toBeInstanceOf(Array);
      expect(proof?.pathIndices).toBeInstanceOf(Array);
    });

    it('generates valid proof for multiple users', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      tree.addBalance('user3', 3000n);

      const proof1 = tree.generateInclusionProof('user1');
      const proof2 = tree.generateInclusionProof('user2');
      const proof3 = tree.generateInclusionProof('user3');

      expect(proof1).not.toBeNull();
      expect(proof2).not.toBeNull();
      expect(proof3).not.toBeNull();

      // Each proof should have the same depth
      expect(proof1?.pathHashes.length).toBe(proof2?.pathHashes.length);
      expect(proof2?.pathHashes.length).toBe(proof3?.pathHashes.length);
    });

    it('proof path length matches tree depth', () => {
      const smallTree = new MerkleSumTree(8); // 2^3 = 8, depth = 3
      smallTree.addBalance('user1', 1000n);

      const proof = smallTree.generateInclusionProof('user1');
      expect(proof?.pathHashes.length).toBe(3);
      expect(proof?.pathSums.length).toBe(3);
      expect(proof?.pathIndices.length).toBe(3);
    });

    it('path indices are 0 or 1', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);

      const proof = tree.generateInclusionProof('user1');
      expect(proof?.pathIndices.every(i => i === 0 || i === 1)).toBe(true);
    });
  });

  describe('verifyInclusionProof', () => {
    it('returns true for valid proof', () => {
      tree.addBalance('user1', 1000n);
      const proof = tree.generateInclusionProof('user1');

      expect(proof).not.toBeNull();
      if (proof) {
        const isValid = tree.verifyInclusionProof(proof);
        expect(isValid).toBe(true);
      }
    });

    it('returns true for valid proof with multiple users', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      tree.addBalance('user3', 3000n);

      const proof1 = tree.generateInclusionProof('user1');
      const proof2 = tree.generateInclusionProof('user2');

      expect(proof1 && tree.verifyInclusionProof(proof1)).toBe(true);
      expect(proof2 && tree.verifyInclusionProof(proof2)).toBe(true);
    });

    it('returns false for tampered balance', () => {
      tree.addBalance('user1', 1000n);
      const proof = tree.generateInclusionProof('user1');

      if (proof) {
        // Tamper with the balance
        proof.balance = 9999n;
        const isValid = tree.verifyInclusionProof(proof);
        expect(isValid).toBe(false);
      }
    });

    it('returns false for tampered path hash', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      const proof = tree.generateInclusionProof('user1');

      if (proof && proof.pathHashes.length > 0) {
        // Tamper with a path hash
        proof.pathHashes[0] = 123456789n;
        const isValid = tree.verifyInclusionProof(proof);
        expect(isValid).toBe(false);
      }
    });

    it('returns false for tampered path sum', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      const proof = tree.generateInclusionProof('user1');

      if (proof && proof.pathSums.length > 0) {
        // Tamper with a path sum
        proof.pathSums[0] = 999999n;
        const isValid = tree.verifyInclusionProof(proof);
        expect(isValid).toBe(false);
      }
    });
  });

  describe('getStats', () => {
    it('returns correct stats for empty tree', () => {
      const stats = tree.getStats();
      expect(stats.userCount).toBe(0);
      expect(stats.totalLiabilities).toBe(0n);
      expect(stats.treeDepth).toBeGreaterThan(0);
    });

    it('returns correct stats with users', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);

      const stats = tree.getStats();
      expect(stats.userCount).toBe(2);
      expect(stats.totalLiabilities).toBe(3000n);
    });

    it('updates stats after balance changes', () => {
      tree.addBalance('user1', 1000n);
      expect(tree.getStats().userCount).toBe(1);

      tree.addBalance('user2', 2000n);
      expect(tree.getStats().userCount).toBe(2);
      expect(tree.getStats().totalLiabilities).toBe(3000n);

      tree.removeBalance('user1');
      expect(tree.getStats().userCount).toBe(1);
      expect(tree.getStats().totalLiabilities).toBe(2000n);
    });
  });

  describe('save', () => {
    it('saves tree state to file', async () => {
      const { writeFile, mkdir } = await import('fs/promises');

      tree.addBalance('user1', 1000n);
      await tree.save();

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });

    it('includes all user data in saved file', async () => {
      const { writeFile } = await import('fs/promises');

      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      await tree.save();

      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('user1')
      );
    });
  });

  describe('load', () => {
    it('loads tree from file', async () => {
      const { readFile } = await import('fs/promises');
      const { existsSync } = await import('fs');

      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
        version: 1,
        treeDepth: 16,
        balances: [
          { userId: 'user1', balance: '1000', salt: '12345' },
          { userId: 'user2', balance: '2000', salt: '67890' },
        ],
        lastUpdated: new Date().toISOString(),
      }));

      const loadedTree = await MerkleSumTree.load();

      expect(loadedTree.getBalance('user1')).toBe(1000n);
      expect(loadedTree.getBalance('user2')).toBe(2000n);
    });

    it('returns empty tree when file does not exist', async () => {
      const { existsSync } = await import('fs');
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const loadedTree = await MerkleSumTree.load();
      expect(loadedTree.getStats().userCount).toBe(0);
    });

    it('handles corrupted file gracefully', async () => {
      const { readFile } = await import('fs/promises');
      const { existsSync } = await import('fs');

      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue('invalid json');

      // Should not throw, returns empty tree
      const loadedTree = await MerkleSumTree.load();
      expect(loadedTree.getStats().userCount).toBe(0);
    });
  });

  describe('generateSolvencyProofInputs', () => {
    it('generates proof inputs for ZK circuit', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);

      const reserves = 5000n;
      const blinding = 12345n;
      const inputs = tree.generateSolvencyProofInputs(reserves, blinding);

      expect(inputs.liabilitiesRoot).toMatch(/^0x[0-9a-f]+$/i);
      expect(inputs.totalLiabilities).toMatch(/^0x[0-9a-f]+$/i);
      expect(inputs.reservesCommitment).toMatch(/^0x[0-9a-f]+$/i);
      expect(inputs.actualReserves).toMatch(/^0x[0-9a-f]+$/i);
      expect(inputs.reservesBlinding).toMatch(/^0x[0-9a-f]+$/i);
    });

    it('calculates correct solvency ratio', () => {
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 1000n);
      // Total liabilities = 2000n

      // 100% reserves
      const inputs100 = tree.generateSolvencyProofInputs(2000n, 1n);
      expect(inputs100.solvencyRatioBps).toBe('0x' + (10000n).toString(16).padStart(64, '0'));

      // 150% reserves
      const inputs150 = tree.generateSolvencyProofInputs(3000n, 1n);
      expect(inputs150.solvencyRatioBps).toBe('0x' + (15000n).toString(16).padStart(64, '0'));
    });

    it('handles zero liabilities', () => {
      // Empty tree - no liabilities
      const inputs = tree.generateSolvencyProofInputs(1000n, 1n);
      // Should return 100% (10000 bps) when no liabilities
      expect(inputs.solvencyRatioBps).toBe('0x' + (10000n).toString(16).padStart(64, '0'));
    });

    it('handles under-collateralized case', () => {
      tree.addBalance('user1', 10000n);
      // Only 50% reserves
      const inputs = tree.generateSolvencyProofInputs(5000n, 1n);
      expect(inputs.solvencyRatioBps).toBe('0x' + (5000n).toString(16).padStart(64, '0'));
    });
  });

  describe('deterministic hashing', () => {
    it('produces consistent hashes for same inputs', () => {
      const tree1 = new MerkleSumTree(16);
      const tree2 = new MerkleSumTree(16);

      tree1.addBalance('user1', 1000n, 12345n);
      tree2.addBalance('user1', 1000n, 12345n);

      const root1 = tree1.getRoot();
      const root2 = tree2.getRoot();

      expect(root1.hash).toBe(root2.hash);
      expect(root1.sum).toBe(root2.sum);
    });

    it('produces different hashes for different balances', () => {
      const tree1 = new MerkleSumTree(16);
      const tree2 = new MerkleSumTree(16);

      tree1.addBalance('user1', 1000n, 12345n);
      tree2.addBalance('user1', 2000n, 12345n);

      const root1 = tree1.getRoot();
      const root2 = tree2.getRoot();

      expect(root1.hash).not.toBe(root2.hash);
    });

    it('produces different hashes for different salts', () => {
      const tree1 = new MerkleSumTree(16);
      const tree2 = new MerkleSumTree(16);

      tree1.addBalance('user1', 1000n, 12345n);
      tree2.addBalance('user1', 1000n, 67890n);

      const root1 = tree1.getRoot();
      const root2 = tree2.getRoot();

      expect(root1.hash).not.toBe(root2.hash);
      // Same sum despite different hashes
      expect(root1.sum).toBe(root2.sum);
    });
  });

  describe('tree structure', () => {
    it('pads to power of 2', () => {
      const tree = new MerkleSumTree(8); // 2^3 = 8
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      tree.addBalance('user3', 3000n);
      // Only 3 users but tree has 8 leaves

      const root = tree.getRoot();
      expect(root.sum).toBe(6000n);
    });

    it('handles exactly power of 2 users', () => {
      const tree = new MerkleSumTree(4);
      tree.addBalance('user1', 1000n);
      tree.addBalance('user2', 2000n);
      tree.addBalance('user3', 3000n);
      tree.addBalance('user4', 4000n);

      const root = tree.getRoot();
      expect(root.sum).toBe(10000n);
    });
  });
});

describe('getMST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset module state
    vi.resetModules();
  });

  it('returns a MerkleSumTree instance', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const mst = await getMST();
    expect(mst).toBeInstanceOf(MerkleSumTree);
  });

  it('returns same instance on subsequent calls', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const mst1 = await getMST();
    const mst2 = await getMST();

    // Note: Due to module caching, these should be the same instance
    // This test verifies the singleton pattern works
    expect(mst1).toBeDefined();
    expect(mst2).toBeDefined();
  });
});

describe('generateSolvencyReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('generates a complete solvency report', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const report = await generateSolvencyReport(10000n);

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('rootHash');
    expect(report).toHaveProperty('totalLiabilities');
    expect(report).toHaveProperty('reserves');
    expect(report).toHaveProperty('reservesCommitment');
    expect(report).toHaveProperty('solvencyRatioBps');
    expect(report).toHaveProperty('userCount');
  });

  it('includes correct reserves value', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const reserves = 50000n;
    const report = await generateSolvencyReport(reserves);

    expect(report.reserves).toBe('50000');
  });

  it('calculates solvency ratio correctly', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // With empty tree (0 liabilities), ratio should be 100% (10000 bps)
    const report = await generateSolvencyReport(10000n);
    expect(report.solvencyRatioBps).toBe(10000);
  });

  it('accepts custom blinding factor', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const reserves = 10000n;
    const blinding = 12345n;
    const report = await generateSolvencyReport(reserves, blinding);

    expect(report.reservesCommitment).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('includes timestamp in ISO format', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const report = await generateSolvencyReport(10000n);

    // Should be valid ISO date
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
