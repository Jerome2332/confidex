#!/bin/bash

# Confidex Demo Script
# Solana Privacy Hack 2026

set -e

echo "=========================================="
echo "     CONFIDEX - Confidential DEX Demo     "
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "  ✓ $1"
    else
        echo -e "  ✗ $1 (not found)"
        exit 1
    fi
}

check_command solana
check_command anchor
check_command pnpm
echo ""

# Configuration
PROGRAM_ID="${PROGRAM_ID:-63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"

echo -e "${BLUE}Configuration:${NC}"
echo "  Program ID: $PROGRAM_ID"
echo "  RPC URL: $RPC_URL"
echo ""

# Demo scenarios
demo_scenario() {
    local scenario=$1
    echo -e "${YELLOW}=== Demo Scenario: $scenario ===${NC}"
    echo ""
}

# Scenario 1: Architecture Overview
demo_scenario "Three-Layer Privacy Architecture"

echo "Confidex implements a novel three-layer privacy architecture:"
echo ""
echo "  Layer 1: ZK Compliance (Noir/Groth16)"
echo "  ├─ Proves user is NOT on blacklist"
echo "  ├─ Uses Sparse Merkle Tree non-membership"
echo "  └─ Proof size: 388 bytes (fits in single tx)"
echo ""
echo "  Layer 2: Encrypted Execution (Arcium MPC)"
echo "  ├─ Order amounts and prices encrypted"
echo "  ├─ Price comparison via MPC"
echo "  └─ Fill calculation without revealing values"
echo ""
echo "  Layer 3: Confidential Settlement (ShadowWire)"
echo "  ├─ Bulletproof-based private transfers"
echo "  ├─ Amount hidden via ZK proofs"
echo "  └─ Both parties remain anonymous"
echo ""
read -p "Press Enter to continue..."
echo ""

# Scenario 2: Order Placement Flow
demo_scenario "Encrypted Order Placement"

echo "User places a buy order for SOL/USDC:"
echo ""
echo "1. Wallet signs eligibility request"
echo "   └─ Proves ownership without revealing secrets"
echo ""
echo "2. Backend generates ZK proof (~2-3 seconds)"
echo "   └─ Noir circuit: SMT non-membership"
echo "   └─ Compiled to Groth16 via Sunspot"
echo ""
echo "3. Frontend encrypts order values"
echo "   └─ Amount: 1.5 SOL → [encrypted 64 bytes]"
echo "   └─ Price: \$148.50 → [encrypted 64 bytes]"
echo "   └─ Uses X25519 + Rescue cipher"
echo ""
echo "4. Transaction submitted to Solana"
echo "   └─ Proof verified on-chain (200K CU)"
echo "   └─ Encrypted values stored in order account"
echo ""
read -p "Press Enter to continue..."
echo ""

# Scenario 3: Order Matching
demo_scenario "MPC Order Matching"

echo "Matching engine triggers when orders exist:"
echo ""
echo "Buy Order:                   Sell Order:"
echo "├─ Amount: [encrypted]       ├─ Amount: [encrypted]"
echo "├─ Price: [enc: \$150]        ├─ Price: [enc: \$148]"
echo "└─ Side: BUY                 └─ Side: SELL"
echo ""
echo "Arcium MPC compares prices:"
echo "  compare_encrypted(buy.price, sell.price)"
echo "  → Result: BUY >= SELL (MATCH!)"
echo ""
echo "Neither party learns the other's exact price!"
echo ""
echo "Fill calculation via MPC:"
echo "  min(buy.remaining, sell.remaining)"
echo "  → Fill amount (still encrypted)"
echo ""
read -p "Press Enter to continue..."
echo ""

# Scenario 4: Settlement
demo_scenario "Private Settlement"

echo "Trade settles via ShadowWire:"
echo ""
echo "1. Buyer's USDC → Seller (private transfer)"
echo "   └─ Amount hidden by Bulletproof"
echo ""
echo "2. Seller's SOL → Buyer (private transfer)"
echo "   └─ Amount hidden by Bulletproof"
echo ""
echo "3. Fee distribution (1% relayer fee)"
echo "   └─ Maker: 0.10% | Taker: 0.30%"
echo ""
echo "Result:"
echo "  ✓ Trade executed"
echo "  ✓ Amounts never revealed on-chain"
echo "  ✓ Both parties verified compliant"
echo ""
read -p "Press Enter to continue..."
echo ""

# Scenario 5: Prize Track Integration
demo_scenario "Prize Track Integrations"

echo "Confidex targets multiple prize tracks:"
echo ""
echo "1. Arcium (\$10K)"
echo "   └─ C-SPL encrypted tokens"
echo "   └─ MPC order matching via Cerberus protocol"
echo ""
echo "2. Aztec/Noir (\$10K)"
echo "   └─ Groth16 eligibility proofs"
echo "   └─ Sunspot verifier deployment"
echo ""
echo "3. Open Track (\$18K)"
echo "   └─ Novel three-layer architecture"
echo "   └─ First confidential DEX on Solana"
echo ""
echo "4. Helius (\$5K)"
echo "   └─ Priority fee estimation"
echo "   └─ Webhooks for order notifications"
echo "   └─ DAS token metadata"
echo ""
echo "5. Radr Labs ShadowWire (\$15K)"
echo "   └─ Private settlement layer"
echo "   └─ Bulletproof transfers"
echo ""
echo "6. PNP SDK (\$2.5K)"
echo "   └─ Prediction markets integration"
echo "   └─ Confidential collateral support"
echo ""
echo -e "${GREEN}Total potential: \$60,500${NC}"
echo ""
read -p "Press Enter to continue..."
echo ""

# Scenario 6: Start Frontend
demo_scenario "Launch Frontend"

echo "Starting Confidex frontend..."
echo ""
echo "  cd frontend && pnpm dev"
echo ""
echo "Features:"
echo "  • Trading panel with ZK proof status"
echo "  • Encrypted order book (prices only)"
echo "  • Balance display with reveal toggle"
echo "  • Prediction markets integration"
echo ""

read -p "Start frontend? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$(dirname "$0")/../frontend"
    pnpm dev
fi

echo ""
echo -e "${GREEN}Demo complete!${NC}"
echo ""
echo "Learn more:"
echo "  • Docs: https://docs.arcium.com"
echo "  • GitHub: https://github.com/confidex-dex"
echo ""
