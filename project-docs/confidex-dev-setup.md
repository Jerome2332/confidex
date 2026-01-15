# Confidex Development Environment Setup Guide

**Version:** 1.0  
**Last Updated:** January 10, 2026  
**Target Setup Time:** 30-45 minutes  

---

## Overview

This guide will set up everything needed to develop Confidex, including:

- Rust + Solana CLI + Anchor (smart contracts)
- Node.js + pnpm (frontend & scripts)
- Noir + Sunspot (zero-knowledge proofs)
- Development tools and IDE configuration

**Supported Platforms:** macOS (Apple Silicon & Intel), Ubuntu 22.04+, WSL2

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Rust & Solana Toolchain](#2-rust--solana-toolchain)
3. [Anchor Framework](#3-anchor-framework)
4. [Node.js & Package Manager](#4-nodejs--package-manager)
5. [Noir ZK Toolchain](#5-noir-zk-toolchain)
6. [IDE Setup](#6-ide-setup)
7. [API Keys & Access](#7-api-keys--access)
8. [Verification](#8-verification)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Storage | 20 GB free | 50 GB free |
| CPU | 4 cores | 8 cores |

### Required System Packages

#### macOS

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install openssl pkg-config libudev-zero protobuf llvm cmake
```

#### Ubuntu / WSL2

```bash
sudo apt update && sudo apt upgrade -y

sudo apt install -y \
    build-essential \
    pkg-config \
    libudev-dev \
    llvm \
    libclang-dev \
    protobuf-compiler \
    libssl-dev \
    cmake \
    curl \
    git \
    jq
```

---

## 2. Rust & Solana Toolchain

### 2.1 Install Rust

```bash
# Install rustup (Rust toolchain manager)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Load Rust environment
source "$HOME/.cargo/env"

# Verify installation
rustc --version
# Expected: rustc 1.89.0 (required for Arcium v0.4.0+)

# Install specific version for Arcium compatibility
rustup install 1.89.0
rustup default 1.89.0
```

### 2.2 Install Solana CLI

```bash
# Install Solana CLI (v2.3.0 required for Arcium v0.4.0+)
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"

# Add to PATH (add to ~/.bashrc or ~/.zshrc for persistence)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version
# Expected: solana-cli 2.3.0

# Configure for devnet
solana config set --url devnet

# Generate a new keypair for development (or import existing)
solana-keygen new --outfile ~/.config/solana/devnet.json

# Set as default keypair
solana config set --keypair ~/.config/solana/devnet.json

# Airdrop some SOL for testing (devnet only)
solana airdrop 5

# Verify balance
solana balance
```

### 2.3 Install SPL Token CLI

```bash
cargo install spl-token-cli

# Verify
spl-token --version
```

---

## 3. Anchor Framework

### 3.1 Install Anchor Version Manager (AVM)

```bash
# Install AVM
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Install latest Anchor version
avm install latest
avm use latest

# Verify installation
anchor --version
# Expected: anchor-cli 0.32.1
```

### 3.2 Verify Anchor Setup

```bash
# Create a test project to verify everything works
mkdir -p ~/confidex-test && cd ~/confidex-test
anchor init test_project
cd test_project

# Build (this will take a few minutes first time)
anchor build

# If successful, clean up
cd ~ && rm -rf ~/confidex-test
```

---

## 4. Node.js & Package Manager

### 4.1 Install Node.js via nvm

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load nvm (or restart terminal)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install Node.js LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version
# Expected: v20.x.x
```

### 4.2 Install pnpm (Recommended) or Yarn

```bash
# Install pnpm (faster, more efficient)
npm install -g pnpm

# Verify
pnpm --version

# Alternative: Install Yarn
# npm install -g yarn
```

### 4.3 Install Global Node Packages

```bash
# TypeScript
npm install -g typescript ts-node

# Useful CLI tools
npm install -g dotenv-cli
```

---

## 5. Noir ZK Toolchain

### 5.1 Install Noirup (Noir Version Manager)

```bash
# Install noirup
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash

# Load noirup (or restart terminal)
source ~/.bashrc  # or ~/.zshrc

# Install Noir (specific version for stability)
noirup -v 1.0.0-beta.13

# Verify installation
nargo --version
# Expected: nargo version = 1.0.0-beta.13
```

### 5.2 Install Barretenberg Backend (for proof generation)

```bash
# The bb (Barretenberg) CLI is needed for proof generation
# It's typically installed alongside Noir, but verify:
bb --version

# If not found, install via:
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
source ~/.bashrc
bbup -v 0.63.0
```

### 5.3 Verify Noir Setup

```bash
# Create a test circuit
mkdir -p ~/noir-test && cd ~/noir-test
nargo new test_circuit
cd test_circuit

# Build the circuit
nargo build

# Run tests
nargo test

# Clean up
cd ~ && rm -rf ~/noir-test
```

### 5.4 Install Sunspot (Solana ZK Verifier)

```bash
# Clone Sunspot repository
git clone https://github.com/reilabs/sunspot.git ~/sunspot

# Build Sunspot
cd ~/sunspot
cargo build --release

# Add to PATH (add to ~/.bashrc or ~/.zshrc)
export PATH="$HOME/sunspot/target/release:$PATH"

# Verify
sunspot --help
```

---

## 6. IDE Setup

### 6.1 VS Code Extensions

Install these extensions for the best development experience:

```bash
# Install VS Code extensions via CLI
code --install-extension rust-lang.rust-analyzer
code --install-extension tamasfe.even-better-toml
code --install-extension serayuzgur.crates
code --install-extension vadimcn.vscode-lldb
code --install-extension esbenp.prettier-vscode
code --install-extension dbaeumer.vscode-eslint
code --install-extension bradlc.vscode-tailwindcss
code --install-extension noir-lang.vscode-noir
code --install-extension ms-vscode.vscode-typescript-next
```

### 6.2 VS Code Settings

Create or update `.vscode/settings.json` in your project:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer",
    "editor.formatOnSave": true
  },
  "[toml]": {
    "editor.defaultFormatter": "tamasfe.even-better-toml"
  },
  "rust-analyzer.check.command": "clippy",
  "rust-analyzer.cargo.features": "all",
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "files.associations": {
    "*.nr": "noir"
  }
}
```

### 6.3 Recommended Terminal Setup

```bash
# Install Oh My Zsh (optional but recommended)
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Add aliases to ~/.zshrc or ~/.bashrc
cat >> ~/.zshrc << 'EOF'

# Confidex Development Aliases
alias sb="anchor build"
alias st="anchor test"
alias sd="anchor deploy"
alias sl="solana logs"
alias sa="solana airdrop 2"
alias sbal="solana balance"

# Quick devnet/localnet switching
alias devnet="solana config set --url devnet"
alias localnet="solana config set --url localhost"
alias mainnet="solana config set --url mainnet-beta"

# Noir shortcuts
alias nb="nargo build"
alias nt="nargo test"
alias np="nargo prove"
alias nv="nargo verify"

EOF

source ~/.zshrc
```

---

## 7. API Keys & Access

### 7.1 Helius (Required)

1. Go to https://dev.helius.xyz/
2. Sign up / Log in
3. Create a new project
4. Copy your API key

```bash
# Add to environment (create .env file in project root)
echo "HELIUS_API_KEY=your-api-key-here" >> ~/.confidex-env

# Or export directly
export HELIUS_API_KEY="your-api-key-here"
```

### 7.2 Arcium Testnet (Required)

1. Go to https://developers.arcium.com/
2. Apply for testnet access
3. Complete registration
4. Wait for approval (may take 24-48 hours)

```bash
# Once approved, add credentials
echo "ARCIUM_API_KEY=your-api-key-here" >> ~/.confidex-env
echo "ARCIUM_CLUSTER_ID=your-cluster-id" >> ~/.confidex-env
```

### 7.3 Create Environment Template

```bash
# Create a template .env file for the project
cat > ~/.confidex-env << 'EOF'
# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY

# Helius
HELIUS_API_KEY=your-helius-api-key

# Arcium
ARCIUM_API_KEY=your-arcium-api-key
ARCIUM_CLUSTER_ID=confidex-cluster
ARCIUM_NETWORK=testnet

# Program IDs (populated after deployment)
CONFIDEX_PROGRAM_ID=
VERIFIER_PROGRAM_ID=

# Frontend
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
EOF

echo "Environment template created at ~/.confidex-env"
```

---

## 8. Verification

Run this script to verify your entire setup:

```bash
#!/bin/bash
# Save as: verify-setup.sh

echo "🔍 Verifying Confidex Development Environment..."
echo "================================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_command() {
    if command -v $1 &> /dev/null; then
        VERSION=$($1 --version 2>&1 | head -n 1)
        echo -e "${GREEN}✓${NC} $1: $VERSION"
        return 0
    else
        echo -e "${RED}✗${NC} $1: NOT FOUND"
        return 1
    fi
}

check_env() {
    if [ -n "${!1}" ]; then
        echo -e "${GREEN}✓${NC} $1: Set"
        return 0
    else
        echo -e "${YELLOW}⚠${NC} $1: Not set"
        return 1
    fi
}

echo ""
echo "📦 Core Tools:"
echo "--------------"
check_command rustc
check_command cargo
check_command solana
check_command anchor
check_command node
check_command pnpm

echo ""
echo "🔐 ZK Tools:"
echo "------------"
check_command nargo
check_command bb

echo ""
echo "⚙️  Environment Variables:"
echo "--------------------------"
source ~/.confidex-env 2>/dev/null
check_env HELIUS_API_KEY
check_env ARCIUM_API_KEY

echo ""
echo "🌐 Solana Configuration:"
echo "------------------------"
solana config get

echo ""
echo "💰 Wallet Balance:"
echo "------------------"
solana balance 2>/dev/null || echo "No wallet configured or not connected"

echo ""
echo "================================================"
echo "🎉 Verification complete!"
echo ""
echo "Next steps:"
echo "1. If any tools are missing, re-run the relevant installation section"
echo "2. Ensure API keys are set in ~/.confidex-env"
echo "3. Request Arcium testnet access if not done already"
echo "4. Run 'solana airdrop 5' if wallet balance is low"
```

Make it executable and run:

```bash
chmod +x verify-setup.sh
./verify-setup.sh
```

---

## 9. Troubleshooting

### Common Issues

#### "error: linker `cc` not found" (Rust)

```bash
# macOS
xcode-select --install

# Ubuntu
sudo apt install build-essential
```

#### "Unable to get latest blockhash" (Solana)

```bash
# Check your network connection and RPC URL
solana config get

# Try switching RPC
solana config set --url https://api.devnet.solana.com
```

#### Anchor build fails with BPF error

```bash
# Ensure you're using compatible Rust version
rustup default 1.75.0

# Clean and rebuild
anchor clean
anchor build
```

#### Noir "Backend not found"

```bash
# Reinstall Barretenberg backend
bbup -v 0.63.0
```

#### Node.js memory issues

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=8192"
```

#### Permission denied on WSL2

```bash
# Fix file permissions
sudo chmod -R 755 ~/.local/share/solana
```

### Getting Help

- **Solana Discord:** https://discord.gg/solana
- **Anchor Discord:** https://discord.gg/anchor
- **Noir Discord:** https://discord.gg/aztec
- **Arcium Discord:** https://discord.gg/arcium
- **Helius Discord:** https://discord.gg/helius

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIDEX DEV QUICK REFERENCE                  │
├─────────────────────────────────────────────────────────────────┤
│  SOLANA                                                          │
│  ───────                                                         │
│  solana config set --url devnet     # Switch to devnet          │
│  solana airdrop 5                   # Get test SOL              │
│  solana balance                     # Check balance             │
│  solana logs                        # Stream program logs       │
│                                                                  │
│  ANCHOR                                                          │
│  ───────                                                         │
│  anchor build                       # Compile programs          │
│  anchor test                        # Run tests                 │
│  anchor deploy                      # Deploy to network         │
│  anchor keys list                   # Show program IDs          │
│                                                                  │
│  NOIR                                                            │
│  ─────                                                           │
│  nargo new <name>                   # Create new circuit        │
│  nargo build                        # Compile circuit           │
│  nargo test                         # Run circuit tests         │
│  nargo prove                        # Generate proof            │
│  nargo verify                       # Verify proof              │
│                                                                  │
│  USEFUL PATHS                                                    │
│  ─────────────                                                   │
│  ~/.config/solana/devnet.json       # Devnet keypair            │
│  ~/.confidex-env                    # Environment variables      │
│  ~/sunspot/                         # Sunspot installation       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

Once your environment is set up:

1. **Clone the Confidex boilerplate** (when available)
2. **Run verification script** to confirm everything works
3. **Set up API keys** for Helius and Arcium
4. **Start with the first milestone:** C-SPL token wrapping

Good luck building Confidex! 🚀
