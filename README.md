# Confidex - Confidential DEX on Solana

<p align="center">
  <strong>The first privacy-preserving decentralized exchange on Solana</strong>
</p>

<p align="center">
  Built for <a href="https://solana.com/hackathon">Solana Privacy Hack 2026</a>
</p>

<p align="center">
  <a href="HACKATHON_SUBMISSION.md"><strong>Hackathon Submission</strong></a> |
  <a href="EATING_GLASS.md"><strong>Technical Challenges</strong></a> |
  <a href="CLAUDE.md"><strong>Developer Guide</strong></a> |
  <a href="project-docs/"><strong>Documentation</strong></a>
</p>

---

## Live Demo

| Resource | URL | Status |
|----------|-----|--------|
| **Frontend** | [https://www.confidex.xyz](https://www.confidex.xyz) | Live |
| **Backend API** | [https://confidex-uflk.onrender.com](https://confidex-uflk.onrender.com) | Live |
| **DEX Program** | [`63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB`](https://explorer.solana.com/address/63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB?cluster=devnet) | Deployed |
| **MXE Program** | [`4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi`](https://explorer.solana.com/address/4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi?cluster=devnet) | Deployed |
| **ZK Verifier** | [`9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W`](https://explorer.solana.com/address/9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W?cluster=devnet) | Deployed |
| **Arcium Core** | [`Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ`](https://explorer.solana.com/address/Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ?cluster=devnet) | Active |

### Backend Services (Running 24/7)

| Service | Description | Status |
|---------|-------------|--------|
| **Crank Service** | Automated order matching with 5s polling | Running |
| **MPC Poller** | Real Arcium MPC (not simulated) | Running |
| **Settlement Executor** | Dual settlement (ShadowWire + C-SPL) | Running |
| **Position Verifier** | V6 perpetual position verification | Running |
| **Liquidation Checker** | Batch liquidation (10 positions/batch) | Running |
| **Margin Processor** | Async margin add/remove with MPC | Running |
| **WebSocket Server** | Real-time streaming via Socket.IO | Running |
| **Pyth Oracle** | Price streaming via Hermes SSE | Running |

### Token Mints (Devnet)

| Token | Address |
|-------|---------|
| Wrapped SOL | `So11111111111111111111111111111111111111112` |
| Dummy USDC | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` |

## Overview

Confidex is a confidential order book DEX that enables private trading on Solana. Unlike traditional DEXs where order details are public, Confidex keeps your trade amounts and prices encrypted throughout the entire lifecycle.

### Four-Layer Privacy Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Compliance** | Noir/Groth16 ZK Proofs (via Sunspot) | Proves eligibility without revealing identity |
| **Execution** | Arcium MPC (Cerberus protocol) | Encrypted order matching |
| **Storage** | Light Protocol ZK Compression | Rent-free compressed accounts (~5000x cheaper) |
| **Settlement** | ShadowWire (Bulletproof) | Private token transfers with hidden amounts |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Developer guide with critical rules and patterns |
| [project-docs/ARCHITECTURE.md](project-docs/ARCHITECTURE.md) | Detailed system architecture (88KB) |
| [project-docs/ARCIUM_MPC_INTEGRATION.md](project-docs/ARCIUM_MPC_INTEGRATION.md) | MPC integration guide |
| [project-docs/implementation/STREAMING_IMPLEMENTATION.md](project-docs/implementation/STREAMING_IMPLEMENTATION.md) | Real-time streaming infrastructure |
| [project-docs/dev-setup.md](project-docs/dev-setup.md) | Full development setup |
| [project-docs/deployment/DEPLOYMENT.md](project-docs/deployment/DEPLOYMENT.md) | Production deployment guide |
| [project-docs/arcium/](project-docs/arcium/) | Arcium documentation (9 guides) |

## Features

### Spot Trading
- **Encrypted Orders**: Amount and price encrypted via Arcium MPC
- **ZK Compliance**: Groth16 proofs verify blacklist non-membership
- **Private Settlement**: Bulletproof-based transfers hide amounts
- **MEV Protection**: Orders invisible until matched
- **Institutional Ready**: Compliant trading with privacy
- **Real-Time Updates**: WebSocket streaming for instant order/trade notifications

### Private Perpetuals (NEW)
- **Leveraged Positions**: 1-20x leverage with encrypted position data
- **Hybrid Privacy Model**: Core position data encrypted, liquidation thresholds public
- **Permissionless Liquidations**: MPC-verified thresholds enable liquidation without revealing position details
- **Funding Rate System**: 8-hour funding intervals with TWAP
- **Auto-Deleverage**: Insurance fund protection with ADL mechanism

## Quick Start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | **1.89.0** | Required for Arcium v0.6.3 |
| Solana CLI | 2.3.0+ | |
| Anchor | 0.32.1 | |
| Noir | **1.0.0-beta.13** | Locked for Sunspot compatibility |
| Node.js | 18+ | |
| pnpm | 8+ | |

### Installation

```bash
# Clone repository
git clone https://github.com/confidex-dex/confidex
cd confidex

# Install all dependencies
cd frontend && pnpm install && cd ..
cd backend && pnpm install && cd ..

# Build Anchor programs
anchor build
```

### Build ZK Circuits (Optional)

```bash
cd circuits/eligibility
nargo build
sunspot compile target/eligibility.json
sunspot setup target/eligibility.ccs
```

### Run Services

```bash
# Terminal 1: Frontend
cd frontend && pnpm dev

# Terminal 2: Backend with Crank (order matching)
cd backend && pnpm dev
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
│                 PRIVACY LAYER 1: COMPLIANCE                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          Noir Circuit (Groth16 via Sunspot)          │    │
│  │     SMT Non-Membership Proof for Blacklist Check     │    │
│  │              Proof Size: 324 bytes                   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  PRIVACY LAYER 2: EXECUTION                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Arcium MXE (Cerberus Protocol)          │    │
│  │      Encrypted Price Comparison & Fill Calc          │    │
│  │          Values Never Revealed On-Chain              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   PRIVACY LAYER 3: STORAGE                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Light Protocol ZK Compression              │    │
│  │       Rent-Free Accounts (~5000x Cheaper)            │    │
│  │            Optional Compressed Storage               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 PRIVACY LAYER 4: SETTLEMENT                  │
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
│   └── confidex_dex/           # Core DEX program (Rust/Anchor)
│       ├── src/
│       │   ├── instructions/   # place_order, match, cancel, settle
│       │   ├── state/          # Exchange, Pair, Order, Position
│       │   ├── cpi/            # Arcium, Verifier integrations
│       │   └── settlement/     # ShadowWire integration
│       └── Cargo.toml
│
├── arcium-mxe/                 # Arcium MPC integration
│   ├── encrypted-ixs/          # Arcis MPC circuits
│   └── programs/confidex_mxe/  # MXE wrapper program
│
├── circuits/
│   └── eligibility/            # Noir ZK circuit (Groth16)
│       └── src/main.nr
│
├── frontend/                   # Next.js 14 application
│   ├── src/
│   │   ├── app/                # Pages and routes
│   │   ├── components/         # Trading panel, order book, etc.
│   │   ├── hooks/              # useEncryption, useMpcEvents
│   │   ├── lib/                # Clients, constants
│   │   └── stores/             # Zustand state
│   └── scripts/                # Devnet utilities
│
├── backend/                    # Express + Crank service
│   └── src/
│       └── crank/              # Order matching automation
│           ├── match-executor.ts
│           └── mpc-poller.ts
│
├── project-docs/               # Detailed documentation
│   └── arcium/                 # Arcium integration guides
│
└── tests/
    ├── e2e/                    # End-to-end tests
    └── integration/            # Integration tests
```

## Prize Track Integrations

### Arcium ($10K)
- C-SPL confidential token integration
- MPC order matching via Cerberus protocol
- Encrypted value comparison and fill calculation

### Aztec/Noir ($10K)
- Groth16 eligibility proofs via Sunspot verifier
- SMT non-membership circuit for blacklist check
- 324-byte proofs fit within Solana tx limits

### Open Track ($18K)
- Novel four-layer privacy architecture
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

### Frontend (.env.local)

```env
# Program IDs (Devnet)
NEXT_PUBLIC_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
NEXT_PUBLIC_MXE_PROGRAM_ID=4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi
NEXT_PUBLIC_VERIFIER_PROGRAM_ID=9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W

# MPC Encryption (Required)
NEXT_PUBLIC_MXE_X25519_PUBKEY=113364f169338f3fa0d1e76bf2ba71d40aff857dd5f707f1ea2abdaf52e2d06c

# RPC
HELIUS_API_KEY=your-helius-api-key

# Feature Flags
NEXT_PUBLIC_LIGHT_PROTOCOL_ENABLED=true
```

### Backend (.env)

```env
# Crank Service
CRANK_ENABLED=true
CRANK_USE_REAL_MPC=true

# RPC
HELIUS_API_KEY=your-helius-api-key
```

## Critical Constraints

These constraints are **non-negotiable** for correct operation:

| Constraint | Value | Why |
|------------|-------|-----|
| Arcium Cluster | **456** | Cluster 123 does NOT exist despite older docs |
| Noir Version | **1.0.0-beta.13** | Locked for Sunspot Groth16 compatibility |
| Rust Version | **1.89.0** | Required for Arcium v0.6.3 |
| Order Account Size | **366 bytes (V5)** | Filter with `dataSize: 366` everywhere |
| Proof Size | **324 bytes** | Fits within Solana transaction limits |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `AccountDidNotDeserialize` | Filter for V5 orders (366 bytes) |
| `InsufficientBalance` | Wrap more tokens via scripts |
| MXE keygen stuck | Run `arcium requeue-mxe-keygen` |
| Cluster 123 errors | Use cluster **456** (123 doesn't exist) |
| `DeclaredProgramIdMismatch` | Rebuild MXE after updating `declare_id!` |
| `mxeKeysNotSet` (0x1772) | DKG not complete - check `arcium mxe-info` |

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
