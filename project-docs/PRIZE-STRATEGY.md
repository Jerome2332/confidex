# Confidex Prize Strategy

**Hackathon:** Solana Privacy Hack (January 2026)
**Project:** Confidex - Confidential DEX with Three-Layer Privacy Architecture
**Total Prize Pool Target:** ~$66,500

---

## Prize Positioning Matrix

| Sponsor | Prize Pool | Our Fit | Confidence | Priority |
|---------|------------|---------|------------|----------|
| **Arcium** | $10,000 | Excellent (RFP #1) | 98% | P0 |
| **Aztec/Noir** | $10,000 | Strong | 80% | P0 |
| **Open Track** | $18,000 | Excellent | 75% | P0 |
| **Radr Labs** | $15,000 | Strong (C-SPL fallback) | 65% | P1 |
| **Helius** | $5,000 | Strong | 85% | P1 |
| **Inco** | $6,000 | Medium (DeFi $2K) | 45% | P2 |
| **PNP Exchange** | $2,500 | Medium | 60% | P2 |

---

## Tier 0: Primary Targets (Must Win)

### 1. Arcium - $10,000

**Why We're Positioned to Win:**
- Confidex is literally the ideal Arcium use case: a confidential dark pool DEX
- Our architecture uses Arcium as the core execution layer (Layer 2)
- Direct alignment with Arcium's stated use case: "trustless dark pools, allowing participants to trade privately without revealing sensitive order details"

#### Arcium Request for Products (RFP) Alignment

Arcium published an official [Request for Products](https://www.arcium.com/articles/request-for-products) outlining what they want developers to build. **Confidex directly addresses their #1 DeFi priority:**

| RFP Category | Arcium's Request | Confidex Implementation |
|--------------|------------------|------------------------|
| **Dark Pools** | "Orders and balances remain hidden, execution is private" without MEV exposure. Notes "40-60% of US equity trading volume runs through dark pools" yet none exist on Solana. | **Direct match.** Core product is encrypted order matching with hidden prices/amounts via Cerberus MPC. |
| **Private Perpetuals** | "Encrypted perpetual futures where trader positions stay hidden until closure, preventing copy-trading, front-running, and targeted liquidations." | **Extensible.** Architecture supports perps as future feature. |
| **Blind Auctions** | Sealed-bid mechanisms where "bids remain encrypted until auction closure." | **Built-in.** Our order matching IS a continuous blind auction. |
| **C-SPL Payments** | Wrapping tokens into confidential versions where "balances and transaction amounts remain encrypted onchain." | **Direct match.** Layer 3 uses C-SPL for settlement. |

**Additional RFP Opportunities (Stretch Goals):**

| RFP Category | Description | Confidex Fit |
|--------------|-------------|--------------|
| Prediction Markets | Prevent whale manipulation via encrypted voting | PNP SDK integration candidate |
| Private Voting | "Every vote hidden until final tally" | Could add governance features |
| Private Lending | Hidden LTV ratios and liquidation checks | Future DeFi primitive |

**Key Quote from Arcium RFP:**
> "Dark Pools / Private Trading: Trading venues where orders and balances remain hidden, execution is private without MEV exposure."

**This is literally Confidex's mission statement.**

**Our Technical Implementation:**
```
Layer 2: Execution (Arcium MPC)
├── Encrypted price comparison: buy_price >= sell_price
├── Fill calculation: min(buy_remaining, sell_remaining)
├── Cerberus protocol (dishonest majority, strongest security)
└── MEV-protected order matching
```

**Differentiators:**
- Three-layer architecture (not just MPC, but ZK compliance + MPC execution + C-SPL settlement)
- Production-ready design with Cerberus protocol selection
- Integration with C-SPL for persistent encrypted balances

**Risk Factors:**
- C-SPL not yet live on devnet (may need fallback to custom encrypted storage)
- Competition from simpler Arcium demos

**Action Items:**
- [ ] Deploy working MXE program on devnet
- [ ] Demonstrate encrypted order matching
- [ ] Show end-to-end flow: order submission → MPC matching → settlement

---

### 2. Aztec/Noir - $10,000

**Prize Categories:**
1. Best Overall ZK App
2. "Eating Glass" (hardest technical challenge)
3. Most Creative Use

**Why We're Positioned to Win:**

**Best Overall:** We're using Noir for real-world compliance verification, not just a toy demo.

**Eating Glass:** We're combining:
- Noir ZK proofs (compliance layer)
- Groth16 via Sunspot (on-chain verification)
- Sparse Merkle Tree non-membership proofs (blacklist)
- Integration with MPC layer (novel combination)

**Most Creative:** ZK + MPC combination is genuinely novel—proving eligibility privately while also executing trades privately.

**Our Technical Implementation:**
```
Layer 1: Compliance (Noir ZK)
├── Eligibility Circuit
│   ├── Public input: blacklist_root (32 bytes)
│   └── Private inputs: address, merkle_path, path_indices
├── Sparse Merkle Tree verification
├── Poseidon hashing
└── Groth16 proof (via Sunspot) → ~200K compute units on-chain
```

**Key Insight:** Most projects use ZK OR MPC. We use ZK to prove facts (eligibility) and MPC to compute on encrypted data (order matching). This layered approach is architecturally unique.

**Risk Factors:**
- Sunspot WASM compilation unclear (may need server-side proving)
- SMT Exclusion circuit from noir-examples may need adaptation

**Action Items:**
- [ ] Adapt SMT Exclusion circuit for Confidex eligibility
- [ ] Test Sunspot end-to-end proof generation
- [ ] Deploy Groth16 verifier on devnet
- [ ] Document the "eating glass" challenges overcome

---

### 3. Open Track - $18,000

**Why We're Positioned to Win:**
- Novel MPC + ZK combination is exactly what open track rewards
- Three-layer architecture demonstrates deep technical understanding
- Real-world use case (dark pool DEX) with clear value proposition

**Our Unique Value Proposition:**
```
Privacy Problem                    → Our Solution
─────────────────────────────────────────────────────
Identity exposure                  → ZK eligibility proofs
Order information leakage          → MPC encrypted matching
Balance visibility                 → C-SPL encrypted tokens
MEV/front-running                  → All layers combined
```

**Narrative for Judges:**
"Confidex solves the DeFi privacy trilemma: compliance without identity exposure, execution without information leakage, and settlement without balance visibility. By layering Noir ZK proofs, Arcium MPC, and C-SPL tokens, we create the first truly confidential DEX on Solana."

**Risk Factors:**
- Larger prize = more competition
- May need polished demo/presentation

**Action Items:**
- [ ] Create compelling demo video
- [ ] Prepare architecture walkthrough
- [ ] Quantify privacy guarantees (what's hidden, from whom)

---

## Tier 1: Secondary Targets (Strong Fit)

### 4. Helius - $5,000

**Prize:** Best privacy project using Helius RPC

**Why We're Positioned:**
- Already planned to use Helius as RPC provider
- Helius webhooks for transaction confirmation
- Helius Photon for indexing

**Our Integration:**
```
External Services
├── Helius RPC (reliable devnet access)
├── Helius Webhooks (order confirmation notifications)
└── Helius Photon (encrypted order indexing)
```

**Easy Win Conditions:**
- Just need to use Helius SDK meaningfully
- Document the integration in submission

**Action Items:**
- [ ] Set up Helius RPC endpoint
- [ ] Implement webhook notifications for order fills
- [ ] Add Helius attribution in submission

---

### 5. Radr Labs (ShadowWire) - $15,000

**Prize:** Best integration with ShadowWire

**What ShadowWire Is:**
- TypeScript SDK for private Solana transfers using Bulletproofs ZK
- **Production-ready** with audited smart contracts
- 17 supported tokens (SOL, USDC, BONK, etc.)
- 1% relayer fee on all transfers

**Why Upgraded to Strong Fit:**
- Most mature privacy solution available (production, audited)
- Ready-to-use SDK with comprehensive documentation
- Strong fallback if C-SPL isn't ready in time
- Clear integration path for settlement layer

**Technical Fit Assessment:**

| Confidex Need | ShadowWire Capability | Fit |
|---------------|----------------------|-----|
| Private settlement | Internal transfers (amount hidden) | ✅ Direct |
| Token support | 17 tokens including SOL, USDC | ✅ Good |
| Client integration | Full TS SDK with wallet adapter | ✅ Easy |
| Proof generation | Client WASM (2-3s) or backend | ✅ Flexible |

**Integration Options:**

```
Option A: ShadowWire as Primary Settlement (Recommended if C-SPL delayed)
├── Layer 1: Noir ZK (compliance) - unchanged
├── Layer 2: Arcium MPC (order matching) - unchanged
└── Layer 3: ShadowWire (settlement) - REPLACE C-SPL
    ├── Users deposit to ShadowWire pools
    ├── DEX executes private transfers between pools
    └── Users withdraw anonymously

Option B: Anonymous Withdrawal Feature
├── Keep C-SPL for internal balances
├── Add ShadowWire for anonymous exit
└── "Withdraw privately to any wallet"

Option C: Dual Settlement (User Choice)
├── Option 1: C-SPL (on-chain encrypted balances)
├── Option 2: ShadowWire (pool-based transfers)
└── Different tradeoffs for different users
```

**Implementation Complexity:**

```typescript
// ShadowWire settlement integration
import { ShadowWireClient } from '@radr/shadowwire';
import { useWallet } from '@solana/wallet-adapter-react';

const client = new ShadowWireClient();
const { signMessage, publicKey } = useWallet();

// After Arcium MPC confirms trade match:
await client.transfer({
  sender: sellerPool,
  recipient: buyerPool,
  amount: tradeAmount,
  token: 'USDC',
  type: 'internal',
  wallet: { signMessage }
});
```

**Pros:**
- Production-ready (audited contracts)
- Existing liquidity pools and user base
- Well-documented SDK
- Client-side proof generation available

**Cons:**
- 1% relayer fee impacts DEX economics
- Different privacy model than Arcium (Bulletproofs vs MPC)
- Requires pool deposits (not direct wallet-to-wallet)
- Limited to 17 supported tokens

**Prize Strategy:**
- $15K is significant - worth serious consideration
- If C-SPL delayed, ShadowWire becomes primary settlement
- Even partial integration (anonymous withdrawals) could win
- Strong demo showing Arcium + ShadowWire combination

**Updated Confidence:** 65% (upgraded from 50%)
**Priority:** P1 (elevated from P2 consideration)

**Action Items:**
- [ ] Test ShadowWire SDK integration with wallet adapter
- [ ] Prototype deposit → trade → withdraw flow
- [ ] Measure 1% fee impact on DEX economics
- [ ] Decide: full settlement layer vs withdrawal-only feature
- [ ] Create demo showing private trade settlement

---

## Tier 2: Opportunistic Targets

### 6. Inco Lightning - $6,000

**Prize Tracks:**
- DeFi: $2,000
- Consumer, Gaming, Prediction Markets: $2,000
- Payments: $2,000

**What Inco Is:**
- TEE-based confidential computing (vs Arcium's MPC)
- Encrypted handles (128-bit references to off-chain encrypted data)
- Operations via CPI: `e_add`, `e_sub`, `e_ge`, `e_select`, etc.
- Covalidator network processes encrypted operations

**Why Upgraded to Medium Fit:**
- Inco's encrypted types (`Euint128`, `Ebool`) could store order amounts/prices
- Confidential SPL token pattern aligns with our settlement layer needs
- Simpler CPI-based operations (vs Arcium's MXE circuits)
- Could serve as C-SPL fallback if C-SPL isn't ready

**Potential Integration Paths:**

```
Option A: Hybrid Architecture (Recommended)
├── Layer 1: Noir ZK (compliance) - unchanged
├── Layer 2: Arcium MPC (order matching) - unchanged
└── Layer 3: Inco (encrypted balance storage) - NEW
    └── Use Euint128 for user balance tracking
    └── Complements C-SPL or replaces if unavailable

Option B: Dual Submission
├── Main: Confidex with Arcium (Arcium + Noir prizes)
└── Side: "Confidex-Inco" demo showing encrypted storage
    └── Minimal effort, targets DeFi $2K
```

**Technical Fit:**
| Confidex Need | Inco Capability |
|---------------|-----------------|
| Encrypted order amounts | `Euint128` handles |
| Price comparisons | `e_ge`, `e_gt`, `e_lt` operations |
| Conditional fills | `e_select` for branching |
| Balance privacy | Confidential SPL token pattern |

**Inco vs Arcium Trade-off:**
| Aspect | Inco | Arcium |
|--------|------|--------|
| Security | TEE trust | Cryptographic MPC |
| Complexity | Simpler (CPI) | Complex (circuits) |
| Maturity | Beta | Public testnet |
| Our Investment | Heavy (Arcium) | Light (none yet) |

**Revised Strategy:**
- **Primary:** Stay with Arcium for order matching (stronger security, already invested)
- **Stretch:** Add Inco for encrypted balance storage as C-SPL alternative
- **Minimum:** Mention Inco compatibility in architecture docs for DeFi track

**Action Items (if pursuing):**
- [ ] Create simple Inco-based encrypted balance demo
- [ ] Show `Euint128` storage for user positions
- [ ] Document as "alternative settlement layer"

**Confidence:** 45% (upgraded from 30%)
**Effort Required:** Medium (need to learn Inco SDK, build demo)
**Prize Target:** DeFi track ($2,000)

---

### 7. PNP Exchange - $2,500

**Prize:** Private prediction markets / AI agents

**Why Medium Fit:**
- PNP SDK is easy to integrate
- Could add prediction market functionality
- Privacy-focused tokens as collateral aligns with C-SPL

**Potential Feature:**
```
Confidex + PNP Integration
├── Trade on confidential DEX
├── Use C-SPL tokens as prediction market collateral
└── Private prediction markets with hidden positions
```

**Strategy:** Quick integration if time permits. Low effort, decent reward.

**Action Items:**
- [ ] Basic PNP SDK integration
- [ ] Create simple prediction market with C-SPL collateral
- [ ] Document privacy benefits

---

## Prize Combination Strategy

**Optimal Submission Path:**

```
Primary submission: "Confidex - Confidential DEX"
├── Arcium track: Core execution layer [$10K]
├── Noir track: Compliance layer [$10K]
├── Open track: Novel architecture [$18K]
└── Helius track: RPC infrastructure [$5K]

Total primary target: $43,000
```

**Stretch Goals:**
```
If time permits:
├── ShadowWire integration [$15K]
└── PNP prediction markets [$2.5K]

Stretch target: $17,500
```

**Maximum Theoretical:** $66,500
**Realistic Target:** $43,000 - $48,000

---

## Competitive Advantages

### 1. Direct RFP Alignment
Confidex is the **#1 product request** from Arcium's official Request for Products:
- Dark Pools listed as top DeFi priority
- They explicitly note "40-60% of US equity trading volume runs through dark pools" yet none exist on Solana
- We're building exactly what they asked for

### 2. Architecture Depth
Most hackathon projects use ONE privacy technology. We layer THREE:
- ZK (compliance) + MPC (execution) + Encrypted tokens (settlement)

### 3. Real-World Use Case
Dark pool DEX solves actual DeFi problems:
- MEV protection
- Information leakage prevention
- Regulatory compliance without KYC exposure

### 4. Technical Rigor
We've researched the correct approaches:
- Groth16 (not Barretenberg) for Solana verification
- Cerberus (not Manticore) for DEX security requirements
- Sparse Merkle Trees for efficient blacklist proofs

### 5. Production Readiness
Architecture diagram and documentation show we understand:
- Execution windows and timeouts
- Callback server requirements
- Pricing model implications

### 6. Multiple RFP Categories
Beyond dark pools, Confidex touches multiple Arcium RFP categories:
- Blind auctions (order matching is continuous blind auction)
- C-SPL integration (confidential token settlement)
- Extensible to private perpetuals and lending

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| C-SPL not ready | High | Fall back to Token-2022 Confidential Extension or ShadowWire |
| Sunspot WASM issues | Medium | Server-side proving with privacy disclosure |
| Arcium testnet instability | High | Pre-record demos, have backup cluster offsets |
| Time constraints | High | Prioritize P0 prizes, cut P2 features |

---

## Timeline Alignment

### Must Complete (P0 Prizes)
1. Noir eligibility circuit + Sunspot verifier
2. Arcium MXE for order matching
3. Basic frontend demonstrating flow
4. Helius integration

### Should Complete (P1 Prizes)
5. C-SPL or ShadowWire settlement
6. End-to-end demo video

### Nice to Have (P2 Prizes)
7. PNP SDK integration
8. Advanced matching algorithms

---

## Submission Checklist

- [ ] Working demo on Solana devnet
- [ ] Architecture documentation (confidex-architecture.md)
- [ ] Video walkthrough (2-3 minutes)
- [ ] GitHub repo with README
- [ ] Prize track declarations (Arcium, Noir, Open, Helius)
- [ ] Team information

---

*Last updated: January 2026*
