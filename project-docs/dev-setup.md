# Development Environment Setup

**Document ID:** DEV-SETUP
**Version:** 1.0
**Date:** January 15, 2026

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Rust | 1.89.0 | Solana program development |
| Solana CLI | 2.0+ | Blockchain interaction |
| Anchor | 0.32.1 | Smart contract framework |
| Noir | 1.0.0-beta.13 | ZK circuit development |
| Sunspot | Latest | Solana ZK verifier deployment |
| Node.js | 18+ | Frontend and testing |
| pnpm | 8+ | Package management |
| Go | 1.24+ | Sunspot CLI build |

---

## 1. Rust Toolchain

Create `rust-toolchain.toml` in project root:

```toml
[toolchain]
channel = "1.89.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

Verify installation:
```bash
rustc --version
# rustc 1.89.0 (...)
```

---

## 2. Solana CLI

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/v2.0.0/install)"

# Configure for devnet
solana config set --url https://api.devnet.solana.com

# Create keypair (if needed)
solana-keygen new

# Get devnet SOL
solana airdrop 2
```

Verify:
```bash
solana --version
# solana-cli 2.0.x

solana config get
# RPC URL: https://api.devnet.solana.com
```

---

## 3. Anchor Framework

```bash
# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.32.1
avm use 0.32.1
```

Verify:
```bash
anchor --version
# anchor-cli 0.32.1
```

---

## 4. Noir (ZK Circuits)

```bash
# Install noirup
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash

# Install specific version (required for Sunspot compatibility)
noirup -v 1.0.0-beta.13
```

Verify:
```bash
nargo --version
# nargo version = 1.0.0-beta.13
```

---

## 5. Sunspot (ZK Verifier)

```bash
# Clone Sunspot
git clone https://github.com/reilabs/sunspot.git ~/sunspot

# Build (requires Go 1.24+)
cd ~/sunspot/go && go build -o sunspot .

# Add to PATH
export PATH="$HOME/sunspot/go:$PATH"

# Set verifier binary location
export GNARK_VERIFIER_BIN="$HOME/sunspot/gnark-solana/crates/verifier-bin"
```

Add to `~/.zshrc` or `~/.bashrc`:
```bash
export PATH="$HOME/sunspot/go:$PATH"
export GNARK_VERIFIER_BIN="$HOME/sunspot/gnark-solana/crates/verifier-bin"
```

Verify:
```bash
sunspot --help
# Sunspot provides tooling for Noir circuits on Solana...
```

---

## 6. Arcium CLI

```bash
# Install arcup (Arcium version manager)
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash

# Install latest version
arcup install

# Verify
arcium version
```

---

## 7. Node.js & pnpm

```bash
# Install Node.js 18+ (via nvm recommended)
nvm install 18
nvm use 18

# Install pnpm
npm install -g pnpm
```

Verify:
```bash
node --version
# v18.x.x

pnpm --version
# 8.x.x
```

---

## 8. Project Setup

```bash
# Clone repository
git clone https://github.com/your-org/confidex.git
cd confidex

# Install Anchor dependencies
anchor build

# Install frontend dependencies
cd frontend && pnpm install

# Copy environment file
cp .env.example .env.local
```

---

## 9. Environment Variables

Create `.env.local` in `frontend/`:

```env
# RPC
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_HELIUS_API_KEY=your_helius_api_key

# Program IDs
NEXT_PUBLIC_PROGRAM_ID=63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
NEXT_PUBLIC_MXE_PROGRAM_ID=DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM
NEXT_PUBLIC_VERIFIER_PROGRAM_ID=6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF

# Proof server (for server-side proof generation)
NEXT_PUBLIC_PROOF_SERVER_URL=http://localhost:3001
```

---

## 10. Quick Commands Reference

### Anchor (Solana Programs)

```bash
anchor build              # Build all programs
anchor test               # Run tests (localnet)
anchor deploy             # Deploy to devnet
anchor keys list          # Show program keypairs
```

### Noir (ZK Circuits)

```bash
cd circuits/eligibility
nargo build               # Compile circuit
nargo test                # Run circuit tests
```

### Sunspot (ZK Verifier)

```bash
cd circuits/eligibility
sunspot compile target/eligibility.json  # Noir JSON → CCS
sunspot setup target/eligibility.ccs     # Generate proving/verifying keys
sunspot deploy target/eligibility.vk     # Deploy verifier to devnet
```

### Frontend

```bash
cd frontend
pnpm dev                  # Development server (localhost:3000)
pnpm build                # Production build
pnpm lint                 # Run ESLint
```

### Integration Tests

```bash
cd tests
pnpm test                 # Run all integration tests
pnpm test:zk              # ZK verification tests only
pnpm test:trade           # Trade flow tests only
pnpm test:mpc             # MPC matching tests only
```

---

## 11. IDE Setup

### VS Code Extensions

- **rust-analyzer** - Rust language support
- **Noir Language Support** - Noir syntax highlighting
- **Solana Snippets** - Anchor/Solana helpers
- **ESLint** - JavaScript/TypeScript linting
- **Tailwind CSS IntelliSense** - Tailwind autocomplete

### VS Code Settings

Add to `.vscode/settings.json`:

```json
{
  "rust-analyzer.cargo.target": "sbf-solana-solana",
  "editor.formatOnSave": true,
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

---

## 12. Troubleshooting

### Anchor Build Fails

```bash
# Clear cache and rebuild
cargo clean
anchor build
```

### Noir Compilation Errors

```bash
# Ensure correct version
noirup -v 1.0.0-beta.13
nargo --version
```

### Sunspot Deploy Fails

```bash
# Check environment variable
echo $GNARK_VERIFIER_BIN

# Check SOL balance
solana balance

# Airdrop if needed
solana airdrop 2
```

### Frontend Build Errors

```bash
# Clear Next.js cache
rm -rf frontend/.next
cd frontend && pnpm build
```

---

## 13. Network Configuration

| Network | RPC URL | Usage |
|---------|---------|-------|
| Devnet | `https://api.devnet.solana.com` | Development |
| Devnet (Helius) | `https://devnet.helius-rpc.com/?api-key=...` | Production-like |
| Mainnet | `https://api.mainnet-beta.solana.com` | Production (future) |

### Arcium Testnet Clusters

| Cluster Offset | Version | Status |
|----------------|---------|--------|
| 123 | v0.5.1 | Active |
| 456 | v0.5.1 | Active |
| 789 | v0.5.1 | Active |

---

## 14. Deployed Program IDs (Devnet)

| Program | Address |
|---------|---------|
| `confidex_dex` | `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` |
| `arcium_mxe` | `DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM` |
| `eligibility_verifier` | `6gXWoHY73B1zrPew9UimHoRzKL5Aq1E3DfrDc9ey3hxF` |

---

*Last updated: January 15, 2026*
