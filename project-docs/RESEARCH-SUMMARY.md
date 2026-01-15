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
| **Open Track** | $18,000 | Novel MPC + ZK combination |

**Total Potential:** ~$64,000

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
- Fast, flexible, low-cost infrastructure for encrypted computation via blockchain
- Decentralized network of MPC nodes (Arx nodes) executing on encrypted data
- Privacy guaranteed if at least 1 node is honest (dishonest majority model)

**Key Components:**

| Component | Purpose |
|-----------|---------|
| **MXE (Multi-Party Execution Environment)** | Core operational unit where computations execute |
| **Arcis** | Rust framework for writing MPC circuits |
| **Cerberus Protocol** | Security model with dishonest majority protection |
| **Arx Nodes** | Network nodes that process encrypted computations |

**MXE Types:**
- **Single-Use MXEs:** One-time computations, no state retention
- **Recurring MXEs:** Repeated computations with fresh inputs

**Execution Workflow:**
1. Client encrypts data and submits to MXE program
2. Program routes computation to Arcium's MPC node network
3. Nodes process encrypted data and return results
4. Optional callback servers handle larger outputs

**Encryption System:**
- Uses **Rescue cipher** (arithmetization-oriented symmetric encryption)
- **x25519 ECDH** key exchange between client and cluster
- 128-bit security for cipher, 256-bit for key derivation
- `Enc<Owner, T>` type system: `Shared` or `Mxe` ownership

**SDK Installation:**
```bash
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
```

**Prerequisites:**
- Rust
- Solana CLI 2.3.0
- Yarn
- Anchor 0.32.1
- Docker & Docker Compose

**Client Libraries:**
```bash
npm install @arcium-hq/client  # Encryption, submission, callbacks
npm install @arcium-hq/reader  # Read MXE data
```

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

**Transfer Types:**
- **Internal:** Both parties are ShadowWire users, amount fully hidden
- **External:** Amount visible but sender anonymous

**Proof Generation Options:**
- Backend processing (simpler, less private)
- Client-side WASM (2-3 seconds, full privacy)

**Key Features:**
- 17 supported tokens
- Wallet signature authentication required
- 1% relayer fee
- Audited smart contracts

**Integration:**
```typescript
import { ShadowWireClient } from '@radr/shadowwire';

const client = new ShadowWireClient();
const result = await client.transfer({
  sender: 'WALLET',
  recipient: 'RECIPIENT',
  amount: 0.5,
  token: 'SOL',
  type: 'internal'
});
```

**Potential Confidex Integration:**
- Could use ShadowWire for the token transfer layer
- Would complement Arcium's order matching
- Worth $15K in bounties if well-integrated

### 3.4 Inco Lightning (SVM)

**What Inco Lightning Is:**
- Confidential computing platform for Solana
- Rust SDK + JavaScript SDK
- Beta status, features subject to change

**Capabilities:**
- Private data types and operations
- Programmable access control
- Confidential Anchor programs

**Use Cases:** Payments, DeFi, governance, gaming

**Getting Started:**
- Quick Start Guide available
- Confidential Token Tutorial
- Rust Crate + JavaScript SDK

---

## 4. Architecture Decision Matrix

### Which Technologies for Which Layer?

| Layer | Original PRD | Recommended | Notes |
|-------|-------------|-------------|-------|
| **Compliance (ZK Proofs)** | Noir + Barretenberg | Noir + Sunspot/Groth16 | MUST change - Barretenberg won't work |
| **Execution (MPC)** | Arcium Cerberus | Arcium Cerberus | Correct as designed |
| **Settlement (Tokens)** | C-SPL | C-SPL OR ShadowWire | Consider ShadowWire for extra bounty |
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
3. **C-SPL vs ShadowWire:** Which is more mature/documented?
4. **Inco Integration:** Is it complementary or competing?

### First Steps to Build

1. Set up development environment ([confidex-dev-setup.md](confidex-dev-setup.md))
2. Clone and test `solana-foundation/noir-examples` (especially SMT Exclusion)
3. Register for Arcium testnet
4. Clone and test `arcium-hq/examples` (especially sealed-bid auction)
5. Create basic Anchor program structure

---

## 6. Key Resources

### Documentation
- **Arcium Docs:** https://docs.arcium.com/
- **Noir Docs:** https://noir-lang.org/docs
- **Helius Docs:** https://helius.dev
- **Inco SVM Docs:** https://docs.inco.org/svm

### Code Repositories
- **Sunspot:** https://github.com/reilabs/sunspot
- **Noir Examples:** https://github.com/solana-foundation/noir-examples
- **Arcium Examples:** https://github.com/arcium-hq/examples
- **ShadowWire:** https://github.com/Radrdotfun/ShadowWire
- **Awesome Privacy on Solana:** https://github.com/catmcgee/awesome-privacy-on-solana

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

## 8. Open Questions

1. **Proof Generation Location:**
   - Can Sunspot be compiled to WASM for client-side proving?
   - If not, how do we handle server-side proving without compromising privacy?

2. **C-SPL Availability:**
   - Is C-SPL on Arcium testnet ready for use?
   - What's the migration path from Token-2022 Confidential Extension?

3. **Order Matching Latency:**
   - What's the realistic latency for Arcium MPC operations?
   - Can we batch multiple price comparisons?

4. **Blacklist Management:**
   - Who maintains the Sparse Merkle Tree?
   - How often can the root be updated?

5. **Integration Complexity:**
   - How mature is Arcium testnet?
   - What's the fallback if MPC cluster is unavailable?

---

## 9. Next Steps

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
