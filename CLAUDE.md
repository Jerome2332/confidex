# CLAUDE.md - Confidex

Confidential DEX on Solana with four-layer privacy: ZK proofs (compliance) + Arcium MPC (execution) + Light Protocol (storage) + ShadowWire (settlement).

## Critical Rules

1. **NEVER bypass privacy layers** - No simulated proofs, no mock MPC, no plaintext fallbacks
2. **ZK proofs via Sunspot Groth16 ONLY** - Barretenberg/HONK proofs don't work on Solana
3. **Never emit amounts/prices in events** - Only order IDs, timestamps, sides
4. **V5 orders (366 bytes) only** - Filter with `dataSize: 366` everywhere
5. **Cluster 456 for Arcium** - Cluster 123 does NOT exist despite docs
6. **Noir 1.0.0-beta.13** - Locked for Sunspot compatibility
7. **Rust 1.89.0** - Required for Arcium v0.6.3
8. **Fix root causes, not symptoms** - Stack overflow? Optimize code, don't remove privacy

## File Structure

```
confidex/
├── programs/
│   └── confidex_dex/        # Anchor program (Rust)
├── arcium-mxe/
│   ├── encrypted-ixs/       # Arcis MPC circuits
│   └── programs/confidex_mxe/  # MXE wrapper
├── circuits/eligibility/    # Noir ZK circuit
├── frontend/                # Next.js 14
│   ├── src/hooks/           # useEncryption, useMpcEvents, useOrderBook
│   └── scripts/             # Devnet utilities
├── backend/                 # Express + crank service
│   └── src/crank/           # Order matching automation
└── project-docs/            # Detailed documentation
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Blockchain | Solana devnet, Anchor 0.32.1 |
| ZK Proofs | Noir 1.0.0-beta.13, Sunspot Groth16 |
| MPC | Arcium v0.6.3 (Cerberus protocol) |
| ZK Compression | Light Protocol v0.22.0 (rent-free accounts) |
| Settlement | ShadowWire (Bulletproof privacy) |
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui |
| Icons | Phosphor Icons (`@phosphor-icons/react`) |
| Backend | Express, SQLite (crank persistence) |

## Build Commands

```bash
# Programs
anchor build && anchor test && anchor deploy

# Circuits
nargo build && sunspot compile && sunspot setup && sunspot deploy

# Frontend
cd frontend && pnpm dev

# Backend (with crank)
cd backend && pnpm dev
```

## Program IDs (Devnet)

| Program | Address |
|---------|---------|
| confidex_dex | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` |
| confidex_mxe | `4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi` |
| eligibility_verifier | `9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W` |
| Arcium Core | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` |

## Token Mints (Devnet)

| Token | Address | Notes |
|-------|---------|-------|
| Wrapped SOL | `So11111111111111111111111111111111111111112` | |
| Dummy USDC | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` | Default for testing |

## Key Patterns

### Encryption (V2 Format - 64 bytes)
```
[nonce (16) | ciphertext (32) | ephemeral_pubkey (16)]
```
No plaintext prefix. All values fully encrypted. MPC handles comparisons.

### Order Flow
1. Frontend encrypts via RescueCipher + MXE public key
2. ZK eligibility proof submitted with order
3. On-chain: Sunspot verifies proof, stores encrypted order
4. Crank triggers MPC price comparison
5. MPC callback updates fill amounts
6. Settlement transfers confidential balances (ShadowWire)

### Four-Layer Privacy Architecture
```
Layer 1: COMPLIANCE    - Noir ZK proofs via Sunspot (eligibility without identity)
Layer 2: EXECUTION     - Arcium MPC (encrypted order matching)
Layer 3: STORAGE       - Light Protocol (rent-free compressed accounts)
Layer 4: SETTLEMENT    - ShadowWire (Bulletproof hidden amounts)
```

### MPC Operations
- `ComparePrices` - Order matching
- `CalculateFill` - Fill amount calculation
- `BatchLiquidationCheck` - Up to 10 positions per call

## Environment Variables

```bash
# Required
NEXT_PUBLIC_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
NEXT_PUBLIC_MXE_PROGRAM_ID=4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi
NEXT_PUBLIC_MXE_X25519_PUBKEY=113364f169338f3fa0d1e76bf2ba71d40aff857dd5f707f1ea2abdaf52e2d06c
HELIUS_API_KEY=your-key

# Light Protocol (ZK Compression)
NEXT_PUBLIC_LIGHT_PROTOCOL_ENABLED=true

# Crank service
CRANK_ENABLED=true
CRANK_USE_REAL_MPC=true
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

Admin endpoints require `X-API-Key` header. Load testing: set `LOAD_TEST_MODE=true`.

## Testing

```bash
# Frontend
cd frontend && pnpm test

# Backend
cd backend && pnpm test

# Anchor
anchor test

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
| `AccountDidNotDeserialize` | Filter for V5 orders (366 bytes) |
| `InsufficientBalance` | Wrap more tokens via scripts |
| MXE keygen stuck | `arcium requeue-mxe-keygen` or deploy fresh MXE |
| Cluster 123 errors | Use cluster 456 instead (123 does NOT exist) |
| `DeclaredProgramIdMismatch` | Rebuild MXE after updating declare_id |
| `mxeKeysNotSet` (0x1772) | DKG not complete - check with `arcium mxe-info` |

## Documentation

Detailed documentation moved to `project-docs/`:
- [API Reference](project-docs/API.md)
- [Architecture Details](project-docs/ARCHITECTURE.md)
- [Arcium Integration](project-docs/arcium/)
- [Privacy Model](project-docs/PRIVACY_MODEL.md)
- [Deployment Guide](project-docs/deployment/DEPLOYMENT.md)
- [Load Testing](tests/load/README.md)

## Performance Targets

| Operation | Target |
|-----------|--------|
| ZK proof generation | < 3s (client) |
| MPC comparison | ~500ms |
| Full order match | 1-2s |
| Proof verification | ~200K CU |
