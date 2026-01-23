# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning & Task Breakdown

When planning work on this project:
- Every task/ticket should be an atomic, commitable piece of work with tests (or other validation)
- Every sprint should result in a demoable piece of software that can be run, tested, and built upon
- Focus on small atomic tasks that compose into clear sprint goals
- Be exhaustive, clear, and technical in task definitions

## Development Standards

**⚠️ NO SHORTCUTS OR BYPASSES - STRICT ENFORCEMENT ⚠️**

This is a production-grade platform, not a hackathon demo. Every feature must be implemented correctly. **NEVER** implement workarounds, simulations, or bypasses for any of the following:

### Mandatory Four-Layer Privacy Architecture

| Layer | Technology | Requirement | Status |
|-------|------------|-------------|--------|
| **Layer 1: Compliance** | Noir ZK Proofs | Real Groth16 proofs via Sunspot | MANDATORY |
| **Layer 2: Execution** | Arcium MPC | Real Cerberus protocol matching | MANDATORY |
| **Layer 3: Storage** | Light Protocol | ZK Compression for rent-free accounts | OPTIONAL |
| **Layer 4: Settlement** | ShadowWire | Bulletproof private transfers | MANDATORY |

### Strict Requirements

- **ZK Verification:** Real Groth16 proofs via Sunspot - **NO** simulated/fake proofs, **NO** skipping verification, **NO** placeholder proofs
- **MPC Operations:** Real Arcium cluster integration - **NO** mock computations, **NO** plaintext fallbacks
- **Encryption:** Proper RescueCipher with actual MXE keys - **NO** demo modes, **NO** plaintext-in-ciphertext hacks
- **Settlement:** Production-ready ShadowWire/C-SPL integration - **NO** public token transfers as permanent solution
- **Eligibility Proofs:** The 388-byte ZK proof MUST be verified on-chain via Sunspot verifier CPI - this is NON-NEGOTIABLE

### Why This Matters

The ZK verification alongside MPC and encrypted balances is our **competitive advantage** and the core value proposition of Confidex. Cutting corners:
1. Defeats the purpose of the project
2. Disqualifies us from hackathon prizes requiring real privacy
3. Creates a false sense of security for users
4. Makes the codebase inconsistent and harder to upgrade

**If you encounter stack overflow or other technical constraints, fix the root cause (optimize code, reduce allocations) rather than removing privacy features.**

### Address-Specific ZK Proof Generation ✅ COMPLETED

The ZK eligibility system now fully supports per-address proof generation with non-empty blacklists.

**Implementation Status (January 2026):**

| Component | Status | Details |
|-----------|--------|---------|
| Poseidon2 Hash | ✅ Complete | Native JS matching Noir's BN254 stdlib |
| Sparse Merkle Tree | ✅ Complete | 20-level tree, collision handling |
| Per-Address Proofs | ✅ Complete | Unique merkle paths per address |
| Dynamic Prover.toml | ✅ Complete | Generated per `(address, root)` tuple |
| Integration Tests | ✅ Complete | 23 tests covering all cases |

**Key Files:**

| File | Purpose |
|------|---------|
| `backend/src/lib/poseidon2.ts` | Poseidon2 hash (BN254, t=4, d=5, 4+56+4 rounds) |
| `backend/src/lib/blacklist.ts` | SparseMerkleTree with full proof generation |
| `backend/src/lib/prover.ts` | Dynamic Prover.toml + Groth16 proof generation |
| `backend/src/__tests__/lib/blacklist.test.ts` | Comprehensive test suite |

**Technical Details:**

```typescript
// Poseidon2 hash - matches Noir's stdlib exactly
hash(0, 0) = 0x18dfb8dc9b82229cff974efefc8df78b1ce96d9d844236b496785c698bc6732e

// Empty tree root (20 levels)
EMPTY_ROOT = 0x3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387

// Address → leaf index mapping
index = first 20 bits of base58.decode(address)
```

**Proof Flow:**
1. `getMerkleProof(address, root)` returns `{isEligible, path[20], indices[20]}`
2. If blacklisted: `isEligible=false`, empty path/indices
3. If eligible: 20 sibling hashes + 20 path direction bits
4. `generateProverToml()` creates circuit inputs
5. `nargo execute` → witness → `sunspot prove` → 324-byte Groth16 proof

**Acceptance Criteria (All Met):**
- [x] `poseidon2Hash()` computes correct hashes matching Noir circuit
- [x] Merkle proofs verify for addresses NOT in a non-empty blacklist
- [x] Proofs FAIL verification for blacklisted addresses
- [x] Backend generates unique proofs per address (not shared empty-tree proof)
- [x] Tests cover: empty tree, single entry, multiple entries, boundary cases, collisions

## Project Overview

Confidex is a confidential decentralized exchange (DEX) for the Solana Privacy Hack (January 2026). It implements a **four-layer privacy architecture**:

1. **Noir ZK Proofs** - Blacklist non-membership proof (compliance)
2. **Arcium MPC** - Encrypted order matching (execution)
3. **Light Protocol** - ZK Compression for rent-free accounts (storage)
4. **ShadowWire** - Bulletproof private transfers (settlement)

## Tech Stack

- **Blockchain:** Solana (devnet), Anchor 0.32.1
- **ZK Proofs:** Noir 1.0.0-beta.13, Groth16 via Sunspot
- **MPC:** Arcium v0.6.3 (Cerberus protocol)
- **ZK Compression:** Light Protocol v0.22.0 (rent-free accounts)
- **Settlement:** ShadowWire (Bulletproof privacy)
- **Prediction Markets:** PNP SDK (pnp-sdk npm package)
- **Rust:** 1.89.0 (required for Arcium v0.4.0+)
- **Frontend:** Next.js 14, TypeScript, Tailwind, shadcn/ui, Zustand
- **Icons:** Phosphor Icons (@phosphor-icons/react) - see [frontend/phosphor-icons.md](frontend/phosphor-icons.md)
- **RPC:** Helius SDK (also supports Light Protocol compression indexing)
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
| `confidex_mxe` | `DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM` | MXE wrapper for Arcium MPC operations (deployed 2026-01-20) |
| `eligibility_verifier` | `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W` | ZK proof verification (Groth16 via Sunspot) |
| `c_spl_program` | TBD | Confidential token standard |

### Key Account Structures
- **ExchangeState** (158 bytes): Global config, blacklist merkle root, fee settings
- **TradingPair** (234 bytes): Base/quote mints, confidential vaults
- **ConfidentialOrder**: Encrypted amount/price/filled (64 bytes each via Arcium)
  - **V3 format** (334 bytes): Legacy format without hackathon plaintext fields
  - **V4 format** (390 bytes): Current format with `amount_plaintext`, `price_plaintext`, `filled_plaintext`, and `ephemeral_pubkey`
- **UserConfidentialBalance** (153 bytes): User's wrapped token balance for a specific mint
- **UserAccount** (66 bytes): Optional tracking, eligibility verification status

### Order Format Migration (V3 → V4)

**IMPORTANT:** The on-chain program expects V4 (390-byte) orders. V3 orders cause `AccountDidNotDeserialize` (0xbbb) errors.

| Field | V3 Offset | V4 Offset | Size | Notes |
|-------|-----------|-----------|------|-------|
| discriminator | 0 | 0 | 8 | Anchor discriminator |
| maker | 8 | 8 | 32 | Order creator pubkey |
| pair | 40 | 40 | 32 | Trading pair PDA |
| side | 72 | 72 | 1 | 0=Buy, 1=Sell |
| order_type | 73 | 73 | 1 | Order type enum |
| encrypted_amount | 74 | 74 | 64 | V2 ciphertext blob |
| encrypted_price | 138 | 138 | 64 | V2 ciphertext blob |
| encrypted_filled | 202 | 202 | 64 | V2 ciphertext blob |
| status | 266 | 266 | 1 | Active/Filled/Cancelled |
| created_at | 267 | 267 | 8 | Unix timestamp |
| order_id | 275 | 275 | 16 | Hash-based ID |
| order_nonce | 291 | 291 | 8 | PDA derivation nonce |
| eligibility_proof_verified | 299 | 299 | 1 | ZK proof verified flag |
| pending_match_request | 300 | 300 | 32 | MPC request tracking |
| is_matching | 332 | 332 | 1 | Currently in MPC match |
| bump | 333 | 333 | 1 | PDA bump |
| amount_plaintext | - | 334 | 8 | **V4 only**: Hackathon plaintext |
| price_plaintext | - | 342 | 8 | **V4 only**: Hackathon plaintext |
| filled_plaintext | - | 350 | 8 | **V4 only**: Hackathon plaintext |
| ephemeral_pubkey | - | 358 | 32 | **V4 only**: X25519 pubkey |

**Crank Service Compatibility:**
- `order-monitor.ts`: Fetches both V3 and V4, but only matches V4 orders
- `settlement-executor.ts`: Only settles V4 orders (V3 causes on-chain errors)

### Cross-Program Invocations
- **Sunspot verifier:** Verify Groth16 proof (324 bytes proof + 44 bytes witness)
- **Arcium adapter:** `encrypt_value`, `compare_encrypted`, `add/sub/mul_encrypted`
- **C-SPL:** `confidential_transfer`, `deposit_confidential`, `withdraw_confidential`

## Critical Constraints

### Cryptographic Requirements - Groth16 via Sunspot (MANDATORY)

**Why Groth16?** (Source: Solana Foundation, Aztec Privacy Hackathon Telegram, Jan 2026)

> "If you want to verify Noir on Solana, you won't use Barretenberg at all. You'll need to only use the Groth16 backend by Sunspot."
> — Cat | Solana Foundation

> "HONK proofs are too large to verify on Solana. Groth16 proofs are faster and cheaper to verify."
> — Cat | Solana Foundation

**Key Technical Constraints:**

| Constraint | Requirement | Reason |
|------------|-------------|--------|
| **Proof Backend** | Sunspot Groth16 ONLY | Barretenberg/HONK proofs too large for Solana |
| **Proof Size** | 388 bytes (Groth16) | HONK proofs are 10-100x larger |
| **Verifier** | gnark-solana (via Sunspot) | Only verifier compatible with Solana CU limits |
| **WASM Backend** | NOT compatible | WASM `makeProof` output does NOT match Sunspot format |
| **Compute Units** | ~200K CU for verification | Must fit within Solana transaction limits |

**DO NOT:**
- Use `backend_barretenberg` for proof generation
- Use WASM-generated proofs directly on-chain
- Assume byte-for-byte compatibility between backends
- Skip verification due to proof size issues

**Sunspot Workflow:**
```bash
sunspot compile circuits/eligibility/  # Generate Solana verifier from Noir circuit
sunspot setup                          # Generate proving/verification keys
sunspot deploy                         # Deploy verifier program to Solana
```

**Reference:** https://github.com/zk-nalloc/zk-nalloc (research on ZK constraints)

### Additional Cryptographic Requirements
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
NEXT_PUBLIC_MXE_PROGRAM_ID=DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM

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

### Perpetual Market Addresses (Devnet)

| Account | Address | Purpose |
|---------|---------|---------|
| **Perp Market PDA** | `FFU5bwpju8Hrb2bgrrWPK4LgGG1rD1ReK9ieVHavcW6n` | SOL-PERP market state (seeds: `["perp_market", SOL_MINT]`) |
| **Funding State PDA** | `7eiG5J7ntca6k6ChFDygxE835zJaAVfTcp9ewCNPgT7o` | Funding rate state (seeds: `["funding", perp_market]`) |
| **Vault Authority PDA** | `Bj4ZZtvbg7CJzbCJMomYzW5MLkxiRGcZbmPSrjyR3sVE` | Signs vault transfers (seeds: `["vault", perp_market]`) |
| **Collateral Vault** | `DF8HbGMS6gLjQRjWgpaUV4G4C1CcJczseWJFtd1Jx32q` | USDC token account (owned by vault authority) |
| **Fee Recipient** | `2HmZ5C68M3m9WBdzDGHw4oUiUEJ7f9pxJddi2GUL2jGt` | Receives trading fees |
| **Insurance Fund** | `F9f1r3kRHF265Xme5qkjskzvByVYZ1jt1iWVVySTZbK6` | Socialized losses / ADL fund |
| **Liquidation Config PDA** | `6sUqk2qFq5yc4dZ13BUQfcr76xTXF5y8FNjZr5qncobe` | Liquidation parameters |
| **Pyth Oracle** | `J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix` | SOL/USD price feed |

**Market Parameters (SOL-PERP):**
- Max Leverage: 10x
- Maintenance Margin: 5% (500 bps)
- Initial Margin: 10% (1000 bps)
- Taker Fee: 0.5% (50 bps)
- Maker Fee: 0.2% (20 bps)
- Liquidation Fee: 1% (100 bps)
- Min Position Size: 0.01 SOL
- Funding Interval: 1 hour

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

**Devnet cluster offsets:** 456, 789 (v0.5.1) — Note: Cluster 123 does NOT exist despite documentation

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
| `programs/confidex_dex/src/instructions/perp_open_position.rs` | Perp position opening with encrypted thresholds |
| `programs/confidex_dex/src/instructions/perp_close_position.rs` | Perp close with MPC PnL/funding calculation |
| `programs/confidex_dex/src/instructions/perp_liquidate.rs` | Liquidation with MPC batch verification |
| `programs/confidex_dex/src/instructions/check_liquidation_batch.rs` | **NEW:** Batch liquidation check via MPC |
| `programs/confidex_dex/src/state/position.rs` | Position struct with encrypted thresholds, hash-based IDs |
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
| `VerifyPositionParams` | encrypted entry + leverage/mm_bps | bool (valid) | Open position - verify encrypted threshold |
| `BatchLiquidationCheck` | up to 10 encrypted thresholds + mark price | bool[10] | **NEW:** Batch liquidation eligibility |
| `CheckLiquidation` | encrypted collateral/size/entry + mark price | bool (liquidate) | Single position liquidation check |
| `CalculatePnL` | encrypted size/entry + exit price | u64 + is_loss bool | Close position / liquidation PnL |
| `CalculateFunding` | encrypted size + funding rate/delta | u64 + is_paying bool | Position funding settlement |

**Configuration:**
```rust
// programs/confidex_dex/src/cpi/arcium.rs
pub const USE_REAL_MPC: bool = true;  // Toggle simulation vs real MPC
pub const DEFAULT_CLUSTER_OFFSET: u16 = 456;  // Devnet cluster (456 or 789 - NOT 123)
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

### MPC Integration Test Suite

A comprehensive test suite verifies the Arcium MPC integration is working correctly.

**Location:** `frontend/test-mpc-integration.ts`

**Run Tests:**
```bash
cd frontend && npx tsx test-mpc-integration.ts
```

**Tests Covered:**

| Category | Test | What It Verifies |
|----------|------|------------------|
| **MXE Account** | Account exists | MXE PDA is initialized (319 bytes) |
| | Keygen complete | X25519 key at offset 95-127 is non-zero |
| | Key matches | Key matches `NEXT_PUBLIC_MXE_X25519_PUBKEY` |
| **Encryption** | Parse MXE key | Hex → Uint8Array conversion |
| | Ephemeral keypair | X25519 keypair generation |
| | Shared secret | ECDH key agreement |
| | RescueCipher | Cipher instantiation |
| | Encrypt value | BigInt → ciphertext |
| | V2 blob format | 64-byte `[nonce\|ciphertext\|ephemeral]` |
| **DEX Program** | Deployed | Program is executable on devnet |
| **Circuits** | compare_prices | HTTP 200 from GitHub Releases |
| | calculate_fill | HTTP 200 from GitHub Releases |
| | verify_position_params | HTTP 200 from GitHub Releases |
| **Cluster** | Account exists | Cluster 456 PDA via SDK |
| | Arcium program | Core program is deployed |

**Expected Output (All Pass):**
```
============================================================
   Confidex MPC Integration Test Suite
============================================================
✅ MXE account exists (Size: 319 bytes)
✅ Keygen complete (X25519 key: 14706bf82ff9e9ce...)
✅ Key matches expected (Keys match!)
✅ All encryption tests pass (64-byte V2 format)
✅ DEX program deployed
✅ All circuits accessible (HTTP 200)
✅ Cluster 456 account exists (483 bytes)
✅ Arcium program deployed

  Passed: 18
  Failed: 0
  Total:  18

✅ All tests passed! MPC integration is ready.
```

**Key Technical Details:**
- X25519 key location in MXE account: bytes 95-127
- V2 encryption format: `[nonce (16) | ciphertext (32) | ephemeral_pubkey (16)]`
- RescueCipher.encrypt() takes array of BigInts: `cipher.encrypt([value], nonce)`
- Cluster account derived via SDK: `getClusterAccAddress(456)`

### Docs

**Local Documentation (project-docs/arcium/):**

When working with Arcium, reference these local docs first - they are indexed from the official Arcium developer documentation:

| Document | Path | Description |
|----------|------|-------------|
| **Introduction** | `project-docs/arcium/intro-to-arcium.md` | What Arcium enables, how it works |
| **Installation** | `project-docs/arcium/installation.md` | Quick install and manual setup |
| **Arcup** | `project-docs/arcium/arcup.md` | Version manager documentation |
| **Hello World** | `project-docs/arcium/hello-world.md` | Step-by-step tutorial |
| **Computation Lifecycle** | `project-docs/arcium/computation-lifecycle.md` | Full lifecycle with mermaid diagram |
| **Deployment** | `project-docs/arcium/deployment.md` | Deploying MXE to devnet |
| **Callback Server** | `project-docs/arcium/callback-server.md` | Handling large computation outputs |
| **Current Limitations** | `project-docs/arcium/current-limitations.md` | Known constraints |
| **Setup Testnet Node** | `project-docs/arcium/setup-testnet-node.md` | Running an Arx node |

**Arcis Framework (MPC Circuits):**

| Document | Path | Description |
|----------|------|-------------|
| **Overview** | `project-docs/arcium/arcis/arcis-overview.md` | Framework introduction |
| **Mental Model** | `project-docs/arcium/arcis/mental-model.md` | Thinking in MPC |
| **Types** | `project-docs/arcium/arcis/types.md` | Supported types reference |
| **Input/Output** | `project-docs/arcium/arcis/input-output.md` | Working with Enc types |
| **Operations** | `project-docs/arcium/arcis/operations.md` | Complete operations reference |
| **Primitives** | `project-docs/arcium/arcis/primitives.md` | RNG, crypto, data packing |
| **Best Practices** | `project-docs/arcium/arcis/best-practices.md` | Performance and debugging |
| **Quick Reference** | `project-docs/arcium/arcis/quick-reference.md` | Syntax cheatsheet |

**Solana Program Integration:**

| Document | Path | Description |
|----------|------|-------------|
| **Program Overview** | `project-docs/arcium/program/program-overview.md` | Invoking encrypted instructions |
| **Computation Definitions** | `project-docs/arcium/program/computation-def-accs.md` | Computation definition accounts |
| **Callback Accounts** | `project-docs/arcium/program/callback-accs.md` | Additional callback accounts |
| **Callback Type Generation** | `project-docs/arcium/program/callback-type-generation.md` | Auto-generated output types |

**TypeScript Client:**

| Document | Path | Description |
|----------|------|-------------|
| **Client Overview** | `project-docs/arcium/js-client-library/js-client-overview.md` | SDK overview |
| **Encryption** | `project-docs/arcium/js-client-library/encryption.md` | Encryption overview |
| **Encrypting Inputs** | `project-docs/arcium/js-client-library/encrypting-inputs.md` | Input encryption guide |
| **Sealing** | `project-docs/arcium/js-client-library/sealing.md` | Re-encryption documentation |
| **Tracking Callbacks** | `project-docs/arcium/js-client-library/tracking-callbacks.md` | Await computation finalization |

**External Links:**
- **Main:** https://docs.arcium.com/developers
- **TS SDK API:** https://ts.arcium.com/api
- **Hello World:** https://docs.arcium.com/developers/hello-world
- **Architecture:** https://docs.arcium.com/getting-started/architecture-overview
- **MPC Protocols:** https://docs.arcium.com/multi-party-execution-environments-mxes/mpc-protocols
- **Migration Guide (v0.5.x → v0.6.3):** https://docs.arcium.com/llms.txt

### Arcium v0.6.3 Migration Guide

**Current Version:** v0.6.3 (as of January 2026)

This section documents the migration from Arcium v0.5.x to v0.6.3. The v0.6.3 release requires a **program redeploy** due to a change in the Arcium program ID.

#### Breaking Changes Summary

| Change | Before v0.6 | v0.6.3 |
|--------|-------------|--------|
| Program ID | `BpaW2ZmCJnDwizWY8eM34JtVqp2kRgnmQcedSVc9USdP` | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` |
| Signer Account Type | `SignerAccount` | `ArciumSignerAccount` |
| Signer PDA Seed | `"SignerAccount"` | `"ArciumSignerAccount"` |
| Rust Dependencies | `0.5.x` | `0.6.3` |
| TypeScript Client | `@arcium-hq/client@0.5.x` | `@arcium-hq/client@0.6.3` |
| Arcis Crate | `arcis-imports` | `arcis` |
| blake3 (encrypted-ixs) | Not required | `blake3 = "=1.8.2"` |
| clock_account | No `mut` | Requires `mut` |

#### 1. Update TypeScript Dependencies

```bash
cd frontend
pnpm add @arcium-hq/client@0.6.3 @arcium-hq/reader@0.6.3
```

#### 2. Update Rust Dependencies (if using Arcium crates)

```bash
# In programs/your-program-name
cargo update --package arcium-client --precise 0.6.3
cargo update --package arcium-macros --precise 0.6.3
cargo update --package arcium-anchor --precise 0.6.3

# In encrypted-ixs (if present)
cargo update --package arcis --precise 0.6.3
```

**Note:** `arcis-imports` no longer exists in v0.6.3. Migrate to the `arcis` crate:

```toml
# Before v0.6 (Cargo.toml)
[dependencies]
arcis-imports = "0.5.1"

# v0.6.3 (Cargo.toml)
[dependencies]
arcis = "0.6.3"
blake3 = "=1.8.2"  # Must pin to 1.8.2 (newer uses Rust 2024 edition)
```

```rust
// Before v0.6
use arcis_imports::*;

// v0.6.3
use arcis::*;
```

#### 3. Rename SignerAccount to ArciumSignerAccount (if applicable)

If your program uses Arcium's signer account pattern:

```rust
// Before v0.6
#[account(
    init_if_needed,
    payer = payer,
    space = 8 + 1,
    seeds = [b"SignerAccount"],
    bump,
    address = derive_sign_pda!(),
)]
pub sign_pda_account: Account<'info, SignerAccount>,

// v0.6.3
#[account(
    init_if_needed,
    payer = payer,
    space = 8 + 1,
    seeds = [b"ArciumSignerAccount"],
    bump,
    address = derive_sign_pda!(),
)]
pub sign_pda_account: Account<'info, ArciumSignerAccount>,
```

TypeScript PDA derivation:
```typescript
// Before v0.6
const signPda = PublicKey.findProgramAddressSync(
  [Buffer.from("SignerAccount")],
  program.programId
)[0];

// v0.6.3
const signPda = PublicKey.findProgramAddressSync(
  [Buffer.from("ArciumSignerAccount")],
  program.programId
)[0];
```

#### 4. Add `mut` to clock_account

```rust
// Before v0.6
#[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
pub clock_account: Account<'info, ClockAccount>,

// v0.6.3
#[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
pub clock_account: Account<'info, ClockAccount>,
```

#### 5. Configure Arcium.toml for Testing

v0.6.3 adds the `--cluster` flag for remote testing:

```toml
# Arcium.toml
[localnet]
nodes = 2
localnet_timeout_secs = 60
backends = ["Cerberus"]

# Cluster config for devnet testing (cluster 456 = v0.6.3)
[clusters.devnet]
offset = 456
```

Run tests:
```bash
arcium test              # Localnet (Docker required)
arcium test --cluster devnet  # Remote devnet cluster
```

#### 6. Redeploy MXE

After completing code updates:
```bash
arcium build
arcium test
arcium deploy --cluster-offset 456 --recovery-set-size 4 --keypair-path <path> --rpc-url <url>
```

#### Confidex Migration Status

| Component | Status | Notes |
|-----------|--------|-------|
| Program ID | ✅ Already v0.6.3 | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` |
| Frontend SDK | ✅ Updated | `@arcium-hq/client@0.6.3` |
| Rust CPI code | ✅ Compatible | Uses custom CPI, no arcis crate |
| SignerAccount | N/A | Not using this pattern |
| clock_account | N/A | Not using this pattern |

**Note:** Confidex uses custom Arcium CPI infrastructure in `programs/confidex_dex/src/cpi/arcium.rs` rather than the `arcium-anchor` crate, so most Rust-side migration steps don't apply.

### Arcium Deployment (Official Documentation)

**Reference:** https://docs.arcium.com/developers/deployment

#### Devnet Cluster Configuration

| Cluster Offset | Version | Status | Notes |
|----------------|---------|--------|-------|
| **123** | v0.5.4 | ✅ Available | Older version |
| **456** | v0.6.3 | ✅ **Recommended** | Latest stable |

**Recovery Set Size:** `4` (required parameter for devnet)

#### Prerequisites

Before deploying:
- MXE built successfully with `arcium build`
- Tests passing locally with `arcium test`
- Solana keypair with **2-5 SOL** for deployment costs
- **Reliable RPC endpoint** (Helius or QuickNode recommended - default Solana RPC drops transactions)

#### Deployment Command

**⚠️ IMPORTANT:** Use `arcium deploy`, NOT manual `initMxe` calls.

```bash
# Full deployment with required parameters
arcium deploy \
  --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path ~/.config/solana/devnet.json \
  --rpc-url https://devnet.helius-rpc.com/?api-key=<your-api-key>
```

**Required Parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| `--cluster-offset` | `456` | Arcium cluster to connect to (456 recommended for v0.6.3) |
| `--recovery-set-size` | `4` | Number of nodes for threshold crypto recovery |
| `--keypair-path` | Path to keypair | Solana keypair with SOL for fees |
| `--rpc-url` | Helius/QuickNode URL | **Use reliable RPC, not default devnet** |

**Optional Parameters:**
| Parameter | Default | Options |
|-----------|---------|---------|
| `--mempool-size` | `Tiny` | `Tiny`, `Small`, `Medium`, `Large` |
| `--program-keypair` | Auto-generated | Custom program address |
| `--skip-deploy` | false | Only initialize MXE account |
| `--skip-init` | false | Only deploy program |

#### Post-Deployment: Initialize Computation Definitions

After deployment, initialize computation definitions using the same cluster offset:

```typescript
// Use the cluster offset from deployment (456)
const clusterOffset = 456;

// Derive accounts
const computationAccount = getComputationAccAddress(clusterOffset, computationOffset);
const clusterAccount = getClusterAccAddress(clusterOffset);
const mxeAccount = getMXEAccAddress(program.programId);
const mempoolAccount = getMempoolAccAddress(clusterOffset);
const executingPool = getExecutingPoolAccAddress(clusterOffset);
```

#### Verify Deployment

```bash
# Check program deployed successfully
solana program show <your-program-id> --url <your-rpc-url>

# Check MXE account info
arcium mxe-info <your-program-id> --rpc-url <your-rpc-url>
```

#### Common Issues

| Issue | Solution |
|-------|----------|
| Transaction dropped | Use reliable RPC (Helius/QuickNode), not default devnet |
| Out of SOL | `solana airdrop 2 <pubkey> -u devnet` |
| Partial deployment failed | Use `--skip-deploy` or `--skip-init` to complete missing step |
| InvalidRecoveryPeersCount | Use `--recovery-set-size 4` (required for devnet) |

#### Key Insights from Arcium Team

> "Recovery set on devnet cluster 456 is set to size 4 - it's mentioned in the deployment docs"
> — Arihant Bansal | Arcium Team (Jan 20, 2026)

> "Why are you calling initMxe yourself? Please use `arcium deploy` to do so - you should ideally never call it yourself."
> — Arihant Bansal | Arcium Team (Jan 20, 2026)

**On keygen timing and troubleshooting (Jan 20, 2026):**

| Question | Answer |
|----------|--------|
| How long should MXE keygen take? | "A couple mins at max" |
| Need priority fee for testing? | "Not needed for testing rn" |
| Anything beyond `requeue-mxe-keygen`? | "No" |
| Are cluster 456 nodes processing? | "They are processing computations" |

> "I'll check your program ID in the node logs to see what's going on"
> — Arihant Bansal | Arcium Team (Jan 20, 2026)

**Useful Commands for Debugging:**
```bash
# Check MXE account info
arcium mxe-info <MXE_PROGRAM_ID> -u <RPC_URL>

# Check execpool (pending computations)
arcium execpool 456 -u <RPC_URL>

# Check mempool
arcium mempool 456 -u <RPC_URL>

# Requeue keygen if stuck
arcium requeue-mxe-keygen <MXE_PROGRAM_ID> \
  --cluster-offset 456 \
  --keypair-path ~/.config/solana/devnet.json \
  --rpc-url <RPC_URL>
```

#### MXE Deployment Complete (2026-01-20)

**✅ MXE keygen has completed successfully.** The frontend now uses production Arcium encryption.

**Current Configuration:**
```env
# frontend/.env.local
NEXT_PUBLIC_MXE_PROGRAM_ID=DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM
NEXT_PUBLIC_MXE_X25519_PUBKEY=14706bf82ff9e9cebde9d7ad1cc35dc98ad11b08ac92b07ed0fe472333703960
NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456
```

**Key Priority Chain** in `use-encryption.ts`:
```
Priority 1: NEXT_PUBLIC_MXE_X25519_PUBKEY environment variable ← ACTIVE
Priority 2: getMXEPublicKey() from Arcium SDK (fallback)
Priority 3: Deterministic demo key (emergency fallback only)
```

**Expected Log (Production Mode):**
```
[INFO] [encryption] Using production Arcium encryption (key source: env)
```

**Circuit Storage:** All 10 MPC circuits are stored on GitHub Releases and fetched by Arx nodes:
- URL: https://github.com/Jerome2332/confidex/releases/tag/v0.1.0-circuits
- Total size: ~15MB (10 circuits)
- Hash verification: `circuit_hash!` macro ensures integrity

#### MXE Deployment (Use CLI, Not Manual Scripts)

**⚠️ DEPRECATED:** The manual initialization script at `frontend/scripts/init-arcium-mxe.ts` should NOT be used. Per Arcium team guidance, use `arcium deploy` instead.

**Correct Approach:**
```bash
# Deploy MXE using official CLI (handles initMxePart1, initMxePart2, keygen automatically)
arcium deploy --cluster-offset 456 --keypair-path ./keys/deployer.json --rpc-url https://api.devnet.solana.com
```

**Why the manual script failed:**
- ❌ Part 2 failed with `InvalidRecoveryPeersCount` error
- Root cause: Recovery set size is 4 on cluster 456, script wasn't configured correctly
- Solution: Use `arcium deploy` which handles this automatically

**Historical Reference (do not use):**
- Part 1 TX: `5tab5mT81kQ3ZHuq6fEHcdkozvMj8iWM9a5ra2q9H7LgrUHZmwocNGiA3PPEe2UtZmKMe9AkDva1AVTPNFCfTruK`

#### When Real MXE Keys Are Available

Once MXE is deployed via `arcium deploy`:

1. Run `arcium deploy --cluster-offset 456 ...` (see above)
2. Get the MXE public key from deployment output or on-chain state
3. Set `NEXT_PUBLIC_MXE_X25519_PUBKEY` in frontend/.env.local
4. Restart frontend - demo mode warning will disappear

#### Privacy Implications

| Mode | Privacy Level | MPC Decryption | Production Ready |
|------|---------------|----------------|------------------|
| **Demo Mode** | Visual only | ❌ No | ❌ No |
| **Real MXE Key** | Full encryption | ✅ Yes | ✅ Yes |

**Demo mode provides:**
- Correct encryption format (V2 pure ciphertext)
- Working UI/UX for testing
- Encrypted blobs on-chain (but wrong key material)

**Demo mode lacks:**
- MPC cluster cannot decrypt values
- Order matching would fail in production
- Not suitable for mainnet deployment

#### Production MXE Deployment Guide

**Step 1: Deploy MXE using `arcium deploy` CLI**
```bash
# Install Arcium CLI if not already installed
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
arcup install

# Deploy MXE to devnet cluster 456
arcium deploy \
  --cluster-offset 456 \
  --keypair-path ~/.config/solana/devnet.json \
  --rpc-url https://api.devnet.solana.com

# The deploy command handles:
# 1. initMxePart1 - Creates mxeAccount PDA
# 2. initMxePart2 - Associates with cluster, configures recovery set (size 4)
# 3. Triggers keygen - MPC nodes generate x25519 keypair
```

**Step 2: Retrieve the MXE x25519 Public Key**
```bash
# After keygen completes (may take a few minutes), check status:
CLUSTER_OFFSET=456 npx tsx frontend/scripts/init-arcium-mxe.ts

# The script will output the x25519 key if keygen is complete
# Example output: NEXT_PUBLIC_MXE_X25519_PUBKEY=a1b2c3d4...
```

**Step 3: Configure Frontend for Production**
```bash
# Add to frontend/.env.local:
NEXT_PUBLIC_MXE_X25519_PUBKEY=<64-hex-chars-from-step-2>
NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456
NEXT_PUBLIC_ARCIUM_ENABLED=true
```

**Step 4: Verify Production Mode**
```bash
# Start frontend and check console for:
# "[INFO] [encryption] Using production Arcium encryption (key source: env)"
#
# If you see:
# "[WARN] [encryption] MXE key fetch failed - using demo mode."
# Then keygen is not complete or env var is not set correctly.
```

**Verification Checklist:**
- [ ] `arcium deploy` completed successfully
- [ ] Keygen finished (x25519 key is non-zero)
- [ ] `NEXT_PUBLIC_MXE_X25519_PUBKEY` set in .env.local
- [ ] Frontend shows "production Arcium encryption" in logs
- [ ] Test order placement creates 64-byte encrypted blobs on-chain

#### Resolution Complete (January 20, 2026)

**✅ RESOLVED:** Fresh MXE deployed with cluster 456 and keygen completed successfully.

**Deployment Summary:**
| Item | Value |
|------|-------|
| MXE Program ID | `DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM` |
| X25519 Public Key | `14706bf82ff9e9cebde9d7ad1cc35dc98ad11b08ac92b07ed0fe472333703960` |
| Cluster | 456 (Arcium v0.6.3) |
| Recovery Set | 4 nodes |
| Circuits | 10 (stored on GitHub Releases) |
| DEX Program Updated | ✅ Slot 436479951 |

**Arcium MXE Project Structure:**

The production MXE is at `arcium-mxe/` with:
- `Arcium.toml` - Cluster 456 configuration
- `encrypted-ixs/` - Arcis circuits for DEX operations (10 circuits)
- `programs/confidex_mxe/` - Anchor program wrapper with `CircuitSource::OffChain`
- `build/` - Compiled `.arcis` circuit files
- `OFFCHAIN_CIRCUITS.md` - Implementation documentation

**Valid Devnet Clusters:**
| Offset | Version | Status |
|--------|---------|--------|
| 123 | N/A | ❌ Does NOT exist |
| 456 | v0.6.3 | ✅ **IN USE** |
| 789 | v0.5.1 | ✅ Available (backup) |

---

## Production Roadmap

### Current State (January 2026)

Confidex implements a **full privacy model** for perpetuals with V2 pure ciphertext encryption. The key privacy enhancements:

#### What's Implemented

| Component | Status | Privacy Level |
|-----------|--------|---------------|
| **ZK Eligibility Proofs** | ✅ Live | Full privacy - blacklist membership proven without revealing address |
| **RescueCipher Encryption** | ✅ Live | Order values encrypted with X25519 + Arcium cipher |
| **MPC Price Comparison** | ✅ Live | Encrypted price matching via Arcium Cerberus protocol |
| **Encrypted Liquidation Thresholds** | ✅ Live | Prevents entry price reverse-engineering |
| **Hash-Based Position IDs** | ✅ Live | Prevents activity correlation via sequential IDs |
| **Coarse Timestamps** | ✅ Live | Hour precision reduces temporal correlation |
| **MPC Batch Liquidation Checks** | ✅ Live | Efficient batch verification (up to 10 positions) |
| **Automated Crank Service** | ✅ Live | Backend service auto-matches orders on devnet |
| **Async MPC Flow** | ✅ Live | Production callback-based MPC execution |
| **SPL Token Collateral Transfer** | ✅ Live | Real USDC moved to vault (C-SPL fallback) |
| **Real Order Book from Chain** | ✅ Live | Fetches V4 orders, shows "Live" status indicator |
| **Real-Time Trades from Events** | ✅ Live | Subscribes to settlement logs for live trade feed |
| **MPC Event Callbacks** | ✅ Live | Frontend receives MPC results via log subscription |
| **Settlement Persistence (SQLite)** | ✅ Live | Crank survives restarts, no double-settlement |
| **Production MPC Mode Default** | ✅ Live | `CRANK_USE_REAL_MPC=true` by default |

#### Recent Deployment (January 20, 2026)

**Deploy TX:** `5R4vHzBEsVkJBQZLMEBp9aRamZjEpvsbtwyEVGZhF2JvdcRGXWFWMqCdLPJkqxZuckBJr1Voa3Mcnh1WaBXC547p`

**Changes:**
- Added SPL token transfer for collateral in `open_position` instruction
- Collateral now actually moves from trader → vault (was TODO before)
- Temporary fallback until C-SPL SDK available (collateral amount visible on-chain)

**Privacy Analysis (Previous Position TX: `3Hvw9xQmBGseHdoj2bW5wAPPNuLVXQU2Z6V6xPazg75UFJpK3NLmNfYMEfJYdkeLcDrZY4knpPgwBBExUWvWiGkW`):**

| Data Point | Visible On-Chain | Privacy Status |
|------------|------------------|----------------|
| Position size | `[u8; 64]` encrypted blob | ✅ Private |
| Entry price | `[u8; 64]` encrypted blob | ✅ Private |
| Collateral | `[u8; 64]` encrypted blob | ✅ Private |
| Liquidation threshold | `[u8; 64]` encrypted blob | ✅ Private |
| Trader address | `3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm` | ⚠️ Public (inherent) |
| Position side | `Long` | ⚠️ Public (required) |
| Leverage | `10x` | ⚠️ Public (required) |
| Collateral amount (fallback) | u64 in instruction data | ⚠️ Public (C-SPL fallback) |
| Oracle price | `139.817414` | ⚠️ Public (logged) |

**What's Hidden:**
- Order amounts and prices (64-byte encrypted blobs)
- Liquidation thresholds (prevents entry price reverse-engineering)
- Position ID now hash-based (was sequential `#2` in old TX)

**What's Still Visible (by design):**
- Trader pubkey (inherent to Solana)
- Side/leverage (needed for funding/risk calculations)
- Collateral amount (temporary - visible until C-SPL)
- Oracle price (public market data)

#### V2 Encryption Format (Pure Ciphertext)

```
[nonce (16 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
```

**No plaintext prefix.** All values are fully encrypted. MPC handles all comparisons and calculations.

| Bytes | Content | Purpose |
|-------|---------|---------|
| 0-15 | Nonce | MPC decryption seed |
| 16-47 | Ciphertext | MPC encrypted value |
| 48-63 | Ephemeral pubkey | MPC key routing |

#### Privacy Guarantees (Perpetuals)

| Data | Visibility | Rationale |
|------|------------|-----------|
| Position size | **Encrypted (private)** | V2 pure ciphertext |
| Entry price | **Encrypted (private)** | V2 pure ciphertext |
| Collateral (encrypted) | **Encrypted (private)** | V2 pure ciphertext |
| Collateral amount (transfer) | **Public (fallback)** | SPL transfer until C-SPL ready |
| **Liquidation threshold** | **Encrypted (private)** | **NEW: MPC batch verification** |
| Position side (long/short) | Public | Required for funding direction |
| Leverage | Public | Required for risk management |
| Position ID | Hash-based | **NEW: No sequential correlation** |
| Timestamps | Hour precision | **NEW: Reduces temporal correlation** |
| User eligibility | ZK (private) | Blacklist status never revealed |

**Key privacy improvement:** Liquidation thresholds are now encrypted. Previously, public thresholds ($133) allowed reverse-engineering entry price (~$140) via `entry ≈ threshold / 0.95`.

#### MPC Batch Liquidation Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Liquidation    │     │   DEX Program   │     │  Arcium MPC     │
│     Bot         │     │                 │     │                 │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ 1. Fetch open   │────▶│ 2. Create batch │────▶│ 3. For each:    │
│    positions    │     │    check request│     │    decrypt(liq) │
│                 │     │    (up to 10)   │     │    compare(mark)│
│                 │     │                 │     │                 │
│ 5. Execute      │◀────│ 4. Callback     │◀────│    Return       │
│    liquidation  │     │    with results │     │    bool[]       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Efficiency:** 10 positions per MPC call (~500ms total) instead of 10 separate calls (~5s total).

#### Position Account Structure (V2)

```rust
pub struct ConfidentialPosition {
    // Identity (96 bytes)
    pub trader: Pubkey,                     // 32 bytes
    pub market: Pubkey,                     // 32 bytes
    pub position_id: [u8; 16],              // Hash-based (no sequential leak)
    pub created_at_hour: i64,               // Hour precision
    pub last_updated_hour: i64,             // Hour precision

    // Public parameters
    pub side: PositionSide,                 // Long/Short (needed for funding)
    pub leverage: u8,                       // 1-20x

    // Encrypted core data (256 bytes)
    pub encrypted_size: [u8; 64],           // Pure ciphertext
    pub encrypted_entry_price: [u8; 64],    // Pure ciphertext
    pub encrypted_collateral: [u8; 64],     // Pure ciphertext
    pub encrypted_realized_pnl: [u8; 64],   // Pure ciphertext

    // Encrypted liquidation thresholds (128 bytes)
    pub encrypted_liq_below: [u8; 64],      // For longs - MPC verified
    pub encrypted_liq_above: [u8; 64],      // For shorts - MPC verified
    pub threshold_commitment: [u8; 32],     // hash(entry, leverage, mm_bps, side)

    // ... status fields
}
// Total SIZE: 561 bytes
```

### Phase 2: Encrypted Open Interest (Future)

Open interest is still public. Encrypting OI would prevent funding rate prediction:

| Current | Future |
|---------|--------|
| `total_long_open_interest: u64` | `encrypted_long_oi: [u8; 64]` |
| `total_short_open_interest: u64` | `encrypted_short_oi: [u8; 64]` |

**Requires:** MPC funding rate calculation from encrypted OI.

### Phase 3: Production Hardening

1. **Real ZK Verification**
   - Enable Sunspot Groth16 verification on-chain
   - Remove `ZK verification DISABLED` bypass
   - Deploy production verifier program

2. **MPC Cluster Selection**
   - Use devnet clusters 456 or 789 (NOTE: 123 does NOT exist)
   - Configure failover between clusters
   - Monitor MPC latency and success rates

3. **Settlement Layer**
   - Primary: C-SPL confidential transfers
   - Fallback: ShadowWire for anonymous withdrawals
   - Inco Lightning as alternative TEE option

### Architecture (Current V2)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CURRENT (V2 - Full Perpetuals Privacy)               │
├─────────────────────────────────────────────────────────────────────────┤
│  User                    On-Chain                    MPC                │
│  ────                    ────────                    ───                │
│  ZK proof ───────────────► Verify eligibility                           │
│  Encrypted values ───────► Store encrypted ─────────► Threshold verify  │
│  Position nonce ─────────► Hash-based ID                                │
│                          Coarse timestamps                              │
│                                                                         │
│  Liquidation flow:       Batch request ────────────► Compare encrypted  │
│                          (up to 10)                   liq thresholds    │
│                          ◄─────────────────────────── bool[] results    │
│                          Execute if result[i]=true                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Monitoring & Operations

The automated crank service provides production-grade order matching with SQLite persistence:

```bash
# Enable crank service
CRANK_ENABLED=true pnpm dev

# Check crank status
curl http://localhost:3001/admin/crank/status

# Configuration
CRANK_POLLING_INTERVAL_MS=5000    # Check for matches every 5s
CRANK_USE_REAL_MPC=true           # Production MPC (default is TRUE)
CRANK_USE_ASYNC_MPC=true          # Use production async MPC flow
CRANK_MAX_CONCURRENT_MATCHES=5    # Parallel match attempts
CRANK_DB_PATH=./data/settlements.db  # SQLite persistence
```

**Production Features (January 2026):**

| Feature | Description | File |
|---------|-------------|------|
| **SQLite Persistence** | Settled orders survive crank restarts | `backend/src/crank/settlement-executor.ts` |
| **Real Order Book** | Fetches V4 orders from chain, aggregates by price | `frontend/src/hooks/use-order-book.ts` |
| **Live Trades Feed** | Subscribes to settlement logs | `frontend/src/hooks/use-recent-trades.ts` |
| **MPC Event Callbacks** | Frontend receives MPC results in real-time | `frontend/src/hooks/use-mpc-events.ts` |
| **No MPC Demo Fallback** | Production mode enforced, errors propagate | `backend/src/crank/mpc-poller.ts` |

**Key Hooks:**

| Hook | Purpose |
|------|---------|
| `useOrderBook(pairPubkey?)` | Real-time order book from chain (V4 orders) |
| `useRecentTrades(limit?)` | Live trade feed from settlement events |
| `useMpcEvents()` | MPC computation tracking and callbacks |

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

## Encryption Provider Feature Flags (Runtime Switching)

Confidex supports runtime switching between encryption providers (Arcium MPC and Inco TEE) without code changes or redeployment. This enables instant failover and user preference.

### Priority Cascade

The encryption provider is selected based on a 4-level priority cascade:

```
┌─────────────────────────────────────────────┐
│  1. ENV_FORCE_PROVIDER                      │  ← Admin emergency override
│     (NEXT_PUBLIC_FORCE_ENCRYPTION_PROVIDER) │
├─────────────────────────────────────────────┤
│  2. User Settings (localStorage)            │  ← Runtime user choice
│     (preferredEncryptionProvider)           │
├─────────────────────────────────────────────┤
│  3. Environment Defaults                    │  ← Build-time config
│     (NEXT_PUBLIC_ARCIUM_ENABLED, etc.)      │
├─────────────────────────────────────────────┤
│  4. Hardcoded Defaults                      │  ← Code fallback
│     (auto mode: Arcium > Inco > demo)       │
└─────────────────────────────────────────────┘
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_FORCE_ENCRYPTION_PROVIDER` | - | Force provider (`arcium`, `inco`, `demo`) - overrides all settings |
| `NEXT_PUBLIC_PREFERRED_ENCRYPTION_PROVIDER` | `auto` | Default preference if user hasn't set one |
| `NEXT_PUBLIC_ARCIUM_ENABLED` | `true` | Enable/disable Arcium MPC |
| `NEXT_PUBLIC_INCO_ENABLED` | `false` | Enable/disable Inco TEE |
| `NEXT_PUBLIC_AUTO_FALLBACK_ENABLED` | `true` | Auto-switch if preferred unavailable |

### User Settings Store

Settings are persisted in localStorage via Zustand with v3 migration:

```typescript
interface SettingsState {
  // Encryption provider settings
  preferredEncryptionProvider: 'auto' | 'arcium' | 'inco';
  arciumEnabled: boolean;
  incoEnabled: boolean;
  autoFallbackEnabled: boolean;
}
```

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/stores/settings-store.ts` | Zustand store with provider preferences |
| `frontend/src/lib/constants.ts` | Environment variable constants |
| `frontend/src/hooks/use-unified-encryption.ts` | Provider selection logic |
| `frontend/src/hooks/use-encryption-status.ts` | UI-friendly status hook |
| `frontend/src/components/settings/encryption-settings.tsx` | Settings panel UI |

### Usage Examples

**Admin Override (Emergency):**
```bash
# Force Arcium regardless of user settings
NEXT_PUBLIC_FORCE_ENCRYPTION_PROVIDER=arcium

# Force Inco
NEXT_PUBLIC_FORCE_ENCRYPTION_PROVIDER=inco

# Disable all switching (lock to auto)
NEXT_PUBLIC_ARCIUM_ENABLED=true
NEXT_PUBLIC_INCO_ENABLED=false
```

**User Runtime Switching:**
```typescript
import { useSettingsStore } from '@/stores/settings-store';

function EncryptionSettings() {
  const {
    preferredEncryptionProvider,
    setPreferredEncryptionProvider,
  } = useSettingsStore();

  // Switch to Inco
  setPreferredEncryptionProvider('inco');
}
```

**Check Current Status:**
```typescript
import { useEncryptionStatus } from '@/hooks/use-encryption-status';

function StatusBadge() {
  const { provider, isProductionReady, canSwitch } = useEncryptionStatus();

  return (
    <span>{provider} {isProductionReady ? '✓' : '⚠️'}</span>
  );
}
```

### What's NOT Stored in localStorage

- Private keys
- MXE public keys
- Encrypted values
- Session tokens

Only preference flags are stored locally.

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

### Utility Scripts

Scripts for devnet testing and setup in `frontend/scripts/`:

| Script | Purpose | Command |
|--------|---------|---------|
| `wrap-usdc-for-buyer.ts` | Wrap USDC into confidential balance for buyer | `pnpm tsx scripts/wrap-usdc-for-buyer.ts` |
| `wrap-sol-for-seller.ts` | Wrap SOL into confidential balance for seller | `pnpm tsx scripts/wrap-sol-for-seller.ts` |
| `init-mxe-config.ts` | Initialize MXE configuration | `pnpm tsx scripts/init-mxe-config.ts` |
| `place-sell-order.ts` | Place a test sell order | `pnpm tsx place-sell-order.ts` |

**Wrap Scripts:**

The wrap scripts deposit regular SPL tokens into the DEX's confidential vaults and credit the user's `UserConfidentialBalance` account.

```bash
# Wrap 200 USDC for buyer (id.json wallet)
cd frontend && pnpm tsx scripts/wrap-usdc-for-buyer.ts

# Wrap 2 SOL for seller (devnet.json wallet)
cd frontend && pnpm tsx scripts/wrap-sol-for-seller.ts
```

**UserConfidentialBalance Account Layout** (153 bytes):
```
Offset 0-7:    Discriminator (8 bytes)
Offset 8-39:   Owner pubkey (32 bytes)
Offset 40-71:  Mint pubkey (32 bytes)
Offset 72-135: Encrypted balance (64 bytes) - plaintext in first 8 bytes
Offset 136-143: Total deposited (8 bytes)
Offset 144-151: Total withdrawn (8 bytes)
Offset 152:    Bump (1 byte)
```

**Reading balance:** `data.readBigUInt64LE(72)` extracts the balance from offset 72.

**TradingPair Vault Offsets:**
- `c_base_vault` (SOL): offset 136 (8 + 32×4)
- `c_quote_vault` (USDC): offset 168 (8 + 32×5)

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

### Crank Service (Order Matching & Settlement)

The crank service automatically monitors open orders, triggers MPC-based matching, and executes settlements when orders are filled.

**Architecture:**
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  OrderMonitor   │     │ MatchingAlgo    │     │ SettlementExec  │
│  (Polling)      │     │ (MPC Trigger)   │     │ (Token Transfer)│
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ 1. Fetch V4     │────▶│ 2. Find pairs   │────▶│ 4. Detect fills │
│    orders       │     │ 3. match_orders │     │ 5. settle_order │
│                 │     │    via MPC      │     │    instruction  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| OrderMonitor | `backend/src/crank/order-monitor.ts` | Fetches open orders, parses V3/V4 formats |
| MatchingAlgorithm | `backend/src/crank/matching-algorithm.ts` | Finds compatible buy/sell pairs |
| MatchExecutor | `backend/src/crank/match-executor.ts` | Executes `match_orders` instruction |
| SettlementExecutor | `backend/src/crank/settlement-executor.ts` | Monitors filled orders, executes settlement |
| MpcPoller | `backend/src/crank/mpc-poller.ts` | Polls for MPC computation results |

**Order Flow:**
1. `OrderMonitor` polls for V4 orders (390 bytes) every 5 seconds
2. `MatchingAlgorithm` identifies compatible buy/sell pairs
3. `MatchExecutor` sends `match_orders` instruction with MPC price comparison
4. MPC callback sets `filled_plaintext` on matched orders
5. `SettlementExecutor` detects orders with `filled_plaintext > 0`
6. Settlement transfers tokens: seller SOL → buyer, buyer USDC → seller

**Settlement Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    settle_order Instruction                      │
├─────────────────────────────────────────────────────────────────┤
│ Inputs:                                                          │
│   - buy_order PDA (V4 format, 390 bytes)                        │
│   - sell_order PDA (V4 format, 390 bytes)                       │
│   - buyer_base_balance (SOL balance PDA)                        │
│   - buyer_quote_balance (USDC balance PDA)                      │
│   - seller_base_balance (SOL balance PDA)                       │
│   - seller_quote_balance (USDC balance PDA)                     │
│                                                                  │
│ Logic (settle_order.rs):                                         │
│   fill_amount = order.filled_plaintext (SOL in lamports)        │
│   fill_value = fill_amount * price / 1e9 (USDC in micros)       │
│                                                                  │
│   seller_base -= fill_amount   (seller sends SOL)               │
│   buyer_base += fill_amount    (buyer receives SOL)             │
│   buyer_quote -= fill_value    (buyer sends USDC)               │
│   seller_quote += fill_value   (seller receives USDC)           │
│                                                                  │
│ Constraints:                                                     │
│   - Line 172: seller_base >= fill_amount                        │
│   - Line 179: buyer_quote >= fill_value                         │
│   - Both orders must have filled_plaintext > 0                  │
└─────────────────────────────────────────────────────────────────┘
```

**Common Errors:**

| Error | Code | Cause | Fix |
|-------|------|-------|-----|
| `AccountDidNotDeserialize` | 0xbbb | V3 order passed to V4-expecting program | Only use V4 orders |
| `InsufficientBalance` | 0x1782 | Buyer USDC or seller SOL too low | Wrap more tokens |

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
