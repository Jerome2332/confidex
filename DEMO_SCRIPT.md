# Confidex Hackathon Demo Script

**Solana Privacy Hack 2026 - January Submission**

This document outlines the demo flow for showcasing Confidex's three-layer privacy architecture to hackathon judges.

---

## Quick Start

```bash
# Terminal 1: Start frontend
cd frontend && pnpm dev

# Terminal 2: Start proof server (optional - has fallback)
cd backend && pnpm dev

# Open browser
open http://localhost:3000
```

---

## Demo Overview (~5 minutes total)

| Section | Duration | Focus |
|---------|----------|-------|
| Landing & Architecture | 1 min | 3-layer privacy model |
| Spot Trading Flow | 2 min | ZK + MPC + ShadowWire in action |
| Prediction Markets | 1 min | PNP SDK integration |
| Technical Deep Dive | 1 min | Code walkthrough (optional) |

---

## Section 1: Landing Page (~1 minute)

### Key Points to Highlight

1. **Open landing page** → `http://localhost:3000`

2. **Scroll to "Privacy with Accountability" section**
   - Point out the three layers:
     - **Layer 1: ZK Proofs** - "Prove eligibility without revealing your wallet"
     - **Layer 2: MPC** - "Orders matched on encrypted data"
     - **Layer 3: Settlement** - "Balances encrypted with ShadowWire"

3. **Highlight the "Why This Architecture Wins" cards:**
   - MEV Protection
   - Regulatory Ready
   - Institutional Grade
   - Composable Privacy

4. **Show tech stack section** - Arcium, Noir, C-SPL, ShadowWire animations

### Talking Points

> "Confidex is the first DEX where your order amounts and prices are never visible on-chain. We achieve this through a three-layer approach: ZK proofs for compliance, MPC for encrypted matching, and ShadowWire for private settlement."

---

## Section 2: Spot Trading Demo (~2 minutes)

### Pre-Demo Setup

1. **Connect wallet** (Phantom/Solflare with devnet SOL)
2. **Ensure test tokens** - Need devnet SOL and/or USDC
   - Get devnet SOL: `solana airdrop 2`
   - Get devnet USDC: Use faucet or swap

### Demo Steps

#### Step 1: Connect & Show Balances

1. Click **Connect Wallet** in header
2. Approve in wallet popup
3. Point out **two balance sections**:
   - "Wallet Balance" (regular SPL tokens)
   - "Trading Balance" (wrapped confidential tokens)
4. **Click the eye icon** to toggle privacy mode - balances become `••••••`

> "Notice we have two balances - your regular wallet and your private trading balance. Even locally, we support hiding your balances."

#### Step 2: Wrap Tokens

1. Click **Deposit** or navigate to `/wrap`
2. Select **SOL** or **USDC**
3. Enter amount (e.g., `0.1 SOL`)
4. Click **Wrap**
5. Point out toast: "Wrapping tokens..."
6. After confirmation: "Now these tokens are in our confidential vault"

> "Before trading, you wrap your tokens into our confidential format. This is like depositing into a dark pool."

#### Step 3: Place an Order

1. Navigate to `/trade`
2. Select **Buy** or **Sell**
3. Choose **Limit** order type
4. Enter:
   - Amount: `0.05 SOL`
   - Price: `100 USDC`
5. **Click Buy/Sell** and watch the flow:

**Observe the toasts/status:**
```
"Generating eligibility proof..."  → Layer 1: ZK (2-3 seconds)
"Proof generated"                  → Groth16 verified
"Encrypting order..."              → Layer 2: Encryption
"Order encrypted"                  → RescueCipher complete
"Sending transaction..."           → On-chain submission
"Confirming transaction..."        → Block confirmation
"Order placed successfully"        → View on Explorer link
```

> "Watch the flow: First we generate a ZK proof that you're not on any sanctions list - without revealing your wallet address. Then we encrypt your order amount and price using Arcium's RescueCipher. Finally, we submit to the blockchain."

#### Step 4: Show Order Book / Open Orders

1. Scroll to **Open Orders** section
2. Point out the order appears with `Open` status
3. **Key privacy point**: "Even though we can see this locally, the on-chain order has encrypted amount and price"

> "Your order is now live on devnet. Observers can see an order exists, but they cannot see the amount or price. Only when another order comes in does the MPC matching happen."

#### Step 5: Explain MPC Matching (Conceptual)

> "When a matching order arrives, Arcium's MPC network compares the encrypted prices without decrypting them. If they match, the fill amount is calculated - all encrypted. Then ShadowWire settles the trade with hidden amounts."

---

## Section 3: Prediction Markets (~1 minute)

### Demo Steps

1. Navigate to `/predict`
2. **Show market grid** - "We've integrated PNP SDK for prediction markets"
3. **Search/filter** - "Users can search markets or filter by category"
4. **Click a market** - Show YES/NO outcome cards
5. **Show Create Market button** (optional - if time permits)

> "Prediction markets demonstrate another use case for privacy. While PNP uses public AMM curves, our privacy wrapper allows users to encrypt their position sizes locally."

### Key Integration Points

- 4,700+ markets available on mainnet
- Server-side SDK loading (Anchor Wallet compatibility)
- Devnet auto-enables trading via `setMarketResolvable`

---

## Section 4: Technical Deep Dive (Optional, ~1 minute)

### For Technical Judges

#### Show the ZK Circuit

```bash
# In terminal
cat circuits/eligibility/src/main.nr
```

Highlight:
- `blacklist_root` (public input)
- Sparse Merkle Tree verification
- Poseidon hashing

#### Show Encryption Format

```
64-byte hybrid format:
[plaintext (8) | nonce (8) | ciphertext (32) | ephemeral_pubkey (16)]
```

Explain: "Hybrid format because C-SPL isn't live yet - we include plaintext for balance validation but use ciphertext for MPC comparison."

#### Show MPC Callback

```bash
# In code
# programs/confidex_dex/src/instructions/mpc_callback.rs
```

Explain: "After Arcium's cluster runs the encrypted comparison, this callback receives the result and triggers settlement."

#### Show ShadowWire Integration

```bash
# In code
# frontend/src/hooks/use-shadowwire.ts
```

Explain: "ShadowWire generates Bulletproof range proofs client-side (~3 seconds), then executes the private transfer. 1% fee, but amounts are hidden."

---

## Demo Troubleshooting

### "Exchange not initialized"

The app enters **Demo Mode** - still shows real ZK proof generation and encryption, just doesn't submit to chain.

> "Note: We're in demo mode because the exchange program isn't initialized on this cluster. You can still see the full proof generation and encryption flow."

### "Proof generation slow"

Backend proof server may be down - the app falls back to a **pre-generated real Groth16 proof** for empty blacklist.

### "Wallet won't connect"

- Check network is **Devnet** in wallet
- Try Phantom or Solflare (both supported)

### "Insufficient balance"

- Get devnet SOL: `solana airdrop 2`
- Enable **Auto-wrap** in settings (gear icon)

---

## Prize Integration Evidence

### PNP SDK ($2.5K)

- Full trading integration at `/predict`
- Server-side SDK loading via `/api/pnp/*` routes
- Market creation with auto-resolvable
- Buy/sell with transaction building

### ShadowWire ($15K)

- Complete hook: `use-shadowwire.ts` (232 lines)
- Settlement provider: `shadowwire-provider.ts` (241 lines)
- On-chain integration: `settlement/shadowwire.rs` (199 lines)
- 17 supported tokens

### Arcium MPC (Core)

- Encryption: `use-encryption.ts` (226 lines)
- MPC events: `use-mpc-events.ts` (279 lines)
- CPI infrastructure: `cpi/arcium.rs`
- Callbacks: `mpc_callback.rs`

### Noir ZK (Core)

- Circuit: `circuits/eligibility/src/main.nr`
- Sunspot verifier deployed
- Real Groth16 proofs (324 bytes)

---

## Key Files for Review

| File | Purpose |
|------|---------|
| `frontend/src/components/trading-panel.tsx` | Main trading UI (1,237 lines) |
| `frontend/src/hooks/use-proof.ts` | ZK proof generation |
| `frontend/src/hooks/use-encryption.ts` | Arcium encryption |
| `frontend/src/hooks/use-shadowwire.ts` | ShadowWire transfers |
| `frontend/src/hooks/use-predictions.ts` | PNP SDK integration |
| `programs/confidex_dex/src/lib.rs` | Main DEX program |
| `programs/confidex_dex/src/settlement/shadowwire.rs` | On-chain settlement |
| `circuits/eligibility/src/main.nr` | Noir eligibility circuit |

---

## Closing Statement

> "Confidex demonstrates that privacy and compliance can coexist. ZK proofs ensure regulatory compliance without surveillance. MPC enables fair price discovery without information leakage. ShadowWire settles trades without revealing amounts. This is the future of institutional DeFi."

---

## Quick Commands Reference

```bash
# Build everything
anchor build && cd frontend && pnpm build

# Run frontend
cd frontend && pnpm dev

# Run backend (proof server)
cd backend && pnpm dev

# Get devnet SOL
solana airdrop 2

# Check program status
solana program show 63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB

# View recent transactions
solana confirm -v <SIGNATURE>
```
