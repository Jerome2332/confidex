# Eating Glass Award Submission

## Confidex: Technical Challenges & Solutions

This document details the significant technical challenges overcome during the development of Confidex, a confidential DEX on Solana. Each section describes a painful problem, the "glass we ate" to solve it, and the resulting solution.

---

## Challenge 1: The Great ZK Migration (Days 2-4)

### The Problem

We started building with **Barretenberg** (Aztec's native proving backend for Noir) because it's the default and most documented approach. After 2 days of circuit development and testing, we attempted our first on-chain verification and discovered:

```
Proof size: 4,127 bytes
Solana transaction limit: ~1,232 bytes (with accounts)
Available for proof: ~388 bytes
```

Our proofs were **10x too large** for Solana.

### What We Tried That Failed

1. **Proof compression** - Barretenberg proofs aren't compressible
2. **Multi-transaction proofs** - Would break atomicity
3. **Off-chain verification with on-chain commit** - Defeated the trustless purpose
4. **Waiting for Barretenberg updates** - No timeline for Solana-sized proofs

### The Glass We Ate

- Scrapped 2 days of Barretenberg integration work
- Rewrote circuits from Poseidon to Pedersen hash (Sunspot requirement)
- Learned Sunspot's underdocumented CLI from scratch
- Debugged version compatibility issues (Noir 1.0.0-beta.13 specifically required)

### The Solution

```bash
# Before (Barretenberg - didn't work)
nargo prove
# Output: 4KB+ proof

# After (Sunspot/Groth16)
sunspot compile --circuit eligibility
sunspot setup eligibility
sunspot deploy eligibility --keypair ~/devnet.json
# Output: 388 byte proof + deployed verifier program
```

**Key Code Change:**
```noir
// BEFORE: Poseidon (Barretenberg default)
use std::hash::poseidon;
fn hash_2(a: Field, b: Field) -> Field {
    poseidon::bn254::hash_2([a, b])
}

// AFTER: Pedersen (Sunspot compatible)
use std::hash::pedersen_hash;
fn hash_2(left: Field, right: Field) -> Field {
    pedersen_hash([left, right])
}
```

### Evidence

- Deployed verifier: `6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF`
- Circuit: [circuits/eligibility/src/main.nr](circuits/eligibility/src/main.nr)
- Proof generation hook: [frontend/src/hooks/use-zk-proof.ts](frontend/src/hooks/use-zk-proof.ts)

---

## Challenge 2: The Impossible Perpetuals Problem (Days 6-9)

### The Problem

We wanted to build **private perpetual futures** - but the core challenge seemed unsolvable:

> How do you liquidate underwater positions when you can't see margin levels?

Traditional perps require:
- Visible collateral to calculate health factor
- Public entry prices to compute unrealized PnL
- Transparent liquidation thresholds

With MPC encryption, ALL of this is hidden. The naive approach would mean:
- Liquidation bots can't identify underwater positions
- Insurance fund can't assess risk
- Users can be secretly underwater indefinitely

### What We Tried That Failed

1. **Periodic decryption** - Defeats continuous privacy
2. **Trusted liquidation oracle** - Introduces centralization
3. **Time-locked revelation** - Too slow for volatile markets
4. **Fully encrypted liquidation** - MPC latency (500ms) too slow for every price tick

### The Glass We Ate

- 3 days of architectural design iterations
- Studied how Drift, dYdX, and GMX handle liquidations
- Realized we needed a "partial reveal" model
- Designed MPC circuit for threshold verification

### The Solution: Hybrid Privacy Model

| Data | Visibility | Reasoning |
|------|------------|-----------|
| Position size | ENCRYPTED | Core privacy need |
| Entry price | ENCRYPTED | Core privacy need |
| Collateral | ENCRYPTED | Core privacy need |
| Realized PnL | ENCRYPTED | Revealed only on close |
| Side (long/short) | PUBLIC | Needed for funding |
| Leverage | PUBLIC | Risk categorization |
| **Liquidation threshold** | PUBLIC | Enables permissionless liquidation |

**The Key Insight:** Publish a single "liquidation trigger price" that is MPC-verified to match the encrypted position. Liquidators learn:
- "This position liquidates at $180"
- NOT: "This is a 10x long with $10K collateral opened at $200"

```rust
// programs/confidex_dex/src/state/position.rs
pub struct ConfidentialPosition {
    // Core data stays encrypted (256 bytes total)
    pub encrypted_size: [u8; 64],
    pub encrypted_entry_price: [u8; 64],
    pub encrypted_collateral: [u8; 64],
    pub encrypted_realized_pnl: [u8; 64],

    // PUBLIC liquidation thresholds
    pub liquidatable_below_price: u64,  // Longs liquidated below this
    pub liquidatable_above_price: u64,  // Shorts liquidated above this
    pub threshold_verified: bool,        // MPC verified correctness
}

impl ConfidentialPosition {
    /// Public liquidation check - no decryption needed
    pub fn is_liquidatable(&self, mark_price: u64) -> bool {
        if !self.threshold_verified { return false; }

        match self.side {
            PositionSide::Long => mark_price <= self.liquidatable_below_price,
            PositionSide::Short => mark_price >= self.liquidatable_above_price,
        }
    }
}
```

**MPC Verification Circuit (Planned):**
```rust
// Arcis circuit to verify threshold matches position
fn verify_position_params(
    encrypted_collateral: Enc<Mxe, u64>,
    encrypted_size: Enc<Mxe, u64>,
    encrypted_entry_price: Enc<Mxe, u64>,
    claimed_threshold: u64,  // PUBLIC
    maintenance_margin_bps: u64,  // PUBLIC (e.g., 500 = 5%)
    is_long: bool,  // PUBLIC
) -> bool {
    // Decrypt internally
    let collateral = encrypted_collateral.to_arcis();
    let size = encrypted_size.to_arcis();
    let entry = encrypted_entry_price.to_arcis();

    // Compute expected liquidation price
    let expected_threshold = if is_long {
        entry * (1 - 1/leverage + maintenance_margin)
    } else {
        entry * (1 + 1/leverage - maintenance_margin)
    };

    // Verify claimed threshold is correct
    claimed_threshold == expected_threshold
}
```

### Evidence

- Position struct: [programs/confidex_dex/src/state/position.rs](programs/confidex_dex/src/state/position.rs)
- Frontend store: [frontend/src/stores/perpetuals-store.ts](frontend/src/stores/perpetuals-store.ts)
- Trading panel: [frontend/src/components/trading-panel.tsx](frontend/src/components/trading-panel.tsx)

---

## Challenge 3: Arcium SDK Learning Curve (Days 4-7)

### The Problem

Arcium's SDK was in active development during the hackathon. Documentation existed but was sparse on practical examples, especially for DEX-style applications.

Key unknowns:
- How to do x25519 key exchange in browser
- RescueCipher initialization quirks
- MXE deployment and cluster selection
- Callback handling for match results

### The Glass We Ate

- Read through Arcium source code on GitHub
- Experimented with different encryption approaches
- Debugged "invalid ciphertext" errors for hours
- Discovered nonce requirements through trial and error

### The Solution

```typescript
// frontend/src/hooks/use-encryption.ts
import { RescueCipher } from '@arcium-hq/client';
import { x25519 } from '@noble/curves/ed25519';

export function useEncryption() {
  const [isInitialized, setIsInitialized] = useState(false);
  const cipherRef = useRef<RescueCipher | null>(null);
  const privateKeyRef = useRef<Uint8Array | null>(null);

  const initializeEncryption = async () => {
    // Generate ephemeral x25519 keypair
    const privateKey = x25519.utils.randomSecretKey();
    privateKeyRef.current = privateKey;

    // Get MXE public key from Arcium
    const mxePublicKey = await fetchMxePublicKey();

    // Compute shared secret via Diffie-Hellman
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

    // Initialize cipher with shared secret
    cipherRef.current = new RescueCipher(sharedSecret);
    setIsInitialized(true);
  };

  const encryptValue = async (value: bigint): Promise<Uint8Array> => {
    if (!cipherRef.current) throw new Error('Encryption not initialized');

    // CRITICAL: Random nonce for each encryption
    const nonce = crypto.getRandomValues(new Uint8Array(12));

    // Convert bigint to bytes (little-endian)
    const valueBytes = new Uint8Array(8);
    const view = new DataView(valueBytes.buffer);
    view.setBigUint64(0, value, true);

    // Encrypt with RescueCipher
    const ciphertext = cipherRef.current.encrypt(valueBytes, nonce);

    // Return nonce + ciphertext (64 bytes total for MPC compatibility)
    const result = new Uint8Array(64);
    result.set(nonce, 0);
    result.set(ciphertext, 12);
    return result;
  };

  return { initializeEncryption, encryptValue, isInitialized };
}
```

**Key Lessons Learned:**
1. Always use random nonces (deterministic nonces leak information)
2. x25519 shared secret must be derived, not hardcoded
3. Arcium expects specific byte ordering (little-endian)
4. 64-byte ciphertext format: 12 bytes nonce + 52 bytes encrypted data

### Evidence

- Encryption hook: [frontend/src/hooks/use-encryption.ts](frontend/src/hooks/use-encryption.ts)
- Client library: [frontend/src/lib/confidex-client.ts](frontend/src/lib/confidex-client.ts)

---

## Challenge 4: C-SPL Vaporware (Ongoing)

### The Problem

C-SPL (Confidential SPL Tokens) was announced by Arcium as "coming soon" but the SDK was not released during the hackathon. We needed a settlement layer.

### The Glass We Ate

- Built interfaces assuming C-SPL would arrive
- Pivoted to ShadowWire as primary settlement
- Designed dual-path architecture for future flexibility
- Kept C-SPL stubs ready for when SDK releases

### The Solution

```typescript
// Dual settlement architecture
export enum SettlementMethod {
  CSPL = 0,      // When available
  ShadowWire = 1 // Production-ready now
}

export async function buildSettlement(
  method: SettlementMethod,
  ...params
): Promise<Transaction> {
  if (method === SettlementMethod.ShadowWire) {
    // ShadowWire - Bulletproof range proofs
    const client = new ShadowWireClient();
    return client.transfer({
      type: 'internal',  // Amount hidden
      ...params
    });
  } else {
    // C-SPL - When SDK releases
    return buildCSPLTransfer(params);
  }
}
```

### Evidence

- Settlement types: [programs/confidex_dex/src/settlement/types.rs](programs/confidex_dex/src/settlement/types.rs)
- Client integration: [frontend/src/lib/confidex-client.ts](frontend/src/lib/confidex-client.ts)

---

## Challenge 5: Rust Toolchain Conflicts (Day 1)

### The Problem

```
error: could not compile `arcium-mxe` due to 2 previous errors
  --> Caused by: rustc 1.75 incompatible with proc-macro2 requirements
```

Arcium v0.4.0+ requires Rust 1.89.0. Anchor 0.32.1 requires specific features. Solana CLI has its own requirements. All conflicted.

### The Glass We Ate

- Hours of `cargo clean && cargo build` cycles
- Reading cryptic rustc error messages
- Managing multiple toolchains with rustup

### The Solution

```toml
# rust-toolchain.toml - The magic file
[toolchain]
channel = "1.89.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

Plus explicit version pinning:
```toml
# Cargo.toml
[dependencies]
anchor-lang = "=0.32.1"
arcium-client = "=0.4.2"
solana-sdk = "=1.18.26"
```

---

## Challenge 6: Real-Time Price Feeds (Days 8-10)

### The Problem

Perpetuals need real-time prices for:
- PnL display
- Liquidation warnings
- Funding rate calculations

But Pyth's HTTP endpoints update only every few seconds. We needed streaming.

### The Glass We Ate

- Discovered Pyth has a separate "Hermes" streaming endpoint
- SSE (Server-Sent Events) not well documented for browser
- Price update format different from REST API

### The Solution

```typescript
// frontend/src/hooks/use-pyth-price.ts
export function usePythPrice(symbol: string) {
  const [price, setPrice] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);

  useEffect(() => {
    const priceId = PYTH_PRICE_IDS[symbol];
    if (!priceId) return;

    // Use Hermes streaming endpoint
    const url = `https://hermes.pyth.network/v2/updates/price/stream?ids[]=${priceId}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.parsed?.[0]?.price) {
          const priceData = data.parsed[0].price;
          // Price is in format: price * 10^expo
          const priceValue = Number(priceData.price) * Math.pow(10, priceData.expo);
          setPrice(priceValue);
          setConfidence(Number(priceData.conf) * Math.pow(10, priceData.expo));
        }
      } catch (err) {
        console.error('Pyth parse error:', err);
      }
    };

    return () => eventSource.close();
  }, [symbol]);

  return { price, confidence };
}
```

### Evidence

- Price hook: [frontend/src/hooks/use-pyth-price.ts](frontend/src/hooks/use-pyth-price.ts)
- Trading panel integration: [frontend/src/components/trading-panel.tsx](frontend/src/components/trading-panel.tsx)

---

## Challenge 7: Transaction Size Limits (Days 7-8)

### The Problem

A single Confidex order submission includes:
- ZK proof (388 bytes)
- Encrypted amount (64 bytes)
- Encrypted price (64 bytes)
- Account metas (~500 bytes for PDAs)
- Instruction data (~200 bytes)

Total: ~1,216 bytes. Solana limit: ~1,232 bytes.

**Only 16 bytes of margin!**

### The Glass We Ate

- Optimized every byte of account structures
- Reduced instruction data by using packed enums
- Pre-computed PDAs client-side to minimize account list

### The Solution

```rust
// Packed enum for order type (1 byte instead of 4)
#[repr(u8)]
pub enum OrderType {
    Market = 0,
    Limit = 1,
}

// Compact instruction data
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PlaceOrderParams {
    pub side: u8,           // 1 byte (not enum)
    pub order_type: u8,     // 1 byte (not enum)
    pub encrypted_amount: [u8; 64],
    pub encrypted_price: [u8; 64],
    pub proof: [u8; 388],   // Exactly Groth16 size
    // Total: 518 bytes (minimal)
}
```

Plus Address Lookup Tables for account compression:
```typescript
// Client-side ALT usage
const lookupTable = new AddressLookupTableAccount({
  key: ALT_ADDRESS,
  state: { addresses: commonAccounts }
});

const messageV0 = new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash,
  instructions,
}).compileToV0Message([lookupTable]);
```

---

## Summary: The Glass Score

| Challenge | Days Spent | Pain Level (1-10) |
|-----------|------------|-------------------|
| ZK proof system migration | 2 | 9 |
| Encrypted perpetuals design | 3 | 10 |
| Arcium SDK integration | 3 | 7 |
| C-SPL workaround | 1 | 5 |
| Rust toolchain hell | 1 | 6 |
| Real-time price feeds | 2 | 4 |
| Transaction size limits | 1 | 8 |
| **Total** | **13** | **Average: 7** |

---

## What We'd Do Differently

1. **Research proof systems earlier** - Would have saved 2 days on Barretenberg
2. **Start with hybrid privacy model** - Spent too long on "fully private" dead ends
3. **Pin all versions from day 1** - Toolchain issues wasted hours
4. **Build settlement abstraction first** - Would have made C-SPL pivot easier

---

## Conclusion

Building Confidex required solving problems that don't have Stack Overflow answers. We combined cutting-edge cryptographic primitives (MPC, ZK proofs, confidential tokens) in ways that haven't been done on Solana before.

Every challenge taught us something:
- ZK on Solana requires Groth16, not Barretenberg
- Privacy and functionality can coexist with careful design
- Beta SDKs require reading source code, not just docs
- Transaction limits force creative optimization

We ate a lot of glass. We hope it shows.

---

*Submitted for the Eating Glass Award - Solana Privacy Hack 2026*
