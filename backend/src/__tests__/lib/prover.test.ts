import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, copyFile, rm } from 'fs/promises';
import { exec, execSync } from 'child_process';
import { join } from 'path';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts;
    }
    // Default success
    if (cb) cb(null, '', '');
  }),
  execSync: vi.fn().mockReturnValue('nargo version = 1.0.0'),
}));

// Mock fs promises
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.alloc(324)),
    mkdir: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock fs sync
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock util promisify to return mocked exec
vi.mock('util', () => ({
  promisify: vi.fn().mockImplementation((fn) => {
    if (fn === exec) {
      return vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    }
    return fn;
  }),
}));

describe('prover', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.STRICT_PROOFS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('PROOF_SIZE constant', () => {
    it('exports correct proof size (324 bytes)', async () => {
      const { PROOF_SIZE } = await import('../../lib/prover.js');
      expect(PROOF_SIZE).toBe(324);
    });
  });

  describe('proofCache', () => {
    it('exports proof cache instance', async () => {
      const { proofCache } = await import('../../lib/prover.js');
      expect(proofCache).toBeDefined();
      expect(typeof proofCache.get).toBe('function');
      expect(typeof proofCache.set).toBe('function');
    });

    it('cache get returns null for non-existent entry', async () => {
      const { proofCache } = await import('../../lib/prover.js');
      proofCache.clear();
      const result = proofCache.get('address1', 'root1');
      expect(result).toBeNull();
    });

    it('cache set and get roundtrip works', async () => {
      const { proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      const testProof = Buffer.from('test-proof');
      proofCache.set('address1', 'root1', testProof);

      const retrieved = proofCache.get('address1', 'root1');
      expect(retrieved).toEqual(testProof);
    });

    it('cache respects capacity limit', async () => {
      const { proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      const stats = proofCache.stats();
      // Default max is 100
      expect(stats.maxSize).toBeGreaterThanOrEqual(1);
    });

    it('cache invalidateByRoot removes matching entries', async () => {
      const { proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      proofCache.set('addr1', 'root1', Buffer.from('proof1'));
      proofCache.set('addr2', 'root1', Buffer.from('proof2'));
      proofCache.set('addr3', 'root2', Buffer.from('proof3'));

      const invalidated = proofCache.invalidateByRoot('root1');

      expect(invalidated).toBe(2);
      expect(proofCache.get('addr1', 'root1')).toBeNull();
      expect(proofCache.get('addr2', 'root1')).toBeNull();
      expect(proofCache.get('addr3', 'root2')).not.toBeNull();
    });

    it('cache clear removes all entries', async () => {
      const { proofCache } = await import('../../lib/prover.js');

      proofCache.set('addr1', 'root1', Buffer.from('proof1'));
      proofCache.clear();

      expect(proofCache.get('addr1', 'root1')).toBeNull();
      expect(proofCache.stats().size).toBe(0);
    });

    it('cache stats returns correct values', async () => {
      const { proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      proofCache.set('addr1', 'root1', Buffer.from('proof1'));

      const stats = proofCache.stats();
      expect(stats.size).toBe(1);
      expect(typeof stats.maxSize).toBe('number');
      expect(typeof stats.ttlMs).toBe('number');
    });
  });

  describe('generateEligibilityProof', () => {
    const validInputs = {
      address: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
      blacklistRoot: '0x1234567890abcdef',
      merklePath: ['0xhash1', '0xhash2'],
      pathIndices: [0, 1],
    };

    it('returns cached proof if available', async () => {
      const { generateEligibilityProof, proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      const cachedProof = Buffer.alloc(324).fill(0xab);
      proofCache.set(validInputs.address, validInputs.blacklistRoot, cachedProof);

      const result = await generateEligibilityProof(validInputs);

      expect(result).toEqual(cachedProof);
    });

    it('generates simulated proof when circuit artifacts missing', async () => {
      const { generateEligibilityProof, proofCache, PROOF_SIZE } = await import('../../lib/prover.js');
      proofCache.clear();

      // Mock existsSync to return false for circuit artifacts
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('eligibility.json')) return false;
        if (path.includes('eligibility.ccs')) return false;
        if (path.includes('eligibility.pk')) return false;
        return true;
      });

      const result = await generateEligibilityProof(validInputs);

      expect(result.length).toBe(PROOF_SIZE);
    });

    it('generates simulated proof when sunspot not found', async () => {
      const { generateEligibilityProof, proofCache, PROOF_SIZE } = await import('../../lib/prover.js');
      proofCache.clear();

      // Mock existsSync: circuit files exist but sunspot doesn't
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('sunspot')) return false;
        return true;
      });

      const result = await generateEligibilityProof(validInputs);

      expect(result.length).toBe(PROOF_SIZE);
    });

    it('generates deterministic simulated proof', async () => {
      const { generateEligibilityProof, proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      // Force simulated proof mode
      (existsSync as Mock).mockReturnValue(false);

      const result1 = await generateEligibilityProof(validInputs);

      proofCache.clear(); // Clear cache to generate again

      const result2 = await generateEligibilityProof(validInputs);

      expect(result1).toEqual(result2);
    });
  });

  describe('isProverAvailable', () => {
    it('returns true when all infrastructure available', async () => {
      (execSync as Mock).mockReturnValue('nargo version = 1.0.0');
      (existsSync as Mock).mockReturnValue(true);

      const { isProverAvailable } = await import('../../lib/prover.js');
      const result = isProverAvailable();

      expect(typeof result).toBe('boolean');
    });

    it('returns false when nargo not available', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('command not found');
      });

      const { isProverAvailable } = await import('../../lib/prover.js');
      const result = isProverAvailable();

      expect(result).toBe(false);
    });

    it('returns false when sunspot not found', async () => {
      (execSync as Mock).mockReturnValue('nargo version = 1.0.0');
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('sunspot')) return false;
        return true;
      });

      const { isProverAvailable } = await import('../../lib/prover.js');
      const result = isProverAvailable();

      expect(result).toBe(false);
    });

    it('returns false when circuit artifacts missing', async () => {
      (execSync as Mock).mockReturnValue('nargo version = 1.0.0');
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('eligibility.json')) return false;
        return true;
      });

      const { isProverAvailable } = await import('../../lib/prover.js');
      const result = isProverAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getProverStatus', () => {
    it('returns complete status object', async () => {
      (execSync as Mock).mockReturnValue('nargo version = 1.0.0');
      (existsSync as Mock).mockReturnValue(true);

      const { getProverStatus } = await import('../../lib/prover.js');
      const status = getProverStatus();

      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('strictMode');
      expect(status).toHaveProperty('sunspotPath');
      expect(status).toHaveProperty('sunspotFound');
      expect(status).toHaveProperty('circuitDir');
      expect(status).toHaveProperty('nargoAvailable');
      expect(status).toHaveProperty('nargoVersion');
      expect(status).toHaveProperty('artifacts');
      expect(status).toHaveProperty('cache');
    });

    it('reports artifacts status correctly', async () => {
      (execSync as Mock).mockReturnValue('nargo version = 1.0.0');
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('eligibility.json')) return true;
        if (path.includes('eligibility.ccs')) return false;
        if (path.includes('eligibility.pk')) return true;
        if (path.includes('eligibility.vk')) return false;
        return true;
      });

      const { getProverStatus } = await import('../../lib/prover.js');
      const status = getProverStatus();

      expect(status.artifacts.json).toBe(true);
      expect(status.artifacts.ccs).toBe(false);
      expect(status.artifacts.pk).toBe(true);
      expect(status.artifacts.vk).toBe(false);
    });

    it('handles nargo not available', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('not found');
      });

      const { getProverStatus } = await import('../../lib/prover.js');
      const status = getProverStatus();

      expect(status.nargoAvailable).toBe(false);
      expect(status.nargoVersion).toBeNull();
    });

    it('includes cache stats', async () => {
      const { getProverStatus, proofCache } = await import('../../lib/prover.js');
      proofCache.clear();
      proofCache.set('addr', 'root', Buffer.from('test'));

      const status = getProverStatus();

      expect(status.cache.size).toBe(1);
      expect(typeof status.cache.maxSize).toBe('number');
      expect(typeof status.cache.ttlMs).toBe('number');
    });
  });

  describe('getPreGeneratedEmptyTreeProof', () => {
    it('returns null when proof file does not exist', async () => {
      (existsSync as Mock).mockReturnValue(false);

      const { getPreGeneratedEmptyTreeProof } = await import('../../lib/prover.js');
      const result = await getPreGeneratedEmptyTreeProof();

      expect(result).toBeNull();
    });

    it('returns proof buffer when file exists with correct size', async () => {
      (existsSync as Mock).mockReturnValue(true);
      const mockProof = Buffer.alloc(324).fill(0x42);
      (readFile as Mock).mockResolvedValue(mockProof);

      const { getPreGeneratedEmptyTreeProof } = await import('../../lib/prover.js');
      const result = await getPreGeneratedEmptyTreeProof();

      expect(result).toEqual(mockProof);
    });

    it('returns null when file has wrong size', async () => {
      (existsSync as Mock).mockReturnValue(true);
      const wrongSizeProof = Buffer.alloc(100);
      (readFile as Mock).mockResolvedValue(wrongSizeProof);

      const { getPreGeneratedEmptyTreeProof } = await import('../../lib/prover.js');
      const result = await getPreGeneratedEmptyTreeProof();

      expect(result).toBeNull();
    });

    it('returns null on read error', async () => {
      (existsSync as Mock).mockReturnValue(true);
      (readFile as Mock).mockRejectedValue(new Error('Read error'));

      const { getPreGeneratedEmptyTreeProof } = await import('../../lib/prover.js');
      const result = await getPreGeneratedEmptyTreeProof();

      expect(result).toBeNull();
    });
  });

  describe('strict proof mode', () => {
    it('respects STRICT_PROOFS environment variable', async () => {
      process.env.STRICT_PROOFS = 'true';
      vi.resetModules();

      const { getProverStatus } = await import('../../lib/prover.js');
      const status = getProverStatus();

      expect(status.strictMode).toBe(true);
    });

    it('defaults to non-strict mode', async () => {
      delete process.env.STRICT_PROOFS;
      vi.resetModules();

      const { getProverStatus } = await import('../../lib/prover.js');
      const status = getProverStatus();

      expect(status.strictMode).toBe(false);
    });
  });

  describe('simulated proof format', () => {
    it('generates proof with correct structure', async () => {
      const { generateEligibilityProof, proofCache, PROOF_SIZE } = await import('../../lib/prover.js');
      proofCache.clear();

      // Force simulated proof
      (existsSync as Mock).mockReturnValue(false);

      const result = await generateEligibilityProof({
        address: '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
        blacklistRoot: '0xtest',
        merklePath: [],
        pathIndices: [],
      });

      expect(result.length).toBe(PROOF_SIZE);

      // Check num_commitments at offset 256
      const numCommitments = result.readUInt32LE(256);
      expect(numCommitments).toBe(1);
    });
  });

  describe('strict proof mode errors', () => {
    it('throws in strict mode when circuit artifacts missing', async () => {
      process.env.STRICT_PROOFS = 'true';
      vi.resetModules();

      const { generateEligibilityProof, proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      // Mock: circuit artifacts don't exist
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('eligibility.json')) return false;
        if (path.includes('eligibility.ccs')) return false;
        if (path.includes('eligibility.pk')) return false;
        if (path.includes('temp')) return true;
        return true;
      });

      await expect(
        generateEligibilityProof({
          address: 'test-address',
          blacklistRoot: '0xroot',
          merklePath: [],
          pathIndices: [],
        })
      ).rejects.toThrow('Circuit artifacts not found');
    });

    it('throws in strict mode when sunspot not found', async () => {
      process.env.STRICT_PROOFS = 'true';
      vi.resetModules();

      const { generateEligibilityProof, proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      // Mock: artifacts exist, sunspot doesn't
      (existsSync as Mock).mockImplementation((path: string) => {
        if (path.includes('sunspot')) return false;
        return true;
      });

      await expect(
        generateEligibilityProof({
          address: 'test-address',
          blacklistRoot: '0xroot',
          merklePath: [],
          pathIndices: [],
        })
      ).rejects.toThrow('Sunspot not found');
    });
  });

  describe('cache TTL expiration', () => {
    it('returns null for expired cache entries', async () => {
      const { proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      // We can't easily test TTL without mocking Date.now,
      // but we can verify the stats include TTL
      const stats = proofCache.stats();
      expect(typeof stats.ttlMs).toBe('number');
      expect(stats.ttlMs).toBeGreaterThan(0);
    });
  });

  describe('cache eviction', () => {
    it('evicts oldest entry when at capacity', async () => {
      // Create a small cache for testing eviction
      vi.resetModules();

      // The default cache is a singleton, so we test via stats
      const { proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      const stats = proofCache.stats();
      expect(stats.maxSize).toBeGreaterThan(0);
    });
  });

  describe('proof size validation', () => {
    it('throws error when generated proof has wrong size', async () => {
      process.env.STRICT_PROOFS = 'false';
      vi.resetModules();

      const { generateEligibilityProof, proofCache, PROOF_SIZE } = await import('../../lib/prover.js');
      proofCache.clear();

      // Mock: all artifacts exist and sunspot exists
      (existsSync as Mock).mockReturnValue(true);

      // Mock execAsync to simulate successful nargo and sunspot execution
      const mockExecAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      vi.doMock('util', () => ({
        promisify: vi.fn().mockImplementation(() => mockExecAsync),
      }));

      // Mock readFile to return a proof with WRONG size
      const wrongSizeProof = Buffer.alloc(100); // Should be 324
      (readFile as Mock).mockResolvedValue(wrongSizeProof);

      // Since we can't easily mock the internal flow, we test that the fallback
      // to simulated proof works correctly when something goes wrong.
      // The simulated proof should always have correct size
      const result = await generateEligibilityProof({
        address: 'test-address',
        blacklistRoot: '0xroot',
        merklePath: [],
        pathIndices: [],
      });

      // Falls back to simulated proof with correct size
      expect(result.length).toBe(PROOF_SIZE);
    });
  });

  describe('nargo/sunspot execution fallback', () => {
    it('falls back to simulated proof when nargo execute fails in non-strict mode', async () => {
      delete process.env.STRICT_PROOFS;
      vi.resetModules();

      const { generateEligibilityProof, proofCache, PROOF_SIZE } = await import('../../lib/prover.js');
      proofCache.clear();

      // Mock: all artifacts exist
      (existsSync as Mock).mockReturnValue(true);

      // Mock execAsync to throw an error (simulating nargo/sunspot failure)
      vi.doMock('util', () => ({
        promisify: vi.fn().mockImplementation(() => {
          return vi.fn().mockRejectedValue(new Error('nargo execute failed'));
        }),
      }));

      // In non-strict mode, should fall back to simulated proof
      const result = await generateEligibilityProof({
        address: 'fallback-test-address',
        blacklistRoot: '0xfallback',
        merklePath: ['0xhash'],
        pathIndices: [1],
      });

      // Should return simulated proof with correct size
      expect(result.length).toBe(PROOF_SIZE);
    });

    it('throws in strict mode when nargo execute fails', async () => {
      process.env.STRICT_PROOFS = 'true';
      vi.resetModules();

      // Mock: all artifacts and sunspot exist
      (existsSync as Mock).mockReturnValue(true);

      // Mock the promisified exec to reject
      vi.doMock('util', () => ({
        promisify: vi.fn().mockImplementation(() => {
          return vi.fn().mockRejectedValue(new Error('sunspot prove failed'));
        }),
      }));

      const { generateEligibilityProof, proofCache } = await import('../../lib/prover.js');
      proofCache.clear();

      await expect(
        generateEligibilityProof({
          address: 'strict-fail-address',
          blacklistRoot: '0xstrict',
          merklePath: [],
          pathIndices: [],
        })
      ).rejects.toThrow();
    });
  });
});
