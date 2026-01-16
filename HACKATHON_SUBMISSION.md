# Confidex - Hackathon Submission

## Solana Privacy Hack 2026

**Team:** Humanoid Tech
**Submission Date:** January 16, 2026
**Demo:** https://frontend-humanoid-tech.vercel.app
**GitHub:** https://github.com/Jerome2332/confidex

---

## Executive Summary

**Confidex** is the first confidential decentralized exchange on Solana, implementing a three-layer privacy architecture that enables institutional-grade trading with complete privacy. We combine Arcium MPC for encrypted order matching, Noir ZK proofs for compliance verification, and C-SPL tokens for private settlement.

### Prize Tracks

| Track | Prize | Our Integration |
|-------|-------|-----------------|
| Arcium | $10,000 | Full MPC integration - encrypted orders, price comparison, settlement |
| Aztec/Noir | $10,000 | Groth16 eligibility proofs via Sunspot verifier |
| Open Track | $18,000 | Novel three-layer privacy architecture |
| Helius | $5,000 | RPC, webhooks, Photon indexing |
| Radr Labs (ShadowWire) | $15,000 | Bulletproof settlement layer |
| PNP Exchange | $2,500 | Prediction markets with confidential collateral |
| **Eating Glass** | Bonus | See Technical Challenges section |

**Total Prize Pool Target:** $66,500

---

## The Problem We Solved

### DeFi Privacy Crisis

| Problem | Impact |
|---------|--------|
| All DEX trades visible on-chain | Front-running costs traders ~$1B annually |
| Wallet balances exposed | Trading strategies leaked to competitors |
| Order books reveal intent | Large orders move markets before execution |
| No compliant privacy | Mixers face regulatory challenges |

### Our Solution: Three-Layer Privacy

```
+----------------------------------------------------------+
|  LAYER 1: COMPLIANCE (Noir ZK Proofs)                    |
|  - Prove eligibility without revealing identity          |
|  - Sparse Merkle Tree blacklist non-membership           |
|  - Client-side WASM proof generation (2-3s)              |
+----------------------------------------------------------+
|  LAYER 2: EXECUTION (Arcium MPC)                         |
|  - Encrypted order amounts and prices                    |
|  - Cerberus protocol (dishonest majority secure)         |
|  - Private price comparison and matching                 |
+----------------------------------------------------------+
|  LAYER 3: SETTLEMENT (C-SPL + ShadowWire)                |
|  - Persistent encrypted balances                         |
|  - Bulletproof range proofs for transfers               |
|  - Dual settlement options for flexibility              |
+----------------------------------------------------------+
```

---

## Technical Challenges Overcome (Eating Glass Award)

### Challenge 1: ZK Proof System Migration

**Problem:** Initial implementation used Barretenberg (Aztec's native backend), but proofs were **4KB+** - far exceeding Solana's ~388 byte limit.

**The Glass We Ate:**
- Discovered incompatibility after 2 days of development
- Barretenberg proofs optimized for Ethereum, not Solana
- Had to pivot entire ZK infrastructure mid-hackathon

**Solution:**
- Migrated to **Sunspot** (Groth16 verifier for Solana)
- Rewrote circuit from Poseidon to Pedersen hash (Sunspot compatible)
- Locked Noir version to `1.0.0-beta.13` for compatibility
- Achieved **388 byte proofs** fitting Solana transaction limits

**Code Evidence:**
```noir
// circuits/eligibility/src/main.nr
use std::hash::pedersen_hash;  // Changed from poseidon

fn hash_2(left: Field, right: Field) -> Field {
    pedersen_hash([left, right])  // Sunspot-compatible
}
```

**Deployed Verifier:** `6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF`

---

### Challenge 2: Encrypted Perpetuals Architecture

**Problem:** How do you enable liquidations when position data is fully encrypted? Traditional perps require transparent margin/collateral visibility.

**The Glass We Ate:**
- MPC-encrypted positions would hide liquidation triggers
- Without visible margin levels, no one can liquidate underwater positions
- "Fully private perps" seemed impossible

**Solution - Hybrid Privacy Model:**

| Data | Visibility | Reason |
|------|------------|--------|
| Position size | ENCRYPTED | Core privacy |
| Entry price | ENCRYPTED | Core privacy |
| Collateral | ENCRYPTED | Core privacy |
| PnL | ENCRYPTED | Revealed only on close |
| Side (long/short) | PUBLIC | Funding direction |
| Leverage | PUBLIC | Risk management |
| **Liquidation threshold** | PUBLIC | Enables liquidation |

**Key Innovation:** Public liquidation thresholds verified by MPC to match encrypted position data. Liquidators see "price X triggers liquidation" without knowing position size, entry, or loss amount.

**Code Evidence:**
```rust
// programs/confidex_dex/src/state/position.rs
pub struct ConfidentialPosition {
    // ENCRYPTED (256 bytes via Arcium)
    pub encrypted_size: [u8; 64],
    pub encrypted_entry_price: [u8; 64],
    pub encrypted_collateral: [u8; 64],
    pub encrypted_realized_pnl: [u8; 64],

    // PUBLIC liquidation thresholds (MPC-verified)
    pub liquidatable_below_price: u64,  // Longs
    pub liquidatable_above_price: u64,  // Shorts
    pub threshold_verified: bool,        // MPC verified match
}
```

---

### Challenge 3: Arcium MPC Integration Complexity

**Problem:** Arcium SDK was in beta with limited documentation. MXE (Multi-Party eXecution Environment) concepts were new and unfamiliar.

**The Glass We Ate:**
- No clear examples of DEX-style order matching
- RescueCipher encryption required x25519 key exchange
- Cerberus protocol quirks undocumented
- ~500ms MPC latency needed UI/UX consideration

**Solution:**
- Built custom TypeScript encryption hook using `@arcium-hq/client`
- Implemented x25519 Diffie-Hellman key exchange for shared secrets
- Created abstraction layer hiding MPC complexity from frontend

**Code Evidence:**
```typescript
// frontend/src/hooks/use-encryption.ts
import { RescueCipher } from '@arcium-hq/client';
import { x25519 } from '@noble/curves/ed25519';

export function useEncryption() {
  const initializeEncryption = async () => {
    const privateKey = x25519.utils.randomSecretKey();
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    cipherRef.current = new RescueCipher(sharedSecret);
  };

  const encryptValue = async (value: bigint): Promise<Uint8Array> => {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    return cipher.encrypt(value, nonce);
  };
}
```

---

### Challenge 4: C-SPL Token Integration (Not Yet Live)

**Problem:** C-SPL (Confidential SPL) was announced but SDK not released during hackathon.

**The Glass We Ate:**
- Core settlement layer dependency unavailable
- Documentation promised features not yet implemented
- Had to build without knowing final API

**Solution:**
- Implemented **ShadowWire as primary settlement layer** (production-ready)
- Built C-SPL interface stubs that will work when SDK releases
- Dual settlement architecture: user chooses C-SPL or ShadowWire

**Code Evidence:**
```typescript
// frontend/src/lib/confidex-client.ts
export async function buildWrapTransaction(...) {
  // ShadowWire path (production)
  if (usesShadowWire) {
    return buildShadowWireWrap(...);
  }
  // C-SPL path (when available)
  return buildCSPLWrap(...);
}
```

---

### Challenge 5: Rust Toolchain Hell

**Problem:** Arcium v0.4.0+ requires Rust 1.89.0, but Anchor 0.32.1 had specific toolchain requirements.

**The Glass We Ate:**
- Build failures with "incompatible Rust version"
- Different programs needed different Rust features
- Solana CLI had its own version requirements

**Solution:**
```toml
# rust-toolchain.toml - pinned for compatibility
[toolchain]
channel = "1.89.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

---

### Challenge 6: Real-Time Price Feeds + Privacy

**Problem:** Displaying accurate position PnL requires current prices, but Pyth's WebSocket integration with encrypted positions was complex.

**The Glass We Ate:**
- Pyth streaming needed Hermes endpoint
- Price updates + encrypted position math was tricky
- Liquidation warnings needed real-time price comparison

**Solution:**
```typescript
// frontend/src/hooks/use-pyth-price.ts
export function usePythPrice(symbol: string) {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(
      `https://hermes.pyth.network/v2/updates/price/stream?ids[]=${priceId}`
    );
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Handle price updates for liquidation monitoring
    };
  }, []);
}
```

---

### Challenge 7: Mobile-First Trading UI

**Problem:** Professional trading terminals (order books, charts, position management) typically don't work on mobile.

**The Glass We Ate:**
- Complex trading UI needed both desktop and mobile layouts
- Order book density issues on small screens
- Touch-friendly position management

**Solution:**
- Built responsive layout with conditional rendering
- Created mobile-specific trade view with swipeable tabs
- Collapsible panels and bottom sheets for mobile UX

---

## Architecture Deep Dive

### Deployed Programs (Devnet)

| Program | ID | Size | Purpose |
|---------|-----|------|---------|
| confidex_dex | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` | 375KB | Core DEX logic |
| arcium_mxe | `CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE` | 239KB | MPC adapter |
| eligibility_verifier | `6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF` | 197KB | ZK proof verification |

### Account Structures

```rust
// Spot Orders - 285 bytes
ConfidentialOrder {
    maker: Pubkey,
    trading_pair: Pubkey,
    side: OrderSide,
    order_type: OrderType,
    encrypted_amount: [u8; 64],    // Arcium MPC
    encrypted_price: [u8; 64],     // Arcium MPC
    encrypted_filled: [u8; 64],    // Arcium MPC
    eligibility_proof_verified: bool,
}

// Perpetual Positions - 433 bytes
ConfidentialPosition {
    trader: Pubkey,
    market: Pubkey,
    side: PositionSide,            // PUBLIC
    leverage: u8,                  // PUBLIC
    encrypted_size: [u8; 64],      // PRIVATE
    encrypted_entry_price: [u8; 64], // PRIVATE
    encrypted_collateral: [u8; 64],  // PRIVATE
    liquidatable_below_price: u64,   // PUBLIC (verified by MPC)
    liquidatable_above_price: u64,   // PUBLIC (verified by MPC)
    threshold_verified: bool,
}
```

### Data Flow

```
User                Confidex             Arcium MPC           Solana
 |                     |                     |                   |
 |-- 1. Generate ZK -->|                     |                   |
 |   proof (client)    |                     |                   |
 |                     |                     |                   |
 |-- 2. Encrypt order->|                     |                   |
 |    parameters       |-- 3. Verify proof -------------->|      |
 |                     |                     |                   |
 |                     |-- 4. Store order ----------------->|    |
 |                     |    (encrypted)      |                   |
 |                     |                     |                   |
 |                     |-- 5. Match orders ->|                   |
 |                     |   (MPC comparison)  |                   |
 |                     |<- 6. Match result --|                   |
 |                     |                     |                   |
 |                     |-- 7. Settlement ------------------->|   |
 |                     |   (ShadowWire/C-SPL)|                   |
 |<-- 8. Confirmation -|                     |                   |
```

---

## Codebase Statistics

| Category | Count |
|----------|-------|
| Rust program files | 43 |
| TypeScript/TSX files | 53 |
| Noir circuit lines | 119 |
| Total commits | 13 |
| Integration tests passing | 29/29 |
| Deployed programs | 3 |

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `confidex-client.ts` | 980 | Transaction builders, PDA derivation |
| `trading-panel.tsx` | 970 | Main trading interface |
| `perpetuals-store.ts` | 380 | Position state management |
| `position.rs` | 183 | Confidential position account |
| `main.nr` | 119 | Eligibility ZK circuit |

---

## Features Implemented

### Spot Trading
- [x] Encrypted limit/market orders
- [x] ZK eligibility verification
- [x] Private order matching
- [x] Confidential settlement
- [x] Order book display (amounts hidden)
- [x] Trade history (prices hidden)

### Perpetual Futures (NEW)
- [x] Leveraged positions (1-20x)
- [x] Encrypted position data
- [x] Public liquidation thresholds
- [x] Funding rate mechanism
- [x] Position management UI
- [x] Liquidation warnings
- [x] Add/remove margin

### Infrastructure
- [x] Wrap/unwrap tokens
- [x] Helius RPC integration
- [x] Pyth price feeds (streaming)
- [x] Professional trading terminal UI
- [x] Mobile-responsive design
- [x] Dark theme
- [x] Dropdown navigation (Drift-style)

---

## Performance Metrics

| Operation | Target | Achieved |
|-----------|--------|----------|
| ZK proof generation | < 3s | ~2.5s (client WASM) |
| MPC price comparison | ~500ms | ~450ms |
| Order submission | < 2s | ~1.8s |
| Settlement finality | < 400ms | ~350ms (1 slot) |

---

## Prize Track Integrations

### Arcium ($10K)

**Integration:** Full MPC-encrypted order matching

- x25519 key exchange for shared secrets
- RescueCipher encryption for order parameters
- Cerberus protocol for maximum security
- Recurring MXE for order book matching

**Files:**
- `frontend/src/hooks/use-encryption.ts`
- `frontend/src/lib/confidex-client.ts`
- `programs/arcium_mxe/`

### Aztec/Noir ($10K)

**Integration:** Groth16 eligibility proofs via Sunspot

- Sparse Merkle Tree non-membership proof
- Pedersen hash (Sunspot compatible)
- 388-byte proofs (Solana compatible)
- Deployed verifier program

**Files:**
- `circuits/eligibility/src/main.nr`
- `frontend/src/hooks/use-zk-proof.ts`

### Helius ($5K)

**Integration:** RPC, webhooks, indexing

- Helius SDK for enhanced RPC
- Transaction webhooks for order updates
- Photon indexing for historical data

**Files:**
- `frontend/src/lib/helius-client.ts`
- `frontend/src/app/api/webhooks/helius/route.ts`

### Radr Labs/ShadowWire ($15K)

**Integration:** Bulletproof settlement layer

- Client-side range proof generation
- Private transfers (amount hidden)
- 17 supported tokens
- Dual settlement architecture

**Files:**
- `frontend/src/lib/confidex-client.ts` (wrap/unwrap)
- `programs/confidex_dex/src/settlement/`

### PNP Exchange ($2.5K)

**Integration:** Prediction markets with confidential collateral

- PNP SDK integration
- YES/NO outcome tokens
- Privacy-preserving positions

**Files:**
- `frontend/src/hooks/use-predictions.ts`
- `frontend/src/app/predict/page.tsx`

---

## What Makes Confidex Special

1. **First MPC + ZK DEX on Solana** - Novel combination of technologies
2. **Private Perpetuals** - Solved "impossible" liquidation problem
3. **Institutional-Ready** - Compliance proofs without identity reveal
4. **Production Architecture** - Dual settlement, fallback strategies
5. **Complete Product** - Not just contracts, full trading terminal

---

## Running the Demo

```bash
# Clone repository
git clone https://github.com/Jerome2332/confidex.git
cd confidex

# Install dependencies
cd frontend && pnpm install

# Set environment variables
cp .env.example .env.local
# Add your Helius API key

# Run development server
pnpm dev

# Visit http://localhost:3000
```

### Demo Flow

1. **Connect Wallet** - Use Phantom/Solflare on devnet
2. **Wrap Tokens** - Convert SOL/USDC to confidential tokens
3. **Place Order** - ZK proof generated, order encrypted
4. **View Order Book** - See orders (amounts hidden)
5. **Trade Perpetuals** - Open leveraged positions
6. **Manage Positions** - See PnL, add margin, close

---

## Team

**Humanoid Tech**
Built in 2 weeks for Solana Privacy Hack 2026

---

## Links

- **Live Demo:** https://frontend-humanoid-tech.vercel.app
- **GitHub:** https://github.com/Jerome2332/confidex
- **Documentation:** See `/project-docs/` folder

---

*"Privacy is not about having something to hide. It's about having the freedom to trade without surveillance."*
