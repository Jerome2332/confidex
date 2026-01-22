# MPC Order Matching & Settlement System

This document describes the complete flow from order placement through MPC matching to token settlement.

## Overview

Confidex uses a three-stage order lifecycle:
1. **Order Placement** - User places encrypted order on-chain
2. **MPC Matching** - Arcium MPC compares encrypted prices
3. **Settlement** - Crank service transfers tokens between users

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONFIDEX ORDER FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐           │
│  │ Frontend │     │ DEX      │     │ Arcium   │     │ Crank    │           │
│  │ (User)   │     │ Program  │     │ MPC      │     │ Service  │           │
│  └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘           │
│       │                │                │                │                  │
│       │ 1. place_order │                │                │                  │
│       │ (encrypted)    │                │                │                  │
│       │───────────────▶│                │                │                  │
│       │                │                │                │                  │
│       │                │ 2. match_orders│                │                  │
│       │                │◀───────────────────────────────│                  │
│       │                │                │                │                  │
│       │                │ 3. Queue MPC   │                │                  │
│       │                │───────────────▶│                │                  │
│       │                │                │                │                  │
│       │                │ 4. Callback    │                │                  │
│       │                │◀───────────────│                │                  │
│       │                │ (set filled)   │                │                  │
│       │                │                │                │                  │
│       │                │ 5. settle_order│                │                  │
│       │                │◀───────────────────────────────│                  │
│       │                │ (transfer)     │                │                  │
│       │                │                │                │                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Order Account Formats

### V5 Format (Current - 366 bytes)

The current on-chain program uses V5 format. This is the production format without hackathon plaintext fields.

| Field | Offset | Size | Description |
|-------|--------|------|-------------|
| discriminator | 0 | 8 | Anchor account discriminator |
| maker | 8 | 32 | Order creator pubkey |
| pair | 40 | 32 | Trading pair PDA |
| side | 72 | 1 | 0 = Buy, 1 = Sell |
| order_type | 73 | 1 | Order type enum |
| encrypted_amount | 74 | 64 | V2 ciphertext: `[nonce|ciphertext|ephemeral]` |
| encrypted_price | 138 | 64 | V2 ciphertext |
| encrypted_filled | 202 | 64 | V2 ciphertext - **first byte != 0 indicates fill** |
| status | 266 | 1 | 0=Active, 1=PartiallyFilled, 2=Filled, 3=Cancelled |
| created_at | 267 | 8 | Unix timestamp |
| order_id | 275 | 16 | Hash-based order ID |
| order_nonce | 291 | 8 | PDA derivation nonce |
| eligibility_proof_verified | 299 | 1 | ZK proof verified flag |
| pending_match_request | 300 | 32 | **MPC request tracking - used for pair matching** |
| is_matching | 332 | 1 | Currently in MPC match |
| bump | 333 | 1 | PDA bump |
| ephemeral_pubkey | 334 | 32 | X25519 public key for MPC |

**Key Differences from V4:**
- Removed `amount_plaintext` (8 bytes)
- Removed `price_plaintext` (8 bytes)
- Removed `filled_plaintext` (8 bytes)
- Total reduction: 24 bytes (390 → 366)

### V4 Format (Legacy - 390 bytes)

V4 orders included hackathon plaintext fields for testing. These are no longer created but may exist on-chain.

| Field | Offset | Size | Notes |
|-------|--------|------|-------|
| ... (same as V5 through bump) | 0-333 | 334 | |
| amount_plaintext | 334 | 8 | **REMOVED in V5** |
| price_plaintext | 342 | 8 | **REMOVED in V5** |
| filled_plaintext | 350 | 8 | **REMOVED in V5** |
| ephemeral_pubkey | 358 | 32 | Moved to offset 334 in V5 |

### V3 Format (Legacy - 334 bytes)

V3 orders lack both plaintext fields and ephemeral_pubkey. They cannot be used with the current program.

## Fill Detection (V5)

In V5, there are no plaintext fields. Fill detection uses the encrypted_filled field:

```typescript
// V5 fill detection - check first byte of encrypted_filled
const hasFill = order.encryptedFilled[0] !== 0;

// V4 legacy fill detection (no longer used)
// const hasFill = order.filledPlaintext > 0n;
```

## Order Pair Matching (V5)

Orders matched together share the same `pending_match_request` pubkey:

```typescript
// V5 pair matching - orders matched via MPC share request ID
const isMatchedPair =
  buy.order.pendingMatchRequest.equals(sell.order.pendingMatchRequest) &&
  !buy.order.pendingMatchRequest.equals(PublicKey.default);

// V4 legacy pair matching (no longer used)
// const isMatchedPair = buy.fillKey === sell.fillKey;
```

## Crank Service Components

### OrderMonitor (`backend/src/crank/order-monitor.ts`)

Polls on-chain order accounts and parses V5 format.

```typescript
// Fetch V5 orders (366 bytes)
const ORDER_ACCOUNT_SIZE_V5 = 366;

const accounts = await connection.getProgramAccounts(programId, {
  filters: [{ dataSize: ORDER_ACCOUNT_SIZE_V5 }],
});

// Filter for active, verified, non-matching orders
const orders = accounts.filter(order =>
  order.status === OrderStatus.Active &&
  order.eligibilityProofVerified &&
  !order.isMatching
);
```

### MatchingAlgorithm (`backend/src/crank/matching-algorithm.ts`)

Finds compatible buy/sell pairs based on:
- Same trading pair
- Opposite sides (buy + sell)
- Price compatibility (checked via MPC)

### MatchExecutor (`backend/src/crank/match-executor.ts`)

Executes the `match_orders` instruction which:
1. Marks both orders as `is_matching = true`
2. Sets `pending_match_request` to same request ID
3. Queues MPC price comparison
4. Waits for MPC callback

### SettlementExecutor (`backend/src/crank/settlement-executor.ts`)

Monitors for filled orders and executes settlement:

```typescript
// Fetch V5 orders (366 bytes)
const accounts = await connection.getProgramAccounts(programId, {
  filters: [{ dataSize: 366 }],
});

// Find orders with encrypted_filled[0] != 0 (MPC has set a fill value)
const filledOrders = accounts.filter(order =>
  order.encryptedFilled[0] !== 0 && !order.isMatching
);

// Match by pending_match_request (orders matched together share this ID)
for (const buy of filledBuys) {
  for (const sell of filledSells) {
    if (buy.order.pendingMatchRequest.equals(sell.order.pendingMatchRequest) &&
        !buy.order.pendingMatchRequest.equals(PublicKey.default) &&
        buy.pair.equals(sell.pair)) {
      await settleOrders(buy, sell);
    }
  }
}
```

## Settlement Instruction

### Accounts Required

```rust
pub struct SettleOrder<'info> {
    pub pair: Account<'info, TradingPair>,
    pub buy_order: Account<'info, ConfidentialOrder>,
    pub sell_order: Account<'info, ConfidentialOrder>,
    pub buyer_base_balance: Account<'info, UserConfidentialBalance>,
    pub buyer_quote_balance: Account<'info, UserConfidentialBalance>,
    pub seller_base_balance: Account<'info, UserConfidentialBalance>,
    pub seller_quote_balance: Account<'info, UserConfidentialBalance>,
    pub crank: Signer<'info>,
}
```

### Settlement Logic

The settlement instruction reads fill amounts from MPC callback results and transfers tokens:

```rust
// Read fill from encrypted_filled (set by MPC callback)
// The first 8 bytes contain the fill amount after MPC decryption
let fill_amount = extract_fill_from_encrypted(&buy_order.encrypted_filled);
let fill_value = fill_amount * price / PRICE_DECIMALS;

// Verify balances (critical checks)
require!(seller_base_balance >= fill_amount, InsufficientBalance);
require!(buyer_quote_balance >= fill_value, InsufficientBalance);

// Transfer tokens
seller_base_balance -= fill_amount;  // Seller sends SOL
buyer_base_balance += fill_amount;   // Buyer receives SOL
buyer_quote_balance -= fill_value;   // Buyer sends USDC
seller_quote_balance += fill_value;  // Seller receives USDC

// Clear matching state
buy_order.is_matching = false;
sell_order.is_matching = false;
buy_order.pending_match_request = Pubkey::default();
sell_order.pending_match_request = Pubkey::default();
```

## Common Errors

| Error | Code | Description | Solution |
|-------|------|-------------|----------|
| `AccountDidNotDeserialize` | 0xbbb | Wrong order format (e.g., V4 passed to V5 program) | Only use V5 (366 byte) orders |
| `InsufficientBalance` | 0x1782 | Not enough tokens for settlement | Wrap more tokens using scripts |
| `OrderNotFilled` | - | `encrypted_filled[0]` is 0 | Wait for MPC callback |
| `InvalidOrderStatus` | - | Order not in correct state | Check order status |
| `PendingMatchMismatch` | - | Orders don't share pending_match_request | Verify MPC matched these orders |

## Race Condition Prevention

The settlement executor implements several safeguards:

### Distributed Locking

```typescript
// Acquire lock before settlement
private settlementLocks: Map<string, number> = new Map();
private readonly LOCK_TIMEOUT_MS = 30000;

if (!this.acquireLock(settlementKey)) {
  continue; // Another settlement in progress
}
```

### Failure Cooldown

```typescript
// Don't retry failed settlements immediately
private failedSettlements: Map<string, number> = new Map();
private readonly FAILURE_COOLDOWN_MS = 60000;

const lastFailure = this.failedSettlements.get(settlementKey);
if (lastFailure && Date.now() - lastFailure < this.FAILURE_COOLDOWN_MS) {
  continue; // Still in cooldown
}
```

### Memory Cleanup

```typescript
// Prevent unbounded cache growth
if (this.settledOrders.size > 500) {
  const toDelete = Array.from(this.settledOrders).slice(0, 250);
  toDelete.forEach(k => this.settledOrders.delete(k));
}
```

## Testing Scripts

### Wrap Tokens for Settlement

```bash
# Wrap 200 USDC for buyer (uses ~/.config/solana/id.json)
cd frontend && pnpm tsx scripts/wrap-usdc-for-buyer.ts

# Wrap 2 SOL for seller (uses ~/.config/solana/devnet.json)
cd frontend && pnpm tsx scripts/wrap-sol-for-seller.ts
```

### Check Confidential Balances

```typescript
const USER_BALANCE_SEED = Buffer.from('user_balance');

// Derive PDA
const [balancePda] = PublicKey.findProgramAddressSync(
  [USER_BALANCE_SEED, userPubkey.toBuffer(), mintPubkey.toBuffer()],
  CONFIDEX_PROGRAM_ID
);

// Read balance (offset 72 in account data)
const accountInfo = await connection.getAccountInfo(balancePda);
const balance = accountInfo.data.readBigUInt64LE(72);
```

## Monitoring

### PM2 Logs

```bash
# View real-time logs
pm2 logs confidex-backend

# Check for successful settlements
grep "Settlement successful" backend/logs/out.log | wc -l

# Check for errors
grep -E "Error|failed|0x" backend/logs/error.log | tail -20
```

### Key Log Messages

| Message | Meaning |
|---------|---------|
| `[OrderMonitor] Fetched N open orders` | Open orders ready for matching |
| `[SettlementExecutor] Found X filled buys, Y filled sells` | Orders ready for settlement |
| `[SettlementExecutor] Attempting settlement` | Starting settlement TX |
| `[SettlementExecutor] ✓ Settlement successful` | Settlement completed |
| `[SettlementExecutor] Settlement TX failed` | Check error details |
| `[SettlementExecutor] Settlement already in progress` | Lock held, skipping |

### Crank Status API

```bash
# Check crank status
curl http://localhost:3001/admin/crank/status

# Response includes:
# - status: running/stopped
# - metrics: totalPolls, successfulMatches, failedMatches
# - config: pollingIntervalMs, useAsyncMpc
```

## Successful Settlement Example

Transaction: `31iGh6RvSLoMGxGKVmhvXarcE6NtV7hKVsKDeP8J2xVRA2smHszwRUi7xCyAWP5CCyNGW1y8mY4DLX8WbA7r1nMZ`

Explorer: https://explorer.solana.com/tx/31iGh6RvSLoMGxGKVmhvXarcE6NtV7hKVsKDeP8J2xVRA2smHszwRUi7xCyAWP5CCyNGW1y8mY4DLX8WbA7r1nMZ?cluster=devnet

**Settlement Details:**
- Fill amount: 100,000,000 lamports (0.1 SOL)
- Fill value: 14,500,000 micros (14.5 USDC)
- Price: 145,000,000 (145 USDC/SOL)

## Version History

| Date | Change |
|------|--------|
| 2026-01-21 | **V5 format documentation** - Updated for 366-byte orders, removed plaintext fields |
| 2026-01-21 | Added race condition prevention (locking, cooldown, cleanup) |
| 2026-01-21 | Updated pair matching to use `pending_match_request` instead of plaintext |
| 2026-01-21 | Updated fill detection to use `encrypted_filled[0] != 0` |
| 2026-01-21 | Fixed V3/V4 order size mismatch in settlement-executor.ts |
| 2026-01-21 | Fixed UserConfidentialBalance offset in wrap scripts |
| 2026-01-21 | Added V4-only matching in order-monitor.ts |
| 2026-01-20 | Initial MPC matching implementation |
