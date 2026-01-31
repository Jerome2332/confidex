# CLAUDE.md - Confidex

Confidential DEX on Solana with **two-layer privacy**: Arcium MPC (encrypted execution) + ShadowWire (private settlement).

> **Architecture Update (Jan 31, 2026):** The new Spot Trading MXE uses a simplified architecture where Arcium MPC handles ALL privacy for order data. ZK eligibility proofs (Noir/Sunspot) are **optional** and controlled by `NEXT_PUBLIC_ZK_PROOFS_ENABLED`. The legacy `confidex_dex` program still supports ZK proofs for backwards compatibility.

## Current Privacy Model

| Layer | Technology | Status | Purpose |
|-------|------------|--------|---------|
| **Execution** | Arcium MPC (Cerberus) | **ACTIVE** | Encrypted order matching, price comparison |
| **Settlement** | ShadowWire | **ACTIVE** | Bulletproof private transfers |
| **Compliance** | Noir ZK Proofs | **OPTIONAL** | Blacklist eligibility (legacy flow only) |
| **Storage** | Light Protocol | **OPTIONAL** | ZK Compression for rent savings |

### Privacy Analysis (Spot Trading MXE)

**What is encrypted on-chain:**
- Trader identity (split into encrypted lo/hi u128 parts)
- Order price (32-byte ciphertext)
- Order quantity (32-byte ciphertext)
- Order side (buy/sell) (32-byte ciphertext)
- Order book state (16 x 32-byte encrypted fields)

**What is visible on-chain:**
- Wallet address submitting transaction (Solana requirement)
- Ephemeral X25519 public key (32 bytes)
- Nonce for encryption (16 bytes)
- Computation offset (unique per order)
- Transaction timing and fees

## Critical Rules

1. **Arcium MPC is the core privacy layer** - All order data encrypted with Rescue cipher
2. **Never emit amounts/prices in events** - Only order IDs, timestamps, computation offsets
3. **Cluster 456 for Arcium** - Cluster 123 does NOT exist despite docs
4. **Rust 1.89.0** - Required for Arcium v0.6.3
5. **Fix root causes, not symptoms** - Stack overflow? Optimize code, don't remove privacy

## File Structure

```
confidex/
├── programs/
│   └── confidex_dex/            # Legacy Anchor program (supports ZK proofs)
├── arcium-mxe/
│   ├── spot-trading/            # Spot trading MXE (Arcium MPC only)
│   │   ├── encrypted-ixs/       # Arcis circuits (submit_order, cancel_order, etc.)
│   │   └── programs/spot_trading/  # Anchor MXE program
│   └── perpetuals/              # Perpetuals MXE (Arcium MPC only)
│       ├── encrypted-ixs/       # Arcis circuits (open_position, close_position, etc.)
│       └── programs/perpetuals/    # Anchor MXE program
├── circuits/eligibility/        # Noir ZK circuit (OPTIONAL - legacy flow)
├── frontend/                    # Next.js 14
│   ├── src/hooks/               # useEncryption, useMpcEvents, useSpotTrading
│   └── scripts/                 # Devnet utilities
├── backend/                     # Express + crank service
│   └── src/crank/               # Order matching automation
└── project-docs/                # Detailed documentation
```

## Tech Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Blockchain | Solana devnet, Anchor 0.32.1 | |
| MPC | Arcium v0.6.3 (Cerberus protocol) | **Primary privacy layer** |
| ZK Proofs | Noir 1.0.0-beta.13, Sunspot Groth16 | Optional, legacy flow only |
| ZK Compression | Light Protocol v0.22.0 | Cost optimization, NOT privacy |
| Settlement | ShadowWire (Bulletproof) | Private transfers |
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui | |
| Icons | Phosphor Icons (`@phosphor-icons/react`) | |
| Backend | Express, SQLite (crank persistence) | |

## Build Commands

```bash
# MXE Programs (Arcium)
cd arcium-mxe/spot-trading && arcium build && arcium deploy

# Legacy DEX Program
anchor build && anchor deploy

# Circuits (optional - only if using ZK proofs)
cd circuits/eligibility && nargo build && sunspot compile && sunspot deploy

# Frontend
cd frontend && pnpm dev

# Backend (with crank)
cd backend && pnpm dev
```

## Program IDs (Devnet)

| Program | Address | Notes |
|---------|---------|-------|
| spot_trading_mxe | `AMm9J2fNYDBREvDZhQDniz7i6QyKwUZ6cFiQBi1P5SVS` | **Recommended** |
| perpetuals_mxe | `CSTs9KjTmnwu3Wg76kE49Mgud2GyAQeQjZ66zicTQKq9` | Perpetuals trading |
| confidex_dex | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` | Legacy (with ZK) |
| eligibility_verifier | `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W` | Optional ZK verifier |
| Arcium Core | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` | MPC infrastructure |

> **Note**: MXEs deployed using `arcium deploy` with correct authority.
> Uses CircuitSource::OffChain for production-ready circuit loading.
> - Spot Trading: 6 circuits, GitHub release v0.1.0-circuits (Jan 31, 2026)
> - Perpetuals: 13 circuits active, GitHub release v0.2.0-circuits (Jan 30, 2026)

## Token Mints (Devnet)

| Token | Address | Notes |
|-------|---------|-------|
| Wrapped SOL | `So11111111111111111111111111111111111111112` | |
| Dummy USDC | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` | Default for testing |

## Key Patterns

### Encryption (32-byte ciphertexts)
The Spot Trading MXE uses 32-byte ciphertexts (not 64-byte like legacy):
- X25519 key exchange with MXE public key
- Rescue sponge cipher for encryption
- Ciphertexts are indistinguishable (all same size regardless of value)

### Order Flow (Spot Trading MXE)
1. Frontend encrypts order via `@arcium-hq/client` + MXE X25519 key
2. `submit_order` queues MPC computation with encrypted data
3. Arcium ARX nodes decrypt in MPC, update encrypted order book state
4. `submit_order_callback` writes new encrypted state on-chain
5. (Future) Settlement triggers via `get_last_match` for private transfers

### Two-Layer Privacy Architecture (Current)
```
Layer 1: EXECUTION     - Arcium MPC (encrypted order matching)
                         All order data (price, quantity, side, trader) encrypted
                         Only MPC cluster can decrypt for matching

Layer 2: SETTLEMENT    - ShadowWire (Bulletproof hidden amounts)
                         Private token transfers after match

Optional:
- ZK Proofs (Noir)     - Blacklist eligibility (disabled by default)
- Light Protocol       - ZK Compression for rent savings (cost optimization only)
```

### MPC Operations (Spot Trading)
- `submit_order` - Add encrypted order to order book
- `compare_prices` - Match orders (triggered by crank)
- `get_last_match` - Reveal match result for settlement
- `cancel_order` - Remove order from book
- `get_cancel_result` - Confirm cancellation

## Environment Variables

```bash
# Required for Spot Trading MXE
NEXT_PUBLIC_SPOT_MXE_PROGRAM_ID=AMm9J2fNYDBREvDZhQDniz7i6QyKwUZ6cFiQBi1P5SVS
NEXT_PUBLIC_SPOT_MXE_X25519_PUBKEY=86a3eae1965df0c70923a74a8e3be69aa00ca821749be475a070343e77f93412
NEXT_PUBLIC_USE_SPOT_MXE=true

# Required for Perpetuals
NEXT_PUBLIC_PERPS_MXE_PROGRAM_ID=CSTs9KjTmnwu3Wg76kE49Mgud2GyAQeQjZ66zicTQKq9
NEXT_PUBLIC_PERPS_MXE_X25519_PUBKEY=9163f8e9c1ac55ead26717a6985f09366c46e629d7f1024319ad5f428b4682bf

# Optional - ZK Proofs (default: true for legacy flow, but not used with USE_SPOT_MXE)
NEXT_PUBLIC_ZK_PROOFS_ENABLED=true
NEXT_PUBLIC_PROOF_SERVER_URL=http://localhost:3001

# RPC
NEXT_PUBLIC_RPC_ENDPOINT=https://your-rpc-endpoint

# Crank service
CRANK_ENABLED=true
```

## Code Style

- **Immutability**: Prefer `const`, use spread operators
- **Max file size**: 500 lines
- **Max function**: 50 lines
- **Naming**: camelCase (vars), PascalCase (types), SCREAMING_SNAKE (constants)
- **Icons**: Phosphor only (`@phosphor-icons/react`)
- **No emojis** in code or comments

## Backend API

See [API Documentation](project-docs/API.md) for complete endpoint reference.

Key endpoints: `/api/status`, `/api/orderbook/:pair`, `/api/orders/simulate`, `/api/prove`

Admin endpoints require `X-API-Key` header.

## Testing

```bash
# Frontend
cd frontend && pnpm test

# Backend
cd backend && pnpm test

# Spot Trading MXE test
cd frontend && npx tsx scripts/test-spot-mxe-full-flow.ts

# Load tests (requires k6)
k6 run --vus 5 --duration 30s tests/load/settlement.js
```

Coverage requirement: 80%+

## Git Workflow

```bash
# Commit format
<type>(<scope>): <description>

# Types: feat, fix, docs, refactor, test, chore
# Example: feat(mpc): add batch liquidation check
```

## Common Issues

| Issue | Solution |
|-------|----------|
| `InstructionFallbackNotFound` | Check discriminator matches IDL exactly |
| `InsufficientBalance` | Wrap more tokens via scripts |
| MXE keygen stuck | `arcium requeue-mxe-keygen` or deploy fresh MXE |
| Cluster 123 errors | Use cluster 456 instead (123 does NOT exist) |
| `DeclaredProgramIdMismatch` | Rebuild MXE after updating declare_id |
| `mxeKeysNotSet` (0x1772) | DKG not complete - check with `arcium mxe-info` |

## Documentation

Detailed documentation in `project-docs/`:
- [API Reference](project-docs/API.md)
- [Architecture Details](project-docs/ARCHITECTURE.md)
- [Arcium Integration](project-docs/arcium/)
- [Privacy Model](project-docs/PRIVACY_MODEL.md)
- [Deployment Guide](project-docs/deployment/DEPLOYMENT.md)

## Performance Targets

| Operation | Target |
|-----------|--------|
| Order encryption | < 50ms (client) |
| MPC computation | 30-60s (devnet) |
| Full order submit | < 2s (excluding MPC callback) |
| MPC callback | 30-60s on devnet |
