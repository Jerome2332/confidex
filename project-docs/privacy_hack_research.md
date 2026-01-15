# Solana Privacy Hack - Confidential DEX / Dark Pool Research & Roadmap

**Competition Dates:** January 12-30, 2026 (Submissions Due: Feb 1)
**Target Prizes:** Arcium ($10K) + Helius ($5K) + Open Track ($18K) = **$33K potential**

---

## 1. ARCIUM C-SPL TECHNICAL DEEP DIVE

### What is C-SPL (Confidential SPL Token)?

C-SPL is Arcium's new token standard that merges:
- SPL Token (original Solana token standard)
- Token-2022 (extended token program)
- Confidential Transfer Extension (native encrypted balances)
- Arcium's MPC-powered encrypted computing

### Key Problems C-SPL Solves

| Problem with Token-2022 | C-SPL Solution |
|------------------------|----------------|
| Only EOAs can control confidential accounts | Programs/PDAs can manage confidential balances via Arcium |
| Recipients must pre-create accounts | Senders can create accounts for recipients |
| No confidential DeFi possible | Full programmatic access to confidential state |
| Complex DevEx | Unified interface mimicking standard SPL |

### Architecture Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONFIDENTIAL SPL TOKEN                       │
├─────────────────────────────────────────────────────────────────┤
│  EXISTING PROGRAMS:                                              │
│  • SPL Token Program - public deposits/withdrawals               │
│  • Token-2022 + Confidential Transfer - basic encrypted          │
│  • Token Wrap Program - wrap any SPL → confidential              │
├─────────────────────────────────────────────────────────────────┤
│  NEW PROGRAMS (Arcium):                                          │
│  • Confidential Transfer Adapter - non-EOA support via MPC       │
│  • Confidential Auditor Adapter - programmable compliance        │
│  • Encrypted SPL Token - lightweight MPC-native accounts         │
│  • Confidential ATA Program - create accounts for third parties  │
└─────────────────────────────────────────────────────────────────┘
```

### How Confidential Transfers Work

1. **Deposit:** User deposits public SPL tokens → encrypted to confidential balance
2. **Transfer:** Encrypted balance transferred, amounts hidden using MPC
3. **Withdrawal:** Confidential balance → public tokens (amount revealed)

The encryption uses:
- **ElGamal encryption** for balance ciphertexts (Token-2022)
- **Arcium MPC** for program-controlled operations (C-SPL extension)
- **Zero-knowledge proofs** for validity without revealing amounts

### Arcium MPC Protocols

**Cerberus Protocol:**
- "Dishonest majority" model - privacy guaranteed if ≥1 node honest
- Cheating detection with identifiable termination
- Best for: High-security DeFi operations

**Manticore Protocol:**
- Optimized for AI/ML workloads
- Weaker security assumptions but faster
- Best for: High-throughput scenarios with trusted node sets

### Integration Points for Our DEX

```rust
// Conceptual flow for confidential swap
1. User wraps tokens to C-SPL format
2. User submits encrypted order (amount hidden via MPC)
3. DEX program receives encrypted order commitment
4. Arcium MXE matches orders on encrypted state
5. Settlement via Confidential Transfer Adapter
6. User can unwrap or keep confidential
```

---

## 2. DARKLAKE COMPETITOR ANALYSIS

### What Darklake Built

**Product: ZK-AMM (Blind Slippage Pool)**
- Live on mainnet (USDC-SOL, USDT-SOL pairs)
- Uses ZK proofs to hide slippage tolerance
- MEV protection by encrypting trade intent

**Technical Approach:**
- Custom proving scheme (Zyga Protocol)
- Polynomial commitments without full R1CS breakdown
- ~750 bytes per swap (3 EC points + partial proof + params)
- Sub-second proof verification

**How Blind Slippage Works:**
```
1. User submits swap with hidden slippage tolerance
2. System generates hash + encrypted value of transaction
3. Groth16 proof validates: result ≥ minimum acceptable output
4. If proof valid → execute; if not → rollback
```

**Darklake's Limitations:**
- Only hides slippage, not full order amounts
- AMM model (not order book)
- Building perp DEX next (pivoting from spot)
- No C-SPL integration (uses their own ZK stack)

### Differentiation Opportunities

| Darklake | Our Opportunity |
|----------|-----------------|
| ZK-only (slippage privacy) | Full confidential balances (C-SPL + MPC) |
| Custom proving scheme | Arcium's battle-tested MPC |
| AMM only | Could do limit orders / order book |
| Spot trading | Could target different use case |
| No auditor support | Built-in compliance via C-SPL |

### Key Insight

Darklake focuses on **pre-execution privacy** (hiding intent before tx confirms).
We can focus on **persistent confidentiality** (balances stay encrypted even after settlement).

---

## 3. NOIR + SUNSPOT ZK INTEGRATION

### Why Add Noir to Our Project?

Noir enables us to add ZK proofs for things Arcium MPC doesn't cover:
- **Identity/eligibility proofs** (prove you're allowed to trade without revealing who you are)
- **Membership proofs** (prove you're not on a blacklist)
- **Range proofs** (prove amount is within limits without revealing it)

### Technical Stack

```
Noir Circuit (main.nr)
    ↓ nargo compile
ACIR Bytecode (.json)
    ↓ sunspot compile
Gnark Constraint System (.ccs)
    ↓ sunspot setup
Proving Key (.pk) + Verifying Key (.vk)
    ↓ sunspot prove
Groth16 Proof (.proof)
    ↓ solana program deploy
On-chain Verifier Program (.so)
```

### Available Circuit Examples

| Circuit | Use Case | Proof Size |
|---------|----------|------------|
| `one` | Simple assertion | 324-388 bytes |
| `verify_signer` | ECDSA signature verification | ~388 bytes |
| `smt_exclusion` | Sparse Merkle Tree exclusion | 388 bytes |

### Relevant for Our DEX

**SMT Exclusion Proof:**
```noir
// Prove address is NOT on blacklist without revealing address
fn main(
    root: pub Field,           // Public: merkle root of blacklist
    address: Field,            // Private: user's address
    path: [Field; DEPTH],      // Private: merkle path
    directions: [bool; DEPTH]  // Private: path directions
) {
    // Verify non-membership proof
    assert(verify_non_membership(root, address, path, directions));
}
```

This lets users prove compliance without doxxing their wallet.

### Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIDENTIAL DEX                              │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Identity/Compliance (Noir ZK)                         │
│  • Non-blacklist proof                                          │
│  • Jurisdiction eligibility                                     │
│  • Accredited investor proof                                    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Confidential Execution (Arcium MPC)                   │
│  • Encrypted order matching                                     │
│  • Hidden amounts/prices                                        │
│  • MEV-resistant settlement                                     │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Token Layer (C-SPL)                                   │
│  • Confidential balances                                        │
│  • Program-controlled transfers                                 │
│  • Optional auditor access                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. HELIUS INTEGRATION

### Why Helius Matters

- **$5K bounty** for best privacy project using Helius tooling
- Helius provides the RPC infrastructure most Solana apps need anyway
- Their Photon indexer is THE standard for compressed state

### Helius Products to Use

| Product | Use In Our DEX |
|---------|----------------|
| **RPC Nodes** | Transaction submission, account queries |
| **Photon Indexer** | Index confidential transfer events |
| **DAS API** | Asset metadata (if we support NFTs/tokens) |
| **Webhooks** | Real-time order/trade notifications |
| **Priority Fee API** | Optimal fee estimation for fast settlement |

### Implementation

```typescript
import { Helius } from "helius-sdk";

const helius = new Helius("YOUR_API_KEY");

// Use Helius RPC for all Solana interactions
const connection = new Connection(helius.rpcUrl);

// Subscribe to confidential transfer events
helius.webhooks.create({
  accountAddresses: [DEX_PROGRAM_ID],
  transactionTypes: ["TRANSFER"],
  webhookURL: "https://your-backend/webhook"
});
```

### Photon for ZK Compression (Bonus)

If we use Light Protocol's ZK Compression (Open Track sponsor):
- Photon indexes compressed accounts
- Enables querying encrypted state efficiently
- Could dramatically reduce on-chain costs

---

## 5. DEVELOPMENT ROADMAP

### Phase 1: Foundation (Days 1-4)
**Jan 12-15**

- [ ] Set up development environment
  - Solana CLI, Anchor framework
  - Noir + Sunspot toolchain
  - Helius API keys
- [ ] Study Arcium testnet documentation
- [ ] Deploy basic C-SPL wrapper contract
- [ ] Create simple Noir circuit (eligibility proof)
- [ ] Test Helius RPC integration

**Deliverable:** Working dev environment with all tools integrated

### Phase 2: Core DEX Logic (Days 5-10)
**Jan 16-21**

- [ ] Design order structure (encrypted via MPC)
- [ ] Implement order submission flow
- [ ] Build matching engine logic
  - For hackathon: simple price-time priority
  - Encrypted comparisons via Arcium
- [ ] Implement settlement via Confidential Transfer Adapter
- [ ] Add basic compliance layer (Noir blacklist check)

**Deliverable:** Functional order matching on devnet

### Phase 3: Integration & Polish (Days 11-15)
**Jan 22-26**

- [ ] Build frontend UI
  - Wallet connection
  - Order placement
  - Position viewing
- [ ] Integrate Helius webhooks for real-time updates
- [ ] Add auditor functionality (optional compliance)
- [ ] Optimize proof generation times
- [ ] Deploy to devnet/mainnet

**Deliverable:** Demo-ready application

### Phase 4: Documentation & Submission (Days 16-18)
**Jan 27-30**

- [ ] Record 3-minute demo video
- [ ] Write technical documentation
- [ ] Open-source code on GitHub
- [ ] Prepare pitch for each bounty track
- [ ] Submit by Feb 1

---

## 6. TECHNICAL SPECIFICATIONS

### Order Structure

```rust
pub struct ConfidentialOrder {
    // Public fields
    pub maker: Pubkey,
    pub pair: TradingPair,
    pub side: Side,  // Buy or Sell
    pub order_type: OrderType,
    pub created_at: i64,
    
    // Encrypted fields (via Arcium MPC)
    pub encrypted_amount: EncryptedU64,
    pub encrypted_price: EncryptedU64,
    pub encrypted_min_fill: EncryptedU64,
    
    // ZK proof of eligibility
    pub eligibility_proof: Option<Groth16Proof>,
}
```

### Matching Algorithm (Simplified)

```
1. Receive new order with encrypted price/amount
2. Query open orders on opposite side
3. For each potential match:
   a. MPC comparison: new_price vs existing_price
   b. If match: calculate fill amount (encrypted)
   c. Execute Confidential Transfer
4. If unfilled portion: add to order book
```

### Smart Contract Architecture

```
┌─────────────────────────────────────────────┐
│           DEX Program (Anchor)              │
├─────────────────────────────────────────────┤
│  Instructions:                              │
│  • initialize_pool                          │
│  • place_order (with ZK eligibility proof)  │
│  • cancel_order                             │
│  • match_orders (via Arcium CPI)            │
│  • settle (via C-SPL CPI)                   │
│  • withdraw                                 │
├─────────────────────────────────────────────┤
│  CPIs to:                                   │
│  • Arcium Program (MPC operations)          │
│  • C-SPL Program (confidential transfers)   │
│  • Noir Verifier (eligibility proofs)       │
└─────────────────────────────────────────────┘
```

---

## 7. RISK ASSESSMENT & MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| C-SPL not ready for hackathon | Medium | High | Fall back to Token-2022 Confidential Extension |
| Arcium testnet issues | Medium | High | Have Darklake-style ZK-only backup |
| Proof generation too slow | Low | Medium | Pre-compute proofs, optimize circuits |
| Scope creep | High | Medium | Focus on core matching first, extras later |
| Integration complexity | High | Medium | Start with simplest flow, iterate |

---

## 8. SUBMISSION STRATEGY

### Bounty Targeting

**Primary: Arcium ($10K)**
- Full C-SPL integration
- Showcase encrypted order matching
- Emphasize institutional use case

**Secondary: Helius ($5K)**
- Document all Helius integrations
- Use Photon for indexing
- Leverage webhooks for UX

**Tertiary: Open Track ($18K)**
- Unique combination of MPC + ZK
- Novel dark pool mechanism
- Working product demo

### Demo Video Script (3 min)

```
0:00-0:30  Problem: MEV, front-running, no privacy in DeFi
0:30-1:00  Solution: Confidential DEX with hidden orders
1:00-2:00  Demo: Place order, show encryption, execute match
2:00-2:30  Technical: Arcium MPC + C-SPL + Noir ZK
2:30-3:00  Why it matters: Institutional adoption, compliance
```

---

## 9. RESOURCES & LINKS

### Documentation
- Arcium Docs: https://docs.arcium.com/
- C-SPL Article: https://www.arcium.com/articles/confidential-spl-token
- Noir Docs: https://noir-lang.org/docs/
- Sunspot Repo: https://github.com/reilabs/sunspot
- Noir-Solana Examples: https://github.com/solana-foundation/noir-examples
- Helius Docs: https://docs.helius.dev/

### Competitor Research
- Darklake: https://darklake.fi/ | https://docs.darklake.fi
- Darklake Blog: https://blog.darklake.fi
- HumidiFi (Dark AMM): Anonymous, routes through Jupiter
- Renegade (Arbitrum): MPC-based dark pool

### Hackathon Resources
- Privacy Hack Page: https://solana.com/privacyhack
- GitHub Examples: https://github.com/catmcgee/privacy-on-solana
- Workshops: Jan 12-16 (Noir, Arcium, Light Protocol, Confidential Transfers)

---

## 10. NEXT IMMEDIATE ACTIONS

1. **Today:** Join Arcium Discord, request testnet access
2. **Today:** Set up Helius account, get API keys
3. **Jan 12:** Attend opening ceremony, watch workshops
4. **Jan 13:** Complete Noir + Sunspot setup
5. **Jan 14:** Deploy first C-SPL test contract
6. **Jan 15:** Begin core DEX logic

---

*Document created: January 10, 2026*
*Competition starts: January 12, 2026*
*Time to prepare: 2 days*
