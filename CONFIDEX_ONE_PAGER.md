# Confidex

**Confidential Trading Infrastructure for Solana**

---

## The Problem

Every trade on a decentralized exchange is publicly visible. Order amounts, prices, wallet balances, and trading strategies are broadcast to the world in real-time. This transparency enables front-running, MEV extraction, and information leakage that costs traders billions annually. Institutions, DAOs, and professional market makers cannot operate on-chain without exposing their entire playbook.

**Solana DEX volume exceeds $2B daily. Estimated MEV extraction: 0.1-0.5% of that volume.**

---

## The Solution

Confidex is a production-deployed confidential decentralized exchange on Solana with a three-layer cryptographic privacy architecture:

| Layer | Technology | What It Does |
|-------|------------|--------------|
| **Verification** | Zero-Knowledge Proofs (Groth16) | Proves trader eligibility without revealing identity. Blacklist/sanctions compliance without KYC exposure. |
| **Execution** | Multi-Party Computation (Arcium Cerberus) | All order data -- price, quantity, side, trader identity -- is encrypted. Matching happens inside MPC. No plaintext ever touches the blockchain. |
| **Settlement** | ShadowWire (Bulletproof ZK) | Private token transfers with hidden amounts. Settlement events contain order IDs, never values. |

**Result:** A fully functional DEX where no observer -- including validators, block explorers, or MEV bots -- can see what is being traded, at what price, or for how much.

---

## What We Have Built

| Capability | Status | Details |
|------------|--------|---------|
| Encrypted spot trading | Live (devnet) | Limit and market orders with fully encrypted order books |
| Encrypted perpetuals | Live (devnet) | Hidden positions, encrypted collateral, private PnL |
| Automated crank service | Running 24/7 | Order matching, MPC polling, settlement execution, liquidation checks |
| ZK wallet verification | Active | 324-byte Groth16 proofs, 24-hour cached sessions, real-time invalidation |
| Batch liquidations | Operational | 10 positions per MPC batch, public thresholds with private collateral |
| Real-time streaming | Complete | WebSocket infrastructure, Pyth oracle integration, event broadcasting |
| MEV protection | Integrated | Jito bundle submission for settlement transactions |

**All MPC operations use real Arcium cluster computation -- nothing is simulated.**

---

## Architecture

```
User  -->  Frontend (Next.js)  -->  Solana Programs (Anchor/Rust)
               |                            |
          Encrypt order               Store encrypted state
          Generate ZK proof                 |
               |                            v
               +---------->  Arcium MPC Cluster (Cerberus)
                                    |
                              Decrypt in MPC
                              Match orders
                              Return encrypted result
                                    |
                                    v
                             ShadowWire Settlement
                              (Bulletproof private transfers)
```

**6 on-chain programs deployed.** 19 MPC circuits active (6 spot, 13 perpetuals). Backend crank with circuit breaker protection, distributed locking, error classification, and retry logic.

---

## Technical Depth

- **Encryption:** X25519 key exchange + Rescue sponge cipher producing uniform 32-byte ciphertexts (indistinguishable regardless of underlying value)
- **ZK Proofs:** Noir circuits compiled to Groth16 via Sunspot. Sparse Merkle Tree non-membership proofs over Poseidon2 hashes (depth 20, supporting ~1M addresses)
- **MPC Security:** Arcium Cerberus protocol -- privacy guaranteed if at least 1 of N nodes is honest (dishonest majority tolerant)
- **Test Coverage:** 80+ test cases across backend, 80%+ backend coverage, E2E suites covering order flow, perpetuals, liquidation, settlement, and margin operations

---

## Market Position

| | Confidex | Standard DEXs | Mixer-based Privacy |
|---|---|---|---|
| Order privacy | Full (MPC encrypted) | None | N/A |
| Settlement privacy | Bulletproof hidden amounts | Public | Obfuscated but detectable |
| Compliance | ZK eligibility proofs | Public wallets | No compliance path |
| Trading features | Spot + Perpetuals | Full featured | No trading |
| Regulatory path | Built-in (optional auditor access) | N/A | Adversarial |

**Confidex is the only project on Solana combining MPC-encrypted execution with ZK compliance and private settlement into a functioning DEX.**

---

## Roadmap

| Timeline | Milestone |
|----------|-----------|
| **Delivered** | Encrypted spot + perps, ZK verification, crank automation, streaming infrastructure |
| **Q1 2026** | C-SPL token integration (native Solana confidential tokens), analytics dashboard, admin monitoring |
| **Q2 2026** | Advanced order types (stop-loss, OCO, trailing stops), institutional API (REST + WebSocket + FIX), mobile app prototype |
| **Q3 2026** | Enhanced ZK circuits (range proofs, solvency proofs, KYC attestation), performance optimization |
| **Q4 2026+** | Cross-chain privacy bridge, governance/DAO, token launch |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Blockchain | Solana, Anchor 0.32.1 |
| MPC | Arcium v0.6.3 (Cerberus protocol) |
| ZK Proofs | Noir 1.0.0-beta.13, Sunspot Groth16 |
| Settlement | ShadowWire (Bulletproof) |
| Frontend | Next.js 14, TypeScript, Tailwind |
| Backend | Express, SQLite, Socket.IO |
| Infrastructure | Render (Docker), Pyth oracle, Jito MEV protection |

---

## Why This Matters for an Acquirer

**Privacy is the missing infrastructure layer for institutional DeFi.** Confidex is not a wrapper or an abstraction -- it is a ground-up implementation of encrypted trading that solves the fundamental transparency problem of on-chain markets.

- **Deep technical moat:** Three independent cryptographic layers, 19 MPC circuits, real ZK proof infrastructure. This is not trivially replicable.
- **Production code, not a prototype:** 24/7 automated services, versioned account schemas, circuit breaker protection, comprehensive test coverage.
- **Composable architecture:** The encryption, MPC, and settlement layers are modular. They can be integrated into existing DEX infrastructure or extended to new asset classes.
- **Regulatory alignment:** ZK eligibility proofs provide a compliance path that mixers and privacy coins cannot offer. Optional auditor access enables institutional adoption without compromising user privacy.
- **First-mover on Solana privacy DeFi:** Built during the Solana Privacy Hack, leveraging the earliest access to Arcium's MPC infrastructure and Noir/Sunspot ZK tooling.

---

**Live:** [confidex.xyz](https://www.confidex.xyz) | **Backend:** Running on Render | **Programs:** Deployed on Solana devnet
