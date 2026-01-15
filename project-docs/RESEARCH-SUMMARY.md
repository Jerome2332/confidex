# Confidex Research Summary

**Date:** January 14, 2026
**Purpose:** Comprehensive research compilation for Confidex development
**Status:** Starting from scratch after project recovery

---

## 1. Project Overview

**Confidex** is a confidential decentralized exchange built on Solana that leverages:
- **Arcium's MPC infrastructure** as its core execution layer
- **Noir ZK proofs** for compliance verification (via Sunspot/Groth16)
- **C-SPL tokens** for persistent encrypted balances

### Target Bounties

| Sponsor | Prize Pool | Our Angle |
|---------|------------|-----------|
| **Arcium** | $10,000 | End-to-end confidential DeFi using C-SPL + MPC matching |
| **Aztec/Noir** | $10,000 | Best overall ZK app / Eating glass / Most creative |
| **Helius** | $5,000 | Best privacy project using Helius RPC |
| **Radr Labs** | $15,000 | ShadowWire integration potential |
| **Inco** | $6,000 | DeFi track ($2k) |
| **PNP Exchange** | $2,500 | Private prediction markets with privacy-focused tokens as collateral |
| **Open Track** | $18,000 | Novel MPC + ZK combination |

**Total Potential:** ~$66,500

### PNP Exchange Prize Details
- **Prize:** $2,500 total ($1k each for 2 winning projects + $500 bonus)
- **Track:** Private & Agent-Based Prediction Markets
- **Requirements:** Build AI agents that create prediction markets using privacy-focused tokens as collateral, OR design private prediction market infrastructure using PNP SDK
- **Our Approach:** Integrate PNP SDK for perpetuals/prediction market functionality with C-SPL confidential tokens as collateral

---

## 2. Critical Technical Discovery

### Groth16 Backend Requirement

**From Telegram (Cat | Solana Foundation):**
> "if you want to verify noir on solana, you wont use barretenberg at all. youll need to only use the groth16 backend by sunspot"
> "honk proofs are too large to verify on solana. groth16 proofs are faster and cheaper to verify"

**Impact on PRD-003:** The current design using `@noir-lang/backend_barretenberg` for client-side proof generation is **incorrect**. We must use:
- **Sunspot** for the entire Groth16 pipeline
- Server-side or WASM-based Sunspot proving (not Barretenberg)

---

## 3. Technology Deep Dive

### 3.1 Arcium MPC Infrastructure

**What Arcium Is:**
- Decentralized private computation network for secure processing of encrypted data via MPC
- Enables computations on fully encrypted information without decryption
- Privacy guaranteed if at least 1 node is honest (dishonest majority model)
- Currently in Public Testnet on Solana devnet

**Key Components:**

| Component | Purpose |
|-----------|---------|
| **MXE (MPC eXecution Environment)** | Smart contract + computation definitions + cluster metadata |
| **Arcis** | Rust framework for writing MPC circuits |
| **Cerberus Protocol** | Security model with dishonest majority protection |
| **Arx Nodes** | Network nodes that process encrypted computations |

**Common Applications:**
- Private DeFi (dark pools with hidden trade sizes/prices)
- Secure AI (model inference on encrypted data)
- Confidential Gaming (hidden-information games)

**MPC Protocols:**
| Protocol | Security Model | Best For | Notes |
|----------|---------------|----------|-------|
| **Cerberus** | Dishonest majority (n-1 malicious) | High-value DeFi, dark pools | MAC-based authentication, strongest security |
| **Manticore** | Honest-but-curious | High-throughput, lower stakes | Faster but weaker guarantees |

**→ For Confidex:** Use **Cerberus** - dark pools require strongest security guarantees.

**Cluster Types:**
| Type | Description | Use Case |
|------|-------------|----------|
| **Fully Permissioned** | Fixed, known operators | Enterprise/regulated DeFi |
| **Partially Permissioned** | Some requirements for operators | Balanced trust/decentralization |
| **Public** | Open to any staked operator | Maximum decentralization |

**MXE Types:**
- **Single-Use MXEs:** One-time computations, no state retention
- **Recurring MXEs:** Repeated computations with fresh inputs

**Computation Lifecycle (5 Stages):**
| Stage | Description | Duration |
|-------|-------------|----------|
| 1. **Definition** | Circuit defined, accounts created | One-time setup |
| 2. **Commissioning** | Cluster assigned, execution window set | Transaction time |
| 3. **Mempool** | Computation queued, awaiting pickup | Variable (priority-based) |
| 4. **Execution** | Arx nodes compute via MPC protocol | Execution window (configurable) |
| 5. **Callback** | Results returned on-chain or to callback server | Transaction time |

**Execution Windows:** Configurable timeouts - if computation exceeds window, it fails and can be retried.

**5 Actors in Lifecycle:**
1. **Client** → Encrypts input parameters
2. **MXE Program** → Formats and submits encrypted computations
3. **Arcium Program** → Queues computations in mempool
4. **MPC Cluster** → Fetches, computes via MPC, returns results
5. **Callback Server** → Handles large outputs (optional)

**Pricing Model:**
```
Total Cost = Base Fee + Priority Fee
```
- **Base Fee:** Minimum cost based on Computational Units (CUs) consumed
- **Priority Fee:** Optional fee to prioritize execution in mempool
- **CUs:** Measure of computation complexity (similar to Solana compute units)

**Solana Integration:**
- Solana serves as **orchestration layer** (not execution layer)
- MXE programs are Anchor programs on Solana
- Arcium network handles actual encrypted computation off-chain
- Results posted back to Solana via callbacks

**Encryption System:**
- Uses **Rescue cipher** (arithmetization-oriented symmetric encryption)
- **x25519 ECDH** key exchange between client and cluster
- **Rescue-Prime** hash for key derivation
- 128-bit security for cipher, 256-bit for key derivation
- `Enc<Owner, T>` type system: `Shared` or `Mxe` ownership

**Security Features:**
- **Constant-time operations:** All MPC operations execute in constant time to prevent timing attacks
- **Cryptographic detection:** Malicious behavior detected cryptographically via MAC verification (Cerberus)
- **Slashing:** Misbehaving nodes lose staked collateral
- **Fault tolerance:** Computations can be retried on different clusters if nodes fail

**Censorship Resistance:**
- Computations can specify multiple fallback clusters
- If primary cluster censors/fails, computation routes to backup
- Economic incentives align nodes toward honest behavior

**SDK Installation:**
```bash
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
```

**Linux Additional Dependencies:**
```bash
sudo apt-get update && sudo apt-get install -y pkg-config build-essential libudev-dev libssl-dev
```

**Arcium Version Manager (arcup):**
```bash
arcup install              # Install latest version
arcup install <version>    # Install specific version
arcup use <version>        # Switch between installed versions
arcup version              # Show currently active version
arcup list                 # List all installed versions
```

**Version Compatibility:** MAJOR.MINOR must match across CLI and Arx Node (PATCH can differ).

**Rust Version Requirements:**
- **For Arcium v0.4.0+:** Use Rust 1.89.0
- **For Arcium v0.3.0:** Use Rust 1.88.0

Create `rust-toolchain.toml` in project root:
```toml
[toolchain]
channel = "1.89.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

**Prerequisites:**
- Rust 1.89.0 (for Arcium v0.4.0+)
- Solana CLI 2.3.0
- Yarn
- Anchor 0.32.1
- Docker & Docker Compose

**Arcium CLI Commands:**
```bash
arcium build                    # Build MXE program
arcium test                     # Run local tests
arcium deploy --cluster-offset <offset> --keypair-path <path> --rpc-url <url>
```

**Devnet Cluster Offsets:** 123, 456, 789 (all v0.5.1)

**Deployment Requirements:**
- 2-5 SOL in keypair for costs
- Dedicated RPC endpoint (Helius or QuickNode recommended - default Solana endpoints unreliable)
- For large circuits: Upload `.arcis` files to IPFS/S3/Supabase, reference with `circuit_hash!` macro

**Client Libraries:**
```bash
npm install @arcium-hq/client  # Encryption, submission, callbacks
npm install @arcium-hq/reader  # Read MXE data
```

**TypeScript SDK Encryption:**
```typescript
import { RescueCipher } from '@arcium-hq/client';
import { x25519 } from '@noble/curves/ed25519';

// 1. Generate keypair
const privateKey = x25519.utils.randomSecretKey();
const publicKey = x25519.getPublicKey(privateKey);

// 2. Establish shared secret with MXE cluster
const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

// 3. Create cipher and encrypt
const cipher = new RescueCipher(sharedSecret);
const nonce = randomBytes(16);
const ciphertext = cipher.encrypt(plaintext, nonce);
const decrypted = cipher.decrypt(ciphertext, nonce);
```

**API Reference:** https://ts.arcium.com/api

#### Arcis Framework (MPC Circuits)

**What Arcis Is:**
- Rust-based framework for writing secure MPC circuits
- Circuit-oriented design for MPC development
- Enables computation on encrypted data without exposing underlying information

**Supported Data Types:**
| Category | Types |
|----------|-------|
| Unsigned integers | `u8`, `u16`, `u32`, `u64`, `u128`, `usize` |
| Signed integers | `i8`, `i16`, `i32`, `i64`, `i128`, `isize` |
| Floating-point | `f32`, `f64` (fixed-point, range -2^250 to 2^250) |
| Composite | Tuples, fixed-length arrays, structs |
| Special | `ArcisPublicKey`, `Enc<Owner, T>` |
| **NOT supported** | `HashMap`, `Vec`, `String` (variable length) |

**Encryption Type:** `Enc<Owner, T>`
- `Enc<Shared, T>` - Both client and MXE can decrypt (for user inputs/outputs)
- `Enc<Mxe, T>` - Only MXE nodes can decrypt collectively (for internal state)

**MPC Operations:**
```rust
// Arithmetic
let sum = a + b;           // +, -, *, /, %
let result = a * b;

// Comparison
let is_greater = a > b;    // ==, !=, <, <=, >=, >

// Logical
let and_result = a && b;   // &&, ||, ^, &, |

// RNG Functions
ArcisRNG::bool()                                    // Random boolean
ArcisRNG::gen_integer_from_width(width: usize)      // Secret int [0, 2^width-1]
ArcisRNG::gen_public_integer_from_width(width)      // Public int
ArcisRNG::gen_integer_in_range(min, max, n_attempts) // Ranged generation
ArcisRNG::shuffle(slice)                            // O(n*log³(n)) shuffle

// Encryption/Ownership
Mxe::get()                           // Create MXE-owned secret data
Shared::new(arcis_public_key)        // Share private data with public key

// Input/Output Conversion
input_enc.to_arcis()                 // Ciphertext → secret shares (no plaintext exposure)
owner.from_arcis(output)             // Secret shares → Enc<Owner, T> ciphertext
```

**Writing MXE Programs:**

1. **Instruction Handler** - Receives encrypted params, uses `ArgBuilder` API:
   - `x25519_pubkey()` - For public keys
   - `plaintext_u128()` - For plaintext values
   - `encrypted_u8()` - For encrypted values

2. **Callback Instruction** - Decorated with `#[arcium_callback(encrypted_ix = "instruction_name")]`
   - Accepts context + `SignedComputationOutputs<T>`
   - Call `verify_output()` for verification

3. **Account Structs** - Use `#[queue_computation_accounts]` and `#[callback_accounts]` macros

**Required Account Categories:**
- Core MXE: `mxe_account`, `mempool_account`, `computation_account`, `comp_def_account`
- Arcium Network: `cluster_account`, `pool_account`, `clock_account`
- System: `payer`, `sign_pda_account`, `arcium_program`

**Limitations:**
- Outputs must fit in single Solana transaction (use callback server for larger outputs)
- No recursive functions
- No user-defined binary operations
- Operations on encrypted data more computationally expensive than plaintext

**Callback Server (for large outputs):**
- Self-hosted HTTP server receiving large computation results
- POST `/callback` endpoint receives: `mempool_id|comp_def_offset|tx_sig|data_sig|pub_key|data`
- Must verify signatures and call `finalize` transaction on-chain

**Documentation URLs:**
- Main: https://docs.arcium.com/developers
- Installation: https://docs.arcium.com/developers/installation
- Hello World: https://docs.arcium.com/developers/hello-world
- Computation Lifecycle: https://docs.arcium.com/developers/computation-lifecycle
- Encryption: https://docs.arcium.com/developers/encryption
- Arcis Framework: https://docs.arcium.com/developers/arcis
- Arcis Operations: https://docs.arcium.com/developers/arcis/operations
- Arcis Types: https://docs.arcium.com/developers/arcis/types
- JS Client Library: https://docs.arcium.com/developers/js-client-library
- Deployment: https://docs.arcium.com/developers/deployment
- Callback Server: https://docs.arcium.com/developers/callback-server
- Limitations: https://docs.arcium.com/developers/limitations
- TS SDK API: https://ts.arcium.com/api

### 3.2 Sunspot & Noir/Groth16 on Solana

**What Sunspot Is:**
- Toolkit for proving and verifying Noir ZK circuits on Solana
- Generates Groth16 proofs (not Honk/PLONK)
- Produces deployable Solana verifier programs

**Required Version:** Noir 1.0.0-beta.13

**Security Notice:** Not audited, provided as-is

**Installation:**
```bash
git clone git@github.com:reilabs/sunspot.git
cd sunspot/go
go build -o sunspot .
# Set GNARK_VERIFIER_BIN environment variable
```

**CLI Commands:**

| Command | Function |
|---------|----------|
| `compile` | ACIR → CCS file |
| `setup` | Generate proving/verification keys |
| `prove` | Generate Groth16 proof |
| `verify` | Verify proof |
| `deploy` | Create Solana verifier program |

**Complete Workflow:**
```bash
# 1. Compile Noir to ACIR
nargo compile

# 2. Convert to CCS
sunspot compile circuit.json

# 3. Generate keys (trusted setup per circuit)
sunspot setup circuit.ccs

# 4. Generate proof
sunspot prove circuit.json witness.gz circuit.ccs key.pk

# 5. Verify locally
sunspot verify vkey.vk proof.proof witness.pw

# 6. Deploy Solana verifier
sunspot deploy vkey.vk
```

**Proof Characteristics:**
- Proof size: ~324-388 bytes
- Verification cost: ~200,000 compute units

**Example Circuits (from solana-foundation/noir-examples):**
1. **One** - Basic assertion (`x != y`)
2. **Verify Signer** - ECDSA secp256k1 signature verification
3. **SMT Exclusion** - Sparse Merkle Tree blacklist proofs (exactly what we need!)

### 3.3 ShadowWire (Radr Labs)

**What ShadowWire Is:**
- TypeScript SDK for confidential transfers on Solana
- Uses **Bulletproof** zero-knowledge proofs (not Groth16)
- Privacy layer above standard Solana transfers
- Hides transaction amounts while maintaining on-chain verifiability

**Hackathon Prize:** $15,000 (Best ShadowWire integration)

**Transfer Types:**

| Type | Privacy Level | Requirement |
|------|--------------|-------------|
| **Internal** | Amount fully hidden (ZK proof) | Both parties must be ShadowWire users |
| **External** | Amount visible, sender anonymous | Works with any Solana wallet |

**Installation:**
```bash
npm install @radr/shadowwire
```

**Client Initialization:**
```typescript
import { ShadowWireClient } from '@radr/shadowwire';

const client = new ShadowWireClient({
  debug: true,  // Optional: enable logging
  apiBaseUrl: 'https://your-api.com'  // Optional: custom endpoint
});
```

**Core API Methods:**

| Method | Purpose |
|--------|---------|
| `getBalance(wallet, token)` | Get available balance and pool address |
| `deposit({ wallet, amount })` | Deposit funds into ShadowWire pool |
| `withdraw({ wallet, amount })` | Withdraw funds from pool |
| `transfer({ sender, recipient, amount, token, type })` | Primary transfer method |
| `transferWithClientProofs()` | Transfer with custom client-generated proofs |

**Balance Query:**
```typescript
const balance = await client.getBalance('WALLET_ADDRESS', 'SOL');
console.log(balance.available);    // Available lamports
console.log(balance.pool_address); // Pool PDA
```

**Deposit/Withdraw:**
```typescript
// Deposit 0.1 SOL
await client.deposit({
  wallet: 'YOUR_WALLET',
  amount: 100000000  // in lamports
});

// Withdraw 0.05 SOL
await client.withdraw({
  wallet: 'YOUR_WALLET',
  amount: 50000000
});
```

**Private Transfer (Primary Method):**
```typescript
const result = await client.transfer({
  sender: 'YOUR_WALLET',
  recipient: 'RECIPIENT_WALLET',
  amount: 0.5,           // In token units (not lamports)
  token: 'SOL',
  type: 'internal',      // or 'external'
  wallet: { signMessage: signMessage! }  // Required: wallet adapter
});

console.log(result.tx_signature);
console.log(result.amount_hidden);  // Boolean: was amount hidden?
```

**Wallet Authentication (MANDATORY):**
```typescript
import { useWallet } from '@solana/wallet-adapter-react';

const { signMessage, publicKey } = useWallet();

await client.transfer({
  sender: publicKey!.toBase58(),
  recipient: 'RECIPIENT_ADDRESS',
  amount: 1.0,
  token: 'SOL',
  type: 'internal',
  wallet: { signMessage: signMessage! }  // REQUIRED for all transfers
});
```

**Client-Side Proof Generation (Browser):**
```typescript
import { initWASM, generateRangeProof, isWASMSupported } from '@radr/shadowwire';

// Check WASM support
if (!isWASMSupported()) {
  console.log('Fallback to backend proofs');
  return;
}

// Initialize WASM (once per session)
await initWASM('/wasm/settler_wasm_bg.wasm');

// Generate proof (takes 2-3 seconds)
const amountLamports = 100000000;  // 0.1 SOL
const proof = await generateRangeProof(amountLamports, 64);

// Transfer with custom proof
await client.transferWithClientProofs({
  sender: 'YOUR_WALLET',
  recipient: 'RECIPIENT_WALLET',
  amount: 0.1,
  token: 'SOL',
  type: 'internal',
  customProof: proof
});
```

**Supported Tokens (17 total):**

| Token | Decimals | Token | Decimals |
|-------|----------|-------|----------|
| SOL | 9 | RADR | 9 |
| USDC | 6 | ORE | 11 |
| BONK | 5 | JIM | 9 |
| GODL | 11 | HUSTLE | 9 |
| ZEC | 8 | CRT | 9 |
| BLACKCOIN | 6 | GIL | 6 |
| ANON | 9 | WLFI | 6 |
| USD1 | 6 | AOL | 6 |
| IQLABS | 9 | | |

**Token Utilities:**
```typescript
import { TokenUtils } from '@radr/shadowwire';

// Convert to smallest units (lamports)
TokenUtils.toSmallestUnit(0.1, 'SOL');        // 100000000

// Convert from smallest units
TokenUtils.fromSmallestUnit(100000000, 'SOL'); // 0.1
```

**Error Handling:**
```typescript
import { RecipientNotFoundError, InsufficientBalanceError } from '@radr/shadowwire';

try {
  await client.transfer({ ... });
} catch (error) {
  if (error instanceof RecipientNotFoundError) {
    // Recipient not in ShadowWire - try external transfer
  } else if (error instanceof InsufficientBalanceError) {
    // Need to deposit more funds
  }
}
```

**Fee Structure:** 1% relayer fee (applied automatically)

**Browser Compatibility:**
- ✅ Chrome/Edge 57+
- ✅ Firefox 52+
- ✅ Safari 11+
- ✅ Node.js 10+
- ❌ Internet Explorer

**Advanced: Two-Step Manual Transfer:**
```typescript
// Step 1: Upload proof
const proofResult = await client.uploadProof({
  sender_wallet: 'YOUR_WALLET',
  token: 'SOL',
  amount: 100000000,
  nonce: Math.floor(Date.now() / 1000)
});

// Step 2: Execute transfer
const result = await client.internalTransfer({
  sender_wallet: 'YOUR_WALLET',
  recipient_wallet: 'RECIPIENT',
  token: 'SOL',
  nonce: proofResult.nonce,
  relayer_fee: 1000000
});
```

**ShadowWire vs C-SPL vs Inco Comparison:**

| Aspect | ShadowWire | C-SPL | Inco |
|--------|------------|-------|------|
| **Privacy Model** | Bulletproofs ZK | Twisted ElGamal | TEE covalidator |
| **Token Support** | 17 existing tokens | Any SPL token | Any (via handles) |
| **Balance Storage** | Off-chain pools | On-chain encrypted | Off-chain handles |
| **Maturity** | Production (audited) | Coming soon | Beta |
| **Fee** | 1% relayer | Gas only | Gas + CU fees |
| **Best For** | Private transfers | Persistent balances | Encrypted compute |

**Potential Confidex Integration:**

```
Option A: ShadowWire as Settlement Layer
├── Pro: Production-ready, audited, 17 tokens supported
├── Pro: Existing user base and liquidity pools
├── Con: 1% fee impacts DEX economics
└── Con: Different privacy model than Arcium

Option B: Dual Settlement (C-SPL + ShadowWire)
├── Users choose settlement method
├── ShadowWire for existing token transfers
└── C-SPL for native confidential balances

Option C: ShadowWire for Withdrawals Only
├── Arcium MPC for order matching
├── C-SPL for internal balances
└── ShadowWire for anonymous withdrawals to external wallets
```

**Prize Strategy:**
- $15K prize for best ShadowWire integration
- Strong fit if C-SPL isn't ready
- Could position as "anonymous withdrawal" feature
- Integration requires pool deposits/withdrawals flow

**Community:**
- Telegram: https://t.me/radrportal
- Twitter: https://x.com/radrdotfun
- Email: hello@radrlabs.io

**GitHub:** https://github.com/Radrdotfun/ShadowWire

### 3.4 Inco Lightning (SVM)

**What Inco Lightning Is:**
- Confidential computing platform enabling encrypted computation on Solana
- Sensitive data remains encrypted throughout on-chain computation
- Uses off-chain covalidator network with TEE (Trusted Execution Environment)
- Rust SDK + JavaScript SDK for full-stack confidential app development

**Hackathon Prize:** $6,000 total
- DeFi: $2,000
- Consumer, Gaming, Prediction Markets: $2,000
- Payments: $2,000

**Architecture:**
```
Client Encryption → Program CPI → Covalidator Network → Encrypted Results
     ↓                  ↓                ↓                    ↓
  JS SDK          Rust SDK        TEE Processing      Handle References
```

**How It Works:**
1. **Client encrypts** data using covalidator's public key (JS SDK)
2. **Program receives** ciphertext and creates encrypted handles via CPI
3. **Operations execute** on encrypted values through Inco Lightning program
4. **Results are handles** - 128-bit references to encrypted values stored off-chain
5. **Authorized decryption** - parties can request attested decryption

**Encrypted Types:**

| Type | Description | Size |
|------|-------------|------|
| `Euint128` | Encrypted unsigned 128-bit integer | 16 bytes |
| `Ebool` | Encrypted boolean | 16 bytes |

**Key Property:** Handles are deterministically derived - same operation with same inputs always produces same handle.

**Rust SDK Installation:**
```toml
[dependencies]
inco-lightning = { version = "0.1.4", features = ["cpi"] }
```

**Anchor.toml Configuration:**
```toml
[programs.devnet]
inco_lightning = "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
```

**Rust SDK Imports:**
```rust
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Operation;
use inco_lightning::cpi::{e_add, e_sub, e_ge, e_select, new_euint128};
use inco_lightning::types::{Euint128, Ebool};
use inco_lightning::ID as INCO_LIGHTNING_ID;
```

**Available Operations:**

| Category | Operations | Return Type |
|----------|-----------|-------------|
| **Arithmetic** | `e_add`, `e_sub`, `e_mul`, `e_rem` | `Euint128` |
| **Comparison** | `e_ge`, `e_gt`, `e_le`, `e_lt`, `e_eq` | `Ebool` |
| **Bitwise** | `e_and`, `e_or`, `e_not`, `e_shl`, `e_shr` | `Euint128` |
| **Selection** | `e_select` (conditional) | `Euint128` |

**Input Functions:**
```rust
new_euint128(ctx, ciphertext)     // Create from encrypted input
new_ebool(ctx, ciphertext)        // Create encrypted bool
as_euint128(ctx, plaintext)       // Convert plaintext to encrypted
as_ebool(ctx, plaintext)          // Convert plaintext bool
```

**JavaScript SDK Installation:**
```bash
npm install @inco/solana-sdk
# or
pnpm add @inco/solana-sdk
```

**Client-Side Encryption:**
```typescript
import { encryptValue } from '@inco/solana-sdk/encryption';

// Encrypt values before sending to program
const encryptedAmount = await encryptValue(amount);
const encryptedBool = await encryptValue(true);
```

**Decryption (Attested):**
```typescript
import { decrypt } from '@inco/solana-sdk';

// Attested Reveal - for display purposes
const result = await decrypt(handles, wallet);
const plaintext = result.plaintexts;

// Attested Decrypt - with on-chain verification
const result = await decrypt(handles, wallet);
// Use result.ed25519Instructions for transaction building
```

**Access Control:**
- Decryption is permission-gated via Allowance PDAs
- Allowance stores `[handle, address]` pairs on-chain
- Must grant permission before user can decrypt their data
- Covalidator checks allowance before revealing plaintext

**Confidential SPL Token Features:**
- Encrypted balances (holdings invisible to observers)
- Private transfers (amounts confidential)
- Encrypted computation on-chain
- Programmable access control via allowance system

**Inco Program ID (Devnet):** `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj`

**Documentation URLs:**
- Introduction: https://docs.inco.org/svm/introduction
- Guide: https://docs.inco.org/svm/guide/intro
- Rust SDK: https://docs.inco.org/svm/rust-sdk/overview
- JS SDK: https://docs.inco.org/svm/js-sdk/overview
- Confidential Token Tutorial: https://docs.inco.org/svm/tutorials/confidential-spl-token/overview

**Inco vs Arcium Comparison:**

| Aspect | Inco Lightning | Arcium |
|--------|---------------|--------|
| **Model** | TEE-based covalidator | MPC network |
| **Security** | Trust TEE hardware | Dishonest majority (cryptographic) |
| **Data Storage** | Off-chain (handles on-chain) | Off-chain (MXE state) |
| **Operations** | CPI to Inco program | Arcis circuits |
| **Decryption** | Attested via TEE signatures | Via MPC threshold |
| **Maturity** | Beta | Public testnet |

**Potential Confidex Integration:**
Inco could serve as an **alternative or complement** to Arcium for:
1. **Encrypted balance storage** - Use `Euint128` for order amounts/prices
2. **Confidential token layer** - Alternative to C-SPL using Inco's confidential SPL pattern
3. **Access control** - Allowance-based decryption for order visibility

**Prize Strategy Consideration:**
- Confidex already uses Arcium for MPC (stronger security model)
- Inco integration would require significant architecture changes
- Best approach: Mention Inco compatibility in roadmap, or build small proof-of-concept
- Could target "DeFi" track ($2K) with minimal integration

### 3.5 PNP Exchange SDK (Prediction Markets)

**What PNP Exchange Is:**
- Permissionless prediction market protocol on Solana
- "Like Polymarket but with AI judges & bonding curves for liquidity"
- No order book - trade directly against bonding curve
- LLM-driven oracle system for market resolution

**Why PNP Was Built:**
- Response to Polymarket's inefficiencies (manipulative UMA voter dynamics, poorly defined resolution criteria)
- Synergizes Pump.fun's token launch mechanics with Polymarket's prediction market framework
- "Correct-by-construction" markets designed to optimally elicit information

**Installation:**
```bash
npm install pnp-sdk
```

**Version:** 0.2.3 (Production-ready, TypeScript built-in)

**Environment Setup (.env):**
```env
# Solana RPC URL
RPC_URL=https://api.devnet.solana.com

# Wallet private key (Base58 OR array format)
WALLET_SECRET_BASE58=YourBase58EncodedPrivateKeyHere
# OR
WALLET_SECRET_ARRAY=[38,217,47,162,6,...]

# Optional: Mint addresses for market creation
BASE_MINT=YourBaseMintAddressHere
QUOTE_MINT=YourQuoteMintAddressHere
```

**Client Initialization:**
```typescript
import { PNPClient } from 'pnp-sdk';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

dotenv.config();

// With Base58 private key
const maybePk = process.env.WALLET_SECRET_BASE58
  ? bs58.decode(process.env.WALLET_SECRET_BASE58)
  : undefined;
const client = new PNPClient(process.env.RPC_URL!, maybePk);

// With private key array
const privateKeyArray = JSON.parse(process.env.WALLET_SECRET_ARRAY!);
const privateKeyBytes = new Uint8Array(privateKeyArray);
const client = new PNPClient(process.env.RPC_URL!, privateKeyBytes);

// Read-only (no private key)
const readOnlyClient = new PNPClient(rpcUrl);
```

**SDK Modules:**
| Module | Purpose |
|--------|---------|
| `client.trading` | TradingModule - Buy/sell outcome tokens (requires private key) |
| `client.fetchGlobalConfig()` | Read global config (read-only) |
| `client.fetchMarket()` | Fetch single market |
| `client.fetchMarkets()` | List all markets |

**Trading Operations:**
```typescript
// Buy tokens with USDC (requires private key)
await client.trading!.buyTokensUsdc(...);

// Read-only operations work without private key
const global = await client.fetchGlobalConfig();
```

**REST API Server (Built-in):**
```bash
# Start the API server on port 3000
npm run api:server

# Create market directly from CLI
npm run api:server "Will this market prediction come true?"
```

**API Endpoints:**
- `GET /health` - Health check endpoint
- `POST /create-market` - Create a new market
  - Request body: `{ "question": "Your market question here" }`

**Market Creation Response:**
```typescript
{
  success: true,
  txSignature: "2NPJ3NCuP1EZpN8DAwyjUgKJbRNZ6ZzmLSz8gXq3wMARMjeY3Y8xpGKUQo4hjiP7eoqAa6bHLNvWUbHMRGZ1sk9n",
  market: "CL9tjeJL38C3KyVvUxSHiiMzfvvB6gNn6TCweE9TH45t",
  yesTokenMint: "BzPKqzBNKw3hjj7BNn6oT7GXG3LKv7R1mFQby5bAYvdG",
  noTokenMint: "5ctuKQpZMQ2HoMvjXZHxAT3QxCN5mq8Ss1U5YCvFg8aZ",
  marketDetails: {
    id: "42",
    question: "Will this market prediction come true?",
    creator: "BUbQNJKKRvZesSPbgJyw1nHDRNMn7demZjcaqWpLXcFe",
    initialLiquidity: "50000000",
    marketReserves: "50000000",
    yesTokenSupply: "50000000",
    noTokenSupply: "50000000",
    endTime: "2025-08-27T19:12:28.000Z",
    resolved: false
  }
}
```

**Development Commands:**
```bash
npm run build       # Build the SDK
npm test            # Run tests
npm run typecheck   # TypeScript type checking
npm run api:server  # Start REST API server
```

**Token Support:**
- Automatically detects and supports both SPL Token and Token-2022 programs
- Collateral can be any SPL token (typically USDC)
- Program ID embedded in program IDL (no env needed)

**PNP Token Contract:** `ArQNTJtmxuWQ77KB7a1PmoZc5Zd25jXmXPDWBX8qVoux`

**Documentation:** https://docs.pnp.exchange/pnp-sdk

---

## 4. Architecture Decision Matrix

### Which Technologies for Which Layer?

| Layer | Original PRD | Recommended | Notes |
|-------|-------------|-------------|-------|
| **Compliance (ZK Proofs)** | Noir + Barretenberg | Noir + Sunspot/Groth16 | MUST change - Barretenberg won't work |
| **Execution (MPC)** | Arcium Cerberus | Arcium Cerberus | Correct as designed |
| **Settlement (Tokens)** | C-SPL | C-SPL OR ShadowWire | Consider ShadowWire for extra bounty |
| **Prediction Markets** | N/A | PNP SDK | New addition for perpetuals/prediction markets |
| **RPC/Infrastructure** | Helius | Helius | Correct as designed |

### Proof Generation Strategy Change

**OLD (PRD-003):**
```typescript
// WRONG - Won't work on Solana
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
const backend = new BarretenbergBackend(circuit);
```

**NEW (Required):**
- Proofs must be generated using Sunspot's Groth16 backend
- Options:
  1. **Server-side:** Generate proofs on backend (simpler, less decentralized)
  2. **WASM:** Compile Sunspot to WASM for client-side (harder, more decentralized)
  3. **Hybrid:** Pre-compute proofs, cache them for eligible users

---

## 5. Development Priorities

### Immediate Research Needs

1. **Sunspot WASM Support:** Can Sunspot prove in browser?
2. **Arcium Testnet Access:** Register at developers.arcium.com
3. **C-SPL vs ShadowWire vs Inco:** ✅ RESEARCHED - See comparison table in Section 3.3
   - **ShadowWire:** Most mature (production, audited), 1% fee, 17 tokens
   - **C-SPL:** Coming soon, on-chain encrypted, no extra fee
   - **Inco:** Beta, TEE-based, good for encrypted compute
4. **Inco Integration:** ✅ RESEARCHED - Complementary, not competing. Could use for encrypted balance storage as C-SPL fallback. Target DeFi track ($2K) with minimal integration.
5. **ShadowWire Integration:** ✅ RESEARCHED - Strong fallback for settlement layer. Production-ready SDK, 65% confidence for $15K prize. Best option if C-SPL delayed.

### First Steps to Build

1. Set up development environment ([confidex-dev-setup.md](confidex-dev-setup.md))
2. Clone and test `solana-foundation/noir-examples` (especially SMT Exclusion)
3. Register for Arcium testnet
4. Clone and test `arcium-hq/examples` (especially sealed-bid auction)
5. Create basic Anchor program structure

---

## 6. Key Resources

### Documentation

**Arcium (complete list):**
- Main: https://docs.arcium.com/developers
- Installation: https://docs.arcium.com/developers/installation
- Arcup: https://docs.arcium.com/developers/installation/arcup
- Hello World: https://docs.arcium.com/developers/hello-world
- Computation Lifecycle: https://docs.arcium.com/developers/computation-lifecycle
- Encryption: https://docs.arcium.com/developers/encryption
- Sealing: https://docs.arcium.com/developers/encryption/sealing
- Arcis Framework: https://docs.arcium.com/developers/arcis
- Arcis Operations: https://docs.arcium.com/developers/arcis/operations
- Arcis Types: https://docs.arcium.com/developers/arcis/types
- Arcis Input/Output: https://docs.arcium.com/developers/arcis/input-output
- Arcis Best Practices: https://docs.arcium.com/developers/arcis/best-practices
- MXE Program: https://docs.arcium.com/developers/program
- Computation Def Accounts: https://docs.arcium.com/developers/program/computation-def-accs
- Callback Accounts: https://docs.arcium.com/developers/program/callback-accs
- Callback Type Generation: https://docs.arcium.com/developers/program/callback-type-generation
- JS Client Library: https://docs.arcium.com/developers/js-client-library
- JS Encryption: https://docs.arcium.com/developers/js-client-library/encryption
- JS Callback: https://docs.arcium.com/developers/js-client-library/callback
- Deployment: https://docs.arcium.com/developers/deployment
- Callback Server: https://docs.arcium.com/developers/callback-server
- Limitations: https://docs.arcium.com/developers/limitations
- Migration: https://docs.arcium.com/developers/migration
- Node Setup: https://docs.arcium.com/developers/node-setup
- **TS SDK API Reference:** https://ts.arcium.com/api

**Arcium Network Architecture:**
- Overview: https://docs.arcium.com/
- Key Features & Use Cases: https://docs.arcium.com/introduction/key-features-and-use-cases
- Basic Concepts: https://docs.arcium.com/introduction/basic-concepts
- Architecture Overview: https://docs.arcium.com/getting-started/architecture-overview
- MXE Overview: https://docs.arcium.com/multi-party-execution-environments-mxes/overview
- MPC Protocols: https://docs.arcium.com/multi-party-execution-environments-mxes/mpc-protocols
- MXE Encryption: https://docs.arcium.com/multi-party-execution-environments-mxes/mxe-encryption
- Clusters Overview: https://docs.arcium.com/clusters/overview
- Permissioned Clusters: https://docs.arcium.com/clusters/permissioned-clusters
- Arx Nodes: https://docs.arcium.com/arx-nodes/overview
- Computation Lifecycle: https://docs.arcium.com/computations/lifecycle-of-an-arcium-computation
- Pricing & Incentives: https://docs.arcium.com/computations/pricing-and-incentives
- Censorship Resistance: https://docs.arcium.com/computations/censorship-resistance-and-fault-handling
- Solana Integration: https://docs.arcium.com/solana-integration-and-multichain-coordination/solana-integration-orchestration-and-execution
- Staking: https://docs.arcium.com/staking/overview

**Inco Lightning (complete list):**
- Introduction: https://docs.inco.org/svm/introduction
- Guide Overview: https://docs.inco.org/svm/guide/intro
- Handles: https://docs.inco.org/svm/guide/handles
- Input & Encryption: https://docs.inco.org/svm/guide/input
- Operations: https://docs.inco.org/svm/guide/operations
- Random Numbers: https://docs.inco.org/svm/guide/random
- Control Flow: https://docs.inco.org/svm/guide/control-flow
- Access Control: https://docs.inco.org/svm/guide/access-control
- Accounts: https://docs.inco.org/svm/guide/accounts
- Decryption: https://docs.inco.org/svm/guide/decryption
- Best Practices: https://docs.inco.org/svm/guide/best-practices
- Rust SDK Overview: https://docs.inco.org/svm/rust-sdk/overview
- Rust SDK Types: https://docs.inco.org/svm/rust-sdk/types
- Rust SDK Operations: https://docs.inco.org/svm/rust-sdk/operations
- Rust SDK Accounts: https://docs.inco.org/svm/rust-sdk/accounts
- JS SDK Overview: https://docs.inco.org/svm/js-sdk/overview
- JS SDK Encryption: https://docs.inco.org/svm/js-sdk/encryption
- Attested Reveal: https://docs.inco.org/svm/js-sdk/attestations/attested-reveal
- Attested Decrypt: https://docs.inco.org/svm/js-sdk/attestations/attested-decrypt
- Confidential Token Tutorial: https://docs.inco.org/svm/tutorials/confidential-spl-token/overview
- Next.js Template: https://docs.inco.org/svm/tutorials/nextjs-template/overview

**Other:**
- **Noir Docs:** https://noir-lang.org/docs
- **Helius Docs:** https://helius.dev
- **PNP SDK Docs:** https://docs.pnp.exchange/pnp-sdk

### Code Repositories
- **Sunspot:** https://github.com/reilabs/sunspot
- **Noir Examples:** https://github.com/solana-foundation/noir-examples
- **Arcium Examples:** https://github.com/arcium-hq/examples
- **ShadowWire:** https://github.com/Radrdotfun/ShadowWire
- **Awesome Privacy on Solana:** https://github.com/catmcgee/awesome-privacy-on-solana

### NPM Packages
- **Arcium Client:** https://www.npmjs.com/package/@arcium-hq/client
- **Arcium Reader:** https://www.npmjs.com/package/@arcium-hq/reader
- **Inco Solana SDK:** https://www.npmjs.com/package/@inco/solana-sdk
- **PNP SDK:** https://www.npmjs.com/package/pnp-sdk

### Community
- Solana Discord
- Arcium Discord
- Aztec/Noir Discord
- Radr Telegram: @radrportal

---

## 7. Updated Tech Stack

### Smart Contracts
- **Language:** Rust
- **Framework:** Anchor 0.32.1
- **Arcium Integration:** Arcis framework

### ZK Proofs
- **Circuit Language:** Noir 1.0.0-beta.13
- **Compiler:** nargo
- **Proof System:** Groth16 (via Sunspot)
- **Verifier:** Sunspot-generated Solana program

### MPC Layer
- **Provider:** Arcium
- **Protocol:** Cerberus (dishonest majority)
- **SDK:** @arcium-hq/client, @arcium-hq/reader

### Token Layer
- **Primary:** C-SPL (Arcium confidential tokens)
- **Alternative:** ShadowWire (Bulletproof-based)

### Prediction Markets Layer
- **Provider:** PNP Exchange
- **SDK:** pnp-sdk (npm)
- **Features:** Bonding curve markets, LLM oracle resolution, Token-2022 support

### Frontend
- **Framework:** Next.js 14
- **Language:** TypeScript
- **Wallet:** @solana/wallet-adapter
- **RPC:** Helius SDK

### Infrastructure
- **RPC:** Helius
- **Indexing:** Helius Photon
- **Webhooks:** Helius

---

## 8. Clarifications from Arcium Team (Jan 2026)

**Q&A from Privacy Hackathon Telegram:**

1. **JS/TS SDK availability?**
   - ✅ Full TypeScript library available: https://ts.arcium.com/
   - Docs: https://arcium-updates.mintlify.app/developers/js-client-library

2. **Persistent vs Single-use MXE for portfolio encryption?**
   - Use case dependent - need to specify exact use case for recommendation

3. **Arcium testnet accessibility?**
   - ✅ Public testnet live on Solana devnet
   - No whitelisting required
   - Get started: https://docs.arcium.com/developers/hello-world

4. **Browser client triggering?**
   - ✅ No backend needed - write normal Solana programs, Arcium handles the rest
   - Works with static sites + serverless functions

5. **Balance threshold proofs (prove ownership without revealing amount)?**
   - ⚠️ This is a ZK use case, NOT MPC
   - Use Noir/ZK for proving facts, use Arcium/MPC for encrypted computation

6. **On-chain verification cost?**
   - ZK syscalls exist but are separate from Arcium
   - Groth16 via Sunspot: ~200K compute units

7. **Sandbox environment?**
   - ✅ Just deploy on Solana devnet

8. **C-SPL status?**
   - ⚠️ Going live on devnet "soon" (as of Jan 2026)
   - Worth waiting for vs custom encrypted position storage

---

## 9. Remaining Open Questions

1. **Proof Generation Location:**
   - Can Sunspot be compiled to WASM for client-side proving?
   - If not, how do we handle server-side proving without compromising privacy?

2. **C-SPL Timeline:**
   - Exact devnet launch date for C-SPL?
   - Can we start with custom approach and migrate?

3. **Order Matching Latency:**
   - What's the realistic latency for Arcium MPC operations?
   - Can we batch multiple price comparisons?

4. **Blacklist Management:**
   - Who maintains the Sparse Merkle Tree?
   - How often can the root be updated?

---

## 10. Next Steps

### Today
- [ ] Set up complete dev environment
- [ ] Clone and test noir-examples (especially SMT Exclusion)
- [ ] Register for Arcium testnet

### This Week
- [ ] Build basic Anchor program skeleton
- [ ] Test Sunspot end-to-end with sample circuit
- [ ] Evaluate ShadowWire integration feasibility
- [ ] Create first encrypted order struct with Arcium

---

*This document will be updated as research progresses.*
