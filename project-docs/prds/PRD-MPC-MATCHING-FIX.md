# PRD: MPC Matching and Settlement Flow Fix

## Overview

This PRD addresses 12 critical and major issues preventing the MPC-based order matching and settlement flow from completing successfully. Orders currently get stuck in a loop of repeated matching attempts because the async MPC flow is incomplete and the backend expects deprecated V4 order format.

**Priority:** 🔴 CRITICAL
**Estimated Complexity:** High
**Prerequisite:** Deploy updated `settle_order.rs` (clears `encrypted_filled` after settlement)

---

## Problem Statement

The Confidex crank service cannot successfully complete the order matching → MPC verification → settlement flow. Root causes:

1. **Format Mismatch:** Backend expects V4 orders (390 bytes) but on-chain uses V5 (366 bytes)
2. **Incomplete Async Flow:** MPC callback sets a fake marker instead of real fill amounts
3. **Missing Fill Calculation:** Async flow queues price comparison but never queues fill calculation
4. **State Machine Bugs:** Partially filled orders can be re-matched infinitely

---

## Scope

### In Scope
- Fix backend order parsing for V5 format (366 bytes)
- Complete the async MPC flow with fill calculation
- Fix order state management to prevent re-matching
- Add proper coordination between crank components
- Fix settlement executor pair matching logic

### Out of Scope
- C-SPL integration (future)
- Sync MPC flow (already works, keep as fallback)
- Frontend changes

---

## Technical Analysis

### Current Order Format (V5 - 366 bytes)

```rust
// programs/confidex_dex/src/state/order.rs
pub struct ConfidentialOrder {
    pub maker: Pubkey,                    // 32 bytes (offset 8)
    pub pair: Pubkey,                     // 32 bytes (offset 40)
    pub side: Side,                       // 1 byte (offset 72)
    pub order_type: OrderType,            // 1 byte (offset 73)
    pub encrypted_amount: [u8; 64],       // 64 bytes (offset 74)
    pub encrypted_price: [u8; 64],        // 64 bytes (offset 138)
    pub encrypted_filled: [u8; 64],       // 64 bytes (offset 202)
    pub status: OrderStatus,              // 1 byte (offset 266)
    pub created_at: i64,                  // 8 bytes (offset 267)
    pub order_id: [u8; 16],               // 16 bytes (offset 275)
    pub order_nonce: u64,                 // 8 bytes (offset 291)
    pub eligibility_proof_verified: bool, // 1 byte (offset 299)
    pub pending_match_request: Pubkey,    // 32 bytes (offset 300)
    pub is_matching: bool,                // 1 byte (offset 332)
    pub bump: u8,                         // 1 byte (offset 333)
    pub ephemeral_pubkey: [u8; 32],       // 32 bytes (offset 334)
}
// Total: 366 bytes (8 discriminator + 358 data)
```

**Key Change from V4:** No plaintext fields (`amount_plaintext`, `price_plaintext`, `filled_plaintext` removed)

### Current Flow (Broken)

```
1. OrderMonitor.fetchOpenOrders()
   ❌ Filters for 390-byte accounts → Finds 0 orders

2. MatchingAlgorithm.findMatchableOrders()
   ❌ Receives empty array → No matches

3. MatchExecutor.executeMatch()
   ❌ Never called

4. MPC Callback (if somehow triggered)
   ❌ Sets encrypted_filled[0] = 0xFF (fake marker, not real fill)

5. SettlementExecutor.pollForSettlements()
   ❌ Looks for filledPlaintext > 0 → Never finds matches
```

### Target Flow (Fixed)

```
1. OrderMonitor.fetchOpenOrders()
   ✅ Fetches 366-byte V5 accounts
   ✅ Parses encrypted fields correctly

2. MatchingAlgorithm.findMatchableOrders()
   ✅ Matches orders by pair and opposite sides
   ✅ Returns candidate pairs

3. MatchExecutor.executeMatch()
   ✅ Calls match_orders with async flow
   ✅ Queues MPC price comparison AND fill calculation

4. MPC Callback (finalize_match)
   ✅ Receives actual fill amount from MPC
   ✅ Sets encrypted_filled to real MPC-computed value
   ✅ Updates order status correctly

5. SettlementExecutor.pollForSettlements()
   ✅ Detects encrypted_filled[0] != 0
   ✅ Matches pairs by pending_match_request (same request ID)
   ✅ Calls settle_order instruction
   ✅ On-chain clears encrypted_filled → prevents re-settlement
```

---

## Implementation Plan

### Phase 1: Backend V5 Format Support

#### Task 1.1: Update Order Monitor for V5 Format
**File:** `backend/src/crank/order-monitor.ts`

```typescript
// Change from:
const ORDER_ACCOUNT_SIZE_V4 = 390;

// To:
const ORDER_ACCOUNT_SIZE_V5 = 366;

// Update parseOrder() for V5 layout:
private parseOrder(data: Buffer): ParsedOrder | null {
  const dataSize = data.length;

  // V5 format: 366 bytes (no plaintext fields)
  if (dataSize === 366) {
    let offset = 8; // Skip discriminator

    const maker = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const pair = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const side = data[offset] as Side;
    offset += 1;

    const orderType = data[offset];
    offset += 1;

    const encryptedAmount = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedPrice = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const encryptedFilled = new Uint8Array(data.subarray(offset, offset + 64));
    offset += 64;

    const status = data[offset] as OrderStatus;
    offset += 1;

    const createdAt = data.readBigInt64LE(offset);
    offset += 8;

    const orderId = new Uint8Array(data.subarray(offset, offset + 16));
    offset += 16;

    const orderNonce = data.readBigUInt64LE(offset);
    offset += 8;

    const eligibilityProofVerified = data[offset] === 1;
    offset += 1;

    const pendingMatchRequest = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const isMatching = data[offset] === 1;
    offset += 1;

    const bump = data[offset];
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
      createdAt: Number(createdAt),
      orderId,
      orderNonce,
      eligibilityProofVerified,
      pendingMatchRequest,
      isMatching,
      bump,
      ephemeralPubkey,
    };
  }

  return null; // Unknown format
}
```

#### Task 1.2: Update Settlement Executor for V5 Format
**File:** `backend/src/crank/settlement-executor.ts`

```typescript
// Change pair matching logic from plaintext comparison to request ID comparison:

// OLD (broken):
if (buy.fillKey !== sell.fillKey) {
  continue;
}

// NEW (correct):
// Orders matched together share the same pending_match_request
if (!buy.order.pendingMatchRequest.equals(sell.order.pendingMatchRequest)) {
  continue;
}
// Also verify the request is non-zero (orders were actually matched)
if (buy.order.pendingMatchRequest.equals(PublicKey.default)) {
  continue;
}
```

#### Task 1.3: Update Detection of Filled Orders
**File:** `backend/src/crank/settlement-executor.ts`

```typescript
// OLD: Check plaintext field
const fillAmount = order.filledPlaintext;
if (fillAmount > 0) { ... }

// NEW: Check encrypted marker (first byte non-zero = MPC computed fill)
const hasFill = order.encryptedFilled[0] !== 0;
if (hasFill) { ... }
```

### Phase 2: Fix On-Chain MPC Callback

#### Task 2.1: Update finalize_match to Use Real Fill Values
**File:** `programs/confidex_dex/src/instructions/mpc_callback.rs`

The current callback sets a fake marker:
```rust
// WRONG - sets fake marker
buy_order.encrypted_filled[0] = 0xFF;
sell_order.encrypted_filled[0] = 0xFF;
```

Change to use actual MPC result:
```rust
// CORRECT - use MPC-computed fill amount
// The MPC result contains the encrypted fill amount
let fill_result = &ctx.accounts.mpc_result;
let encrypted_fill = fill_result.encrypted_output; // 64-byte ciphertext

buy_order.encrypted_filled = encrypted_fill;
sell_order.encrypted_filled = encrypted_fill;
```

**Note:** This requires the MPC computation to return an encrypted fill amount, not just a boolean.

#### Task 2.2: Add Fill Calculation MPC Call
**File:** `programs/confidex_dex/src/instructions/match_orders.rs`

After queuing price comparison, also queue fill calculation:
```rust
// After queue_compare_prices succeeds:
if prices_match {
    // Queue fill calculation MPC
    let fill_request = queue_calculate_fill(
        &ctx.accounts.mpc_program,
        buy_order.encrypted_amount,
        sell_order.encrypted_amount,
        buy_order.encrypted_filled,  // already filled portion
        sell_order.encrypted_filled,
    )?;

    // Store request ID for callback correlation
    buy_order.pending_match_request = fill_request.request_id;
    sell_order.pending_match_request = fill_request.request_id;
}
```

### Phase 3: Fix Order State Management

#### Task 3.1: Prevent Re-Matching of Partially Filled Orders
**File:** `programs/confidex_dex/src/instructions/mpc_callback.rs`

```rust
// In finalize_match, always set is_matching = true until FULLY settled
// Only settlement instruction should clear is_matching

// CURRENT (wrong):
buy_order.is_matching = false;

// FIXED:
// Keep is_matching = true if order still has unfilled capacity
// Settlement executor will clear it after successful settlement
if buy_fully_filled {
    buy_order.status = OrderStatus::Inactive;
}
// Don't clear is_matching here - let settlement do it
```

#### Task 3.2: Clear is_matching in Settlement
**File:** `programs/confidex_dex/src/instructions/settle_order.rs`

```rust
// After successful settlement, clear matching state
buy_order.is_matching = false;
sell_order.is_matching = false;
buy_order.pending_match_request = Pubkey::default();
sell_order.pending_match_request = Pubkey::default();
```

### Phase 4: Add Coordination Between Components

#### Task 4.1: Add Request Tracking to Match Executor
**File:** `backend/src/crank/match-executor.ts`

```typescript
// Track in-flight match requests to prevent duplicate submissions
private pendingMatches: Map<string, {
  buyOrder: PublicKey;
  sellOrder: PublicKey;
  requestId: PublicKey;
  submittedAt: number;
}> = new Map();

// Before submitting match:
const pairKey = `${buyPda.toBase58()}-${sellPda.toBase58()}`;
if (this.pendingMatches.has(pairKey)) {
  log.debug({ pairKey }, 'Match already pending, skipping');
  return;
}

// After submitting:
this.pendingMatches.set(pairKey, {
  buyOrder: buyPda,
  sellOrder: sellPda,
  requestId: result.requestId,
  submittedAt: Date.now(),
});
```

#### Task 4.2: Add Request Cleanup on MPC Completion
**File:** `backend/src/crank/mpc-poller.ts`

```typescript
// After processing callback result, notify match executor
private async notifyMatchExecutor(requestId: PublicKey): Promise<void> {
  // Emit event or call method to clear pending match
  this.matchExecutor?.clearPendingMatch(requestId);
}
```

### Phase 5: Fix Settlement Executor Race Conditions

#### Task 5.1: Add Distributed Locking for Settlement
**File:** `backend/src/crank/settlement-executor.ts`

```typescript
// Use order PDAs as lock keys
private settlementLocks: Map<string, number> = new Map();
private readonly LOCK_TIMEOUT_MS = 30000; // 30 second lock

private acquireLock(settlementKey: string): boolean {
  const existing = this.settlementLocks.get(settlementKey);
  const now = Date.now();

  if (existing && now - existing < this.LOCK_TIMEOUT_MS) {
    return false; // Lock held by another operation
  }

  this.settlementLocks.set(settlementKey, now);
  return true;
}

private releaseLock(settlementKey: string): void {
  this.settlementLocks.delete(settlementKey);
}

// In pollForSettlements:
if (!this.acquireLock(settlementKey)) {
  continue; // Another settlement in progress
}

try {
  await this.settleOrders(buy.pda, sell.pda, buy.order, sell.order);
  this.settledOrders.add(settlementKey);
} finally {
  this.releaseLock(settlementKey);
}
```

---

## Acceptance Criteria

### Must Have
- [ ] Order monitor fetches 366-byte V5 orders successfully
- [ ] Settlement executor matches orders by `pending_match_request`, not plaintext
- [ ] Filled orders detected by `encrypted_filled[0] != 0`
- [ ] Orders cannot be re-matched while `is_matching = true`
- [ ] Settlement clears `is_matching` and `pending_match_request`
- [ ] No duplicate settlement attempts for same order pair

### Should Have
- [ ] Match executor tracks in-flight requests
- [ ] MPC poller notifies match executor on completion
- [ ] Settlement executor uses distributed locking
- [ ] Cleanup of stale locks after timeout

### Nice to Have
- [ ] Metrics for match/settlement success rates
- [ ] Alert on repeated settlement failures
- [ ] Dashboard showing order state distribution

---

## Testing Plan

### Unit Tests
1. **Order parsing:** Verify V5 format (366 bytes) parsed correctly
2. **State transitions:** Test order status changes through full lifecycle
3. **Lock management:** Verify settlement locking prevents races

### Integration Tests
1. **Full flow test:**
   - Place buy and sell orders
   - Verify matching triggered
   - Verify MPC callback received
   - Verify settlement executed
   - Verify orders marked as filled

2. **Partial fill test:**
   - Place large buy order
   - Place small sell order
   - Verify partial fill calculated correctly
   - Verify remaining quantity can be matched again

3. **Concurrent settlement test:**
   - Simulate two crank instances
   - Verify only one settles successfully
   - Verify other gracefully skips

### Manual Tests
1. Place orders via frontend
2. Monitor crank logs for successful flow
3. Verify token balances updated correctly
4. Verify order status in explorer

---

## Rollback Plan

If issues arise after deployment:

1. **Backend:** Revert to V4 parsing (requires V4 orders on-chain)
2. **On-chain:** Keep old `settle_order` behavior (don't clear `encrypted_filled`)
3. **Crank:** Disable async MPC, use sync flow only

---

## Dependencies

| Dependency | Status | Blocking? |
|------------|--------|-----------|
| Deploy updated `settle_order.rs` | Pending (needs SOL) | Yes |
| Arcium MXE keygen complete | ✅ Done | No |
| V5 orders on devnet | ✅ Active | No |

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/src/crank/order-monitor.ts` | V5 format parsing |
| `backend/src/crank/settlement-executor.ts` | Request ID matching, locking |
| `backend/src/crank/match-executor.ts` | Pending match tracking |
| `backend/src/crank/mpc-poller.ts` | Callback notification |
| `backend/src/crank/types.ts` | Update ParsedOrder interface |
| `programs/confidex_dex/src/instructions/mpc_callback.rs` | Real fill values |
| `programs/confidex_dex/src/instructions/settle_order.rs` | Clear is_matching |
| `programs/confidex_dex/src/instructions/match_orders.rs` | Queue fill calculation |

---

## Verification

After implementation:

```bash
# 1. Build and deploy on-chain program
cd programs/confidex_dex
anchor build --no-idl
anchor deploy --program-name confidex_dex

# 2. Build and restart backend
cd backend
pnpm build
pnpm pm2:restart

# 3. Place test orders
cd frontend
pnpm tsx place-sell-order.ts

# 4. Monitor crank logs
cd backend
pnpm pm2:logs

# Expected output:
# [INFO] [order-monitor] Fetched 2 open orders (format: V5)
# [INFO] [matching] Found matchable pair: buy=ABC... sell=DEF...
# [INFO] [match-executor] Match queued, request=XYZ...
# [INFO] [mpc-poller] Callback received for request=XYZ...
# [INFO] [settlement] ✓ Settlement successful: ABC... <-> DEF...
```

---

## Notes

- The sync MPC flow (for testing) should continue to work unchanged
- V4 orders (390 bytes) can be ignored - they're from hackathon mode
- The `ephemeral_pubkey` field in V5 is used for RescueCipher re-encryption
