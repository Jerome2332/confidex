# PRD-ZK-VERIFICATION: ZK Verification Production Readiness

**Status:** Active
**Priority:** Critical
**Created:** 2026-01-21
**Author:** Claude (AI Assistant)

## Executive Summary

This PRD documents the current state of Confidex's ZK verification infrastructure and provides a roadmap to achieve full production readiness. The system is architecturally sound but has critical gaps preventing real proof verification in production.

---

## Current State Assessment

### What's Working (Production-Ready)

| Component | Status | Notes |
|-----------|--------|-------|
| Noir Circuit (`circuits/eligibility/`) | ✅ Complete | Poseidon2 SMT, 20-level tree, ~5500 constraints |
| Sunspot Verifier Program | ✅ Deployed | `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W` |
| Proof Format (324 bytes Groth16) | ✅ Correct | A(64)+B(128)+C(64)+commitments(68) |
| On-chain CPI Integration | ✅ Working | `verify_eligibility_proof()` in verifier.rs |
| Two-Instruction Pattern | ✅ Implemented | Avoids stack overflow |
| Pre-generated Empty Tree Proof | ✅ Valid | Works for empty blacklist |
| Feature Flags | ✅ Secure | Compile-time only, production defaults |

### What's Broken/Incomplete (Blocking Production)

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | **Proof verification failing** | CRITICAL | Orders rejected with "Proof verification failed!" |
| 2 | **Proof/VK mismatch** | CRITICAL | Frontend proof doesn't match deployed verifier |
| 3 | **Single proof for all users** | HIGH | Same proof replayed (detectable pattern) |
| 4 | **No address-specific proofs** | HIGH | Can't prove individual non-membership |
| 5 | **Backend uses simulated proofs** | HIGH | Fallback generates invalid proofs |
| 6 | **On-chain root = zeros** | MEDIUM | ExchangeState.blacklist_root uninitialized |
| 7 | **No blacklist sync mechanism** | MEDIUM | Can't update root on-chain |
| 8 | **Nargo version not pinned** | LOW | Reproducibility risk |

---

## Root Cause Analysis

### Issue 1: Proof Verification Failure

**Symptom:** `Program log: Proof verification failed!` when placing orders

**Root Cause:** The pre-generated proof in `use-proof.ts` was generated with a different proving key than what the deployed verifier expects.

**Evidence:**
- Proof in frontend: `256a1c68d478f28fee71b37633d77a1c...`
- Proof file regenerated Jan 21: `068933282f619c63ea21559cf916c9f2...`
- Verifier deployed Jan 17 with specific VK

**Fix Required:** Regenerate proof using the SAME proving key that was used to generate the deployed verification key.

### Issue 2: Pre-generated Proof Strategy Limitations

**Current Flow:**
```
Frontend → Uses hardcoded REAL_EMPTY_TREE_PROOF_HEX → On-chain verifier rejects
```

**Problem:** The pre-generated proof approach only works when:
1. Proof matches the deployed VK (currently broken)
2. Blacklist is empty (can't handle non-empty blacklists)
3. All users use same proof (privacy concern)

---

## Implementation Plan

### Phase 1: Fix Immediate Proof Verification (Priority: CRITICAL)

**Goal:** Get ZK verification working with the deployed Sunspot verifier

**Tasks:**

1. **Regenerate Proof with Correct Keys**
   ```bash
   cd circuits/eligibility
   # Use the EXACT same artifacts from Jan 17 deployment
   nargo execute
   sunspot prove --pk target/eligibility.pk
   ```

2. **Update Frontend Proof Constant**
   - File: `frontend/src/hooks/use-proof.ts`
   - Replace `REAL_EMPTY_TREE_PROOF_HEX` with newly generated proof
   - Verify proof is 324 bytes (648 hex chars)

3. **Initialize On-chain Blacklist Root**
   - Current: `ExchangeState.blacklist_root = [0u8; 32]`
   - Required: `0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387`
   - Create admin script to call `update_blacklist` instruction

4. **Test End-to-End**
   ```bash
   cd frontend && pnpm tsx place-sell-order.ts
   # Should see: "ZK proof verification: VALID"
   ```

### Phase 2: Backend Proof Generation Service (Priority: HIGH)

**Goal:** Enable real proof generation for any address/blacklist state

**Tasks:**

1. **Install Sunspot Binary**
   - Document installation in README
   - Add env var `SUNSPOT_BINARY_PATH`
   - Update `backend/src/lib/prover.ts` to use configurable path

2. **Implement Real Proof Generation**
   - File: `backend/src/lib/prover.ts`
   - Remove simulated proof fallback (or gate behind `STRICT_PROOFS=true`)
   - Wire up `nargo execute` + `sunspot prove` pipeline

3. **Add Proof Caching**
   - Cache by `(address, blacklist_root)` tuple
   - TTL: Match blacklist update frequency
   - Storage: Redis or in-memory with LRU

4. **Frontend Integration**
   - File: `frontend/src/hooks/use-proof.ts`
   - Prioritize backend API over hardcoded proof
   - Add proper error handling for server unavailability

### Phase 3: Address-Specific Proof Generation (Priority: HIGH)

**Goal:** Generate unique proofs per user address

**Tasks:**

1. **Implement Full Poseidon2 in Backend**
   - Currently: Uses pre-computed empty subtree roots only
   - Required: Full Poseidon2 hash implementation
   - Library: `@noble/poseidon` or similar

2. **Wire Address → SMT Index**
   - Use first 20 bits of base58-decoded address
   - Generate merkle path for that index
   - Pass to circuit as private inputs

3. **Update Prover.toml Generation**
   - File: `backend/src/lib/prover.ts`
   - Generate correct `merkle_path` and `path_indices` per address
   - Test with known addresses

### Phase 4: Blacklist Management (Priority: MEDIUM)

**Goal:** Enable dynamic blacklist updates with on-chain sync

**Tasks:**

1. **Fix On-chain Root Update**
   - Verify `update_blacklist` instruction works
   - Create admin CLI tool for updates
   - Document update process

2. **Implement Proof Invalidation**
   - When blacklist changes, invalidate cached proofs
   - Notify frontend of root change
   - Re-verify open positions/orders

3. **Add Monitoring**
   - Alert on blacklist root mismatch (local vs on-chain)
   - Track proof generation success/failure rates

### Phase 5: Production Hardening (Priority: MEDIUM)

**Tasks:**

1. **Pin Nargo Version**
   - File: `circuits/eligibility/Nargo.toml`
   - Set `compiler_version = "=1.0.0-beta.13"` (exact version)

2. **Add CI/CD Checks**
   - Verify `skip-zk-verification` NOT in default features
   - Run proof generation test in CI
   - Verify proof size = 324 bytes

3. **Environment Documentation**
   - Update `.env.example` files
   - Add `SUNSPOT_VERIFIER_PROGRAM_ID` to backend config
   - Document mainnet deployment path

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/hooks/use-proof.ts` | Replace proof constant, add backend API priority |
| `backend/src/lib/prover.ts` | Real proof generation, configurable Sunspot path |
| `backend/src/lib/blacklist.ts` | Full Poseidon2 implementation |
| `circuits/eligibility/Nargo.toml` | Pin compiler version |
| `programs/confidex_dex/src/instructions/initialize.rs` | Initialize blacklist_root correctly |
| Admin scripts | Update blacklist root on-chain |

---

## Acceptance Criteria

### Phase 1 (Immediate Fix)
- [ ] Place order succeeds with ZK proof verification
- [ ] Logs show "ZK proof verification: VALID"
- [ ] On-chain blacklist_root = empty tree root

### Phase 2 (Backend Service)
- [ ] Backend generates real Groth16 proofs
- [ ] Frontend uses backend API for proof generation
- [ ] Proof caching reduces latency on repeat orders

### Phase 3 (Address-Specific)
- [ ] Each address gets unique proof
- [ ] Proofs verify correctly for any address
- [ ] Non-membership proven for non-blacklisted addresses

### Phase 4 (Blacklist Management)
- [ ] Admin can update blacklist on-chain
- [ ] Cached proofs invalidated on root change
- [ ] Monitoring alerts on root mismatch

### Phase 5 (Production)
- [ ] CI validates no verification bypass
- [ ] Nargo version pinned
- [ ] All environments documented

---

## Verification Commands

```bash
# 1. Regenerate proof with correct keys
cd circuits/eligibility
nargo execute
sunspot prove

# 2. Update frontend constant
# Copy hex from target/eligibility.proof to use-proof.ts

# 3. Initialize on-chain root
cd frontend && pnpm tsx scripts/init-blacklist-root.ts

# 4. Test order placement
cd frontend && pnpm tsx place-sell-order.ts

# 5. Verify logs
# Expected: "ZK proof verification: VALID"
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Proof/VK regeneration fails | Medium | High | Keep backup of Jan 17 artifacts |
| Sunspot binary unavailable | Low | High | Document manual installation |
| Poseidon2 implementation mismatch | Medium | High | Test against circuit outputs |
| Production builds with verification disabled | Low | Critical | CI/CD checks mandatory |

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | 2-4 hours | Access to original proving key |
| Phase 2 | 4-8 hours | Sunspot binary installed |
| Phase 3 | 8-16 hours | Phase 2 complete |
| Phase 4 | 4-8 hours | Phase 1 complete |
| Phase 5 | 2-4 hours | All phases complete |

**Total: 20-40 hours for full production readiness**

---

## Appendix: Technical Details

### Groth16 Proof Format (324 bytes)
```
Offset 0-63:    A (G1 point)
Offset 64-191:  B (G2 point)
Offset 192-255: C (G1 point)
Offset 256-259: num_commitments (u32)
Offset 260-323: commitment_pok (G1 point)
```

### Witness Format (44 bytes)
```
Offset 0-3:   num_inputs (u32 BE) = 1
Offset 4-7:   padding = 0
Offset 8-11:  num_field_elements (u32 BE) = 1
Offset 12-43: blacklist_root (32 bytes)
```

### Empty Tree Root (Poseidon2)
```
0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387
```

### Key Program IDs
```
DEX:      63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
Verifier: 9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W
MXE:      DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM
```
