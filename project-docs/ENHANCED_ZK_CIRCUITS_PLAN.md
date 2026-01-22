# Enhanced ZK Circuits Implementation Plan

**Priority:** P2 (Implement Now)
**Status:** Phase 0-3 COMPLETE, Phase 4 pending (testing & deployment)

---

## Overview

Extend Confidex's ZK infrastructure with two core circuits: **Range Proofs** and **Solvency Proofs**. Both follow the established Poseidon2/Groth16/Sunspot pattern.

**Also implemented:** Complete blacklist management infrastructure (Phase 0).

**Deferred to Future:** KYC Attestation and Credit Score circuits (tracked separately in FUTURE_IMPLEMENTATIONS.md)

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Blacklist Management Infrastructure | COMPLETE |
| Phase 1 | Shared Circuit Library + Build Scripts | COMPLETE |
| Phase 2 | Range Proofs | COMPLETE |
| Phase 3 | Solvency Proofs | COMPLETE |
| Phase 4 | Testing & Deployment | PENDING |

### Completed Files

**Phase 0 - Blacklist:**
- [backend/src/lib/blacklist.ts](../backend/src/lib/blacklist.ts) - Complete SMT with persistent storage
- [backend/src/routes/admin/blacklist.ts](../backend/src/routes/admin/blacklist.ts) - Admin API endpoints
- [frontend/src/app/admin/blacklist/page.tsx](../frontend/src/app/admin/blacklist/page.tsx) - Admin UI

**Phase 1 - Foundation:**
- [circuits/shared/src/lib.nr](../circuits/shared/src/lib.nr) - Shared library entry
- [circuits/shared/src/poseidon.nr](../circuits/shared/src/poseidon.nr) - Poseidon2 hash helpers
- [circuits/shared/src/merkle.nr](../circuits/shared/src/merkle.nr) - Merkle tree utilities
- [circuits/scripts/build-all.sh](../circuits/scripts/build-all.sh) - Multi-circuit build script

**Phase 2 - Range Proofs:**
- [circuits/range_proof/src/main.nr](../circuits/range_proof/src/main.nr) - Range proof circuit
- [frontend/src/hooks/use-range-proof.ts](../frontend/src/hooks/use-range-proof.ts) - Range proof hook

**Phase 3 - Solvency:**
- [circuits/solvency/src/main.nr](../circuits/solvency/src/main.nr) - Solvency proof circuit
- [circuits/solvency/src/inclusion.nr](../circuits/solvency/src/inclusion.nr) - User inclusion proof
- [backend/src/solvency/merkle-sum-tree.ts](../backend/src/solvency/merkle-sum-tree.ts) - MST builder
- [frontend/src/app/solvency/page.tsx](../frontend/src/app/solvency/page.tsx) - Solvency dashboard

---

## Current State

**Existing Circuit:** `circuits/eligibility/src/main.nr`
- 20-level Sparse Merkle Tree non-membership proof (blacklist checking)
- ~5,500 constraints, Poseidon2 hashing
- Groth16 via Sunspot (324 bytes proof)
- ~200K compute units on-chain verification

**Infrastructure:**
- Noir 1.0.0-beta.13 (locked for Sunspot compatibility)
- Backend: `prover.ts` for server-side proof generation
- Frontend: `use-proof.ts` hook with caching and fallback
- On-chain: `verifier.rs` CPI to Sunspot program

---

## Circuits Implemented Now

| Circuit | Purpose | Constraints | Proof Size | Use Case |
|---------|---------|-------------|------------|----------|
| **Range Proof** | Prove `min ≤ value ≤ max` | ~3,500 | 324 bytes | Order amount bounds |
| **Solvency** | Prove `reserves ≥ liabilities` | ~9,000 | 324 bytes | Proof of reserves |

## Deferred Circuits (Future Task)

| Circuit | Purpose | Status |
|---------|---------|--------|
| **KYC Attestation** | Prove valid KYC from provider | Deferred - requires provider partnerships |
| **Credit Score** | Prove `score ≥ threshold` | Deferred - requires attestation infrastructure |

---

## Architecture

### Unified Verifier Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    Circuit Registry                         │
├─────────────────┬─────────────────┬─────────────────────────┤
│  eligibility/   │  range_proof/   │  solvency/              │
│  (0x00)         │  (0x01)         │  (0x02)                 │
├─────────────────┼─────────────────┼─────────────────────────┤
│  kyc_attest/    │  credit_score/  │  (reserved)             │
│  (0x03)         │  (0x04)         │  (0x05-0xFF)            │
└─────────────────┴─────────────────┴─────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Unified Verifier Program                       │
│  - Circuit type discriminator (1 byte)                      │
│  - Per-circuit verification keys (PDAs)                     │
│  - Shared CPI infrastructure                                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              DEX Program Integration                        │
│  - place_order.rs (eligibility + range)                     │
│  - solvency_report.rs (solvency)                            │
│  - verify_kyc.rs (kyc attestation)                          │
│  - verify_credit.rs (credit score)                          │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Single program deployment reduces operational complexity
- Add new circuits without redeploying main verifier
- Shared infrastructure for proof parsing and validation
- Circuit-specific verification keys stored in separate PDAs

---

## Circuit Specifications

### 1. Range Proof

**Purpose:** Prove amount is within bounds without revealing actual value.

**Public Inputs (96 bytes):**
```
commitment: Field        // Poseidon(value, blinding_factor)
min_bound: Field         // Minimum allowed value
max_bound: Field         // Maximum allowed value
```

**Private Inputs:**
```
value: Field             // Actual value being proven
blinding_factor: Field   // Randomness for hiding
```

**Noir Implementation:**
```noir
use std::hash::poseidon2;

fn main(
    commitment: pub Field,
    min_bound: pub Field,
    max_bound: pub Field,
    value: Field,
    blinding_factor: Field
) {
    // 1. Verify commitment matches value
    let computed = poseidon2::Poseidon2::hash([value, blinding_factor], 2);
    assert(commitment == computed);

    // 2. Range check
    let value_u64 = value as u64;
    let min_u64 = min_bound as u64;
    let max_u64 = max_bound as u64;

    assert(value_u64 >= min_u64);
    assert(value_u64 <= max_u64);
}
```

**Integration with Arcium:**
```
Flow:
  User has: amount = 500 USDC
      │
      ├──► commitment = Poseidon(amount, blinding)  ──► ZK Range Proof
      │
      └──► ciphertext = Arcium.encrypt(amount)      ──► MPC Operations
```
- User commits to plaintext BEFORE encryption
- Commitment stored alongside 64-byte ciphertext on-chain
- ZK verifies commitment bounds, MPC operates on ciphertext

**✅ Arcium MPC Integration Complete (January 2026):**
- MXE program deployed: `DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM`
- MXE callback CPIs to DEX `finalize_match` with `invoke_signed`
- `verify_output()` called before CPI for cryptographic verification
- All sync fallbacks removed (no plaintext extraction from ciphertext)
- See `project-docs/arcium/migration-prd.md` for full migration details

### 2. Solvency Proof

**Purpose:** Exchange proves `total_reserves ≥ sum(user_balances)` without revealing individual balances.

**Approach:** Merkle-Sum-Tree with Poseidon hashing

**Data Structure:**
```
Merkle-Sum-Tree Node:
┌─────────────────────────────────────────────────────┐
│  hash = Poseidon(left_hash, right_hash, sum)        │
│  sum = left_sum + right_sum                         │
└─────────────────────────────────────────────────────┘

Leaf Node:
┌─────────────────────────────────────────────────────┐
│  hash = Poseidon(user_id_commitment, balance)       │
│  sum = balance                                      │
└─────────────────────────────────────────────────────┘
```

**Public Inputs (128 bytes):**
```
liabilities_root: Field     // Merkle-sum-tree root
total_liabilities: Field    // Sum at root (public for verification)
reserves_commitment: Field  // Poseidon(reserves, blinding)
solvency_ratio: Field       // (reserves/liabilities) * 10000 bps
```

**Private Inputs:**
```
actual_reserves: Field
reserves_blinding: Field
```

**Key Features:**
- Users can verify their balance is included (inclusion proof variant)
- Exchange submits proofs periodically (e.g., every 24 hours)
- Public ratio allows market confidence without revealing exact amounts

**Noir Implementation (Basic Solvency):**
```noir
fn main(
    liabilities_root: pub Field,
    total_liabilities: pub Field,
    reserves_commitment: pub Field,
    solvency_ratio: pub Field,
    actual_reserves: Field,
    reserves_blinding: Field
) {
    // 1. Verify reserves commitment
    let computed = poseidon2::hash([actual_reserves, reserves_blinding], 2);
    assert(reserves_commitment == computed);

    // 2. Verify solvency: reserves >= liabilities
    let reserves_u64 = actual_reserves as u64;
    let liabilities_u64 = total_liabilities as u64;
    assert(reserves_u64 >= liabilities_u64);

    // 3. Verify claimed ratio (within 0.01% tolerance)
    let computed_ratio = (reserves_u64 * 10000) / liabilities_u64;
    let claimed_ratio = solvency_ratio as u64;
    let diff = if computed_ratio > claimed_ratio {
        computed_ratio - claimed_ratio
    } else {
        claimed_ratio - computed_ratio
    };
    assert(diff <= 1);  // 1 basis point tolerance
}
```

### 3. KYC Attestation

**Purpose:** Prove user has valid KYC from trusted provider without revealing PII.

**Public Inputs (160 bytes):**
```
user_id_hash: Field           // Poseidon(wallet_pubkey)
required_kyc_level: Field     // 1=basic, 2=standard, 3=enhanced
current_timestamp: Field      // For expiry check
provider_pubkey_x: Field      // Provider EdDSA key X
provider_pubkey_y: Field      // Provider EdDSA key Y
attestation_hash: Field       // For on-chain registry lookup
```

**Private Inputs:**
```
kyc_level: Field              // User's actual level
country_code_hash: Field      // Hashed country (not revealed)
expiry_timestamp: Field       // When attestation expires
signature_r: Field            // EdDSA signature R
signature_s: Field            // EdDSA signature S
```

**Noir Implementation:**
```noir
use std::hash::poseidon2;
use std::eddsa;

fn main(
    user_id_hash: pub Field,
    required_kyc_level: pub Field,
    current_timestamp: pub Field,
    provider_pubkey_x: pub Field,
    provider_pubkey_y: pub Field,
    attestation_hash: pub Field,
    kyc_level: Field,
    country_code_hash: Field,
    expiry_timestamp: Field,
    signature_r: Field,
    signature_s: Field
) {
    // 1. Reconstruct attestation message
    let message_hash = poseidon2::hash([
        user_id_hash,
        kyc_level,
        country_code_hash,
        expiry_timestamp
    ], 4);

    // 2. Verify provider signature (EdDSA)
    let sig_valid = eddsa::eddsa_poseidon_verify(
        provider_pubkey_x,
        provider_pubkey_y,
        signature_r,
        signature_s,
        message_hash
    );
    assert(sig_valid);

    // 3. Verify KYC level meets requirement
    assert(kyc_level as u8 >= required_kyc_level as u8);

    // 4. Verify attestation not expired
    assert(expiry_timestamp as u64 > current_timestamp as u64);

    // 5. Verify attestation hash (for registry lookup)
    let computed_hash = poseidon2::hash([
        user_id_hash, kyc_level, country_code_hash,
        expiry_timestamp, signature_r, signature_s
    ], 6);
    assert(attestation_hash == computed_hash);
}
```

**Provider Registry (On-Chain):**
```rust
#[account]
pub struct KycProviderRegistry {
    pub authority: Pubkey,
    pub providers: Vec<KycProvider>,  // Max 10 providers
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct KycProvider {
    pub name: [u8; 32],           // Provider name (padded)
    pub pubkey_x: [u8; 32],       // EdDSA public key X
    pub pubkey_y: [u8; 32],       // EdDSA public key Y
    pub is_active: bool,
    pub added_at: i64,
}
```

### 4. Credit Score

**Purpose:** Prove credit score meets threshold without revealing exact score.

**Public Inputs (128 bytes):**
```
user_id_hash: Field           // Poseidon(wallet_pubkey)
score_threshold: Field        // Minimum required (e.g., 650)
attestation_timestamp: Field  // When score was attested
provider_pubkey_x: Field      // Credit provider key X
provider_pubkey_y: Field      // Credit provider key Y
```

**Private Inputs:**
```
actual_score: Field           // User's real score (300-850)
score_blinding: Field         // Randomness
signature_r: Field            // Provider signature R
signature_s: Field            // Provider signature S
```

**Noir Implementation:**
```noir
fn main(
    user_id_hash: pub Field,
    score_threshold: pub Field,
    attestation_timestamp: pub Field,
    provider_pubkey_x: pub Field,
    provider_pubkey_y: pub Field,
    actual_score: Field,
    score_blinding: Field,
    signature_r: Field,
    signature_s: Field
) {
    // 1. Verify score meets threshold
    let score_u16 = actual_score as u16;
    let threshold_u16 = score_threshold as u16;
    assert(score_u16 >= threshold_u16);

    // 2. Verify provider signature
    let message_hash = poseidon2::hash([
        user_id_hash,
        actual_score,
        score_blinding,
        attestation_timestamp
    ], 4);

    let sig_valid = eddsa::eddsa_poseidon_verify(
        provider_pubkey_x, provider_pubkey_y,
        signature_r, signature_s,
        message_hash
    );
    assert(sig_valid);

    // 3. Score bounds check (300-850 typical range)
    assert(score_u16 >= 300);
    assert(score_u16 <= 850);
}
```

---

## Directory Structure

```
circuits/
├── eligibility/              # Existing blacklist circuit
│   ├── Nargo.toml
│   ├── Prover.toml
│   └── src/
│       └── main.nr
│
├── range_proof/              # NEW: Amount range proofs
│   ├── Nargo.toml
│   ├── Prover.toml
│   └── src/
│       └── main.nr
│
├── solvency/                 # NEW: Exchange solvency proofs
│   ├── Nargo.toml
│   ├── Prover.toml
│   └── src/
│       ├── main.nr           # Basic solvency proof
│       └── inclusion.nr      # User inclusion proof
│
├── kyc_attest/               # NEW: KYC attestation proofs
│   ├── Nargo.toml
│   ├── Prover.toml
│   └── src/
│       └── main.nr
│
├── credit_score/             # NEW: Credit score threshold proofs
│   ├── Nargo.toml
│   ├── Prover.toml
│   └── src/
│       └── main.nr
│
├── shared/                   # NEW: Shared circuit utilities
│   ├── Nargo.toml
│   └── src/
│       ├── lib.nr
│       ├── poseidon.nr       # Poseidon2 helpers
│       ├── merkle.nr         # Merkle tree utilities
│       └── eddsa.nr          # EdDSA verification helpers
│
└── scripts/                  # Build and deployment scripts
    ├── build-all.sh
    ├── test-all.sh
    └── deploy-verifiers.sh
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Tasks:**
1. Create `circuits/shared/` library with Poseidon2 and Merkle utilities
2. Implement unified verifier program structure
3. Update build scripts for multi-circuit compilation
4. Add circuit type constants to DEX program
5. Create frontend `CircuitType` enum and types

**Deliverables:**
- Unified verifier program (not deployed yet)
- Shared circuit library
- Updated build scripts

### Phase 2: Range Proofs (Week 3)

**Tasks:**
1. Write `circuits/range_proof/src/main.nr`
2. Create WASM bindings for client-side proof generation
3. Add `useRangeProof` hook to frontend
4. Update `place_order.rs` to accept optional range proof
5. Write unit and integration tests

**Deliverables:**
- Working range proof circuit
- Frontend integration
- DEX program updates

### Phase 3: KYC & Credit Score (Week 4)

**Tasks:**
1. Write `circuits/kyc_attest/src/main.nr`
2. Write `circuits/credit_score/src/main.nr`
3. Implement `KycProviderRegistry` on-chain account
4. Create `verify_kyc` and `verify_credit_score` instructions
5. Add frontend hooks for both circuits

**Deliverables:**
- KYC attestation circuit
- Credit score circuit
- Provider registry
- Integration tests

### Phase 4: Solvency Proofs (Week 5)

**Tasks:**
1. Write `circuits/solvency/src/main.nr` and `inclusion.nr`
2. Implement off-chain merkle-sum-tree builder (Node.js)
3. Create `submit_solvency_proof` instruction
4. Build admin dashboard for solvency reports
5. User-facing "verify my balance" feature

**Deliverables:**
- Solvency proof circuit
- Inclusion proof variant
- Proof of reserves feature

### Phase 5: Testing & Deployment (Week 6)

**Tasks:**
1. Deploy unified verifier to devnet
2. Register all circuit verification keys
3. Full integration testing
4. Performance benchmarking
5. Security audit preparation

**Deliverables:**
- Deployed system on devnet
- Performance report
- Documentation

---

## Performance Targets

| Circuit | Constraints | Gen Time (Client) | Gen Time (Server) | Verify CUs |
|---------|-------------|-------------------|-------------------|------------|
| Eligibility | ~5,500 | <3s | <1s | ~200K |
| Range Proof | ~3,500 | <2s | <0.5s | ~180K |
| Solvency | ~9,000 | <5s | <2s | ~250K |
| KYC Attestation | ~6,500 | <4s | <1.5s | ~220K |
| Credit Score | ~4,500 | <3s | <1s | ~200K |

**Transaction Size Budget:**
```
Solana Transaction Limit: 1232 bytes

Single Proof Transaction:
├── Header + signatures: ~100 bytes
├── Account addresses: ~256 bytes (8 accounts × 32 bytes)
├── Instruction data:
│   ├── Circuit type: 1 byte
│   ├── Proof: 324 bytes
│   └── Public inputs: 96-160 bytes
└── Total: ~777-841 bytes ✓

Dual Proof Transaction (with ALT):
├── Header + signatures: ~100 bytes
├── Account addresses: ~80 bytes (using lookup table)
├── Instruction data: ~840 bytes
└── Total: ~1020 bytes ✓
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `circuits/shared/src/lib.nr` | Shared Poseidon2, Merkle utilities |
| `circuits/range_proof/src/main.nr` | Range proof circuit |
| `circuits/solvency/src/main.nr` | Solvency proof circuit |
| `circuits/solvency/src/inclusion.nr` | User inclusion proof |
| `circuits/kyc_attest/src/main.nr` | KYC attestation circuit |
| `circuits/credit_score/src/main.nr` | Credit score circuit |
| `programs/unified_verifier/src/lib.rs` | Unified verifier program |
| `programs/confidex_dex/src/state/kyc_registry.rs` | KYC provider registry |
| `programs/confidex_dex/src/instructions/verify_kyc.rs` | KYC verification instruction |
| `programs/confidex_dex/src/instructions/solvency_report.rs` | Solvency submission |
| `frontend/src/hooks/use-circuit-proofs.ts` | Unified proof hook |
| `frontend/src/lib/circuits/types.ts` | Circuit types and inputs |
| `backend/src/solvency/merkle-sum-tree.ts` | MST builder service |
| `frontend/src/app/solvency/page.tsx` | Solvency dashboard |

---

## Files to Modify

| File | Change |
|------|--------|
| `programs/confidex_dex/src/cpi/verifier.rs` | Extend for unified verifier CPI |
| `programs/confidex_dex/src/instructions/place_order.rs` | Accept optional range proof |
| `programs/confidex_dex/src/lib.rs` | Add new instructions |
| `programs/confidex_dex/src/state/mod.rs` | Export new state types |
| `frontend/src/hooks/use-proof.ts` | Refactor as base for all proofs |
| `backend/src/routes/prove.ts` | Add routes for new circuits |

---

## Privacy Model

| Circuit | Public Inputs | Private Inputs | Privacy Guarantee |
|---------|---------------|----------------|-------------------|
| Eligibility | merkle_root | address, path | Address not linked to proof |
| Range Proof | commitment, bounds | value, blinding | Value hidden in commitment |
| Solvency | root, ratio | reserves, balances | Individual balances hidden |
| KYC | user_hash, level_req | actual_level, PII | PII never revealed |
| Credit Score | user_hash, threshold | score, attestation | Exact score hidden |

---

## Security Considerations

### Attack Vectors and Mitigations

| Attack | Risk | Mitigation |
|--------|------|------------|
| Replay Attacks | Medium | Include nonce/timestamp in public inputs |
| Malicious KYC Providers | High | On-chain registry with governance |
| Stale Solvency Proofs | Medium | Require proofs within 24-hour window |
| Front-running | Low | User's wallet in public inputs |

### Audit Checklist

**Circuit Security:**
- [ ] All arithmetic checked for overflow/underflow
- [ ] Poseidon hash domain separation implemented
- [ ] No unsafe unwraps in constraint generation
- [ ] Public inputs minimized
- [ ] Private inputs never logged or emitted

**On-Chain Security:**
- [ ] Verification key immutable after deployment
- [ ] Circuit type cannot be spoofed
- [ ] CPI permissions verified
- [ ] Account validation complete

---

## Verification Plan

### Unit Tests (Noir)
```bash
cd circuits/range_proof && nargo test
cd circuits/solvency && nargo test
cd circuits/kyc_attest && nargo test
cd circuits/credit_score && nargo test
```

### Integration Tests
1. Generate proof for each circuit type
2. Submit via CPI to unified verifier
3. Verify proof accepted/rejected correctly
4. Test with invalid proofs (should fail)

### E2E Test Flow
1. Create order with range proof → verify accepted
2. Submit solvency proof → verify stored on-chain
3. Verify KYC attestation → check access granted
4. Test credit score threshold → verify conditional access

### Performance Benchmarking
- Measure proof generation time (client WASM)
- Measure proof generation time (server nargo)
- Measure on-chain verification compute units
- Test with various input sizes

---

## References

- [FUTURE_IMPLEMENTATIONS.md](./FUTURE_IMPLEMENTATIONS.md) - Roadmap context
- [eligibility/main.nr](../circuits/eligibility/src/main.nr) - Reference circuit pattern
- [verifier.rs](../programs/confidex_dex/src/cpi/verifier.rs) - Sunspot CPI integration
- [use-proof.ts](../frontend/src/hooks/use-proof.ts) - Frontend proof generation pattern
- [prover.ts](../backend/src/lib/prover.ts) - Backend proof generation service
