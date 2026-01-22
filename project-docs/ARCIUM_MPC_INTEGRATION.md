# Arcium MPC Integration

This document details the Arcium Multi-Party Computation (MPC) integration for Confidex's encrypted order matching system.

## Overview

Confidex uses Arcium's MPC infrastructure to enable **true encrypted order matching** where:
- Order prices and amounts are never revealed on-chain
- Price comparisons happen on fully encrypted data
- Only the boolean result (match/no match) is revealed
- Fill amounts remain encrypted throughout

## Deployed Programs

| Program | Program ID | Network |
|---------|-----------|---------|
| **confidex_dex** | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` | Devnet |
| **confidex_mxe** | `HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS` | Devnet |
| **Arcium Core** | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` | Devnet |

**MXE X25519 Public Key:** `46589a2f72e04b041864f84900632a8a017173ddc002f37d5ab3c7a69e1a1f1b`

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          CONFIDEX DEX                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │ place_order │───▶│match_orders │───▶│ MPC Callback│              │
│  │ (encrypted) │    │ (queue MPC) │    │  Receivers  │              │
│  └─────────────┘    └──────┬──────┘    └──────▲──────┘              │
│                            │                   │                      │
│                            │ CPI               │ CPI                  │
│                            ▼                   │                      │
├──────────────────────────────────────────────────────────────────────┤
│                         ARCIUM MXE                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐           │
│  │queue_compare │───▶│ Computation  │───▶│process_      │           │
│  │_prices       │    │ Request      │    │callback      │           │
│  └──────────────┘    └──────┬───────┘    └──────────────┘           │
│                             │                                         │
└─────────────────────────────┼─────────────────────────────────────────┘
                              │
                              ▼ Arcium Mempool
┌──────────────────────────────────────────────────────────────────────┐
│                      ARCIUM CLUSTER (Arx Nodes)                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐           │
│  │ Node 1  │    │ Node 2  │    │ Node 3  │    │ Node N  │           │
│  │(Cerberus│◄──►│(Cerberus│◄──►│(Cerberus│◄──►│(Cerberus│           │
│  │Protocol)│    │Protocol)│    │Protocol)│    │Protocol)│           │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘           │
│                                                                       │
│  Security: Dishonest majority (N-1 nodes can collude)                │
│  Protocol: Cerberus with MAC authentication                          │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Key Files

### On-Chain Programs (Rust)

| File | Description |
|------|-------------|
| `programs/confidex_dex/src/cpi/arcium.rs` | CPI infrastructure, program IDs, MPC queue functions |
| `programs/confidex_dex/src/instructions/mpc_callback.rs` | `ReceiveCompareResult`, `ReceiveFillResult` handlers |
| `programs/confidex_dex/src/state/pending_match.rs` | `PendingMatch` account structure |
| `programs/arcium_mxe/src/instructions/callback.rs` | MXE callback processor with CPI to DEX |
| `programs/arcium_mxe/src/state/mod.rs` | `MxeConfig`, `ComputationRequest`, `ComputationType` |

### Frontend (TypeScript)

| File | Description |
|------|-------------|
| `frontend/src/hooks/use-encryption.ts` | Client-side RescueCipher encryption |
| `frontend/src/hooks/use-mpc-events.ts` | Event subscription for MPC callbacks |
| `frontend/src/hooks/use-private-predictions.ts` | Privacy-enhanced prediction markets |
| `frontend/src/hooks/use-shadowwire.ts` | ShadowWire private transfers integration |

## MPC Operations

### ComparePrices

Compares two encrypted prices to determine if they match (buy_price >= sell_price).

**Input:**
- `buy_price`: `[u8; 64]` - Encrypted buy price
- `sell_price`: `[u8; 64]` - Encrypted sell price

**Output:**
- `result[0]`: `u8` - 1 if prices match, 0 otherwise

**Use Case:** Order matching - determines if a buy and sell order can be matched.

### CalculateFill

Calculates the fill amount from encrypted order quantities.

**Input:**
- `buy_amount`: `[u8; 64]` - Encrypted buy order amount
- `buy_filled`: `[u8; 64]` - Encrypted amount already filled
- `sell_amount`: `[u8; 64]` - Encrypted sell order amount
- `sell_filled`: `[u8; 64]` - Encrypted amount already filled

**Output:**
- `result[0..64]`: `[u8; 64]` - Encrypted fill amount
- `result[64]`: `u8` - 1 if buy order fully filled
- `result[65]`: `u8` - 1 if sell order fully filled

**Use Case:** After price match confirmed, calculate how much to fill.

---

## Perpetuals MPC Operations

### VerifyPositionParams

Verifies that the claimed liquidation threshold matches the encrypted position parameters.

**Input:**
- `encrypted_collateral`: `[u8; 64]` - Encrypted collateral amount
- `encrypted_size`: `[u8; 64]` - Encrypted position size
- `encrypted_entry_price`: `[u8; 64]` - Encrypted entry price
- `claimed_threshold`: `u64` - Public claimed liquidation threshold
- `leverage`: `u8` - Position leverage
- `is_long`: `bool` - Position direction
- `maintenance_margin_bps`: `u16` - Maintenance margin in basis points

**Output:**
- `result[0]`: `u8` - 1 if threshold is valid, 0 otherwise

**Use Case:** Open position - verify liquidation threshold before allowing position.

### CheckLiquidation

Checks if a position should be liquidated based on current mark price.

**Input:**
- `encrypted_collateral`: `[u8; 64]` - Encrypted collateral amount
- `encrypted_size`: `[u8; 64]` - Encrypted position size
- `encrypted_entry_price`: `[u8; 64]` - Encrypted entry price
- `mark_price`: `u64` - Current oracle mark price (public)
- `is_long`: `bool` - Position direction
- `maintenance_margin_bps`: `u16` - Maintenance margin in basis points

**Output:**
- `result[0]`: `u8` - 1 if should liquidate, 0 otherwise

**Use Case:** Liquidation - verify eligibility using encrypted position data.

### CalculatePnL

Calculates profit/loss for a position.

**Input:**
- `encrypted_size`: `[u8; 64]` - Encrypted position size
- `encrypted_entry_price`: `[u8; 64]` - Encrypted entry price
- `exit_price`: `u64` - Exit/mark price (public)
- `is_long`: `bool` - Position direction

**Output:**
- `result[0..8]`: `u64` - Absolute PnL value
- `result[64]`: `u8` - 0 if profit, 1 if loss

**Use Case:** Close position or liquidation - calculate settlement amount.

### CalculateFunding

Calculates funding payment for a position.

**Input:**
- `encrypted_size`: `[u8; 64]` - Encrypted position size
- `funding_rate`: `i64` - Current funding rate (public)
- `funding_delta`: `i64` - Cumulative funding since entry (public)
- `is_long`: `bool` - Position direction

**Output:**
- `result[0..8]`: `u64` - Absolute funding payment
- `result[64]`: `u8` - 0 if receiving, 1 if paying

**Use Case:** Position settlement - calculate funding owed/received.

## Account Structures

### PendingMatch

Tracks in-flight MPC computations:

```rust
pub struct PendingMatch {
    pub request_id: [u8; 32],        // Links to MXE computation
    pub buy_order: Pubkey,           // Buy order being matched
    pub sell_order: Pubkey,          // Sell order being matched
    pub trading_pair: Pubkey,        // Trading pair
    pub compare_result: Option<bool>, // Price comparison result
    pub fill_result: Option<[u8; 64]>, // Encrypted fill amount
    pub status: PendingMatchStatus,  // Current status
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

pub enum PendingMatchStatus {
    AwaitingCompare,  // Waiting for price comparison
    AwaitingFill,     // Prices matched, waiting for fill calc
    Matched,          // Successfully matched
    NoMatch,          // Prices don't overlap
    Failed,           // Computation failed
}
```

### ComputationRequest (MXE)

```rust
pub struct ComputationRequest {
    pub request_id: [u8; 32],
    pub computation_type: ComputationType,
    pub requester: Pubkey,
    pub callback_program: Pubkey,
    pub callback_discriminator: [u8; 8],
    pub inputs: Vec<u8>,
    pub status: ComputationStatus,
    pub created_at: i64,
    pub completed_at: i64,
    pub result: Vec<u8>,
    pub bump: u8,
}
```

## Events

### PriceCompareComplete

Emitted after MPC price comparison:

```rust
#[event]
pub struct PriceCompareComplete {
    pub request_id: [u8; 32],
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub prices_match: bool,
    pub timestamp: i64,
}
```

### OrdersMatched

Emitted after successful fill calculation:

```rust
#[event]
pub struct OrdersMatched {
    pub request_id: [u8; 32],
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub buy_fully_filled: bool,
    pub sell_fully_filled: bool,
    pub timestamp: i64,
}
```

## Configuration

### Feature Flag

```rust
// programs/confidex_dex/src/cpi/arcium.rs
pub const USE_REAL_MPC: bool = true;  // true = real MPC, false = simulation
```

When `USE_REAL_MPC = false`, the system uses simulated MPC that extracts plaintext from the first 8 bytes of encrypted values. **This is NOT secure and only for testing.**

### Cluster Configuration

```rust
pub const DEFAULT_CLUSTER_OFFSET: u16 = 456;  // Devnet cluster v0.6.3
```

**Valid Devnet Clusters:**
| Offset | Version | Nodes | Status |
|--------|---------|-------|--------|
| 123 | N/A | N/A | Does NOT exist (despite old docs) |
| 456 | v0.6.3 | 2/2 | **Recommended** - current production cluster |

**Important:** Cluster 123 is mentioned in older Arcium documentation but does not exist on devnet. Always use cluster 456.

## Frontend Integration

### Encryption

```typescript
import { useEncryption } from '@/hooks/use-encryption';

function TradingComponent() {
  const { initializeEncryption, encryptValue, isInitialized } = useEncryption();

  // Initialize on wallet connect
  useEffect(() => {
    if (wallet.connected && !isInitialized) {
      initializeEncryption();
    }
  }, [wallet.connected]);

  // Encrypt order values before submission
  const submitOrder = async (price: number, amount: number) => {
    const encryptedPrice = await encryptValue(BigInt(price * 1e6));
    const encryptedAmount = await encryptValue(BigInt(amount * 1e6));

    // Submit to program...
  };
}
```

### Event Subscription

```typescript
import { useMpcEvents } from '@/hooks/use-mpc-events';

function OrderStatus() {
  const {
    pendingComputations,
    startListening,
    onPriceCompareComplete,
    onOrdersMatched
  } = useMpcEvents();

  useEffect(() => {
    startListening();

    const unsubCompare = onPriceCompareComplete((event) => {
      if (event.pricesMatch) {
        console.log('Order matched! Waiting for fill calculation...');
      } else {
        console.log('Prices do not overlap, no match');
      }
    });

    const unsubMatch = onOrdersMatched((event) => {
      console.log('Order filled!', {
        buyFilled: event.buyFullyFilled,
        sellFilled: event.sellFullyFilled
      });
    });

    return () => {
      unsubCompare();
      unsubMatch();
    };
  }, []);

  return (
    <div>
      <h3>Pending Computations</h3>
      {pendingComputations.map(comp => (
        <div key={comp.requestId}>
          Type: {comp.type} | Status: {comp.status}
        </div>
      ))}
    </div>
  );
}
```

## Security Model

### Cerberus Protocol

Arcium uses the Cerberus MPC protocol which provides:

- **Dishonest Majority Security:** Privacy guaranteed even if N-1 nodes collude
- **MAC Authentication:** Cryptographic verification of computation integrity
- **Constant-Time Operations:** Prevents timing side-channel attacks

### Privacy Guarantees

| Data | Visibility |
|------|------------|
| Order price | Encrypted (never revealed) |
| Order amount | Encrypted (never revealed) |
| Fill amount | Encrypted (stays encrypted) |
| Match result | Boolean only (prices match or not) |
| Fill status | Boolean only (fully filled or not) |

### Attack Mitigations

| Attack | Mitigation |
|--------|------------|
| Front-running | Prices encrypted, MEV bots can't see |
| Information leakage | Only boolean results revealed |
| Malicious nodes | Cerberus N-1 security model |
| Replay attacks | Unique request IDs with timestamps |

## MPC Integration Test Suite

A comprehensive test suite verifies that all Arcium MPC infrastructure is correctly configured and operational.

### Location

```
frontend/test-mpc-integration.ts
```

### Running Tests

```bash
cd frontend && npx tsx test-mpc-integration.ts
```

### Test Categories

| Category | Tests | Description |
|----------|-------|-------------|
| **MXE Account** | 3 | Verifies MXE PDA exists, keygen complete, X25519 key matches |
| **Encryption** | 7 | Tests full encryption pipeline: key parsing, ECDH, RescueCipher, V2 format |
| **DEX Program** | 1 | Confirms DEX program is deployed and executable |
| **Circuits** | 3 | Verifies circuits accessible via GitHub Releases (HTTP 200) |
| **Cluster** | 2 | Confirms cluster 456 account and Arcium program exist |

### Detailed Test Coverage

| Test | What It Verifies |
|------|------------------|
| MXE account exists | MXE PDA initialized at expected address (319 bytes) |
| Keygen complete | X25519 key at bytes 95-127 is non-zero |
| Key matches expected | On-chain key matches `MXE_X25519_PUBKEY` constant |
| Parse MXE public key | Hex string → Uint8Array conversion |
| Generate ephemeral keypair | X25519 private/public key generation |
| Compute shared secret | ECDH key agreement with MXE public key |
| Create RescueCipher | Cipher instantiation from shared secret |
| Encrypt value | BigInt value → RescueCipher ciphertext |
| Build V2 blob | 64-byte format: `[nonce(16)\|ciphertext(32)\|ephemeral(16)]` |
| Validate format | Non-zero, correct length |
| DEX program deployed | Program exists and is executable |
| Circuit: compare_prices | HTTP 200 from GitHub Releases |
| Circuit: calculate_fill | HTTP 200 from GitHub Releases |
| Circuit: verify_position_params | HTTP 200 from GitHub Releases |
| Cluster 456 account | Cluster PDA exists (483 bytes) |
| Arcium program deployed | Core Arcium program is executable |

### Expected Output

```
============================================================
   Confidex MPC Integration Test Suite
============================================================

Configuration:
  RPC URL: https://api.devnet.solana.com
  DEX Program: 63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
  MXE Program: HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS
  X25519 Key: 46589a2f72e04b04...

--- Test 1: MXE Account Status ---
✅ MXE account exists (Size: 319 bytes)
✅ Keygen complete (X25519 key: 14706bf82ff9e9ce...)
✅ Key matches expected (Keys match!)

--- Test 2: Encryption ---
✅ Parse MXE public key
✅ Generate ephemeral keypair
✅ Compute shared secret
✅ Create RescueCipher
✅ Test value
✅ Generate nonce
✅ Encrypt value
✅ Build V2 encrypted blob (Size: 64 bytes)
✅ Validate encrypted format

--- Test 3: DEX Program Status ---
✅ DEX program deployed

--- Test 4: Circuit Accessibility ---
✅ Circuit: compare_prices (HTTP 200)
✅ Circuit: calculate_fill (HTTP 200)
✅ Circuit: verify_position_params (HTTP 200)

--- Test 5: Arcium Cluster Status ---
✅ Cluster 456 account exists (483 bytes)
✅ Arcium program deployed

============================================================
   Test Summary
============================================================

  Passed: 18
  Failed: 0
  Total:  18

✅ All tests passed! MPC integration is ready.
```

### Key Technical Details

| Detail | Value |
|--------|-------|
| X25519 key offset in MXE account | Bytes 95-127 (32 bytes) |
| V2 encryption format | `[nonce(16) \| ciphertext(32) \| ephemeral_pubkey(16)]` |
| Total encrypted blob size | 64 bytes |
| RescueCipher input format | Array of BigInts: `cipher.encrypt([value], nonce)` |
| Cluster account derivation | `getClusterAccAddress(456)` via SDK |
| Circuit storage | GitHub Releases v0.1.0-circuits |

### When to Run

- After MXE deployment or redeployment
- After updating encryption constants
- Before submitting orders to verify infrastructure
- When debugging MPC-related issues
- As part of CI/CD pipeline

---

## Troubleshooting

### Common Issues

**"MXE accounts required for real MPC but not provided"**
- Cause: `USE_REAL_MPC = true` but MXE accounts not passed to queue function
- Fix: Pass `MxeCpiAccounts` struct with all required accounts

**"Invalid request ID"**
- Cause: Callback received with unknown request ID
- Fix: Ensure `PendingMatch` account exists before MPC callback

**"Prices did not match - cannot calculate fill"**
- Cause: Attempting fill calculation without successful price comparison
- Fix: Check `compare_result == Some(true)` before fill calculation

### Logs

Enable detailed logging:

```rust
msg!("MPC compare result for request {:?}: prices_match={}", &request_id[0..8], prices_match);
```

Frontend:
```typescript
const log = createLogger('mpc-events');
log.debug('Tracking computation', { requestId, type });
```

## Performance

| Operation | Expected Time |
|-----------|---------------|
| Client-side encryption | < 100ms |
| MPC price comparison | ~500ms |
| MPC fill calculation | ~500ms |
| Full match cycle | 1-2 seconds |
| Callback confirmation | < 1 block (~400ms) |

---

## Prediction Markets Privacy

While PNP prediction markets use public AMM bonding curves (prices are inherently public), Confidex adds privacy layers for user positions:

### Privacy Modes

| Mode | Description | What's Hidden |
|------|-------------|---------------|
| `none` | Standard trading | Nothing |
| `encrypted` | Arcium encryption | Position sizes stored locally encrypted |
| `shadowwire` | ShadowWire integration | Deposits/withdrawals via private transfers |

### Implementation

```typescript
import { usePrivatePredictions } from '@/hooks/use-private-predictions';

function PredictionTrading() {
  const {
    privacyMode,
    setPrivacyMode,
    buyTokensPrivate,
    sellTokensPrivate,
    getDecryptedPosition
  } = usePrivatePredictions();

  // Enable encrypted positions
  setPrivacyMode('encrypted');

  // Trade with privacy
  const result = await buyTokensPrivate('YES', 100, 0.5);

  // Only you can see your position
  const position = await getDecryptedPosition(marketId);
}
```

### What Remains Public

- Market prices (AMM bonding curve)
- Total liquidity
- Transaction existence on-chain
- Oracle resolution

### What Becomes Private

- Your position size (encrypted locally)
- Deposit amounts (via ShadowWire)
- Withdrawal amounts (via ShadowWire)

---

## Future Improvements

1. **Batch Matching:** Match multiple order pairs in single MPC computation
2. **Partial Reveals:** Reveal aggregate statistics without individual order details
3. **Cross-Chain MPC:** Enable cross-chain order matching via Arcium
4. **C-SPL Integration:** Confidential token settlement when SDK available
5. **True Private Predictions:** On-chain encrypted positions when Arcium supports prediction market primitives
