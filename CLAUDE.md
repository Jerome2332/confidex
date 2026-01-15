# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
| Program | Purpose |
|---------|---------|
| `confidex_dex` | Core DEX logic, order management |
| `eligibility_verifier` | ZK proof verification (Groth16) |
| `arcium_adapter` | MPC operations wrapper |
| `c_spl_program` | Confidential token standard |

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

### Program ID (Devnet)
```
NEXT_PUBLIC_PROGRAM_ID=FWkEu3vnS2ctMUU3BRBnkAQAqK7PhW8HtwnS5AR2tjGr
```

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

### Docs
- **Main:** https://docs.arcium.com/developers
- **TS SDK API:** https://ts.arcium.com/api
- **Hello World:** https://docs.arcium.com/developers/hello-world
- **Architecture:** https://docs.arcium.com/getting-started/architecture-overview
- **MPC Protocols:** https://docs.arcium.com/multi-party-execution-environments-mxes/mpc-protocols

## PNP SDK Integration (Prediction Markets)

PNP Exchange is used for perpetuals/prediction market functionality with privacy-focused tokens as collateral.

**Installation:**
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

**Client Initialization:**
```typescript
import { PNPClient } from 'pnp-sdk';
import bs58 from 'bs58';

// With Base58 private key
const pk = process.env.WALLET_SECRET_BASE58 ? bs58.decode(process.env.WALLET_SECRET_BASE58) : undefined;
const client = new PNPClient(process.env.RPC_URL!, pk);

// Read-only (no private key)
const readOnlyClient = new PNPClient(rpcUrl);

// With Uint8Array
const client = new PNPClient(rpcUrl, new Uint8Array(privateKeyArray));
```

**Trading Operations:**
```typescript
// Buy tokens with USDC
await client.trading!.buyTokensUsdc(...);

// Fetch global config (read-only)
const global = await client.fetchGlobalConfig();
```

**REST API Server:**
```bash
npm run api:server                              # Start server on :3000
npm run api:server "Your market question?"      # Create market via CLI
```

**API Endpoints:**
- `GET /health` - Health check
- `POST /create-market` - Create market with `{ "question": "..." }`

**Market Response Structure:**
```typescript
{
  market: PublicKey,           // Market address
  yesTokenMint: PublicKey,     // YES outcome token
  noTokenMint: PublicKey,      // NO outcome token
  marketDetails: {
    id, question, creator, initialLiquidity,
    marketReserves, yesTokenSupply, noTokenSupply,
    endTime, resolved
  }
}
```

**Docs:** https://docs.pnp.exchange/pnp-sdk

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
