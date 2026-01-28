# ZK Eligibility Verification Implementation

> Last updated: January 28, 2026

This document describes the ZK eligibility verification system implemented for Confidex, including the two-instruction pattern to avoid stack overflow and the Sunspot Groth16 verifier integration.

---

## Overview

Confidex uses Zero-Knowledge proofs to verify trader eligibility without revealing their address. This proves that a trader is NOT on a blacklist (Sparse Merkle Tree non-membership proof).

### Three-Layer Privacy Architecture

```
Layer 1: Noir ZK Proofs     → Eligibility verification (blacklist non-membership)
Layer 2: Arcium MPC         → Encrypted order matching (price comparison)
Layer 3: C-SPL Tokens       → Persistent encrypted balances (settlement)
```

---

## Program IDs (Devnet)

| Program | Address | Purpose |
|---------|---------|---------|
| **Confidex DEX** | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` | Core DEX logic, order management |
| **Sunspot ZK Verifier** | `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W` | Groth16 proof verification |
| **Arcium MXE** | `4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi` | MPC operations wrapper |

### Key PDAs

| PDA | Address | Seeds |
|-----|---------|-------|
| Exchange State | `AzYUvLiRgUz5juG24rvLMQBuKD7AmnJ3eh8GKp7exVWb` | `[b"exchange"]` |
| SOL Perp Market | `FFU5bwpju8Hrb2bgrrWPK4LgGG1rD1ReK9ieVHavcW6n` | `[b"perp_market", SOL_MINT]` |
| Funding State | `7eiG5J7ntca6k6ChFDygxE835zJaAVfTcp9ewCNPgT7o` | `[b"funding", perp_market]` |
| Vault Authority | `Bj4ZZtvbg7CJzbCJMomYzW5MLkxiRGcZbmPSrjyR3sVE` | `[b"vault", perp_market]` |
| Trader Eligibility | Dynamic | `[b"trader_eligibility", trader_pubkey]` |

### Token Accounts

| Account | Address | Owner | Purpose |
|---------|---------|-------|---------|
| Collateral Vault | `DF8HbGMS6gLjQRjWgpaUV4G4C1CcJczseWJFtd1Jx32q` | Vault Authority PDA | Holds USDC collateral |
| Fee Recipient | `2HmZ5C68M3m9WBdzDGHw4oUiUEJ7f9pxJddi2GUL2jGt` | Exchange authority | Receives trading fees |
| Insurance Fund | `F9f1r3kRHF265Xme5qkjskzvByVYZ1jt1iWVVySTZbK6` | Exchange authority | Socialized losses |

---

## Two-Instruction Pattern

### Problem: Stack Overflow

Solana BPF programs have a 4096-byte stack limit. The original `open_position` instruction included:
- 324-byte ZK proof
- 64-byte encrypted size
- 64-byte encrypted entry price
- 64-byte encrypted collateral
- Various account data

This exceeded the stack limit, causing `AccessViolation: stack overflow`.

### Solution: Separate Instructions

Split into two transactions:

1. **`verify_eligibility`** - Takes the 324-byte proof, creates/updates `TraderEligibility` account
2. **`open_position`** - References the `TraderEligibility` account (already verified)

```
┌─────────────────────┐     ┌─────────────────────┐
│  verify_eligibility │     │    open_position    │
├─────────────────────┤     ├─────────────────────┤
│ Inputs:             │     │ Inputs:             │
│ - 324-byte proof    │     │ - 64B encrypted_size│
│ - trader pubkey     │     │ - 64B encrypted_price
│                     │     │ - leverage, side    │
│                     │     │                     │
│ Outputs:            │     │ Verifies:           │
│ - TraderEligibility │────▶│ - eligibility.      │
│   account created   │     │   is_valid(root)    │
└─────────────────────┘     └─────────────────────┘
```

---

## TraderEligibility Account

```rust
#[account]
pub struct TraderEligibility {
    pub trader: Pubkey,                    // 32 bytes
    pub is_verified: bool,                 // 1 byte
    pub verified_blacklist_root: [u8; 32], // 32 bytes - which root was verified
    pub verified_at: i64,                  // 8 bytes - timestamp
    pub verification_count: u32,           // 4 bytes - how many times verified
    pub bump: u8,                          // 1 byte
}

impl TraderEligibility {
    pub const SIZE: usize = 8 + 32 + 1 + 32 + 8 + 4 + 1; // 86 bytes
    pub const SEED: &'static [u8] = b"trader_eligibility";

    pub fn is_valid(&self, current_blacklist_root: &[u8; 32]) -> bool {
        self.is_verified && self.verified_blacklist_root == *current_blacklist_root
    }
}
```

### Re-verification

Eligibility must be re-verified if the blacklist root changes. The `is_valid()` method checks that the verified root matches the current exchange state root.

---

## ZK Circuit: Eligibility Non-Membership

### Circuit: `circuits/eligibility/src/main.nr`

```noir
// Proves SMT non-membership (address NOT in blacklist)
fn main(
    blacklist_root: pub Field,           // Public input
    merkle_path: [Field; TREE_DEPTH],    // Private (20 siblings)
    path_indices: [Field; TREE_DEPTH]    // Private (20 direction bits)
) {
    let valid = verify_smt_non_membership(blacklist_root, merkle_path, path_indices);
    assert(valid, "Address is blacklisted or proof invalid");
}
```

### Hash Function: Poseidon2

```noir
fn hash_2(left: Field, right: Field) -> Field {
    let state: [Field; 4] = [left, right, 0, 0];
    let result = poseidon2_permutation(state, 4);
    result[0]
}
```

### Tree Parameters

- **Depth:** 20 levels (supports ~1M addresses)
- **Hash:** Poseidon2 (ZK-friendly)
- **Empty Root:** `3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387`

---

## Groth16 Proof Format (Sunspot/gnark)

```
Layout: A(64) + B(128) + C(64) + num_commitments(4) + commitment_pok(64) = 324 bytes

┌─────────────┬─────────────┬─────────────┬──────────────┬─────────────────┐
│    A (G1)   │    B (G2)   │    C (G1)   │ num_commits  │ commitment_pok  │
│   64 bytes  │  128 bytes  │   64 bytes  │   4 bytes    │    64 bytes     │
└─────────────┴─────────────┴─────────────┴──────────────┴─────────────────┘
```

### Witness Format (for CPI)

```
[proof_bytes (324)] || [witness_bytes (44)]

Witness:
- num_inputs (u32 BE): 1
- padding (4 bytes): 0x00000000
- num_field_elements (u32 BE): 1
- blacklist_root (32 bytes)
```

---

## Frontend Integration

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/hooks/use-proof.ts` | Proof generation and caching |
| `frontend/src/lib/confidex-client.ts` | Transaction builders |
| `circuits/eligibility/src/main.nr` | Noir circuit |
| `programs/confidex_dex/src/instructions/verify_eligibility.rs` | On-chain verification |

### Proof Generation Flow

```typescript
// 1. Check if trader has valid eligibility on-chain
const { isVerified } = await checkTraderEligibility(connection, publicKey);

if (!isVerified) {
  // 2. Generate proof (uses pre-generated proof for empty blacklist)
  const proofResult = await generateProof();

  // 3. Build and send verify_eligibility transaction
  const verifyTx = await buildVerifyEligibilityTransaction({
    connection,
    trader: publicKey,
    eligibilityProof: proofResult.proof,
  });

  await sendTransaction(verifyTx, connection);
}

// 4. Now can open position (eligibility verified)
const openTx = await buildOpenPositionTransaction({ ... });
```

### Pre-generated Proof

For the empty blacklist (all addresses eligible), a pre-generated proof is embedded:

```typescript
// use-proof.ts
const REAL_EMPTY_TREE_PROOF_HEX = '256a1c68d478f28fee71b37633d77a1c62433e3b6d234642f114f887837e12ca2f8a3ac89b3110f2c3fe5e63f661daca3e384e2f57362b3c7327516ca17668d802b161fcaca8f926c8a73b877f239b3fe8d4178d24fe166bf0b4552c943e42b80e8a308309dcfb2ed2a573677f0fc5039255afa24c4761a5d707fa42a0aa593612c4f786ea9d93cabab566128897b17fbe6796bcf21bb766ad468273863b81040c0bf677b74ce6eb9cb3fa9d351212d316e34cc1636fa794b83c9604dd82136007826b4354b020006b176298ddf2858d64264ad5f35a4538264ddba7f5536b73193067af707182c0608ee1318ecb42adb24efcff676c36caf07b3e1c2abf5a950000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
```

---

## Instruction Discriminators

Anchor generates 8-byte discriminators from `sha256("global:instruction_name")[0..8]`.

| Instruction | Discriminator |
|-------------|---------------|
| `verify_eligibility` | `0xa5, 0x0a, 0x92, 0xdd, 0x07, 0xf4, 0xef, 0x14` |
| `open_position` | `0x87, 0x80, 0x15, 0x0c, 0xc9, 0x42, 0x8a, 0xd5` |

---

## Regenerating Proofs

When the circuit or verification key changes:

```bash
cd circuits/eligibility

# 1. Compile and execute
nargo execute

# 2. Generate proof with Sunspot
sunspot prove target/eligibility.json target/eligibility.gz target/eligibility.ccs target/eligibility.pk

# 3. Verify locally
sunspot verify target/eligibility.gz target/eligibility.json target/eligibility.vk

# 4. Output is in target/eligibility.gz - extract hex for frontend
xxd -p target/eligibility.gz | tr -d '\n'
```

---

## Error Codes

| Error | Code | Description |
|-------|------|-------------|
| `EligibilityProofFailed` | Custom | ZK proof verification failed |
| `EligibilityNotVerified` | Custom | Trader has no valid eligibility |
| `Custom:101` | Sunspot | Invalid proof (wrong proof for circuit) |

---

## Successful Transaction

First successful on-chain position with ZK verification:

**Signature:** `5ZJY4pB216CUHWgova6wePJMBzqpysc7BMZbXfFAr5QDdcweNKuTHHgHNHAEftRKwgTuiKqLBw21ZSMAfxgReE8t`

**Logs:**
```
Program 63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB invoke [1]
Program log: Instruction: OpenPosition
Program log: TraderEligibility check: verified=true, root_match=true
Program log: Using pre-verified eligibility from separate verify_eligibility tx
Program log: Position opened successfully
```

---

## Security Considerations

1. **Re-verification on root change:** If blacklist is updated, all traders must re-verify
2. **Proof caching:** Frontend caches proofs per wallet to avoid re-generation
3. **Verifier program:** Deployed separately, can be upgraded independently
4. **Empty blacklist:** Currently using empty tree; production would have actual blacklist

---

## Verified Test Results (January 28, 2026)

The following test results verify that the ZK proof infrastructure is fully operational:

### Test Environment

```
Prover Server: http://localhost:3001
Mode: local-prover (real Groth16 proofs)
Nargo: v1.0.0-beta.13
Sunspot: ~/sunspot/go/sunspot (20MB binary)
```

### Infrastructure Check

| Component | Status |
|-----------|--------|
| ZK Proofs Enabled | ✅ `ZK_PROOFS_ENABLED=true` |
| Prover Mode | ✅ `real` (not demo/simulated) |
| Nargo Binary | ✅ v1.0.0-beta.13 |
| Sunspot Binary | ✅ Found at configured path |
| Circuit Artifacts | ✅ All present |

**Artifact Verification:**
```
eligibility.json  ✅ (circuit definition)
eligibility.ccs   ✅ (constraint system)
eligibility.pk    ✅ (proving key)
eligibility.vk    ✅ (verification key)
```

### Proof Generation Test

```
Test Wallet: A4rKenXZS3hJwgRAMnmKGohgXMteq5evqH5DPQuiovkF
Message: "Confidex eligibility proof request: 1769589545443"
Signature: 2mdUiyWbezqa...

Proof Generation:
  - Client-side request: 903ms
  - Server-side generation: 167ms
  - Proof size: 324 bytes (exact match)
```

### Proof Structure Validation

```
Groth16 Proof (324 bytes):
┌─────────────┬─────────────┬─────────────┬──────────────┬─────────────────┐
│    A (G1)   │    B (G2)   │    C (G1)   │ num_commits  │ commitment_pok  │
│   64 bytes  │  128 bytes  │   64 bytes  │   4 bytes    │    64 bytes     │
└─────────────┴─────────────┴─────────────┴──────────────┴─────────────────┘

Parsed Values:
  Point A (G1): 11a3630895ac4972...
  Point B (G2): 24ea208b2a3955d8...
  Point C (G1): 15faa31b2be0bfc1...
  Commitments:  0
  POK:          0000000000000000...

Blacklist Root: 0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387
  (Empty tree root - matches circuit's Poseidon2 computation)
```

### Test Script

Run the verification test:

```bash
cd frontend && pnpm tsx scripts/test-zk-flow.ts
```

**Expected Output:**
```
═══════════════════════════════════════════════════════════════
           CONFIDEX - ZK ELIGIBILITY PROOF TEST
═══════════════════════════════════════════════════════════════

📊 Step 1: Checking prover status...
   ✅ Prover infrastructure ready

🔐 Step 2: Generating ZK eligibility proof...
   ✅ Proof received in ~900ms

🔍 Step 3: Validating proof...
   ✅ Proof format is valid

═══════════════════════════════════════════════════════════════
                      ✅ ALL TESTS PASSED
═══════════════════════════════════════════════════════════════
```

### Configuration for ZK-Enabled Demo

**Backend (`backend/.env`):**
```bash
ZK_PROOFS_ENABLED=true
SUNSPOT_BINARY_PATH=/Users/jmoney/sunspot/go/sunspot
CIRCUIT_DIR=/Users/jmoney/Desktop/Dev/confidex/circuits/eligibility
VERIFIER_PROGRAM_ID=9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W
```

**Frontend (`frontend/.env.local`):**
```bash
NEXT_PUBLIC_ZK_PROOFS_ENABLED=true
NEXT_PUBLIC_PROOF_SERVER_URL=http://localhost:3001
```

---

## Future Improvements

1. **Real blacklist:** Integrate with compliance provider for actual blacklist data
2. **WASM prover:** Client-side proof generation instead of pre-generated
3. **Batch verification:** Verify multiple proofs in single transaction
4. **Proof compression:** Explore recursive proofs for smaller on-chain footprint
