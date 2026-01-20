# Confidex TODO Tracker

> Last updated: January 19, 2026

This document tracks all TODO items in the codebase, their dependencies, and prioritization for the hackathon.

---

## Summary

| Category | Total | Completed | Actionable Now | Blocked |
|----------|-------|-----------|----------------|---------|
| C-SPL Integration | 10 | 0 | 0 | 10 |
| MPC Computations | 4 | **4** | 0 | 0 |
| Oracle Integration | 3 | **3** | 0 | 0 |
| ZK Verification | 2 | **1** | 0 | 1 |
| PNP Privacy | 1 | 0 | 0 | 1 |
| **Total** | **24** | **8** | **0** | **16** |

---

## Completed (8 items)

### 1. MPC Computations (4 items) - DONE

#### 1.1 Funding Settlement MPC
**File:** `programs/confidex_dex/src/instructions/perp_settle_funding.rs`
**Status:** Implemented using `calculate_funding_sync()`, `add_encrypted()`, and `sub_encrypted()`.
**Completed:** January 19, 2026

#### 1.2 Add Margin MPC Request
**File:** `programs/confidex_dex/src/instructions/perp_add_margin.rs`
**Status:** Implemented using `add_encrypted()` and `verify_position_params_sync()`.
**Completed:** January 19, 2026

#### 1.3 Remove Margin MPC Request
**File:** `programs/confidex_dex/src/instructions/perp_remove_margin.rs`
**Status:** Implemented using `sub_encrypted()` and `verify_position_params_sync()`.
**Completed:** January 19, 2026

#### 1.4 Auto-Deleverage MPC
**File:** `programs/confidex_dex/src/instructions/perp_auto_deleverage.rs`
**Status:** Implemented using `check_liquidation_sync()` and `calculate_pnl_sync()` for verification.
**Note:** Full ADL with encrypted size reduction needs new MPC circuit (CALCULATE_ADL_AMOUNTS) - marked for future.
**Completed:** January 19, 2026

---

### 2. Oracle Integration (3 items) - DONE

#### 2.1 Remove Margin - Get Mark Price
**File:** `programs/confidex_dex/src/instructions/perp_remove_margin.rs:69`
**Status:** Implemented using `get_sol_usd_price()` from oracle module.
**Completed:** January 19, 2026

#### 2.2 Remove Margin - Oracle Validation
**File:** `programs/confidex_dex/src/instructions/perp_remove_margin.rs:77-88`
**Status:** Uncommented and active - validates position safety with 5% buffer.
**Completed:** January 19, 2026

#### 2.3 ADL - Get Mark Price + Insurance Check
**File:** `programs/confidex_dex/src/instructions/perp_auto_deleverage.rs:115-120`
**Status:** Implemented `get_sol_usd_price()` + insurance fund balance check.
**Completed:** January 19, 2026

---

### 3. ZK Verification (1 item actionable) - DONE

#### 3.1 Sunspot Verifier CPI (Generic)
**File:** `programs/confidex_dex/src/cpi/verifier.rs:146-221`
**Status:** Implemented generic `verify_groth16_proof()` function with gnark witness format.
**Completed:** January 19, 2026

---

## Blocked - Waiting on C-SPL SDK (10 items)

These require the Arcium C-SPL (Confidential SPL) SDK which is not yet released on devnet.

### On-Chain (7 items)

| File | Line | Description |
|------|------|-------------|
| `perp_open_position.rs` | 131 | Transfer encrypted collateral to vault |
| `perp_close_position.rs` | 171 | Transfer payout from vault to trader |
| `perp_close_position.rs` | 174 | Calculate and transfer fees |
| `perp_liquidate.rs` | 185 | Transfer collateral distribution |
| `perp_add_margin.rs` | 63 | Transfer encrypted collateral to vault |
| `perp_remove_margin.rs` | 121 | Transfer encrypted collateral from vault |
| `match_orders.rs` | 205 | Execute confidential settlement |

### Frontend (3 items)

| File | Line | Description |
|------|------|-------------|
| `cspl-provider.ts` | 61 | Initialize Arcium C-SPL SDK |
| `cspl-provider.ts` | 93 | Implement deposit functionality |
| `cspl-provider.ts` | 119 | Implement withdrawal functionality |

**Workaround:** ShadowWire is integrated as fallback settlement layer.

---

## Blocked - Other Dependencies (6 items)

### Waiting on Arcium Encryption Updates (3 items)

| File | Line | Description |
|------|------|-------------|
| `wrap_tokens.rs` | 106 | Encrypt balance update on wrap |
| `unwrap_tokens.rs` | 92 | Encrypted balance comparison on unwrap |
| `use-encrypted-balance.ts` | 172 | Replace with actual compare_encrypted CPI |

**Status:** Current hybrid encryption format works. Full encryption requires C-SPL.

### Waiting on ZK Verifier Enable (1 item)

| File | Line | Description |
|------|------|-------------|
| `perp_open_position.rs` | 127 | Verify eligibility proof via Sunspot |

**Status:** Verifier program deployed but CPI disabled. Needs testing.

### Future Enhancement (2 items)

| File | Line | Description |
|------|------|-------------|
| `pnp.ts` | 963 | Arcium + PNP privacy integration |
| `perp_auto_deleverage.rs` | 152 | Full ADL with CALCULATE_ADL_AMOUNTS MPC circuit |

---

## Implementation Summary

### Changes Made (January 19, 2026)

#### Files Modified

1. **`perp_remove_margin.rs`**
   - Added `get_sol_usd_price()` import from oracle module
   - Added `sub_encrypted()` and `verify_position_params_sync()` imports
   - Added `arcium_program` account to instruction
   - Enabled oracle price fetching and validation
   - Implemented MPC margin subtraction and threshold verification

2. **`perp_auto_deleverage.rs`**
   - Added `check_liquidation_sync()` and `calculate_pnl_sync()` imports
   - Added `arcium_program` account to instruction
   - Implemented insurance fund depletion check
   - Added MPC verification for bankrupt position and target profitability

3. **`perp_settle_funding.rs`**
   - Added `calculate_funding_sync()`, `add_encrypted()`, `sub_encrypted()` imports
   - Added `arcium_program` account to instruction
   - Implemented MPC funding payment calculation and collateral update

4. **`perp_add_margin.rs`**
   - Added `add_encrypted()` and `verify_position_params_sync()` imports
   - Added `arcium_program` account to instruction
   - Implemented MPC margin addition and threshold verification

5. **`cpi/verifier.rs`**
   - Implemented generic `verify_groth16_proof()` with full gnark witness format
   - Supports arbitrary number of public inputs
   - Proper CPI invocation to Sunspot verifier

6. **`error.rs`**
   - Added `ThresholdMismatch` error variant
   - Added `InsuranceFundNotDepleted` error variant
   - Added `NotLiquidatable` error variant

7. **`state/perp_market.rs`**
   - Added `insurance_fund_target: u64` field
   - Updated SIZE constant to 390 bytes

---

## File Reference

### Frontend Files
- `frontend/src/lib/pnp.ts`
- `frontend/src/lib/settlement/providers/cspl-provider.ts`
- `frontend/src/hooks/use-encrypted-balance.ts`

### On-Chain Files
- `programs/confidex_dex/src/instructions/perp_open_position.rs`
- `programs/confidex_dex/src/instructions/perp_close_position.rs`
- `programs/confidex_dex/src/instructions/perp_liquidate.rs`
- `programs/confidex_dex/src/instructions/perp_settle_funding.rs`
- `programs/confidex_dex/src/instructions/perp_add_margin.rs`
- `programs/confidex_dex/src/instructions/perp_remove_margin.rs`
- `programs/confidex_dex/src/instructions/perp_auto_deleverage.rs`
- `programs/confidex_dex/src/instructions/match_orders.rs`
- `programs/confidex_dex/src/instructions/wrap_tokens.rs`
- `programs/confidex_dex/src/instructions/unwrap_tokens.rs`
- `programs/confidex_dex/src/cpi/verifier.rs`
- `programs/confidex_dex/src/cpi/arcium.rs`
- `programs/confidex_dex/src/error.rs`
- `programs/confidex_dex/src/state/perp_market.rs`

---

## Changelog

- **2026-01-20:** ZK Eligibility Verification fully working end-to-end
  - Fixed stack overflow by splitting into two-instruction pattern: `verify_eligibility` + `open_position`
  - Regenerated Groth16 proof with `sunspot prove` to match deployed verifier
  - Fixed discriminator mismatch in frontend (`0xa5, 0x0a, 0x92, 0xdd, 0x07, 0xf4, 0xef, 0x14`)
  - Successful on-chain position: `5ZJY4pB216CUHWgova6wePJMBzqpysc7BMZbXfFAr5QDdcweNKuTHHgHNHAEftRKwgTuiKqLBw21ZSMAfxgReE8t`
- **2026-01-19:** Completed 8 actionable TODOs (Oracle + MPC + ZK Verifier)
- **2026-01-19:** Initial documentation of 24 TODOs across codebase
