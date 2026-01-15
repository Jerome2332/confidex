# PRD-001: Confidex Master Project Overview

**Document ID:** PRD-001
**Version:** 1.1
**Date:** January 15, 2026
**Competition:** Solana Privacy Hack
**Target Bounties:** Arcium ($10K) + Noir ($10K) + Open Track ($18K) + Helius ($5K) + Radr Labs ($15K) + Inco ($6K) + PNP ($2.5K)
**Total Prize Pool Target:** ~$66,500 (Core: $43K)  

---

## 1. Executive Summary

### 1.1 Product Vision

**Confidex** is a confidential decentralized exchange built on Solana that enables private trading with hidden order amounts, prices, and balances. By combining Arcium's Multi-Party Computation (MPC) infrastructure with the new C-SPL (Confidential SPL Token) standard and Noir zero-knowledge proofs, Confidex provides institutional-grade privacy while maintaining regulatory compliance capabilities.

### 1.2 Problem Statement

| Problem | Impact |
|---------|--------|
| All DEX trades are publicly visible | Front-running and MEV extraction costs traders billions annually |
| Large orders move markets before execution | Institutions cannot trade without information leakage |
| Wallet balances are public | Trading patterns and strategies are exposed |
| Privacy solutions lack DeFi integration | Mixers face regulatory challenges, can't enable confidential DeFi |

### 1.3 Solution Overview

Confidex introduces a **three-layer privacy architecture**:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: COMPLIANCE (Noir ZK Proofs)                          │
│  • Prove eligibility without revealing identity                 │
│  • Blacklist exclusion proofs                                   │
│  • Jurisdiction verification                                    │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: EXECUTION (Arcium MPC)                               │
│  • Encrypted order matching                                     │
│  • Hidden amounts and prices                                    │
│  • MEV-resistant settlement                                     │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: SETTLEMENT (C-SPL Tokens)                            │
│  • Persistent encrypted balances                                │
│  • Program-controlled confidential accounts                     │
│  • Optional auditor access for compliance                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Target Market

### 2.1 Primary Users

| Segment | Use Case | Pain Point Solved |
|---------|----------|-------------------|
| **Institutional Traders** | Large block trades | No market impact, strategy protection |
| **DAOs** | Treasury management | Operational security, competitor blindness |
| **Market Makers** | Liquidity provision | MEV protection, inventory privacy |
| **HNW Individuals** | Portfolio rebalancing | Wealth privacy, front-run protection |

### 2.2 Market Opportunity

- Solana DEX volume: ~$2B daily
- Estimated MEV extraction: 0.1-0.5% of volume
- Institutional crypto adoption growing 40% YoY
- Privacy is #1 requested feature by institutional users

---

## 3. Product Architecture

### 3.1 System Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Smart Contracts** | Anchor (Rust) | Core DEX logic, order management |
| **Confidential Tokens** | C-SPL + Arcium MPC | Encrypted balances and transfers |
| **ZK Proofs** | Noir + Sunspot | Eligibility and compliance proofs |
| **Infrastructure** | Helius RPC + Photon | Indexing, webhooks, RPC |
| **Frontend** | Next.js + TypeScript | User interface |

### 3.2 Data Flow

```
User                    Confidex                 Arcium              Solana
  │                         │                         │                   │
  │─── 1. Wrap tokens ─────>│                         │                   │
  │                         │─── Convert to C-SPL ───────────────────────>│
  │                         │                         │                   │
  │─── 2. Generate ZK ─────>│                         │                   │
  │      proof (client)     │                         │                   │
  │                         │                         │                   │
  │─── 3. Place order ─────>│                         │                   │
  │    (encrypted + proof)  │─── Verify proof ───────────────────────────>│
  │                         │─── Encrypt order ──────>│                   │
  │                         │<── Encrypted params ────│                   │
  │                         │─── Store order ────────────────────────────>│
  │                         │                         │                   │
  │                         │─── 4. Match orders ────>│                   │
  │                         │    (MPC comparison)     │                   │
  │                         │<── Match result ────────│                   │
  │                         │                         │                   │
  │                         │─── 5. Settle ──────────────────────────────>│
  │                         │    (confidential transfer)                  │
  │<── 6. Confirmation ─────│                         │                   │
```

### 3.3 Security Model

| Mechanism | Security Guarantee |
|-----------|-------------------|
| **Arcium Cerberus** | Privacy if ≥1 MPC node honest (dishonest majority) |
| **Groth16 Proofs** | Cryptographically sound, no trusted setup leakage |
| **ElGamal Encryption** | Balance privacy based on discrete log hardness |
| **Optional Auditor** | Compliance without user privacy compromise |

---

## 4. Feature Requirements

### 4.1 MVP Features (Hackathon Scope)

| ID | Feature | Priority | Complexity | Status |
|----|---------|----------|------------|--------|
| F-001 | C-SPL Token Wrapping/Unwrapping | P0 | Medium | Planned |
| F-002 | Encrypted Order Submission | P0 | High | Planned |
| F-003 | Confidential Order Matching | P0 | High | Planned |
| F-004 | Private Settlement | P0 | High | Planned |
| F-005 | ZK Eligibility Verification | P1 | Medium | Planned |
| F-006 | Position/Balance Viewing | P1 | Low | Planned |
| F-007 | Basic Trading UI | P1 | Medium | Planned |

### 4.2 Post-MVP Features

- Limit order book with hidden depth
- Multi-asset pools
- Auditor dashboard for compliance
- API for programmatic trading
- Mobile wallet integration
- Advanced order types (stop-loss, etc.)

---

## 5. Technical Specifications

### 5.1 Supported Trading Pairs (Launch)

| Pair | Base Token | Quote Token |
|------|------------|-------------|
| SOL/USDC | SOL | USDC |
| SOL/USDT | SOL | USDT |

### 5.2 Order Types

| Type | Description | MVP |
|------|-------------|-----|
| Market | Execute immediately at best price | ✅ |
| Limit | Execute at specified price or better | ✅ |
| Stop-Limit | Trigger limit order at stop price | ❌ |

### 5.3 Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Order submission latency | < 2 seconds | Includes proof generation |
| Proof generation time | < 3 seconds | Server-side Sunspot |
| Settlement finality | < 1 slot (~400ms) | After matching |
| Concurrent orders | > 100 active | Per trading pair |

### 5.4 Dependencies

| Dependency | Version | Purpose | Risk |
|------------|---------|---------|------|
| Solana | 1.18+ | Blockchain runtime | Low |
| Anchor | 0.31+ | Smart contract framework | Low |
| Arcium SDK | Testnet | MPC operations | Medium |
| Noir | 1.0.0-beta.13 | ZK circuit language | Low |
| Sunspot | Latest | Solana ZK verifier | Low |
| Helius SDK | Latest | RPC and indexing | Low |

---

## 6. Development Timeline

### 6.1 Phase Overview

| Phase | Dates | Duration | Focus |
|-------|-------|----------|-------|
| **1: Foundation** | Jan 12-15 | 4 days | Environment, basic contracts |
| **2: Core Logic** | Jan 16-21 | 6 days | DEX logic, matching engine |
| **3: Integration** | Jan 22-26 | 5 days | Frontend, polish |
| **4: Submission** | Jan 27-30 | 4 days | Docs, demo, submit |

### 6.2 Milestones

| ID | Milestone | Date | Success Criteria |
|----|-----------|------|------------------|
| M1 | First C-SPL wrap | Jan 15 | Wrap/unwrap working on devnet |
| M2 | First encrypted order | Jan 18 | Order stored with encrypted params |
| M3 | First matched trade | Jan 21 | Two orders matched and settled |
| M4 | Frontend demo | Jan 26 | Complete user flow working |
| M5 | Submission ready | Jan 30 | Video, docs, code complete |

### 6.3 Daily Schedule (Recommended)

```
Week 1 (Jan 12-18):
├── Day 1-2: Environment setup, Arcium testnet access
├── Day 3-4: C-SPL wrapper contract
├── Day 5-6: Order submission with encryption
└── Day 7: Noir circuit for eligibility

Week 2 (Jan 19-25):
├── Day 8-9: Matching engine implementation
├── Day 10-11: Settlement integration
├── Day 12-13: Frontend development
└── Day 14: Integration testing

Week 3 (Jan 26-30):
├── Day 15-16: Polish and bug fixes
├── Day 17: Demo video recording
├── Day 18: Documentation
└── Day 19: Final submission
```

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| C-SPL SDK not ready | Medium | High | Fall back to Token-2022 Confidential Extension |
| Arcium testnet issues | Medium | High | Have ZK-only backup approach |
| Proof generation slow | Low | Medium | Pre-compute proofs, optimize circuits |
| Scope creep | High | Medium | Strict MVP focus, defer extras |
| Integration complexity | High | Medium | Start simple, iterate |
| Time constraints | High | High | Prioritize ruthlessly |

---

## 8. Success Metrics

### 8.1 Hackathon Success Criteria

- [ ] Working demo of confidential trade execution
- [ ] Integration with ≥2 sponsor technologies (Arcium, Helius)
- [ ] 3-minute demo video showcasing key features
- [ ] Open-source codebase with documentation
- [ ] Deployed to Solana devnet

### 8.2 Prize Strategy

| Bounty | Prize | Our Angle | Confidence | Priority |
|--------|-------|-----------|------------|----------|
| **Arcium** | $10,000 | Full C-SPL integration, encrypted matching (RFP #1) | 98% | P0 |
| **Aztec/Noir** | $10,000 | Groth16 eligibility proofs via Sunspot | 80% | P0 |
| **Open Track** | $18,000 | Novel MPC + ZK three-layer architecture | 75% | P0 |
| **Helius** | $5,000 | RPC, webhooks, Photon indexing | 85% | P1 |
| **Radr Labs** | $15,000 | ShadowWire settlement integration | 65% | P1 |
| **Inco** | $6,000 | DeFi track - document compatibility | 45% | P2 |
| **PNP Exchange** | $2,500 | Prediction markets with C-SPL collateral | 60% | P2 |
| **Total Potential** | **$66,500** | | |

**Core Target (P0 + Helius):** $43,000

---

## 9. Related Documents

| Document | ID | Description |
|----------|-----|-------------|
| Smart Contract Architecture | PRD-002 | Programs, accounts, instructions |
| Cryptographic Infrastructure | PRD-003 | MPC, ZK proofs, encryption |
| Frontend & UX | PRD-004 | UI/UX specifications |
| Integration Specifications | PRD-005 | External service integrations |

---

## 10. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 10, 2026 | Zac | Initial document |
