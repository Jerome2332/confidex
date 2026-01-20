# Confidex - Confidential DEX on Solana

<p align="center">
  <strong>The first privacy-preserving decentralized exchange on Solana</strong>
</p>

<p align="center">
  Built for <a href="https://solana.com/hackathon">Solana Privacy Hack 2026</a>
</p>

<p align="center">
  <a href="HACKATHON_SUBMISSION.md"><strong>Hackathon Submission</strong></a> |
  <a href="EATING_GLASS.md"><strong>Technical Challenges (Eating Glass)</strong></a> |
  <a href="project-docs/"><strong>Documentation</strong></a>
</p>

---

## Live Demo

| Resource | URL |
|----------|-----|
| **Frontend** | [https://frontend-humanoid-tech.vercel.app](https://frontend-humanoid-tech.vercel.app) |
| **DEX Program** | [`63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB`](https://explorer.solana.com/address/63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB?cluster=devnet) |
| **MXE Program** | [`DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM`](https://explorer.solana.com/address/DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM?cluster=devnet) |
| **ZK Verifier** | [`6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF`](https://explorer.solana.com/address/6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF?cluster=devnet) |

## Overview

Confidex is a confidential order book DEX that enables private trading on Solana. Unlike traditional DEXs where order details are public, Confidex keeps your trade amounts and prices encrypted throughout the entire lifecycle.

### Three-Layer Privacy Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Compliance** | Noir/Groth16 ZK Proofs | Proves eligibility without revealing identity |
| **Execution** | Arcium MPC | Encrypted order matching |
| **Settlement** | ShadowWire | Private token transfers |

## Features

### Spot Trading
- **Encrypted Orders**: Amount and price encrypted via Arcium MPC
- **ZK Compliance**: Groth16 proofs verify blacklist non-membership
- **Private Settlement**: Bulletproof-based transfers hide amounts
- **MEV Protection**: Orders invisible until matched
- **Institutional Ready**: Compliant trading with privacy

### Private Perpetuals (NEW)
- **Leveraged Positions**: 1-20x leverage with encrypted position data
- **Hybrid Privacy Model**: Core position data encrypted, liquidation thresholds public
- **Permissionless Liquidations**: MPC-verified thresholds enable liquidation without revealing position details
- **Funding Rate System**: 8-hour funding intervals with TWAP
- **Auto-Deleverage**: Insurance fund protection with ADL mechanism

## Quick Start

### Prerequisites

- Rust 1.89.0+
- Solana CLI 2.3.0+
- Anchor 0.32.1+
- Node.js 18+
- pnpm

### Installation

```bash
# Clone repository
git clone https://github.com/confidex-dex/confidex
cd confidex

# Install frontend dependencies
cd frontend && pnpm install

# Build Anchor programs
cd .. && anchor build
```

### Run Frontend

```bash
cd frontend
pnpm dev
```

Visit `http://localhost:3000` to access the trading interface.

### Run Demo

```bash
./scripts/demo.sh
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      USER INTERFACE                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Wallet  │  │  Trade   │  │   Order  │  │ Predict  │    │
│  │ Connect  │  │  Panel   │  │   Book   │  │ Markets  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PRIVACY LAYER 1: ZK                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          Noir Circuit (Groth16 via Sunspot)          │    │
│  │     SMT Non-Membership Proof for Blacklist Check     │    │
│  │              Proof Size: 388 bytes                   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  PRIVACY LAYER 2: MPC                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Arcium MXE (Cerberus Protocol)          │    │
│  │      Encrypted Price Comparison & Fill Calc          │    │
│  │          Values Never Revealed On-Chain              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                PRIVACY LAYER 3: SETTLEMENT                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │         ShadowWire (Bulletproof Transfers)           │    │
│  │          Private Token Transfer Execution            │    │
│  │             Amount Hidden via ZK Proof               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         SOLANA                               │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐               │
│  │ Confidex  │  │ Verifier  │  │  Arcium   │               │
│  │   DEX     │  │ (Sunspot) │  │  Adapter  │               │
│  └───────────┘  └───────────┘  └───────────┘               │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
confidex/
├── programs/
│   ├── confidex_dex/          # Core DEX program
│   │   ├── src/
│   │   │   ├── instructions/  # place_order, match, cancel
│   │   │   ├── state/         # Exchange, Pair, Order accounts
│   │   │   ├── cpi/           # Arcium, Verifier integrations
│   │   │   └── settlement/    # ShadowWire integration
│   │   └── Cargo.toml
│   └── arcium_mxe/            # MPC computation program
│
├── circuits/
│   └── eligibility/           # Noir ZK circuit
│       ├── src/main.nr
│       └── Nargo.toml
│
├── frontend/
│   ├── src/
│   │   ├── app/               # Next.js pages
│   │   ├── components/        # React components
│   │   ├── hooks/             # Custom hooks
│   │   ├── lib/               # Helius, PNP integrations
│   │   └── stores/            # Zustand state
│   └── package.json
│
├── backend/
│   └── src/                   # Proof generation server
│
├── tests/
│   └── integration/           # Integration tests
│
└── scripts/
    └── demo.sh                # Interactive demo
```

## Prize Track Integrations

### Arcium ($10K)
- C-SPL confidential token integration
- MPC order matching via Cerberus protocol
- Encrypted value comparison and fill calculation

### Aztec/Noir ($10K)
- Groth16 eligibility proofs via Sunspot verifier
- SMT non-membership circuit for blacklist check
- 388-byte proofs fit within Solana tx limits

### Open Track ($18K)
- Novel three-layer privacy architecture
- First confidential order book DEX on Solana
- Combines ZK, MPC, and private transfers

### Helius ($5K)
- Priority fee estimation for order transactions
- Webhooks for real-time order notifications
- DAS integration for token metadata

### Radr Labs ShadowWire ($15K)
- Bulletproof-based private settlement
- Internal transfers with hidden amounts
- Production-ready privacy layer

### PNP SDK ($2.5K)
- Prediction markets with confidential collateral
- Buy/sell outcome tokens privately
- Integrated trading interface

## Environment Variables

```env
# Frontend (.env.local)
NEXT_PUBLIC_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
NEXT_PUBLIC_MXE_PROGRAM_ID=DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM
NEXT_PUBLIC_VERIFIER_PROGRAM_ID=6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_HELIUS_API_KEY=your-helius-api-key
NEXT_PUBLIC_PROOF_SERVER_URL=http://localhost:3001

# Backend
PROOF_SERVER_PORT=3001
```

## Development

### Build Programs

```bash
anchor build
```

### Run Tests

```bash
# Anchor tests
anchor test

# Integration tests
cd tests && npx ts-node integration/full_trade_flow.ts
```

### Deploy to Devnet

```bash
anchor deploy --provider.cluster devnet
```

## Security Considerations

- **Proof Verification**: All ZK proofs verified on-chain via Sunspot
- **MPC Security**: Arcium uses dishonest majority model (Cerberus)
- **Key Management**: Ephemeral keys for encryption, wallet keys for signing
- **Blacklist Updates**: Authority-controlled merkle root updates

## Performance

| Operation | Target | Actual |
|-----------|--------|--------|
| ZK Proof Generation | < 3s | ~2.5s (client) |
| MPC Comparison | ~500ms | ~400ms |
| Order Placement | < 2s | ~1.5s |
| Proof Verification | ~200K CU | ~180K CU |

## Roadmap

- [x] Core DEX program
- [x] Noir eligibility circuit
- [x] Arcium MPC integration
- [x] ShadowWire settlement
- [x] Frontend trading interface
- [x] Helius RPC integration
- [x] PNP prediction markets
- [ ] Mainnet deployment
- [ ] Additional trading pairs
- [ ] Mobile app

## Contributing

Contributions welcome! Please read our contributing guidelines first.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Arcium](https://arcium.com) - MPC infrastructure
- [Aztec](https://aztec.network) - Noir language
- [Helius](https://helius.dev) - Enhanced RPC
- [Radr Labs](https://radr.fun) - ShadowWire protocol
- [PNP Exchange](https://pnp.exchange) - Prediction markets

---

<p align="center">
  Built with privacy in mind for the Solana ecosystem
</p>
