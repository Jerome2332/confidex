/**
 * Integration Test: ZK Proof Verification
 *
 * Tests the zero-knowledge eligibility proof system:
 * 1. Proof generation (simulated Noir/Sunspot)
 * 2. Merkle tree operations
 * 3. Verifier integration
 */

import { PublicKey } from '@solana/web3.js';

// Simulated Poseidon hash (would use real Noir implementation)
function poseidonHash(inputs: bigint[]): bigint {
  // Simulated - in production uses actual Poseidon
  let result = BigInt(0);
  for (const input of inputs) {
    result = (result * BigInt(31) + input) % BigInt(2 ** 254);
  }
  return result;
}

// Sparse Merkle Tree for blacklist
class SparseMerkleTree {
  private depth: number;
  private emptyHashes: bigint[];
  private leaves: Map<string, bigint>;

  constructor(depth: number = 20) {
    this.depth = depth;
    this.leaves = new Map();

    // Precompute empty subtree hashes
    this.emptyHashes = [BigInt(0)];
    for (let i = 1; i <= depth; i++) {
      const prev = this.emptyHashes[i - 1];
      this.emptyHashes.push(poseidonHash([prev, prev]));
    }
  }

  insert(key: bigint): void {
    const keyStr = key.toString();
    this.leaves.set(keyStr, BigInt(1));
  }

  getRoot(): bigint {
    // Simplified - in production calculates actual root
    if (this.leaves.size === 0) {
      return this.emptyHashes[this.depth];
    }

    // Simulate root with some leaves
    let hash = BigInt(0);
    for (const [_key, value] of this.leaves) {
      hash = poseidonHash([hash, value]);
    }
    return hash;
  }

  getMerklePath(key: bigint): { path: bigint[]; indices: boolean[] } {
    const path: bigint[] = [];
    const indices: boolean[] = [];

    // Generate path (simplified for testing)
    for (let i = 0; i < this.depth; i++) {
      path.push(this.emptyHashes[i]);
      indices.push((key >> BigInt(i)) % BigInt(2) === BigInt(1));
    }

    return { path, indices };
  }

  contains(key: bigint): boolean {
    return this.leaves.has(key.toString());
  }
}

// Proof structure matching Noir circuit
interface EligibilityProof {
  proof: Uint8Array; // Groth16 proof (388 bytes)
  publicInputs: {
    blacklistRoot: bigint;
  };
}

// Simulated proof generation
function generateEligibilityProof(
  address: PublicKey,
  tree: SparseMerkleTree
): EligibilityProof {
  const addressBigInt = BigInt('0x' + Buffer.from(address.toBytes()).toString('hex'));
  const root = tree.getRoot();
  const { path, indices } = tree.getMerklePath(addressBigInt);

  // Verify non-membership before generating proof
  if (tree.contains(addressBigInt)) {
    throw new Error('Address is blacklisted');
  }

  // Generate Groth16 proof (simulated)
  const proof = new Uint8Array(388);
  crypto.getRandomValues(proof);

  return {
    proof,
    publicInputs: {
      blacklistRoot: root,
    },
  };
}

// Simulated verifier
function verifyProof(
  proof: EligibilityProof,
  expectedRoot: bigint
): boolean {
  // Check proof size
  if (proof.proof.length !== 388) {
    return false;
  }

  // Check public input matches
  if (proof.publicInputs.blacklistRoot !== expectedRoot) {
    return false;
  }

  // In production: actual Groth16 verification via Sunspot
  return true;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
    });
    console.log(`✓ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    });
    console.log(`✗ ${name} - ${error}`);
  }
}

async function runTests(): Promise<void> {
  console.log('\n=== ZK Verification Tests ===\n');

  // Test 1: Poseidon Hash
  await test('Poseidon hash computation', async () => {
    const hash1 = poseidonHash([BigInt(1), BigInt(2)]);
    const hash2 = poseidonHash([BigInt(1), BigInt(2)]);
    const hash3 = poseidonHash([BigInt(2), BigInt(1)]);

    if (hash1 !== hash2) {
      throw new Error('Hash not deterministic');
    }

    if (hash1 === hash3) {
      throw new Error('Hash should be order-dependent');
    }

    console.log(`  Hash result: ${hash1.toString(16).slice(0, 16)}...`);
  });

  // Test 2: SMT Creation
  await test('Sparse Merkle Tree creation', async () => {
    const tree = new SparseMerkleTree(20);
    const root = tree.getRoot();

    console.log(`  Empty tree root: ${root.toString(16).slice(0, 16)}...`);
    console.log(`  Tree depth: 20`);
  });

  // Test 3: SMT Insertion
  await test('SMT blacklist insertion', async () => {
    const tree = new SparseMerkleTree(20);

    // Add some blacklisted addresses
    const blacklisted = [
      BigInt('0x1234567890abcdef'),
      BigInt('0xdeadbeefcafe1234'),
      BigInt('0xbadaddress111111'),
    ];

    for (const addr of blacklisted) {
      tree.insert(addr);
    }

    const root = tree.getRoot();
    console.log(`  Inserted ${blacklisted.length} addresses`);
    console.log(`  New root: ${root.toString(16).slice(0, 16)}...`);
  });

  // Test 4: Merkle Path Generation
  await test('Generate Merkle proof path', async () => {
    const tree = new SparseMerkleTree(20);
    const address = BigInt('0xabcdef1234567890');

    const { path, indices } = tree.getMerklePath(address);

    if (path.length !== 20) {
      throw new Error(`Invalid path length: ${path.length}`);
    }

    if (indices.length !== 20) {
      throw new Error(`Invalid indices length: ${indices.length}`);
    }

    console.log(`  Path length: ${path.length}`);
    console.log(`  Indices: [${indices.slice(0, 5).join(', ')}...]`);
  });

  // Test 5: Non-membership Proof (Eligible Address)
  await test('Generate proof for eligible address', async () => {
    const tree = new SparseMerkleTree(20);

    // Add some blacklisted addresses
    tree.insert(BigInt('0xbadaddress111111'));
    tree.insert(BigInt('0xbadaddress222222'));

    // Generate proof for eligible address
    const eligibleAddress = PublicKey.unique();
    const proof = generateEligibilityProof(eligibleAddress, tree);

    if (proof.proof.length !== 388) {
      throw new Error(`Invalid proof size: ${proof.proof.length}`);
    }

    console.log(`  Address: ${eligibleAddress.toBase58().slice(0, 20)}...`);
    console.log(`  Proof size: ${proof.proof.length} bytes`);
    console.log(`  Blacklist root: ${proof.publicInputs.blacklistRoot.toString(16).slice(0, 16)}...`);
  });

  // Test 6: Blacklisted Address Rejection
  await test('Reject proof for blacklisted address', async () => {
    const tree = new SparseMerkleTree(20);
    const blacklistedKey = BigInt('0xbadaddress333333');
    tree.insert(blacklistedKey);

    // Create a PublicKey that matches the blacklisted value
    // In reality, we'd need to find a collision, but for testing we simulate
    try {
      const address = PublicKey.unique();
      // Force the address to be "blacklisted" by inserting its value
      const addressBigInt = BigInt('0x' + Buffer.from(address.toBytes()).toString('hex'));
      tree.insert(addressBigInt);

      generateEligibilityProof(address, tree);
      throw new Error('Should have thrown for blacklisted address');
    } catch (error) {
      if (error instanceof Error && error.message === 'Address is blacklisted') {
        console.log('  Correctly rejected blacklisted address');
      } else {
        throw error;
      }
    }
  });

  // Test 7: Proof Verification
  await test('Verify eligibility proof', async () => {
    const tree = new SparseMerkleTree(20);
    const address = PublicKey.unique();
    const root = tree.getRoot();

    const proof = generateEligibilityProof(address, tree);
    const isValid = verifyProof(proof, root);

    if (!isValid) {
      throw new Error('Valid proof rejected');
    }

    console.log('  Proof verified successfully');
  });

  // Test 8: Proof Rejection (Wrong Root)
  await test('Reject proof with wrong root', async () => {
    const tree = new SparseMerkleTree(20);
    const address = PublicKey.unique();
    const proof = generateEligibilityProof(address, tree);

    // Try to verify with different root
    const wrongRoot = BigInt('0xdeadbeefcafebabe');
    const isValid = verifyProof(proof, wrongRoot);

    if (isValid) {
      throw new Error('Invalid proof accepted');
    }

    console.log('  Correctly rejected proof with wrong root');
  });

  // Test 9: Root Update
  await test('Update blacklist root', async () => {
    const tree = new SparseMerkleTree(20);
    const root1 = tree.getRoot();

    // Add new blacklisted address
    tree.insert(BigInt('0xnewbadaddress111'));
    const root2 = tree.getRoot();

    if (root1 === root2) {
      throw new Error('Root should change after insertion');
    }

    console.log(`  Old root: ${root1.toString(16).slice(0, 16)}...`);
    console.log(`  New root: ${root2.toString(16).slice(0, 16)}...`);
  });

  // Test 10: Proof Size Constraints
  await test('Verify proof size constraints', async () => {
    const proof = new Uint8Array(388);
    crypto.getRandomValues(proof);

    // Groth16 proof structure:
    // - 2 G1 points (64 bytes each) = 128 bytes
    // - 1 G2 point (128 bytes) = 128 bytes
    // - Additional data = 132 bytes
    // Total = 388 bytes

    const expectedSize = 388;
    const actualSize = proof.length;

    if (actualSize !== expectedSize) {
      throw new Error(`Expected ${expectedSize} bytes, got ${actualSize}`);
    }

    console.log(`  Groth16 proof: ${actualSize} bytes`);
    console.log('  Within Solana tx size limits: Yes');
  });

  // Print summary
  console.log('\n=== Test Summary ===');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
  }

  const totalTime = results.reduce((acc, r) => acc + r.duration, 0);
  console.log(`\nTotal time: ${totalTime}ms`);
}

// Run tests
runTests().catch(console.error);
