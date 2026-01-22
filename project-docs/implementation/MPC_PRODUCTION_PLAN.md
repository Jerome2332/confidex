# MPC Production Plan

## Current State

The async MPC flow is partially working on devnet:
1. `match_orders` queues a price comparison to `arcium_mxe` ✅
2. Orders transition to `Matching` status ✅
3. A `ComputationRequest` account is created on-chain ✅
4. Callback simulator can call `process_callback` ✅
5. `process_callback` CPIs to DEX ✅

**Blocker:** The DEX callback instruction (`receive_compare_result`) expects accounts that the MXE callback doesn't pass:
- `pending_match` account (not created in current flow)
- `buy_order` and `sell_order` accounts

**Root cause:** The MXE callback was designed generically but the DEX callback expects specific accounts.

## Recommended Fix

### Option A: Simplified Callback (Recommended for hackathon)

Create a new DEX instruction `process_mpc_result` that:
1. Takes only `mxe_authority` as signer (verifies source)
2. Takes `request_id` and `result` as instruction data
3. Looks up orders by iterating orders with matching `pending_match_request`
4. Updates order states based on result

This avoids the account passing problem since the DEX can look up its own orders.

### Option B: Full Callback Infrastructure

Update MXE to store callback accounts alongside the computation request, then pass them through.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRODUCTION FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

1. USER PLACES ORDERS
   ┌──────────┐        ┌──────────┐
   │ Buy Order │        │Sell Order│
   │  (Alice)  │        │  (Bob)   │
   └─────┬────┘        └────┬─────┘
         │                  │
         └────────┬─────────┘
                  ▼
2. CRANK INITIATES MATCH
   ┌─────────────────────────────────────────┐
   │          match_orders (DEX)             │
   │  - Verifies eligibility proofs          │
   │  - Queues price comparison to MXE       │
   │  - Creates PendingMatch account         │
   │  - Orders → Matching status             │
   └────────────────┬────────────────────────┘
                    │ CPI
                    ▼
3. MXE QUEUES COMPUTATION
   ┌─────────────────────────────────────────┐
   │      queue_compare_prices (MXE)         │
   │  - Creates ComputationRequest account   │
   │  - Stores encrypted inputs              │
   │  - Emits ComputationQueued event        │
   └────────────────┬────────────────────────┘
                    │ Off-chain
                    ▼
4. ARCIUM CLUSTER EXECUTES MPC
   ┌─────────────────────────────────────────┐
   │          Arx Nodes (Cerberus)           │
   │  - Pick up request from mempool         │
   │  - Execute MPC: buy_price >= sell_price │
   │  - Threshold signing on result          │
   │  - Post result via process_callback     │
   └────────────────┬────────────────────────┘
                    │ On-chain
                    ▼
5. MXE RECEIVES CALLBACK
   ┌─────────────────────────────────────────┐
   │       process_callback (MXE)            │
   │  - Validates cluster signature          │
   │  - Updates ComputationRequest           │
   │  - CPIs to callback_program (DEX)       │
   └────────────────┬────────────────────────┘
                    │ CPI
                    ▼
6. DEX PROCESSES RESULT
   ┌─────────────────────────────────────────┐
   │     receive_compare_result (DEX)        │
   │  - Parses MPC result (prices_match)     │
   │  - If match: Queue calculate_fill       │
   │  - If no match: Close pending_match     │
   └────────────────┬────────────────────────┘
                    │ (repeat 4-5 for fill)
                    ▼
7. ORDERS FILLED
   ┌─────────────────────────────────────────┐
   │     receive_fill_result (DEX)           │
   │  - Updates order.encrypted_filled       │
   │  - Orders → Filled/PartiallyFilled      │
   │  - Triggers settlement (C-SPL/Shadow)   │
   └─────────────────────────────────────────┘
```

## What Needs to Happen

### Option A: Real Arcium Cluster (Production)

1. **Deploy to Arcium Devnet Cluster**
   - Register MXE with Arcium (cluster offset 123, 456, or 789)
   - Arx nodes monitor for `ComputationQueued` events
   - Automatic pickup and execution

2. **Requirements:**
   - Arcium cluster subscription/registration
   - Sufficient SOL for computation fees
   - Cluster must support our `ComputationType` variants

3. **Timeline:** When Arcium devnet clusters are fully operational

### Option B: Simulated Callback (Testing/Demo)

Create a "callback simulator" that:
1. Monitors for `ComputationQueued` events
2. Reads the encrypted inputs from `ComputationRequest`
3. Computes result using simulated MPC (extracts plaintext from first 8 bytes)
4. Calls `process_callback` on arcium_mxe

This allows full end-to-end testing without real Arcium cluster.

## Implementation Plan

### Phase 1: Callback Simulator (Immediate)

Create `/frontend/scripts/callback-simulator.ts`:

```typescript
// Pseudocode
async function runCallbackSimulator() {
  // 1. Subscribe to ComputationQueued events
  connection.onLogs(MXE_PROGRAM_ID, (logs) => {
    if (logs.includes("ComputationQueued")) {
      processCallback(parseEvent(logs));
    }
  });

  // 2. Or poll for pending requests
  const requests = await fetchPendingComputations();
  for (const request of requests) {
    await processCallback(request);
  }
}

async function processCallback(request: ComputationRequest) {
  // 1. Extract encrypted inputs
  const [buyPrice, sellPrice] = parseInputs(request.inputs);

  // 2. Simulate MPC (dev only - extract plaintext)
  const buyPricePlain = extractPlaintext(buyPrice);
  const sellPricePlain = extractPlaintext(sellPrice);
  const result = buyPricePlain >= sellPricePlain ? 1 : 0;

  // 3. Build and send process_callback tx
  const tx = buildProcessCallbackTx({
    requestId: request.request_id,
    result: [result],
    success: true,
  });
  await sendAndConfirmTransaction(tx);
}
```

### Phase 2: Create PendingMatch Account

The current `match_orders` flow doesn't create a `PendingMatch` account, but the callback expects one. We need to either:

**Option 2A:** Create PendingMatch in match_orders
- Add `init` constraint for pending_match account
- Store buy_order, sell_order, request_id

**Option 2B:** Simplify callback to not require PendingMatch
- Callback directly updates orders based on request_id stored in `order.pending_match_request`

**Recommendation:** Option 2B is simpler. The `pending_match_request` field already exists on orders.

### Phase 3: Update Callback Handler

Modify `receive_compare_result` to:
1. Look up orders by their `pending_match_request` field
2. Don't require a PendingMatch account (optional enhancement)

```rust
// Find orders with this request_id
// orders.pending_match_request == request_id
```

### Phase 4: Settlement Integration

After orders are filled:
1. Calculate token amounts to transfer
2. Execute via C-SPL confidential transfer OR ShadowWire
3. Update user balances

## Immediate Next Steps

### Step 1: Build Callback Simulator Script

```bash
# Creates script that:
# 1. Fetches ComputationRequest at AN9TKHUs525NW6fbQx8R4CPnHRkzHw9kAJBweYjGeHxE
# 2. Simulates MPC result
# 3. Calls process_callback
```

### Step 2: Test Full Flow

1. Place buy order ✅
2. Place sell order ✅
3. Run match_orders ✅ (orders now in Matching state)
4. Run callback simulator (orders → Filled)
5. Verify order states updated

### Step 3: Add Settlement

After successful match:
1. Escrow base tokens from seller
2. Escrow quote tokens from buyer
3. Execute atomic swap

## Account Reference

### Current State
- **Buy Order:** `4diuWKmtWj36iDZUaVkadSzXKEpmzvptiADnLFWB8fQY` (150 USDC, 1 SOL)
- **Sell Order:** `7SqAAnb3Q8Mha8KFz7FYxX2jnP5zphj9hxcSozFaDiup` (150 USDC, 1 SOL)
- **Computation Request:** `AN9TKHUs525NW6fbQx8R4CPnHRkzHw9kAJBweYjGeHxE`
- **MXE Config:** `GqZ3v32aFzr1s5N4vSo6piur8pHuWw4jZpKW5xEy31qK`
- **MXE Authority:** `9WH1PNEpvHQDLTUm1W3MuwSdsbTtLMK8eoy2SyNBLnyn`

### PDAs
```
MXE_PROGRAM_ID = HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS
DEX_PROGRAM_ID = 63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB

mxe_config     = ["mxe_config"]
mxe_authority  = ["mxe_authority"]
computation    = ["computation", count.to_le_bytes()]
```

## Security Considerations

1. **Callback Authorization:** Only accept callbacks signed by `mxe_authority` PDA
2. **Request Validation:** Verify request_id matches pending computation
3. **Replay Protection:** Mark requests as completed after processing
4. **Timeout Handling:** Allow cancellation of stale Matching orders

## File Locations

| File | Purpose |
|------|---------|
| `programs/arcium_mxe/src/instructions/callback.rs` | Receives result from cluster, CPIs to DEX |
| `programs/confidex_dex/src/instructions/mpc_callback.rs` | DEX callback handlers |
| `programs/confidex_dex/src/instructions/match_orders.rs` | Queues MPC computation |
| `programs/confidex_dex/src/state/pending_match.rs` | PendingMatch account (optional) |
| `frontend/src/lib/confidex-client.ts` | Client transaction builders |
| `frontend/test-match.ts` | Match testing script |
