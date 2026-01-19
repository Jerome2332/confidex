# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning & Task Breakdown

When planning work on this project, follow the guidelines in [docs/spec.md](docs/spec.md):
- Every task/ticket should be an atomic, commitable piece of work with tests (or other validation)
- Every sprint should result in a demoable piece of software that can be run, tested, and built upon
- Focus on small atomic tasks that compose into clear sprint goals
- Be exhaustive, clear, and technical in task definitions

## Development Standards

**NO SHORTCUTS OR BYPASSES.** This is a production-grade platform, not a hackathon demo. Every feature must be implemented correctly:

- **ZK Verification:** Real Groth16 proofs via Sunspot - no simulated/fake proofs
- **MPC Operations:** Real Arcium cluster integration - no mock computations
- **Encryption:** Proper RescueCipher with actual MXE keys - no demo modes
- **Settlement:** Production-ready ShadowWire/C-SPL integration

The ZK verification alongside MPC and encrypted balances is our competitive advantage. Cutting corners defeats the purpose of the project.

## Project Overview

Confidex is a confidential decentralized exchange (DEX) for the Solana Privacy Hack (January 2026). It implements a **three-layer privacy architecture**:

1. **Noir ZK Proofs** - Blacklist non-membership proof (compliance)
2. **Arcium MPC** - Encrypted order matching (execution)
3. **C-SPL Tokens** - Persistent encrypted balances (settlement)

## Tech Stack

- **Blockchain:** Solana (devnet), Anchor 0.32.1
- **ZK Proofs:** Noir 1.0.0-beta.13, Groth16 via Sunspot
- **MPC:** Arcium v0.4.0+ (Cerberus protocol)
- **Prediction Markets:** PNP SDK (pnp-sdk npm package)
- **Rust:** 1.89.0 (required for Arcium v0.4.0+)
- **Frontend:** Next.js 14, TypeScript, Tailwind, shadcn/ui, Zustand
- **Icons:** Phosphor Icons (@phosphor-icons/react) - see [frontend/phosphor-icons.md](frontend/phosphor-icons.md)
- **RPC:** Helius SDK
- **Arcium Client:** @arcium-hq/client, @arcium-hq/reader (TS SDK available)

## Build Commands

### Anchor Programs
```bash
anchor build                    # Build all programs
anchor test                     # Run all tests
anchor deploy                   # Deploy to devnet
```

### Noir Circuits
```bash
nargo build                     # Compile circuit
nargo test                      # Run circuit tests
nargo prove                     # Generate proof
sunspot compile                 # Generate Solana verifier
sunspot setup                   # Setup verification keys
sunspot deploy                  # Deploy verifier program
```

### Frontend
```bash
cd frontend
pnpm install                    # Install dependencies
pnpm dev                        # Development server
pnpm build                      # Production build
pnpm lint                       # Run ESLint
pnpm test                       # Run unit tests
pnpm test:watch                 # Run tests in watch mode
pnpm test:coverage              # Run tests with coverage
```

## Architecture

### Data Flow
1. Frontend generates ZK proof client-side (2-3 seconds, WASM)
2. Frontend encrypts order via Arcium SDK
3. Transaction submitted with proof + encrypted parameters
4. On-chain: Sunspot verifier validates ZK proof
5. Order stored encrypted in program state
6. Arcium MPC matches orders (encrypted price comparison)
7. C-SPL confidential transfers execute settlement

### Core Programs
| Program | Program ID (Devnet) | Purpose |
|---------|---------------------|---------|
| `confidex_dex` | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` | Core DEX logic, order management, MPC callbacks |
| `arcium_mxe` | `CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE` | MXE wrapper for Arcium MPC operations |
| `eligibility_verifier` | `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W` | ZK proof verification (Groth16 via Sunspot) |
| `c_spl_program` | TBD | Confidential token standard |

### Key Account Structures
- **ExchangeState** (158 bytes): Global config, blacklist merkle root, fee settings
- **TradingPair** (234 bytes): Base/quote mints, confidential vaults
- **ConfidentialOrder** (285 bytes): Encrypted amount/price/filled (64 bytes each via Arcium)
- **UserAccount** (66 bytes): Optional tracking, eligibility verification status

### Cross-Program Invocations
- **Sunspot verifier:** Verify Groth16 proof (388 bytes proof + 32 bytes witness)
- **Arcium adapter:** `encrypt_value`, `compare_encrypted`, `add/sub/mul_encrypted`
- **C-SPL:** `confidential_transfer`, `deposit_confidential`, `withdraw_confidential`

## Critical Constraints

### Cryptographic Requirements
- **MUST use Groth16 via Sunspot** - NOT Barretenberg (proofs too large for Solana)
- **Noir version lock:** 1.0.0-beta.13 (Sunspot compatibility)
- **ZK hash function:** Poseidon (ZK-friendly)

### Privacy Rules
- **Never emit amounts/prices in events** - Only emit order IDs, timestamps, sides
- **Never expose encrypted values in UI** - Show "encrypted indicator" status only
- Events: `OrderPlaced`, `TradeExecuted` emit maker/pair/side but NOT amount/price

### Performance Targets
| Operation | Target |
|-----------|--------|
| ZK proof generation | < 3 seconds (client-side) |
| MPC comparison | ~500ms |
| Full order match | 1-2 seconds |
| Proof verification | ~200K compute units |

## Environment Setup

### Rust Toolchain (for Arcium v0.4.0+)
Create `rust-toolchain.toml` in project root:
```toml
[toolchain]
channel = "1.89.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

### Arcium Version Manager (arcup)
```bash
arcup install              # Install latest version
arcup install <version>    # Install specific version
arcup use <version>        # Switch versions
arcup version              # Show active version
arcup list                 # List installed versions
```
**Version compatibility:** MAJOR.MINOR must match across CLI and Arx Node (PATCH can differ).

### Required API Keys
- **Helius:** https://dev.helius.xyz/ - For RPC access
- **Arcium:** Public testnet on Solana devnet - No approval needed, just deploy

### Program IDs (Devnet)
```bash
# Core DEX Program
NEXT_PUBLIC_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB

# Arcium MXE Program (our deployed MXE wrapper)
NEXT_PUBLIC_MXE_PROGRAM_ID=CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE

# Arcium Core Program (official Arcium program)
ARCIUM_PROGRAM_ID=Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ
```

### Token Mints (Devnet)

| Token | Mint Address | Notes |
|-------|--------------|-------|
| **Wrapped SOL** | `So11111111111111111111111111111111111111112` | Native SOL wrapper |
| **Dummy USDC** | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` | **Default for devnet testing** - unlimited supply |
| **Circle USDC** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Official Circle devnet USDC (limited supply) |
| **USDC Mainnet** | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Production USDC |

**Important:** All devnet scripts and frontend use Dummy USDC (`Gh9Zw...`) by default for testing. This allows unlimited test tokens without faucet limitations.

## Noir Circuit Pattern

Eligibility circuit proves blacklist non-membership:
- **Public input:** `blacklist_root` (32 bytes, on-chain)
- **Private inputs:** `address`, `merkle_path` ([Field; 20]), `path_indices` ([bool; 20])
- Uses Sparse Merkle Tree verification with Poseidon hashing

## Arcium Integration

### Overview
Arcium is a decentralized "encrypted supercomputer" enabling computation on fully encrypted data via Multi-Party Computation (MPC). Privacy guaranteed if at least 1 node is honest (dishonest majority model). Solana serves as the orchestration layer for computation scheduling, node management, and payments.

### Key Concepts
- **MXE (Multi-Party eXecution Environment):** Virtual machines where computations are defined and securely executed
- **Clusters:** Groups of Arx Nodes collaborating to execute MPC tasks
- **Arx Nodes:** Decentralized network participants performing encrypted computations
- **arxOS:** Distributed operating system powering the network
- **Arcis:** Rust-based developer framework for privacy-preserving apps

### MPC Protocols
| Protocol | Security Model | Use Case |
|----------|---------------|----------|
| **Cerberus** | Dishonest majority + MAC authentication | Maximum security, DEX order matching |
| **Manticore** | Honest but curious + Trusted Dealer | High performance, ML/AI workloads |

**For Confidex:** Use Cerberus for order matching (strongest security guarantees).

### Installation
```bash
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
```

### Arcium CLI Commands
```bash
arcium build                    # Build MXE program
arcium test                     # Run local tests
arcium deploy --cluster-offset <offset> --keypair-path <path> --rpc-url <url>
```

**Devnet cluster offsets:** 123, 456, 789 (all v0.5.1)

### TypeScript SDK
```bash
npm install @arcium-hq/client   # Encryption, submission, callbacks
npm install @arcium-hq/reader   # Read MXE data
```

**Encryption Example:**
```typescript
import { RescueCipher } from '@arcium-hq/client';
import { x25519 } from '@noble/curves/ed25519';

const privateKey = x25519.utils.randomSecretKey();
const publicKey = x25519.getPublicKey(privateKey);
const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
const cipher = new RescueCipher(sharedSecret);
const ciphertext = cipher.encrypt(plaintext, nonce);
```

### Arcis (MPC Circuit Framework)

**Supported Types:**
- Integers: `u8`, `u16`, `u32`, `u64`, `u128`, `i8`, `i16`, `i32`, `i64`, `i128`
- Floats: `f32`, `f64` (fixed-point, range -2^250 to 2^250)
- Arrays, tuples, structs of supported types
- **NOT supported:** HashMap, Vec, String (variable length)

**Encryption Type:** `Enc<Owner, T>` where Owner is `Mxe` or `Shared`

**MPC Operations:**
```rust
// Arithmetic: +, -, *, /, %
// Comparison: ==, !=, <, <=, >=, >
// Logical: &&, ||, ^, &, |

// RNG
ArcisRNG::bool()
ArcisRNG::gen_integer_from_width(width)
ArcisRNG::shuffle(slice)

// Encryption conversion
input_enc.to_arcis()           // Ciphertext → secret shares
owner.from_arcis(output)       // Secret shares → ciphertext
```

### Computation Lifecycle
1. **Definition:** Blueprint in MXE (inputs, outputs, logic, permissions)
2. **Commissioning:** Instantiate with arguments, execution windows
3. **Mempool:** Queued awaiting execution
4. **Execution:** Nodes securely compute while maintaining privacy
5. **Callback:** Success/failure actions integrate results

**Execution Windows:**
- `Valid After`: Earliest execution time (default: 0 = immediate)
- `Valid Before`: Latest deadline (default: infinity = no expiration)

### Pricing Model
- **Base Fee:** Minimum viable price covering node infrastructure costs
- **Priority Fee:** Dynamic fee market for faster execution
- **Computational Units (CUs):** Standardized work metrics for pricing
- Cost = (Base Fee + Priority Fee) / CUs used

### Security Features
- **Constant-time operations:** Prevents timing-based side-channel attacks
- **Cryptographic detection:** Identifies malicious node behavior
- **Slashing penalties:** Automatic stake reduction for misbehavior
- **Redundant execution:** Fault detection triggers re-execution by other nodes

### Key Patterns
- **No backend needed:** Write normal Solana programs, Arcium handles routing
- **Browser client OK:** Trigger computations from browser via TS SDK
- **MXE types:** Recurring for order matching, single-use for one-off
- **Output limit:** Must fit in single Solana tx, or use callback server
- **ZK vs MPC:** Use Noir/ZK for proving facts, Arcium/MPC for encrypted computation
- **Stateless:** Computations complete within single epochs (use external storage for persistence)

### Dark Pool Use Case (Relevant to Confidex)
Arcium enables "trustless dark pools, allowing participants to trade privately without revealing sensitive order details." This prevents:
- Front-running and MEV extraction
- Market manipulation
- Information leakage on large block trades

### C-SPL Status
Going live on devnet soon (as of Jan 2026)

### Confidex MPC Integration (LIVE)

The Arcium MPC integration is now fully wired up and deployed to devnet. This enables true encrypted order matching where prices are never revealed on-chain.

**Architecture:**
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   DEX Program   │     │  Arcium Cluster │
│  (TypeScript)   │     │   (On-Chain)    │     │   (Arx Nodes)   │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ 1. Encrypt with │────▶│ 2. Queue to     │────▶│ 3. MPC Execute  │
│    RescueCipher │     │    MXE program  │     │    (Cerberus)   │
│                 │     │                 │     │                 │
│ 5. Get result   │◀────│ 4. Callback     │◀────│    Return       │
│    from event   │     │    with result  │     │    result       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Key Files:**

| File | Purpose |
|------|---------|
| `programs/confidex_dex/src/cpi/arcium.rs` | CPI infrastructure, program IDs, queue functions (spot + perps) |
| `programs/confidex_dex/src/instructions/mpc_callback.rs` | Callback receivers for MPC results |
| `programs/confidex_dex/src/instructions/match_orders.rs` | Spot order matching with async MPC flow |
| `programs/confidex_dex/src/instructions/perp_open_position.rs` | Perp position opening with MPC threshold verification |
| `programs/confidex_dex/src/instructions/perp_close_position.rs` | Perp close with MPC PnL/funding calculation |
| `programs/confidex_dex/src/instructions/perp_liquidate.rs` | Liquidation with MPC eligibility check |
| `programs/confidex_dex/src/state/pending_match.rs` | PendingMatch account for tracking computations |
| `programs/arcium_mxe/src/instructions/callback.rs` | MXE callback handler with CPI to DEX |
| `frontend/src/hooks/use-encryption.ts` | Client-side RescueCipher encryption |
| `frontend/src/hooks/use-mpc-events.ts` | Event subscription for MPC callbacks |
| `frontend/src/hooks/use-private-predictions.ts` | Privacy-enhanced prediction markets hook |

**MPC Operations Supported:**

| Operation | Input | Output | Use Case |
|-----------|-------|--------|----------|
| `ComparePrices` | 2x encrypted u64 | bool (prices match) | Order matching |
| `CalculateFill` | 4x encrypted u64 | encrypted fill + 2 bools | Fill amount calculation |
| `Add` | 2x encrypted u64 | encrypted u64 | Balance updates |
| `Subtract` | 2x encrypted u64 | encrypted u64 | Balance updates |
| `Multiply` | 2x encrypted u64 | encrypted u64 | Fee calculations |

**Perpetuals MPC Operations:**

| Operation | Input | Output | Use Case |
|-----------|-------|--------|----------|
| `VerifyPositionParams` | encrypted collateral/size/entry + claimed threshold | bool (valid) | Open position - verify liquidation threshold |
| `CheckLiquidation` | encrypted collateral/size/entry + mark price | bool (liquidate) | Liquidation eligibility check |
| `CalculatePnL` | encrypted size/entry + exit price | u64 + is_loss bool | Close position / liquidation PnL |
| `CalculateFunding` | encrypted size + funding rate/delta | u64 + is_paying bool | Position funding settlement |

**Configuration:**
```rust
// programs/confidex_dex/src/cpi/arcium.rs
pub const USE_REAL_MPC: bool = true;  // Toggle simulation vs real MPC
pub const DEFAULT_CLUSTER_OFFSET: u16 = 123;  // Devnet cluster (123, 456, 789)
```

**Events Emitted:**
- `PriceCompareComplete` - After MPC price comparison (includes `prices_match: bool`)
- `OrdersMatched` - After fill calculation (includes `buy_fully_filled`, `sell_fully_filled`)
- `MatchQueued` - When async MPC match is queued (includes `request_id`)
- `ComputationCompleted` - From MXE after any computation

**Async vs Sync MPC Flows:**

| Flow | When to Use | Order Status |
|------|-------------|--------------|
| **Sync** | Testing, low latency requirements | Immediate `PartiallyFilled` / `Filled` |
| **Async** | Production, real MPC clusters | `Matching` → callback → `Filled` |

Async flow adds `Matching` order status and `pending_match_request` field to track in-flight computations.

**Frontend Usage:**
```typescript
import { useMpcEvents } from '@/hooks/use-mpc-events';
import { useEncryption } from '@/hooks/use-encryption';

// Initialize encryption
const { initializeEncryption, encryptValue } = useEncryption();
await initializeEncryption();

// Encrypt order values
const encryptedPrice = await encryptValue(BigInt(price));
const encryptedAmount = await encryptValue(BigInt(amount));

// Subscribe to MPC events
const { onPriceCompareComplete, onOrdersMatched, startListening } = useMpcEvents();
startListening();

onPriceCompareComplete((event) => {
  console.log('Prices match:', event.pricesMatch);
});
```

### Docs
- **Main:** https://docs.arcium.com/developers
- **TS SDK API:** https://ts.arcium.com/api
- **Hello World:** https://docs.arcium.com/developers/hello-world
- **Architecture:** https://docs.arcium.com/getting-started/architecture-overview
- **MPC Protocols:** https://docs.arcium.com/multi-party-execution-environments-mxes/mpc-protocols

---

## Production Roadmap

### Current State (January 2026)

Confidex implements a **hybrid privacy model** that provides meaningful privacy guarantees while working within current infrastructure limitations.

#### What's Implemented

| Component | Status | Privacy Level |
|-----------|--------|---------------|
| **ZK Eligibility Proofs** | ✅ Live | Full privacy - blacklist membership proven without revealing address |
| **RescueCipher Encryption** | ✅ Live | Order values encrypted with X25519 + Arcium cipher |
| **MPC Price Comparison** | ✅ Live | Encrypted price matching via Arcium Cerberus protocol |
| **Automated Crank Service** | ✅ Live | Backend service auto-matches orders on devnet |
| **Async MPC Flow** | ✅ Live | Production callback-based MPC execution |

#### Current Encryption Format (Hybrid)

```
[plaintext (8 bytes) | nonce (8 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
```

**Why hybrid?** On-chain balance validation requires plaintext amounts until C-SPL encrypted balances are available.

| Bytes | Content | Purpose |
|-------|---------|---------|
| 0-7 | Plaintext value | On-chain balance validation & escrow |
| 8-15 | Truncated nonce | MPC decryption |
| 16-47 | Ciphertext | MPC encrypted price comparison |
| 48-63 | Ephemeral pubkey | MPC key routing |

#### Privacy Guarantees Today

| Data | Visibility | Rationale |
|------|------------|-----------|
| Order amounts | On-chain (visible) | Required for balance validation |
| Order prices | On-chain (visible) | Required for cost calculation |
| **Price comparison result** | **MPC (private)** | Matching logic hidden from observers |
| **Trade execution timing** | **Private** | Cannot predict which orders will match |
| User eligibility | ZK (private) | Blacklist status never revealed |

**Key insight:** Even with visible order values, the MPC price comparison prevents front-running because observers cannot determine which orders will match until after MPC execution.

### Phase 2: Full Order Privacy (C-SPL Dependency)

When C-SPL confidential tokens launch on devnet, we can achieve full order privacy:

#### Required Changes

1. **Encrypted Balances**
   - Replace `UserConfidentialBalance.balance: u64` with `encrypted_balance: [u8; 64]`
   - Use MPC for balance comparisons: `encrypted_balance >= encrypted_cost`

2. **Pure Ciphertext Format**
   ```
   [nonce (16 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
   ```
   No plaintext needed - MPC handles all comparisons.

3. **Encrypted Settlement**
   - C-SPL `confidential_transfer` for order fills
   - Encrypted fee calculations via MPC

#### Privacy After C-SPL

| Data | Visibility |
|------|------------|
| Order amounts | Encrypted (private) |
| Order prices | Encrypted (private) |
| User balances | Encrypted (private) |
| Trade amounts | Encrypted (private) |
| Eligibility | ZK (private) |

### Phase 3: Production Hardening

1. **Real ZK Verification**
   - Enable Sunspot Groth16 verification on-chain
   - Remove `ZK verification DISABLED` bypass
   - Deploy production verifier program

2. **MPC Cluster Selection**
   - Evaluate devnet clusters (123, 456, 789) for reliability
   - Configure failover between clusters
   - Monitor MPC latency and success rates

3. **Settlement Layer**
   - Primary: C-SPL confidential transfers
   - Fallback: ShadowWire for anonymous withdrawals
   - Inco Lightning as alternative TEE option

### Architecture Evolution

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CURRENT (Hybrid Privacy)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  User                    On-Chain                    MPC                │
│  ────                    ────────                    ───                │
│  ZK proof ───────────────► Verify eligibility                           │
│  Plaintext amount ───────► Balance check/escrow                         │
│  Ciphertext ─────────────► Store ──────────────────► Price comparison   │
│                                                      (encrypted)        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         FUTURE (Full Privacy with C-SPL)                │
├─────────────────────────────────────────────────────────────────────────┤
│  User                    On-Chain                    MPC                │
│  ────                    ────────                    ───                │
│  ZK proof ───────────────► Verify eligibility                           │
│  Ciphertext only ────────► Store ──────────────────► Balance check      │
│                                  ──────────────────► Price comparison   │
│                                  ──────────────────► Settlement calc    │
│                          C-SPL transfer ◄──────────── Fill amounts      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Monitoring & Operations

The automated crank service provides production-grade order matching:

```bash
# Enable crank service
CRANK_ENABLED=true pnpm dev

# Check crank status
curl http://localhost:3001/admin/crank/status

# Configuration
CRANK_POLLING_INTERVAL_MS=5000    # Check for matches every 5s
CRANK_USE_ASYNC_MPC=true          # Use production async MPC flow
CRANK_MAX_CONCURRENT_MATCHES=5    # Parallel match attempts
```

### Dependencies & Timeline

| Dependency | Status | Impact |
|------------|--------|--------|
| C-SPL devnet launch | Pending (Q1 2026) | Enables full order privacy |
| Arcium mainnet | Live | Production MPC available |
| Sunspot mainnet | Live | Production ZK verification |
| ShadowWire | Live | Anonymous withdrawal option |

---

## PNP SDK Integration (Prediction Markets)

PNP Exchange is a decentralized prediction market protocol on Solana used for prediction market functionality with privacy-focused tokens as collateral. **Hackathon Prize:** $2.5K PNP integration.

### Platform Overview

- Uses **Pythagorean bonding curves** for continuous liquidity (no order books)
- **LLM-assisted oracle** for market resolution (Perplexity + Grok 4)
- **1% trading fee** split: 50% creators, 15% platform, 15% token holders, 10% referrals, 10% insurance
- Permissionless market creation with USDC collateral

### Market Models

**V2 Pythagorean Markets (AMM):**
- Algorithmic market maker with automated price discovery
- Liquidity split equally into YES/NO positions at creation
- Pricing formula: `Price(YES)² + Price(NO)² = 1`
- Prices adjust dynamically based on supply changes

**V3 P2P Parimutuel Markets:**
- Peer-to-peer betting, no market maker
- All bets aggregate into shared pool
- Winners divide pot proportionally by stake
- Parameters: question, expiration, side selection, max pot ratio, initial liquidity

### Installation

```bash
npm install pnp-sdk
```

**Environment Variables:**
```env
RPC_URL=https://api.devnet.solana.com
WALLET_SECRET_BASE58=YourBase58EncodedPrivateKeyHere
# OR
WALLET_SECRET_ARRAY=[38,217,47,162,6,...]
```

### Client Initialization

```typescript
import { PNPClient } from 'pnp-sdk';
import bs58 from 'bs58';

// Read-only operations (no private key needed)
const readOnlyClient = new PNPClient(rpcUrl);

// Write operations (requires private key as Uint8Array or base58)
const pk = process.env.WALLET_SECRET_BASE58
  ? bs58.decode(process.env.WALLET_SECRET_BASE58)
  : undefined;
const client = new PNPClient(process.env.RPC_URL!, pk);
```

### SDK Methods

**Market Operations:**
```typescript
// Create V2 AMM markets
await client.market.createMarket();

// Create P2P markets
await client.createP2PMarketGeneral();

// Platform-linked markets
await client.createMarketTwitter();
await client.createMarketYoutube();
```

**Trading:**
```typescript
// Buy YES/NO tokens with USDC
await client.trading.buyTokensUsdc(market, outcome, amount);

// Alternative buy method
await client.trading.buyOutcome(market, isYes, amount);

// Sell outcome tokens
await client.trading.sellOutcome(market, isYes, tokenAmount);
```

**Redemption:**
```typescript
// Claim winnings from resolved markets
await client.redeemPosition(market);

// Refund from unresolvable markets
await client.claimMarketRefund(market);
await client.claimP2PMarketRefund(market);
```

**Data Fetching:**
```typescript
// Get specific market details
const market = await client.fetchMarket(marketPubkey);

// List all markets
const markets = await client.fetchMarkets();

// System configuration
const config = await client.fetchGlobalConfig();

// All market addresses
const addresses = await client.fetchMarketAddresses();
```

**Oracle/Settlement:**
```typescript
// Check market resolvability
const criteria = await client.fetchSettlementCriteria(market);

// Get resolution answer and reasoning
const settlement = await client.fetchSettlementData(market);
```

### Market Response Structure

```typescript
{
  market: PublicKey,           // Market address
  yesTokenMint: PublicKey,     // YES outcome token
  noTokenMint: PublicKey,      // NO outcome token
  collateralMint: PublicKey,   // USDC mint
  marketDetails: {
    id: string,
    question: string,
    creator: string,
    initialLiquidity: string,
    marketReserves: string,
    yesTokenSupply: string,
    noTokenSupply: string,
    endTime: number,           // Unix timestamp (seconds)
    resolved: boolean,
    winning_token_id?: string  // Set after resolution
  }
}
```

### Oracle System

**Two-Step Process:**
1. **Criteria Generation** (before trading): Validates resolvability, identifies authoritative sources, defines objective metrics
2. **Settlement** (at expiration): Uses time-bounded evidence, checks sources, shows mathematical reasoning, finalizes on-chain

**AI Providers:** Perplexity and Grok 4 for real-time data retrieval with unbiased, current context.

### Devnet vs Mainnet Workflow

**Critical Difference:** On devnet, markets require manual activation before trading is possible.

**The Core Flow:**
```
1. Create Market → 2. Set Resolvable (TRUE) → 3. Trade → 4. Redeem
```

**Why `setMarketResolvable(true)` is Required on Devnet:**

When a market is created, it starts in a **non-resolvable** state:
- ❌ No one can trade yet
- ❌ YES/NO tokens aren't minted (shows as System Program `11111111111111111111111111111111`)
- ❌ Market is essentially "pending activation"

After calling `setMarketResolvable(true)`:
- ✅ YES/NO token mints are created
- ✅ Initial liquidity tokens are minted to creator
- ✅ Trading is enabled

**Network Comparison:**

| Feature | Devnet | Mainnet |
|---------|--------|---------|
| Program ID | `pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz` | `6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb` |
| Set Resolvable | **Manual (you call it)** | Automatic (AI oracle) |
| Settlement | Manual testing | AI oracle resolution |
| Tokens | No real value | Real value |
| Collateral | Devnet USDC: `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` | Real USDC |

**Devnet Market Creation Example:**
```typescript
// Step 1: Create the market
const createRes = await client.market.createMarket({
  question: "Will ETH hit $5000 by end of 2026?",
  initialLiquidity: BigInt(1_000_000), // 1 USDC (6 decimals)
  endTime: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60),
  baseMint: DEVNET_COLLATERAL_MINT,
});

// Step 2: REQUIRED on devnet - enable trading
await client.setMarketResolvable(createRes.market, true);

// Step 3: Now trading is possible
await client.trading.buyTokensUsdc({ market: marketPk, buyYesToken: true, amountUsdc: 10 });
```

**Common Devnet Errors:**
- `"Market tokens not minted"` → Forgot to call `setMarketResolvable(true)`
- Token mints showing as `11111111111111111111111111111111` → Same issue
- `"Trading not enabled"` → Same issue

**Our Implementation:** The `/api/pnp/create-market` route automatically calls `setMarketResolvable(true)` after creating markets on devnet.

### REST API Server

```bash
npm run api:server                              # Start server on :3000
npm run api:server "Your market question?"      # Create market via CLI
```

**API Endpoints:**
- `GET /health` - Health check
- `POST /create-market` - Create market with `{ "question": "..." }`

### Known Limitations & Workarounds

**Root Cause:** pnp-sdk v0.2.3 imports `anchor.Wallet` which is conditionally exported only server-side:
```javascript
// @coral-xyz/anchor/dist/esm/index.js (all versions)
if (!isBrowser) {
    exports.Wallet = require("./nodewallet.js").default;
}
```

**Solution Implemented:** Server-side API routes load SDK via `require()` bypassing webpack:
- `/api/pnp/markets` - Fetches real market data via SDK (4754+ markets available!)
- `/api/pnp/build-tx` - SDK status check (trading requires signer)
- `/api/pnp/create-market` - Market creation (requires server wallet)

**Why NOT Downgrade Anchor:**
1. `@arcium-hq/client@0.6.2` requires Anchor 0.32.1 exactly
2. The `Wallet` export is conditional in ALL Anchor versions (0.29.0 through 0.32.1)
3. Downgrading would break Arcium integration without fixing pnp-sdk

### Confidex Integration Architecture

```
Client (Browser)                    Server (Node.js)
─────────────────                   ────────────────
pnp-client.ts                       /api/pnp/markets
     │                                    │
     │ fetch('/api/pnp/...')             │ require('pnp-sdk')
     │────────────────────────────────►   │
     │                                    │ SDK loads (Wallet available)
     │◄────────────────────────────────   │
     │ JSON response                      │
     ▼
pnp.ts (transforms data)
     │
     ▼
use-predictions.ts (React hook)
```

**Files:**
- `/frontend/src/app/api/pnp/markets/route.ts` - Server-side SDK market fetching
- `/frontend/src/app/api/pnp/build-tx/route.ts` - Transaction building (needs signer)
- `/frontend/src/lib/pnp-client.ts` - Client-side API wrapper
- `/frontend/src/lib/pnp.ts` - Business logic layer
- `/frontend/src/hooks/use-predictions.ts` - React hook with AnchorProvider ready
- `/frontend/src/hooks/use-private-predictions.ts` - Privacy-enhanced wrapper

**Docs:** https://docs.pnp.exchange/pnp-sdk

### Privacy Layer for Predictions

PNP markets use public AMM bonding curves (prices are inherently public), but Confidex adds privacy layers for user positions via `use-private-predictions.ts`.

**Privacy Modes:**

| Mode | Description | What's Hidden |
|------|-------------|---------------|
| `none` | Standard trading | Nothing |
| `encrypted` | Arcium encryption | Position sizes stored locally encrypted |
| `shadowwire` | ShadowWire integration | Deposits/withdrawals via private transfers |

**Usage:**
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

**What Remains Public:**
- Market prices (AMM bonding curve)
- Total liquidity
- Transaction existence on-chain
- Oracle resolution

**What Becomes Private:**
- Your position size (encrypted locally via Arcium)
- Deposit amounts (via ShadowWire)
- Withdrawal amounts (via ShadowWire)

## Inco Lightning (Alternative Confidential Computing)

Inco Lightning is a TEE-based confidential computing platform for Solana. **Hackathon Prize:** $6K (DeFi $2K, Gaming $2K, Payments $2K).

**Installation:**
```toml
# Cargo.toml
[dependencies]
inco-lightning = { version = "0.1.4", features = ["cpi"] }
```

```bash
# JS SDK
npm install @inco/solana-sdk
```

**Key Concepts:**
- **Handles:** 128-bit references to encrypted values (16 bytes each)
- **Types:** `Euint128` (encrypted u128), `Ebool` (encrypted bool)
- **Covalidator:** Off-chain TEE network processes encrypted operations

**Rust SDK Operations:**
```rust
use inco_lightning::cpi::{e_add, e_sub, e_ge, e_select, new_euint128};
use inco_lightning::types::{Euint128, Ebool};

// Arithmetic: e_add, e_sub, e_mul, e_rem
// Comparison: e_ge, e_gt, e_le, e_lt, e_eq (return Ebool)
// Selection: e_select (conditional based on Ebool)
```

**JS SDK Encryption:**
```typescript
import { encryptValue } from '@inco/solana-sdk/encryption';
import { decrypt } from '@inco/solana-sdk';

const encrypted = await encryptValue(amount);
const result = await decrypt(handles, wallet);
```

**Inco vs Arcium:**
| Aspect | Inco | Arcium |
|--------|------|--------|
| Model | TEE covalidator | MPC network |
| Security | Trust TEE hardware | Cryptographic (dishonest majority) |
| Operations | CPI calls | Arcis circuits |

**Program ID (Devnet):** `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj`

**Docs:** https://docs.inco.org/svm/introduction

**Prize Strategy:** Confidex uses Arcium (stronger cryptographic guarantees). Inco integration is optional stretch goal for additional $2K DeFi prize.

## ShadowWire (Private Transfers)

ShadowWire is a Bulletproof-based privacy layer for Solana transfers. **Hackathon Prize:** $15K (Best integration).

**Installation:**
```bash
npm install @radr/shadowwire
```

**Key Features:**
- **Internal transfers:** Amount hidden via ZK proof (both parties must use ShadowWire)
- **External transfers:** Amount visible, sender anonymous (any Solana wallet)
- **17 supported tokens:** SOL, USDC, RADR, BONK, ORE, etc.
- **1% relayer fee** applied automatically
- **Audited** smart contracts

**Basic Transfer:**
```typescript
import { ShadowWireClient } from '@radr/shadowwire';
import { useWallet } from '@solana/wallet-adapter-react';

const client = new ShadowWireClient({ debug: true });
const { signMessage, publicKey } = useWallet();

// Private transfer (amount hidden)
const result = await client.transfer({
  sender: publicKey!.toBase58(),
  recipient: 'RECIPIENT_ADDRESS',
  amount: 0.5,             // In token units
  token: 'SOL',
  type: 'internal',        // or 'external'
  wallet: { signMessage: signMessage! }  // REQUIRED
});
```

**Deposit/Withdraw:**
```typescript
await client.deposit({ wallet: 'ADDRESS', amount: 100000000 }); // lamports
await client.withdraw({ wallet: 'ADDRESS', amount: 50000000 });
const balance = await client.getBalance('ADDRESS', 'SOL');
```

**Client-Side Proof Generation:**
```typescript
import { initWASM, generateRangeProof, isWASMSupported } from '@radr/shadowwire';

if (isWASMSupported()) {
  await initWASM('/wasm/settler_wasm_bg.wasm');
  const proof = await generateRangeProof(amountLamports, 64);  // 2-3 seconds
  await client.transferWithClientProofs({ ..., customProof: proof });
}
```

**ShadowWire vs Arcium vs Inco:**
| Aspect | ShadowWire | Arcium | Inco |
|--------|------------|--------|------|
| Privacy | Bulletproofs ZK | MPC | TEE |
| Maturity | Production | Testnet | Beta |
| Fee | 1% relayer | Gas + CU | Gas + CU |
| Use Case | Transfers | Computation | Computation |

**Confidex Integration Options:**
1. **Settlement layer** - Replace C-SPL with ShadowWire pools
2. **Withdrawal only** - Anonymous exit from DEX to external wallets
3. **Dual support** - User chooses C-SPL or ShadowWire

**GitHub:** https://github.com/Radrdotfun/ShadowWire
**Telegram:** https://t.me/radrportal

## Fallback Strategies

- **C-SPL SDK issues:** Fall back to ShadowWire (production-ready) or Inco confidential tokens
- **Arcium testnet instability:** Fall back to ZK-only approach or Inco for encrypted storage
- **Settlement layer:** ShadowWire is most mature option if C-SPL delayed

## Frontend Infrastructure

### Logging

Structured logging via `@/lib/logger.ts`:
- **Environment-aware:** Silent in production (only errors), verbose in development
- **Namespaced:** `logger.pnp`, `logger.trading`, `logger.settlement`, etc.
- **Configurable:** Set `NEXT_PUBLIC_LOG_LEVEL` to `debug|info|warn|error`

```typescript
import { logger, createLogger } from '@/lib/logger';

// Use pre-configured loggers
logger.pnp.info('Fetched markets', { count: 10 });
logger.settlement.error('Transfer failed', { error: 'Insufficient balance' });

// Create custom namespace
const log = createLogger('my-feature');
log.debug('Processing started');
```

### Testing

Test framework: **Vitest** with React Testing Library

```bash
pnpm test                  # Run all tests
pnpm test:watch            # Watch mode
pnpm test:coverage         # Coverage report
```

Test files location: `/frontend/src/__tests__/`
- `pnp-client.test.ts` - Price calculation and token math
- `settlement.test.ts` - Settlement amount calculations

### API Security

**Helius Webhook** (`/api/webhooks/helius`):
- HMAC-SHA256 signature verification
- Timing-safe comparison (prevents timing attacks)
- Rate limiting: 100 requests/minute per IP
- Event deduplication via caching

**Required env:** `HELIUS_WEBHOOK_SECRET`

## Backend Service

The backend provides ZK proof generation and the automated crank service for order matching.

### Build Commands

```bash
cd backend
pnpm install                    # Install dependencies
pnpm dev                        # Development server (tsx watch)
pnpm build                      # Compile TypeScript to dist/
pnpm start                      # Run compiled JS
pnpm start:prod                 # Run with NODE_ENV=production
```

### Crank Service (Order Matching)

The crank service automatically monitors open orders and triggers MPC-based matching when compatible orders exist.

**How it works:**
1. Polls on-chain order accounts every 5 seconds
2. Identifies matchable buy/sell pairs
3. Executes `match_orders` instruction via MPC
4. Handles callbacks and updates order state

**Configuration (`backend/.env`):**
```env
CRANK_ENABLED=true              # Auto-start on backend launch
CRANK_POLLING_INTERVAL_MS=5000  # Poll every 5 seconds
CRANK_USE_ASYNC_MPC=true        # Use production async MPC flow
CRANK_MAX_CONCURRENT_MATCHES=5  # Max parallel match attempts
CRANK_WALLET_PATH=./keys/crank-wallet.json
CRANK_MIN_SOL_BALANCE=0.1       # Warning threshold
CRANK_ERROR_THRESHOLD=10        # Circuit breaker trigger
CRANK_PAUSE_DURATION_MS=60000   # Pause after circuit breaker
```

**Crank Wallet:**
- Located at `backend/keys/crank-wallet.json`
- Current address: `8LPCkBETLQNaDcbaFqFmeiZJJDoqjUipjEW6G2sf3TJr`
- Needs SOL for transaction fees (~0.1 SOL minimum)

### Production Deployment (PM2)

PM2 provides process management, auto-restart, and logging for production.

**Setup:**
```bash
# Install PM2 globally
npm install -g pm2

# Build and start
cd backend
pnpm build
pnpm pm2:start

# Useful commands
pnpm pm2:status                 # Check process status
pnpm pm2:logs                   # View live logs
pnpm pm2:restart                # Restart service
pnpm pm2:stop                   # Stop service

# Auto-start on system boot
pm2 startup                     # Follow printed instructions
pm2 save                        # Save current process list
```

**PM2 Configuration** (`backend/ecosystem.config.cjs`):
- Auto-restart on crash
- Max memory: 500MB
- Logs: `backend/logs/out.log`, `backend/logs/error.log`
- Environment: production with async MPC enabled

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with prover status |
| `/api/prove` | POST | Generate ZK eligibility proof |
| `/api/admin/blacklist` | GET/POST/DELETE | Manage blacklist |
| `/api/admin/crank/status` | GET | Crank metrics and status |
| `/api/admin/crank/start` | POST | Start crank service |
| `/api/admin/crank/stop` | POST | Stop crank service |
| `/api/admin/crank/pause` | POST | Pause polling |
| `/api/admin/crank/resume` | POST | Resume polling |

**Crank Status Response:**
```json
{
  "status": "running",
  "metrics": {
    "status": "running",
    "startedAt": 1768823244616,
    "lastPollAt": 1768823283595,
    "totalPolls": 100,
    "totalMatchAttempts": 5,
    "successfulMatches": 4,
    "failedMatches": 1,
    "consecutiveErrors": 0,
    "walletBalance": 0.95,
    "openOrderCount": 12,
    "pendingMatches": 0
  },
  "config": {
    "pollingIntervalMs": 5000,
    "useAsyncMpc": true,
    "maxConcurrentMatches": 5
  }
}
```

### Alternative Deployment Options

**Systemd (Linux):**
```ini
# /etc/systemd/system/confidex-crank.service
[Unit]
Description=Confidex Crank Service
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/confidex/backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/path/to/confidex/backend/.env.production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable confidex-crank
sudo systemctl start confidex-crank
```

**Docker:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod
COPY dist/ ./dist/
COPY keys/ ./keys/
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

## Branding Guidelines

See `/frontend/BRAND_GUIDELINES.md` for comprehensive design documentation.

### Quick Reference

**Monochrome Palette:**
- Background: `bg-black`
- Surfaces: `bg-white/5`, `bg-white/10`
- Text: `text-white`, `text-white/60`, `text-white/50`
- Borders: `border-white/10`, `border-white/20`

**Trading Accents (Subtle):**
- Buy/Long: `bg-emerald-500/20 text-emerald-400/80 border-emerald-500/30`
- Sell/Short: `bg-rose-500/20 text-rose-400/80 border-rose-500/30`

**Typography:**
- Headings: `font-light`
- Body: `font-light` or `font-normal`
- Buttons: `font-medium`
- Numbers/Prices: `font-mono`

**Components:**
- Buttons: `rounded-lg`
- Cards: `rounded-xl`
- Badges: `rounded-full`

**Icons:**
- **Use Phosphor Icons by default** (`@phosphor-icons/react`)
- Prefer Phosphor over Lucide for consistency
- If unsure of the icon name, search [phosphoricons.com](https://phosphoricons.com)
- Document new icons in [frontend/phosphor-icons.md](frontend/phosphor-icons.md)
- Common sizes: `size={16}` for inline/nav, `size={24}` for buttons, `size={36}` for section headers
