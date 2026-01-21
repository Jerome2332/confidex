/**
 * Blacklist SMT Integration Tests
 *
 * Tests the complete Sparse Merkle Tree implementation including:
 * - Poseidon2 hash function correctness
 * - Tree construction with multiple addresses
 * - Non-membership proof generation
 * - Proof verification against circuit logic
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(dirname(dirname(dirname(dirname(__dirname)))), 'data');
const blacklistFile = join(dataDir, 'blacklist.json');

// Import the modules being tested
import {
  getMerkleRoot,
  getEmptyTreeRoot,
  addToBlacklist,
  removeFromBlacklist,
  getMerkleProof,
  isBlacklisted,
  getBlacklistedAddresses,
  _resetSMTForTesting,
} from '../../lib/blacklist.js';

import {
  poseidon2Hash,
  fieldToHex,
  hexToField,
  POSEIDON2_EMPTY_SUBTREE_ROOTS,
  POSEIDON2_EMPTY_TREE_ROOT,
} from '../../lib/poseidon2.js';

// Helper function to verify proof against circuit logic
function verifyNonMembershipProof(
  blacklistRoot: bigint,
  merklePath: bigint[],
  pathIndices: number[]
): boolean {
  // Start with empty leaf (0) - we're proving this slot is empty
  let current = 0n;

  // Traverse up the tree from leaf to root (matching circuit logic)
  for (let i = 0; i < 20; i++) {
    const sibling = merklePath[i];
    const isRight = pathIndices[i] === 1;

    // Position current node based on path direction
    const [left, right] = isRight ? [sibling, current] : [current, sibling];
    current = poseidon2Hash(left, right);
  }

  // Computed root must match public blacklist root
  return current === blacklistRoot;
}

describe('Poseidon2 Hash Function', () => {
  it('should produce correct hash for (0, 0)', () => {
    const result = poseidon2Hash(0n, 0n);
    const expected = 0x18dfb8dc9b82229cff974efefc8df78b1ce96d9d844236b496785c698bc6732en;
    expect(result).toBe(expected);
  });

  it('should produce correct empty tree root', () => {
    const expectedRoot = 0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387n;
    expect(POSEIDON2_EMPTY_TREE_ROOT).toBe(expectedRoot);
  });

  it('should produce correct empty subtree roots chain', () => {
    // Verify each level is hash of previous level with itself
    for (let i = 1; i < POSEIDON2_EMPTY_SUBTREE_ROOTS.length; i++) {
      const computed = poseidon2Hash(
        POSEIDON2_EMPTY_SUBTREE_ROOTS[i - 1],
        POSEIDON2_EMPTY_SUBTREE_ROOTS[i - 1]
      );
      expect(computed).toBe(POSEIDON2_EMPTY_SUBTREE_ROOTS[i]);
    }
  });

  it('should be deterministic', () => {
    const a = 123456789n;
    const b = 987654321n;
    const hash1 = poseidon2Hash(a, b);
    const hash2 = poseidon2Hash(a, b);
    expect(hash1).toBe(hash2);
  });

  it('should be non-commutative', () => {
    const a = 123456789n;
    const b = 987654321n;
    const hash1 = poseidon2Hash(a, b);
    const hash2 = poseidon2Hash(b, a);
    expect(hash1).not.toBe(hash2);
  });
});

describe('SparseMerkleTree', () => {
  // Clean up before each test
  beforeEach(async () => {
    // Reset the singleton instance
    _resetSMTForTesting();
    // Remove the blacklist file to start fresh
    if (existsSync(blacklistFile)) {
      await unlink(blacklistFile);
    }
  });

  // Clean up after all tests
  afterAll(async () => {
    _resetSMTForTesting();
    if (existsSync(blacklistFile)) {
      await unlink(blacklistFile);
    }
  });

  describe('Empty Tree', () => {
    it('should return correct empty tree root', () => {
      const root = getEmptyTreeRoot();
      const expected = '0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387';
      expect(root).toBe(expected);
    });

    it('should start with empty root', async () => {
      const root = await getMerkleRoot();
      const expected = getEmptyTreeRoot();
      expect(root).toBe(expected);
    });

    it('should generate valid proof for any address in empty tree', async () => {
      const address = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm';
      const root = await getMerkleRoot();
      const proof = await getMerkleProof(address, root);

      expect(proof.isEligible).toBe(true);
      expect(proof.path.length).toBe(20);
      expect(proof.indices.length).toBe(20);

      // Verify the proof
      const merklePath = proof.path.map(hexToField);
      const verified = verifyNonMembershipProof(hexToField(root), merklePath, proof.indices);
      expect(verified).toBe(true);
    });
  });

  describe('Non-Empty Tree', () => {
    const blacklistedAddr = 'DeadBeef111111111111111111111111111111111111';
    const nonBlacklistedAddr = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm';

    it('should change root when address is added', async () => {
      const emptyRoot = await getMerkleRoot();
      await addToBlacklist(blacklistedAddr);
      const newRoot = await getMerkleRoot();

      expect(newRoot).not.toBe(emptyRoot);

      // Cleanup
      await removeFromBlacklist(blacklistedAddr);
    });

    it('should return to empty root when all addresses removed', async () => {
      const emptyRoot = getEmptyTreeRoot();

      await addToBlacklist(blacklistedAddr);
      const midRoot = await getMerkleRoot();
      expect(midRoot).not.toBe(emptyRoot);

      await removeFromBlacklist(blacklistedAddr);
      const finalRoot = await getMerkleRoot();
      expect(finalRoot).toBe(emptyRoot);
    });

    it('should correctly identify blacklisted addresses', async () => {
      await addToBlacklist(blacklistedAddr);

      expect(await isBlacklisted(blacklistedAddr)).toBe(true);
      expect(await isBlacklisted(nonBlacklistedAddr)).toBe(false);

      // Cleanup
      await removeFromBlacklist(blacklistedAddr);
    });

    it('should reject proof for blacklisted address', async () => {
      await addToBlacklist(blacklistedAddr);
      const root = await getMerkleRoot();

      const proof = await getMerkleProof(blacklistedAddr, root);
      expect(proof.isEligible).toBe(false);
      expect(proof.path.length).toBe(0);
      expect(proof.indices.length).toBe(0);

      // Cleanup
      await removeFromBlacklist(blacklistedAddr);
    });

    it('should generate valid proof for non-blacklisted address in non-empty tree', async () => {
      await addToBlacklist(blacklistedAddr);
      const root = await getMerkleRoot();

      const proof = await getMerkleProof(nonBlacklistedAddr, root);
      expect(proof.isEligible).toBe(true);
      expect(proof.path.length).toBe(20);
      expect(proof.indices.length).toBe(20);

      // Verify the proof
      const merklePath = proof.path.map(hexToField);
      const verified = verifyNonMembershipProof(hexToField(root), merklePath, proof.indices);
      expect(verified).toBe(true);

      // Cleanup
      await removeFromBlacklist(blacklistedAddr);
    });

    it('should handle multiple blacklisted addresses', async () => {
      const addr1 = 'BadActor1111111111111111111111111111111111111';
      const addr2 = 'BadActor2222222222222222222222222222222222222';
      const addr3 = 'BadActor3333333333333333333333333333333333333';
      const goodAddr = 'GoodGuy44444444444444444444444444444444444444';

      await addToBlacklist(addr1);
      await addToBlacklist(addr2);
      await addToBlacklist(addr3);

      const root = await getMerkleRoot();
      const addresses = await getBlacklistedAddresses();
      expect(addresses.length).toBe(3);

      // Verify blacklisted addresses are not eligible
      for (const addr of [addr1, addr2, addr3]) {
        const proof = await getMerkleProof(addr, root);
        expect(proof.isEligible).toBe(false);
      }

      // Verify good address is eligible with valid proof
      const goodProof = await getMerkleProof(goodAddr, root);
      expect(goodProof.isEligible).toBe(true);

      const merklePath = goodProof.path.map(hexToField);
      const verified = verifyNonMembershipProof(hexToField(root), merklePath, goodProof.indices);
      expect(verified).toBe(true);

      // Cleanup
      await removeFromBlacklist(addr1);
      await removeFromBlacklist(addr2);
      await removeFromBlacklist(addr3);
    });
  });

  describe('Proof Verification', () => {
    it('should fail verification with wrong root', async () => {
      const address = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm';
      const root = await getMerkleRoot();
      const proof = await getMerkleProof(address, root);

      const merklePath = proof.path.map(hexToField);

      // Use wrong root
      const wrongRoot = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
      const verified = verifyNonMembershipProof(wrongRoot, merklePath, proof.indices);
      expect(verified).toBe(false);
    });

    it('should fail verification with tampered path', async () => {
      const address = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm';
      const root = await getMerkleRoot();
      const proof = await getMerkleProof(address, root);

      const merklePath = proof.path.map(hexToField);

      // Tamper with one sibling
      merklePath[5] = 0xdeadbeefn;

      const verified = verifyNonMembershipProof(hexToField(root), merklePath, proof.indices);
      expect(verified).toBe(false);
    });

    it('should fail verification with wrong indices', async () => {
      // Use a non-empty tree with a blacklisted address that shares prefix with test address
      // This ensures the proof path has non-empty sibling hashes
      const blacklistedAddr = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVba'; // Same prefix, different ending
      await addToBlacklist(blacklistedAddr);

      const address = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm';
      const root = await getMerkleRoot();
      const proof = await getMerkleProof(address, root);

      // Verify this address is eligible (not the blacklisted one)
      expect(proof.isEligible).toBe(true);

      const merklePath = proof.path.map(hexToField);

      // Flip index at level 0 - this affects the immediate leaf sibling computation
      const wrongIndices = [...proof.indices];
      wrongIndices[0] = wrongIndices[0] === 0 ? 1 : 0;

      const verified = verifyNonMembershipProof(hexToField(root), merklePath, wrongIndices);
      expect(verified).toBe(false);

      // Cleanup
      await removeFromBlacklist(blacklistedAddr);
    });
  });
});

describe('Field Conversion', () => {
  it('should round-trip field to hex and back', () => {
    const original = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
    const hex = fieldToHex(original);
    const converted = hexToField(hex);
    expect(converted).toBe(original);
  });

  it('should pad hex to 64 characters', () => {
    const small = 0x123n;
    const hex = fieldToHex(small);
    expect(hex.length).toBe(66); // 0x + 64 chars
    expect(hex).toBe('0x0000000000000000000000000000000000000000000000000000000000000123');
  });
});

describe('Integration: Dynamic Proof Generation', () => {
  beforeEach(async () => {
    _resetSMTForTesting();
    if (existsSync(blacklistFile)) {
      await unlink(blacklistFile);
    }
  });

  afterAll(async () => {
    _resetSMTForTesting();
    if (existsSync(blacklistFile)) {
      await unlink(blacklistFile);
    }
  });

  it('should generate unique proofs for different addresses with non-empty blacklist', async () => {
    // Setup: Add some addresses to blacklist
    const blacklisted = [
      'BadActor1111111111111111111111111111111111111',
      'BadActor2222222222222222222222222222222222222',
    ];

    for (const addr of blacklisted) {
      await addToBlacklist(addr);
    }

    const root = await getMerkleRoot();
    expect(root).not.toBe(getEmptyTreeRoot());

    // Test multiple eligible addresses
    const eligibleAddrs = [
      '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm',
      '5yPAbq3XF4BVZbqdNsGFMKwxnVRzLZ4eEDphT4knGdgT',
      '7HVPjzR4cFAbM5vKqTbNeLsNvBP2pj9cJmN1uTgG6Z4Y',
    ];

    const proofs = await Promise.all(
      eligibleAddrs.map((addr) => getMerkleProof(addr, root))
    );

    // All should be eligible
    for (const proof of proofs) {
      expect(proof.isEligible).toBe(true);
      expect(proof.path.length).toBe(20);
      expect(proof.indices.length).toBe(20);
    }

    // Verify each proof is valid
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i];
      const merklePath = proof.path.map(hexToField);
      const verified = verifyNonMembershipProof(hexToField(root), merklePath, proof.indices);
      expect(verified).toBe(true);
    }

    // Proofs should be different (different merkle paths based on address index)
    // Compare the indices arrays - they should differ for different addresses
    const indicesStrings = proofs.map((p) => p.indices.join(','));
    const uniqueIndices = new Set(indicesStrings);
    expect(uniqueIndices.size).toBe(eligibleAddrs.length);

    // Cleanup
    for (const addr of blacklisted) {
      await removeFromBlacklist(addr);
    }
  });

  it('should generate Prover.toml compatible proof format', async () => {
    // Add a blacklisted address
    await addToBlacklist('BadActor1111111111111111111111111111111111111');

    const root = await getMerkleRoot();
    const address = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm';
    const proof = await getMerkleProof(address, root);

    expect(proof.isEligible).toBe(true);

    // Verify path format is valid for Prover.toml
    for (const pathElement of proof.path) {
      // Should be 0x prefixed hex string with 64 chars (66 total with 0x)
      expect(pathElement).toMatch(/^0x[0-9a-f]{64}$/);
    }

    // Verify indices are 0 or 1
    for (const idx of proof.indices) {
      expect(idx === 0 || idx === 1).toBe(true);
    }

    // Verify the root format
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);

    // Cleanup
    await removeFromBlacklist('BadActor1111111111111111111111111111111111111');
  });

  it('should produce consistent proofs for same address and root', async () => {
    await addToBlacklist('BadActor1111111111111111111111111111111111111');
    const root = await getMerkleRoot();

    const address = '5yPAbq3XF4BVZbqdNsGFMKwxnVRzLZ4eEDphT4knGdgT';

    // Generate proof multiple times
    const proof1 = await getMerkleProof(address, root);
    const proof2 = await getMerkleProof(address, root);

    // Should be identical
    expect(proof1.isEligible).toBe(proof2.isEligible);
    expect(proof1.path).toEqual(proof2.path);
    expect(proof1.indices).toEqual(proof2.indices);

    // Cleanup
    await removeFromBlacklist('BadActor1111111111111111111111111111111111111');
  });

  it('should handle boundary case: several blacklisted addresses', async () => {
    // Add 5 blacklisted addresses using valid base58 patterns
    // Base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
    // Note: 0, O, I, l are NOT valid base58 characters
    const blacklisted = [
      'BadActr1A11111111111111111111111111111111111',
      'BadActr2B11111111111111111111111111111111111',
      'BadActr3C11111111111111111111111111111111111',
      'BadActr4D11111111111111111111111111111111111',
      'BadActr5E11111111111111111111111111111111111',
    ];

    for (const addr of blacklisted) {
      await addToBlacklist(addr);
    }

    const root = await getMerkleRoot();

    // Test an eligible address
    const eligible = '3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm';
    const proof = await getMerkleProof(eligible, root);

    expect(proof.isEligible).toBe(true);

    // Verify the proof
    const merklePath = proof.path.map(hexToField);
    const verified = verifyNonMembershipProof(hexToField(root), merklePath, proof.indices);
    expect(verified).toBe(true);

    // Test a blacklisted address
    const blacklistedProof = await getMerkleProof(blacklisted[2], root);
    expect(blacklistedProof.isEligible).toBe(false);

    // Cleanup
    for (const addr of blacklisted) {
      await removeFromBlacklist(addr);
    }
  });
});
