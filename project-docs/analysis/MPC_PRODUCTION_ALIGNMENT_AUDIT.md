# MPC Production Alignment Audit

**Date:** 2026-01-28
**Status:** RESOLVED
**Scope:** Verify production MPC code aligns with Arcium documentation and working test script

## Executive Summary

Analysis of production MPC transaction code against the working `test-mpc-compare-prices.ts` script revealed **one critical bug** that will cause production failures. The issue is in `arcium-client.ts` where Option discriminator bytes are missing from the instruction data serialization.

## Critical Finding: Missing Option<Pubkey> Discriminators (FIXED)

### Location
- **File:** `backend/src/crank/arcium-client.ts`
- **Method:** `executeComparePrices()` (line 186)
- **Fixed:** 2026-01-28

### Issue
The instruction data allocation is **128 bytes** but should be **130 bytes** to include the `Option<Pubkey>` discriminator bytes for `buy_order` and `sell_order` parameters:

```typescript
// PRODUCTION CODE (WRONG) - arcium-client.ts:186
const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16); // 128 bytes total

// WORKING TEST SCRIPT (CORRECT) - test-mpc-compare-prices.ts:93
const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 1 + 1); // 130 bytes
```

### Root Cause
Anchor serializes `Option<T>` types with a discriminator byte:
- `0` = `None`
- `1` = `Some` (followed by T data)

The `compare_prices` instruction in Rust expects:
```rust
pub fn compare_prices(
    ctx: Context<ComparePrices>,
    computation_offset: u64,
    buy_price_ciphertext: [u8; 32],
    sell_price_ciphertext: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
    buy_order: Option<Pubkey>,    // <-- Requires 1 byte discriminator (+ 32 bytes if Some)
    sell_order: Option<Pubkey>,   // <-- Requires 1 byte discriminator (+ 32 bytes if Some)
) -> Result<()>
```

### Expected Failure
When `executeComparePrices()` is called in production, it will fail with:
```
AnchorError occurred. Error Code: InstructionDidNotDeserialize. Error Number: 102.
```

### Required Fix

```typescript
// In backend/src/crank/arcium-client.ts, around line 186

// BEFORE (128 bytes - WRONG):
const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16);

// AFTER (130 bytes - CORRECT):
const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 1 + 1); // 130 bytes total

// Also add at the end of serialization (before the return):
// Option<Pubkey> for buy_order = None (discriminator 0)
data.writeUInt8(0, 128);
// Option<Pubkey> for sell_order = None (discriminator 0)
data.writeUInt8(0, 129);
```

---

## Secondary Finding: mxeAccount Writable Flag Inconsistency

### Location
- **Backend:** `backend/src/crank/arcium-accounts.ts` (line 146)
- **Frontend:** `frontend/src/lib/arcium-accounts.ts` (line 159)
- **Test Script:** `frontend/scripts/test-mpc-compare-prices.ts` (line 116)

### Issue
The test script marks `mxeAccount` as `isWritable: false`, but the production account derivation code marks it as `isWritable: true`.

### Analysis
Looking at the Rust struct:
```rust
#[account(address = derive_mxe_pda!())]
pub mxe_account: Account<'info, MXEAccount>,
```

The account constraint does NOT specify `mut`, meaning it's **readonly**. However, the Arcium SDK's `queue_computation` helper may require it writable.

### Risk Level: LOW
The Solana runtime allows passing writable accounts to readonly slots. This wastes a tiny amount of compute but won't cause failures.

### Recommendation
Verify with Arcium team whether `mxe_account` needs to be writable for `queue_computation`. If not, change to readonly for correctness.

---

## Verified Correct: PDA Seed

### Location
All files use `Buffer.from('ArciumSignerAccount')` for the sign PDA seed, which matches:
- The working test script
- The Rust program (uses `SIGN_PDA_SEED` from arcium-anchor SDK)
- Arcium documentation

---

## Verified Correct: Account Order

The 12-account order for direct MXE calls matches across all files:

| Index | Account | Test Script | arcium-client.ts | arcium-accounts.ts |
|-------|---------|-------------|------------------|--------------------|
| 0 | payer | ✅ | ✅ | N/A (CPI) |
| 1 | signPdaAccount | ✅ | ✅ | ✅ |
| 2 | mxeAccount | ✅ | ✅ | ✅ |
| 3 | mempoolAccount | ✅ | ✅ | ✅ |
| 4 | executingPool | ✅ | ✅ | ✅ |
| 5 | computationAccount | ✅ | ✅ | ✅ |
| 6 | compDefAccount | ✅ | ✅ | ✅ |
| 7 | clusterAccount | ✅ | ✅ | ✅ |
| 8 | poolAccount | ✅ | ✅ | ✅ |
| 9 | clockAccount | ✅ | ✅ | ✅ |
| 10 | SystemProgram | ✅ | ✅ | N/A |
| 11 | ARCIUM_PROGRAM | ✅ | ✅ | ✅ |

---

## Verified Correct: Discriminator Calculation

All files use the same discriminator calculation:
```typescript
sha256("global:compare_prices")[0..8]
```

---

## Verified Correct: Cluster 456

All files use cluster offset 456 (not 123), which is the correct devnet cluster.

---

## Production Checklist

Before deploying to production, ensure:

- [x] **CRITICAL:** Fix `arcium-client.ts` to allocate 130 bytes and add Option discriminators (FIXED 2026-01-28)
- [ ] Verify `mxeAccount` writable flag with Arcium team
- [ ] Run `test-mpc-compare-prices.ts` to verify end-to-end MPC works
- [ ] Verify all circuit files are accessible via HTTP 200:
  ```bash
  for circuit in compare_prices calculate_fill calculate_refund decrypt_for_settlement \
                 check_balance check_order_balance batch_compare_prices batch_calculate_fill; do
    echo -n "$circuit: "
    curl -sI "https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits/${circuit}.arcis" | head -1
  done
  ```
- [ ] Monitor MXE program logs during first production transactions:
  ```bash
  solana logs 4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi -u devnet
  ```

---

## Files Analyzed

| File | Purpose | Issues |
|------|---------|--------|
| `backend/src/crank/arcium-client.ts` | Direct MPC queueing | ~~CRITICAL: Missing Option discriminators~~ FIXED |
| `backend/src/crank/arcium-accounts.ts` | Account derivation for CPI | mxeAccount writable flag |
| `backend/src/crank/match-executor.ts` | Match order transactions | Clean |
| `backend/src/crank/mpc-poller.ts` | MPC event listener | Clean |
| `frontend/src/lib/arcium-accounts.ts` | Frontend account derivation | mxeAccount writable flag |
| `frontend/scripts/test-mpc-compare-prices.ts` | Working test script | Reference (correct) |
| `arcium-mxe/programs/confidex_mxe/src/lib.rs` | Rust MXE program | Reference (correct) |

---

## Related Documentation

- [ARCIUM_MPC_CALLBACK_ISSUE.md](../issues/ARCIUM_MPC_CALLBACK_ISSUE.md) - Previous callback issue (resolved)
- [troubleshooting.md](../arcium/troubleshooting.md) - Arcium troubleshooting guide
- [ARCIUM_MPC_INTEGRATION.md](../implementation/ARCIUM_MPC_INTEGRATION.md) - Integration documentation
