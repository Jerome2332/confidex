# ZK Verification Production Readiness - Implementation Plan

**PRD:** PRD-ZK-VERIFICATION
**Status:** In Progress
**Started:** 2026-01-21
**Last Updated:** 2026-01-21

---

## Phase 1: Fix Immediate Proof Verification (CRITICAL) ✅ COMPLETE

### Tasks

- [x] Task 1.1: Verify circuit artifacts are from Jan 17 deployment
- [x] Task 1.2: Regenerate proof using existing PK
- [x] Task 1.3: Update frontend proof constant
- [x] Task 1.4: Create script to initialize on-chain blacklist root
- [x] Task 1.5: Test end-to-end proof verification

### Technical Details

**Circuit Artifacts Status (Jan 17):**
- eligibility.pk (1.9MB) - Proving key ✓
- eligibility.vk (716B) - Verification key ✓
- eligibility.ccs (547KB) - Constraint system ✓
- eligibility.so (88KB) - Deployed verifier ✓

**Proof Status (Jan 21 - VERIFIED):**
- eligibility.proof (324B) - Regenerated, matches VK ✓
- eligibility.pw (44B) - Public witness ✓

**Verification TX:** `5FZY72xRRCmW9nzaafjqLWxPa3GPd9XYWsRN3xSivji19Qmm7x4i2FzweKS2DoDVq8dZyQBQj8hzvNhF6Mo37AVT`

**Empty Tree Root:**
`0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387`

---

## Phase 2: Backend Proof Generation Service ✅ COMPLETE

### Tasks

- [x] Task 2.1: Add SUNSPOT_BINARY_PATH env var
- [x] Task 2.2: Implement real proof generation in prover.ts
- [x] Task 2.3: Add proof caching with LRU
- [x] Task 2.4: Wire frontend to use backend API first

---

## Phase 3: Address-Specific Proof Generation 🔴 IN PROGRESS

**Status:** REQUIRED - No shortcuts or deferrals

### Task 3.1: Implement Full Poseidon2 in JavaScript

**Objective:** Implement Poseidon2 hash function matching Noir's BN254 parameters exactly.

**Research Required:**
1. Extract Poseidon2 parameters from Noir stdlib
2. Verify hash output matches circuit for known inputs
3. Choose library: `@noble/curves`, `circomlibjs`, or custom implementation

**Implementation Steps:**
```typescript
// backend/src/lib/poseidon2.ts

import { Field } from '@noble/curves/abstract/modular';

// BN254 scalar field modulus (same as Noir)
const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Poseidon2 round constants and MDS matrix
// These MUST match Noir's stdlib implementation
const POSEIDON2_ROUND_CONSTANTS: bigint[][] = [...];
const POSEIDON2_MDS_MATRIX: bigint[][] = [...];

/**
 * Poseidon2 permutation for state size 4
 */
function poseidon2Permutation(state: bigint[]): bigint[] {
  // Full rounds + partial rounds
  // Must match Noir's poseidon2_permutation
}

/**
 * Poseidon2 2-to-1 hash (sponge construction)
 */
export function poseidon2Hash(left: bigint, right: bigint): bigint {
  const state = [left, right, 0n, 0n];
  const permuted = poseidon2Permutation(state);
  return permuted[0];
}
```

**Verification:**
```typescript
// Test against known Noir circuit outputs
test('poseidon2Hash matches Noir circuit', () => {
  // Empty leaf hash
  const emptyLeaf = 0n;
  const level1 = poseidon2Hash(emptyLeaf, emptyLeaf);
  expect(level1).toBe(0x18dfb8dc9b82229cff974efefc8df78b1ce96d9d844236b496785c698bc6732en);

  // Level 2
  const level2 = poseidon2Hash(level1, level1);
  expect(level2).toBe(0x2c0d184fc7a25c124a27a67b2c46220b039b1a5072c3b693a18ffee458f6425dn);
});
```

**Files:**
- Create: `backend/src/lib/poseidon2.ts`
- Create: `backend/src/__tests__/lib/poseidon2.test.ts`

---

### Task 3.2: Implement Full Sparse Merkle Tree

**Objective:** Replace placeholder SMT with real implementation using Poseidon2.

**Implementation Steps:**

```typescript
// backend/src/lib/sparse-merkle-tree.ts

import { poseidon2Hash } from './poseidon2.js';

const TREE_DEPTH = 20;
const EMPTY_LEAF = 0n;

// Pre-compute empty subtree roots (optimization)
const EMPTY_SUBTREE_ROOTS: bigint[] = computeEmptySubtreeRoots();

function computeEmptySubtreeRoots(): bigint[] {
  const roots: bigint[] = [EMPTY_LEAF];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    roots.push(poseidon2Hash(roots[i - 1], roots[i - 1]));
  }
  return roots;
}

export class SparseMerkleTree {
  private leaves: Map<bigint, bigint>; // index -> value
  private nodeCache: Map<string, bigint>; // path -> hash

  /**
   * Insert a leaf at the given index
   */
  insert(index: bigint, value: bigint): void {
    this.leaves.set(index, value);
    this.invalidatePathCache(index);
  }

  /**
   * Compute current merkle root
   */
  getRoot(): bigint {
    return this.computeNodeHash(0n, TREE_DEPTH);
  }

  /**
   * Generate non-membership proof for an index
   */
  generateProof(index: bigint): { path: bigint[]; indices: number[] } {
    const path: bigint[] = [];
    const indices: number[] = [];

    for (let level = 0; level < TREE_DEPTH; level++) {
      const bit = Number((index >> BigInt(level)) & 1n);
      indices.push(bit);

      // Get sibling hash
      const siblingIndex = index ^ (1n << BigInt(level));
      path.push(this.computeNodeHash(siblingIndex >> BigInt(level), level));
    }

    return { path, indices };
  }

  /**
   * Compute hash of subtree rooted at (prefix, level)
   */
  private computeNodeHash(prefix: bigint, level: number): bigint {
    const cacheKey = `${prefix}:${level}`;
    if (this.nodeCache.has(cacheKey)) {
      return this.nodeCache.get(cacheKey)!;
    }

    if (level === 0) {
      // Leaf level
      return this.leaves.get(prefix) ?? EMPTY_LEAF;
    }

    // Check if subtree is empty
    if (!this.hasLeavesInSubtree(prefix, level)) {
      return EMPTY_SUBTREE_ROOTS[level];
    }

    // Compute recursively
    const leftChild = this.computeNodeHash(prefix << 1n, level - 1);
    const rightChild = this.computeNodeHash((prefix << 1n) | 1n, level - 1);
    const hash = poseidon2Hash(leftChild, rightChild);

    this.nodeCache.set(cacheKey, hash);
    return hash;
  }
}
```

**Files:**
- Create: `backend/src/lib/sparse-merkle-tree.ts`
- Create: `backend/src/__tests__/lib/sparse-merkle-tree.test.ts`
- Update: `backend/src/lib/blacklist.ts` - Use new SMT

---

### Task 3.3: Wire Address → SMT Index Computation

**Objective:** Map Solana addresses to unique SMT leaf indices.

```typescript
// backend/src/lib/blacklist.ts

import bs58 from 'bs58';

const TREE_DEPTH = 20;

/**
 * Compute SMT leaf index from Solana address
 * Uses first 20 bits of base58-decoded address
 */
export function computeAddressIndex(address: string): bigint {
  const bytes = bs58.decode(address);

  // Take first 3 bytes (24 bits) and mask to TREE_DEPTH bits
  let index = 0n;
  for (let i = 0; i < 3 && i < bytes.length; i++) {
    index = (index << 8n) | BigInt(bytes[i]);
  }

  // Mask to exactly TREE_DEPTH bits
  return index & ((1n << BigInt(TREE_DEPTH)) - 1n);
}

/**
 * Compute leaf value for blacklisted address
 * Non-zero value indicates membership
 */
export function computeLeafValue(address: string): bigint {
  // Hash the full address to get leaf value
  const bytes = bs58.decode(address);
  // Use Poseidon hash of address bytes
  return poseidon2HashBytes(bytes);
}
```

---

### Task 3.4: Dynamic Prover.toml Generation

**Objective:** Generate unique prover inputs for each address.

```typescript
// backend/src/lib/prover.ts

export async function generateProverInputs(
  address: string,
  blacklistRoot: bigint,
  smt: SparseMerkleTree
): Promise<string> {
  const index = computeAddressIndex(address);
  const { path, indices } = smt.generateProof(index);

  // Format as TOML
  const pathHex = path.map(p => `    "${fieldToHex(p)}"`).join(',\n');
  const indicesHex = indices.map(i => `    "${i === 1 ? '0x01' : '0x00'}"`).join(',\n');

  return `# Auto-generated for address: ${address}
blacklist_root = "${fieldToHex(blacklistRoot)}"
merkle_path = [
${pathHex}
]
path_indices = [
${indicesHex}
]
`;
}
```

---

### Task 3.5: Integration Tests

**Test Cases:**

1. **Empty Tree**
   - All addresses should have valid non-membership proofs
   - Root = `0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387`

2. **Single Blacklisted Address**
   - Blacklisted address: proof should FAIL
   - Other addresses: proof should PASS
   - Root changes after insertion

3. **Multiple Blacklisted Addresses**
   - All blacklisted: proof FAILS
   - Non-blacklisted: proof PASSES
   - Root is deterministic for same set

4. **Boundary Cases**
   - Max index (2^20 - 1)
   - Min index (0)
   - Adjacent indices
   - Collision handling (same index, different address)

5. **End-to-End Verification**
   - Generate proof via backend
   - Submit to on-chain verifier
   - Verify success/failure matches expectation

**Files:**
- Create: `backend/src/__tests__/lib/blacklist.integration.test.ts`
- Create: `backend/src/__tests__/e2e/zk-verification.test.ts`

---

### Acceptance Criteria

- [ ] `poseidon2Hash()` outputs match Noir circuit exactly
- [ ] SMT root computation matches circuit's `verify_smt_non_membership`
- [ ] Proofs verify on-chain for non-blacklisted addresses
- [ ] Proofs FAIL on-chain for blacklisted addresses
- [ ] Each address gets a unique proof (not shared)
- [ ] All tests pass with non-empty blacklist
- [ ] Cache properly invalidates when blacklist changes

---

## Phase 4: Blacklist Management ✅ COMPLETE

- [x] Task 4.1: Verify update_blacklist instruction
- [x] Task 4.2: Admin API implemented
- [x] Task 4.3: Proof cache invalidation
- [x] Task 4.4: Monitoring via health endpoint

---

## Phase 5: Production Hardening ✅ COMPLETE

- [x] Task 5.1: Pin Nargo version in Nargo.toml (`=1.0.0-beta.13`)
- [x] Task 5.2: Verify skip-zk-verification NOT in default features
- [x] Task 5.3: Update .env.example files
- [x] Task 5.4: Mainnet deployment path documented

---

## Backpressure Gates

- [x] Proof size = 324 bytes
- [x] On-chain verification succeeds (empty tree)
- [x] Frontend builds without errors
- [x] Backend builds without errors
- [ ] **On-chain verification succeeds (non-empty tree)** ← Phase 3 gate
- [ ] **Blacklisted address proof FAILS** ← Phase 3 gate

---

## Current Iteration

**Iteration:** 3
**Focus:** Phase 3 - Full Poseidon2 + Address-Specific Proof Generation

**Next Steps:**
1. Research Poseidon2 parameters from Noir stdlib
2. Implement and verify poseidon2Hash
3. Build full SparseMerkleTree class
4. Wire into prover.ts
5. Write integration tests
6. Verify on devnet with non-empty blacklist
