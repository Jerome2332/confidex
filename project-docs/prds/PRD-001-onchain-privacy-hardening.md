# PRD-001: On-Chain Privacy Hardening

**Status:** Draft
**Priority:** CRITICAL
**Complexity:** High
**Estimated Effort:** 2-3 days

---

## Executive Summary

The on-chain Solana programs contain bypass flags, plaintext fields, and fallback paths that compromise privacy guarantees in production. This PRD outlines the removal of all development shortcuts and implementation of production-grade privacy controls.

---

## Problem Statement

The Confidex DEX currently has several privacy-compromising patterns in its on-chain code:

1. **Plaintext Order Fields** - `amount_plaintext`, `price_plaintext`, `filled_plaintext` expose trade data
2. **Runtime ZK Bypass** - `ZK_VERIFICATION_ENABLED` flag can disable proof verification at runtime
3. **Hardcoded Program IDs** - Arcium and verifier addresses are compile-time constants
4. **Sync MPC Fallbacks** - Placeholder functions return dummy data instead of requiring async MPC
5. **Missing Oracle Validation** - Liquidations don't check oracle timestamp freshness

These issues defeat the core privacy proposition of Confidex and must be resolved before mainnet.

---

## Scope

### In Scope
- Remove V4 order plaintext fields (migrate to V5 format)
- Make ZK verification compile-time only (no runtime flag)
- Move program IDs to admin-configurable ExchangeState
- Add explicit panics on sync MPC fallback paths
- Implement oracle timestamp validation (<60 seconds)

### Out of Scope
- C-SPL integration (depends on SDK availability)
- Encrypted open interest (Phase 2)
- Full MPC funding rate calculation (Phase 2)

---

## Current State Analysis

### 1. Plaintext Order Fields

**File:** `programs/confidex_dex/src/state/order.rs`

```rust
// Current V4 Order Format (390 bytes) - LINES 98-122
pub struct ConfidentialOrder {
    // ... existing encrypted fields ...

    // HACKATHON PLAINTEXT FIELDS - MUST REMOVE
    /// Plaintext amount for hackathon testing (REMOVE IN PRODUCTION)
    pub amount_plaintext: u64,      // Line 115 - REMOVE
    /// Plaintext price for hackathon testing (REMOVE IN PRODUCTION)
    pub price_plaintext: u64,       // Line 117 - REMOVE
    /// Plaintext filled for hackathon testing (REMOVE IN PRODUCTION)
    pub filled_plaintext: u64,      // Line 119 - REMOVE
    /// Ephemeral public key for MPC re-encryption
    pub ephemeral_pubkey: [u8; 32], // Line 121 - KEEP
}
```

**Impact:** Anyone can read order amounts and prices directly from on-chain state.

### 2. Runtime ZK Bypass

**File:** `programs/confidex_dex/src/cpi/verifier.rs`

```rust
// Line 30 - Current implementation allows runtime bypass
pub const ZK_VERIFICATION_ENABLED: bool = false; // DANGEROUS - can be changed

// Lines 87-89 - Bypass check
pub fn verify_eligibility_proof(...) -> Result<bool> {
    if !ZK_VERIFICATION_ENABLED {
        msg!("ZK verification DISABLED - allowing all orders");
        return Ok(true);  // BYPASSES ALL VERIFICATION
    }
    // ... actual verification ...
}
```

**Impact:** All eligibility proofs are bypassed - blacklisted addresses can trade.

### 3. Hardcoded Program IDs

**File:** `programs/confidex_dex/src/cpi/arcium.rs`

```rust
// Lines 21-46 - Hardcoded addresses
pub const ARCIUM_PROGRAM_ID: Pubkey = pubkey!("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
pub const MXE_PROGRAM_ID: Pubkey = pubkey!("4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi");
pub const VERIFIER_PROGRAM_ID: Pubkey = pubkey!("9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W");
```

**Impact:** Cannot upgrade program addresses without full redeploy.

### 4. Sync MPC Fallbacks

**File:** `programs/confidex_dex/src/cpi/arcium.rs`

```rust
// Lines 183-200 - Sync fallback returns dummy data
pub fn compare_prices_sync(
    encrypted_buy_price: &[u8; 64],
    encrypted_sell_price: &[u8; 64],
) -> Result<bool> {
    // HACKATHON: Return true to simulate match
    // TODO: Remove this - require async MPC
    msg!("WARN: Using sync MPC fallback - NOT FOR PRODUCTION");
    Ok(true)  // DANGEROUS - always matches
}

// Lines 261-283 - Similar pattern for calculate_fill_sync
pub fn calculate_fill_sync(...) -> Result<(u64, bool, bool)> {
    // Returns dummy fill data
    Ok((amount, true, true))  // DANGEROUS - wrong fill amounts
}
```

**Impact:** Order matching uses fake data instead of encrypted MPC.

### 5. Missing Oracle Validation

**File:** `programs/confidex_dex/src/instructions/perp_liquidate.rs`

```rust
// Lines 108-115 - No timestamp check
let oracle_price = get_oracle_price(&ctx.accounts.oracle)?;
// Oracle could be stale by hours/days - no freshness check!

// Liquidation proceeds with potentially stale price
if should_liquidate(position, oracle_price) {
    execute_liquidation(...)?;
}
```

**Impact:** Liquidations can execute with stale prices, causing unfair losses.

---

## Implementation Plan

### Task 1: Remove Plaintext Order Fields (V5 Migration)

**Files to Modify:**
- `programs/confidex_dex/src/state/order.rs`
- `programs/confidex_dex/src/instructions/place_order.rs`
- `programs/confidex_dex/src/instructions/mpc_callback.rs`
- `backend/src/crank/order-monitor.ts`
- `backend/src/crank/settlement-executor.ts`

**Step 1.1: Define V5 Order Format**

```rust
// programs/confidex_dex/src/state/order.rs

/// V5 Order Format - Production (366 bytes)
/// Removes all plaintext fields, keeps ephemeral_pubkey for MPC
#[account]
pub struct ConfidentialOrder {
    /// Order maker's public key
    pub maker: Pubkey,                    // 32 bytes
    /// Trading pair this order belongs to
    pub pair: Pubkey,                     // 32 bytes
    /// Buy or Sell
    pub side: Side,                       // 1 byte
    /// Limit or Market
    pub order_type: OrderType,            // 1 byte

    // Encrypted values (MPC-only access)
    /// Encrypted order amount (V2 pure ciphertext)
    pub encrypted_amount: [u8; 64],       // 64 bytes
    /// Encrypted limit price (V2 pure ciphertext)
    pub encrypted_price: [u8; 64],        // 64 bytes
    /// Encrypted filled amount (V2 pure ciphertext)
    pub encrypted_filled: [u8; 64],       // 64 bytes

    /// Current order status
    pub status: OrderStatus,              // 1 byte
    /// Hour when order was created (coarse timestamp)
    pub created_at_hour: i64,             // 8 bytes
    /// Unique order identifier
    pub order_id: [u8; 16],               // 16 bytes
    /// Nonce for encryption
    pub order_nonce: u64,                 // 8 bytes
    /// Whether ZK eligibility proof was verified
    pub eligibility_proof_verified: bool, // 1 byte
    /// Pending MPC match request ID
    pub pending_match_request: [u8; 32],  // 32 bytes
    /// Whether order is currently in MPC matching
    pub is_matching: bool,                // 1 byte
    /// PDA bump seed
    pub bump: u8,                         // 1 byte
    /// Ephemeral public key for MPC re-encryption
    pub ephemeral_pubkey: [u8; 32],       // 32 bytes
}
// Total: 8 (discriminator) + 358 = 366 bytes

impl ConfidentialOrder {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 1 + 64 + 64 + 64 + 1 + 8 + 16 + 8 + 1 + 32 + 1 + 1 + 32;
    // SIZE = 366 bytes

    pub const SEED: &'static [u8] = b"order";
}
```

**Step 1.2: Update Place Order Instruction**

```rust
// programs/confidex_dex/src/instructions/place_order.rs

pub fn handler(
    ctx: Context<PlaceOrder>,
    encrypted_amount: [u8; 64],
    encrypted_price: [u8; 64],
    side: Side,
    order_type: OrderType,
    eligibility_proof: [u8; 388],
    ephemeral_pubkey: [u8; 32],
) -> Result<()> {
    let order = &mut ctx.accounts.order;

    // Initialize order with V5 format - NO PLAINTEXT
    order.maker = ctx.accounts.user.key();
    order.pair = ctx.accounts.pair.key();
    order.side = side;
    order.order_type = order_type;
    order.encrypted_amount = encrypted_amount;
    order.encrypted_price = encrypted_price;
    order.encrypted_filled = [0u8; 64]; // Zero-encrypted initially
    order.status = OrderStatus::Active;
    order.created_at_hour = Clock::get()?.unix_timestamp / 3600;
    order.order_id = generate_order_id(&ctx.accounts.user.key(), Clock::get()?.unix_timestamp);
    order.order_nonce = ctx.accounts.user.key().to_bytes()[0..8].try_into().unwrap();
    order.eligibility_proof_verified = true; // Set after verification
    order.pending_match_request = [0u8; 32];
    order.is_matching = false;
    order.bump = ctx.bumps.order;
    order.ephemeral_pubkey = ephemeral_pubkey;

    // REMOVED: amount_plaintext, price_plaintext, filled_plaintext

    Ok(())
}
```

**Step 1.3: Update Backend Order Parsing**

```typescript
// backend/src/crank/order-monitor.ts

// V5 Order Format (366 bytes)
private parseOrderV5(data: Buffer): ParsedOrder {
  let offset = 8; // Skip discriminator

  const maker = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const pair = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const side = data.readUInt8(offset) as Side;
  offset += 1;

  const orderType = data.readUInt8(offset) as OrderType;
  offset += 1;

  const encryptedAmount = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedPrice = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedFilled = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const status = data.readUInt8(offset) as OrderStatus;
  offset += 1;

  // Skip: created_at_hour, order_id, order_nonce, eligibility_proof_verified
  offset += 8 + 16 + 8 + 1;

  const pendingMatchRequest = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  const isMatching = data.readUInt8(offset) === 1;
  offset += 1;

  const bump = data.readUInt8(offset);
  offset += 1;

  const ephemeralPubkey = new Uint8Array(data.subarray(offset, offset + 32));

  return {
    maker,
    pair,
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    encryptedFilled,
    status,
    isMatching,
    pendingMatchRequest,
    ephemeralPubkey,
    // NO PLAINTEXT FIELDS
  };
}
```

**Step 1.4: Update Settlement Executor**

```typescript
// backend/src/crank/settlement-executor.ts

// Change filter to V5 size
const v5Accounts = await this.connection.getProgramAccounts(this.programId, {
  filters: [{ dataSize: 366 }], // V5 format
});

// Remove isFilled() plaintext check - must use MPC callback results
private isFilled(order: ParsedOrder): boolean {
  // Check if order has been marked filled via MPC callback
  // The filled status is set by finalize_match instruction
  return order.status === OrderStatus.Filled || order.status === OrderStatus.PartiallyFilled;
}
```

---

### Task 2: Make ZK Verification Compile-Time Only

**Files to Modify:**
- `programs/confidex_dex/src/cpi/verifier.rs`
- `programs/confidex_dex/Cargo.toml`

**Step 2.1: Add Cargo Feature Flag**

```toml
# programs/confidex_dex/Cargo.toml

[features]
default = ["zk-verification"]
zk-verification = []
skip-zk-verification = []  # Only for local testing
```

**Step 2.2: Implement Compile-Time Check**

```rust
// programs/confidex_dex/src/cpi/verifier.rs

/// ZK verification is ALWAYS enabled in production builds.
/// The skip-zk-verification feature is ONLY for local anchor test.
#[cfg(feature = "skip-zk-verification")]
compile_error!("skip-zk-verification feature must NEVER be used in production builds!");

/// Verify eligibility proof via Sunspot Groth16 verifier
pub fn verify_eligibility_proof(
    verifier_program: &AccountInfo,
    proof: &[u8; 388],
    blacklist_root: &[u8; 32],
    user_address: &Pubkey,
) -> Result<bool> {
    // NO RUNTIME BYPASS - verification always runs

    #[cfg(feature = "zk-verification")]
    {
        // Build verification instruction
        let verify_ix = build_verify_instruction(
            verifier_program.key,
            proof,
            blacklist_root,
            user_address,
        )?;

        // CPI to Sunspot verifier
        anchor_lang::solana_program::program::invoke(
            &verify_ix,
            &[verifier_program.clone()],
        )?;

        msg!("ZK eligibility proof VERIFIED");
        Ok(true)
    }

    #[cfg(not(feature = "zk-verification"))]
    {
        // This code path only exists for anchor test
        // Will fail to compile if skip-zk-verification is enabled
        msg!("ZK verification not available - compile with zk-verification feature");
        Err(ConfidexError::ZkVerificationRequired.into())
    }
}
```

**Step 2.3: Update Build Scripts**

```bash
# scripts/build-production.sh
#!/bin/bash
set -e

echo "Building Confidex DEX with ZK verification ENABLED..."

# Ensure zk-verification feature is enabled
anchor build -- --features zk-verification

# Verify the binary doesn't contain bypass code
if grep -q "ZK verification DISABLED" target/deploy/confidex_dex.so; then
    echo "ERROR: Production build contains ZK bypass code!"
    exit 1
fi

echo "Production build complete - ZK verification enforced"
```

---

### Task 3: Move Program IDs to ExchangeState

**Files to Modify:**
- `programs/confidex_dex/src/state/exchange.rs`
- `programs/confidex_dex/src/cpi/arcium.rs`
- `programs/confidex_dex/src/instructions/mod.rs`

**Step 3.1: Add Program IDs to ExchangeState**

```rust
// programs/confidex_dex/src/state/exchange.rs

#[account]
pub struct ExchangeState {
    /// Exchange admin who can update settings
    pub admin: Pubkey,                    // 32 bytes
    /// Fee recipient address
    pub fee_recipient: Pubkey,            // 32 bytes
    /// Trading fee in basis points
    pub fee_bps: u16,                     // 2 bytes
    /// Merkle root of blacklisted addresses
    pub blacklist_root: [u8; 32],         // 32 bytes
    /// Whether exchange is paused
    pub paused: bool,                     // 1 byte
    /// PDA bump
    pub bump: u8,                         // 1 byte

    // NEW: Configurable program addresses
    /// Arcium core program ID
    pub arcium_program_id: Pubkey,        // 32 bytes
    /// MXE program ID (our deployed MXE wrapper)
    pub mxe_program_id: Pubkey,           // 32 bytes
    /// ZK verifier program ID
    pub verifier_program_id: Pubkey,      // 32 bytes
    /// Reserved for future use
    pub reserved: [u8; 64],               // 64 bytes
}

impl ExchangeState {
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 32 + 1 + 1 + 32 + 32 + 32 + 64;
    // SIZE = 268 bytes (was 158)

    pub const SEED: &'static [u8] = b"exchange";
}
```

**Step 3.2: Add Admin Update Instruction**

```rust
// programs/confidex_dex/src/instructions/update_program_ids.rs

use anchor_lang::prelude::*;
use crate::state::ExchangeState;
use crate::error::ConfidexError;

#[derive(Accounts)]
pub struct UpdateProgramIds<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = admin @ ConfidexError::Unauthorized,
    )]
    pub exchange: Account<'info, ExchangeState>,

    pub admin: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateProgramIds>,
    arcium_program_id: Option<Pubkey>,
    mxe_program_id: Option<Pubkey>,
    verifier_program_id: Option<Pubkey>,
) -> Result<()> {
    let exchange = &mut ctx.accounts.exchange;

    if let Some(id) = arcium_program_id {
        msg!("Updating Arcium program ID: {} -> {}", exchange.arcium_program_id, id);
        exchange.arcium_program_id = id;
    }

    if let Some(id) = mxe_program_id {
        msg!("Updating MXE program ID: {} -> {}", exchange.mxe_program_id, id);
        exchange.mxe_program_id = id;
    }

    if let Some(id) = verifier_program_id {
        msg!("Updating Verifier program ID: {} -> {}", exchange.verifier_program_id, id);
        exchange.verifier_program_id = id;
    }

    emit!(ProgramIdsUpdated {
        admin: ctx.accounts.admin.key(),
        arcium_program_id: exchange.arcium_program_id,
        mxe_program_id: exchange.mxe_program_id,
        verifier_program_id: exchange.verifier_program_id,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ProgramIdsUpdated {
    pub admin: Pubkey,
    pub arcium_program_id: Pubkey,
    pub mxe_program_id: Pubkey,
    pub verifier_program_id: Pubkey,
    pub timestamp: i64,
}
```

**Step 3.3: Update CPI to Use Dynamic IDs**

```rust
// programs/confidex_dex/src/cpi/arcium.rs

/// Get Arcium program ID from ExchangeState (dynamic)
pub fn get_arcium_program_id(exchange: &ExchangeState) -> Pubkey {
    exchange.arcium_program_id
}

/// Get MXE program ID from ExchangeState (dynamic)
pub fn get_mxe_program_id(exchange: &ExchangeState) -> Pubkey {
    exchange.mxe_program_id
}

/// Queue MPC computation using dynamic program ID
pub fn queue_mpc_computation(
    exchange: &ExchangeState,
    computation_type: ComputationType,
    inputs: &[&[u8; 64]],
    callback_program: &Pubkey,
) -> Result<[u8; 32]> {
    let mxe_program = get_mxe_program_id(exchange);

    // Build and invoke CPI with dynamic program ID
    let ix = build_queue_computation_ix(
        &mxe_program,
        computation_type,
        inputs,
        callback_program,
    )?;

    // ... invoke CPI ...

    Ok(request_id)
}
```

---

### Task 4: Add Panics on Sync MPC Fallbacks

**Files to Modify:**
- `programs/confidex_dex/src/cpi/arcium.rs`

**Step 4.1: Replace Fallbacks with Panics**

```rust
// programs/confidex_dex/src/cpi/arcium.rs

/// Sync price comparison - REMOVED IN PRODUCTION
///
/// This function exists only for compile-time backward compatibility.
/// It will PANIC if called at runtime.
#[deprecated(since = "1.0.0", note = "Use async MPC via queue_price_comparison")]
pub fn compare_prices_sync(
    _encrypted_buy_price: &[u8; 64],
    _encrypted_sell_price: &[u8; 64],
) -> Result<bool> {
    // PRODUCTION: This must NEVER be called
    // All price comparisons must go through async MPC
    panic!(
        "FATAL: Sync MPC fallback called in production. \
         All MPC operations MUST use async queue_* functions. \
         This indicates a critical code path error."
    );
}

/// Sync fill calculation - REMOVED IN PRODUCTION
#[deprecated(since = "1.0.0", note = "Use async MPC via queue_fill_calculation")]
pub fn calculate_fill_sync(
    _encrypted_buy_amount: &[u8; 64],
    _encrypted_sell_amount: &[u8; 64],
    _encrypted_buy_filled: &[u8; 64],
    _encrypted_sell_filled: &[u8; 64],
) -> Result<(u64, bool, bool)> {
    panic!(
        "FATAL: Sync MPC fallback called in production. \
         All MPC operations MUST use async queue_* functions. \
         This indicates a critical code path error."
    );
}

/// Sync add operation - REMOVED IN PRODUCTION
#[deprecated(since = "1.0.0", note = "Use async MPC via queue_encrypted_add")]
pub fn encrypted_add_sync(
    _a: &[u8; 64],
    _b: &[u8; 64],
) -> Result<[u8; 64]> {
    panic!(
        "FATAL: Sync MPC fallback called in production. \
         Encrypted arithmetic MUST use async MPC."
    );
}

/// Sync subtract operation - REMOVED IN PRODUCTION
#[deprecated(since = "1.0.0", note = "Use async MPC via queue_encrypted_sub")]
pub fn encrypted_sub_sync(
    _a: &[u8; 64],
    _b: &[u8; 64],
) -> Result<[u8; 64]> {
    panic!(
        "FATAL: Sync MPC fallback called in production. \
         Encrypted arithmetic MUST use async MPC."
    );
}
```

**Step 4.2: Remove All Sync Calls from Instructions**

```rust
// programs/confidex_dex/src/instructions/match_orders.rs

pub fn handler(ctx: Context<MatchOrders>) -> Result<()> {
    let buy_order = &ctx.accounts.buy_order;
    let sell_order = &ctx.accounts.sell_order;

    // REMOVED: Sync fallback path
    // OLD CODE (REMOVED):
    // if USE_SYNC_MPC {
    //     let prices_match = compare_prices_sync(&buy_price, &sell_price)?;
    //     ...
    // }

    // REQUIRED: Always use async MPC
    let request_id = queue_price_comparison(
        &ctx.accounts.exchange,
        &buy_order.encrypted_price,
        &sell_order.encrypted_price,
        &crate::ID,
    )?;

    // Mark orders as matching
    ctx.accounts.buy_order.is_matching = true;
    ctx.accounts.sell_order.is_matching = true;
    ctx.accounts.buy_order.pending_match_request = request_id;
    ctx.accounts.sell_order.pending_match_request = request_id;

    emit!(MatchQueued {
        buy_order: ctx.accounts.buy_order.key(),
        sell_order: ctx.accounts.sell_order.key(),
        request_id,
    });

    Ok(())
}
```

---

### Task 5: Implement Oracle Timestamp Validation

**Files to Modify:**
- `programs/confidex_dex/src/instructions/perp_liquidate.rs`
- `programs/confidex_dex/src/error.rs`

**Step 5.1: Add Error Code**

```rust
// programs/confidex_dex/src/error.rs

#[error_code]
pub enum ConfidexError {
    // ... existing errors ...

    #[msg("Oracle price is stale (older than 60 seconds)")]
    StaleOraclePrice,

    #[msg("Oracle confidence interval too wide")]
    OracleConfidenceTooWide,
}
```

**Step 5.2: Add Oracle Validation Helper**

```rust
// programs/confidex_dex/src/helpers/oracle.rs

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::error::ConfidexError;

/// Maximum age of oracle price in seconds
pub const MAX_ORACLE_AGE_SECS: i64 = 60;

/// Maximum confidence interval as percentage of price (5%)
pub const MAX_CONFIDENCE_RATIO: u64 = 500; // basis points

/// Validated oracle price with freshness guarantee
pub struct ValidatedOraclePrice {
    pub price: i64,
    pub conf: u64,
    pub publish_time: i64,
    pub expo: i32,
}

/// Get and validate oracle price
pub fn get_validated_oracle_price(
    oracle: &Account<PriceUpdateV2>,
) -> Result<ValidatedOraclePrice> {
    let price_data = oracle.get_price_unchecked();
    let current_time = Clock::get()?.unix_timestamp;

    // Check freshness
    let age = current_time - price_data.publish_time;
    require!(
        age <= MAX_ORACLE_AGE_SECS,
        ConfidexError::StaleOraclePrice
    );

    // Check confidence interval
    let confidence_ratio = (price_data.conf as u128 * 10000) / price_data.price.unsigned_abs() as u128;
    require!(
        confidence_ratio <= MAX_CONFIDENCE_RATIO as u128,
        ConfidexError::OracleConfidenceTooWide
    );

    msg!(
        "Oracle validated: price={}, conf={}, age={}s",
        price_data.price,
        price_data.conf,
        age
    );

    Ok(ValidatedOraclePrice {
        price: price_data.price,
        conf: price_data.conf,
        publish_time: price_data.publish_time,
        expo: price_data.expo,
    })
}
```

**Step 5.3: Update Liquidation Instruction**

```rust
// programs/confidex_dex/src/instructions/perp_liquidate.rs

use crate::helpers::oracle::get_validated_oracle_price;

pub fn handler(ctx: Context<PerpLiquidate>) -> Result<()> {
    // VALIDATE oracle freshness before using price
    let oracle_price = get_validated_oracle_price(&ctx.accounts.oracle)?;

    msg!(
        "Using validated oracle price: {} (age: {}s, conf: {})",
        oracle_price.price,
        Clock::get()?.unix_timestamp - oracle_price.publish_time,
        oracle_price.conf
    );

    // Now safe to use oracle_price for liquidation check
    let mark_price = oracle_price.price as u64;

    // Queue MPC liquidation check with validated price
    let request_id = queue_liquidation_check(
        &ctx.accounts.exchange,
        &ctx.accounts.position.encrypted_liq_threshold,
        mark_price,
        &crate::ID,
    )?;

    // ... rest of liquidation logic ...

    Ok(())
}
```

---

## Migration Strategy

### Phase 1: Prepare (No User Impact)
1. Deploy new ExchangeState with program ID fields
2. Add update_program_ids instruction
3. Run migrations to initialize new fields

### Phase 2: Feature Flag (Gradual Rollout)
1. Deploy V5 order format support (dual-read V4/V5)
2. Enable ZK verification for new orders only
3. Monitor error rates

### Phase 3: Full Cutover
1. Stop accepting V4 orders
2. Migrate remaining V4 orders to V5 on first interaction
3. Remove sync MPC fallback code paths

### Phase 4: Cleanup
1. Remove V4 parsing code
2. Update all documentation
3. Archive migration scripts

---

## Acceptance Criteria

- [ ] **V5 Order Format**
  - [ ] No `amount_plaintext` field in order struct
  - [ ] No `price_plaintext` field in order struct
  - [ ] No `filled_plaintext` field in order struct
  - [ ] Order SIZE = 366 bytes
  - [ ] Backend parses V5 format correctly

- [ ] **ZK Verification**
  - [ ] `ZK_VERIFICATION_ENABLED` removed (compile-time only)
  - [ ] `skip-zk-verification` feature causes compile error with message
  - [ ] Production build script verifies no bypass code
  - [ ] All orders require valid ZK proof

- [ ] **Dynamic Program IDs**
  - [ ] ExchangeState contains `arcium_program_id`
  - [ ] ExchangeState contains `mxe_program_id`
  - [ ] ExchangeState contains `verifier_program_id`
  - [ ] Admin can update IDs via `update_program_ids`
  - [ ] Event emitted on update

- [ ] **Sync MPC Removal**
  - [ ] `compare_prices_sync` panics with clear message
  - [ ] `calculate_fill_sync` panics with clear message
  - [ ] `encrypted_add_sync` panics with clear message
  - [ ] `encrypted_sub_sync` panics with clear message
  - [ ] No code paths call sync functions

- [ ] **Oracle Validation**
  - [ ] Liquidation requires oracle age < 60 seconds
  - [ ] Liquidation checks oracle confidence interval
  - [ ] `StaleOraclePrice` error code exists
  - [ ] `OracleConfidenceTooWide` error code exists

- [ ] **Tests**
  - [ ] `anchor test` passes
  - [ ] Integration tests for V5 order flow
  - [ ] Integration tests for ZK verification
  - [ ] Integration tests for oracle validation

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| V4→V5 migration breaks existing orders | High | Dual-read support during transition |
| ZK verification too slow | Medium | Client-side proof caching, parallel generation |
| Oracle provider downtime | High | Multiple oracle fallbacks (Pyth + Switchboard) |
| Admin key compromise | Critical | Multisig admin, timelock on updates |

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Sunspot verifier deployment | Ready | Program ID: `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W` |
| Arcium cluster 456 | Ready | Production MPC available |
| Pyth oracle | Ready | SOL/USD feed active |

---

## Verification Commands

```bash
# Build with ZK verification
anchor build -- --features zk-verification

# Run tests
anchor test

# Verify no plaintext in binary
! grep -q "amount_plaintext\|price_plaintext\|filled_plaintext" target/deploy/confidex_dex.so

# Verify no bypass code
! grep -q "ZK verification DISABLED" target/deploy/confidex_dex.so

# Check order account size
solana account <order-pda> --output json | jq '.data | length'
# Should be 366 for V5
```

---

## References

- [Order Format Documentation](../MPC_MATCHING_SETTLEMENT.md)
- [Arcium MPC Integration](ARCIUM_MPC_INTEGRATION.md)
- [Sunspot ZK Verification](https://docs.sunspot.gg)
- [Pyth Oracle Documentation](https://docs.pyth.network)
