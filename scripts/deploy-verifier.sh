#!/bin/bash
# Deploy the eligibility verifier to Solana via Sunspot
# Prerequisites: sunspot CLI, Solana CLI configured for devnet

set -e

CIRCUIT_DIR="circuits/eligibility"
KEYPAIR_PATH="${SOLANA_KEYPAIR:-$HOME/.config/solana/devnet.json}"

echo "=== Deploying Eligibility Verifier ==="
echo ""

# Check sunspot
if ! command -v sunspot &> /dev/null; then
    echo "Error: sunspot not found. Install from:"
    echo "  https://github.com/reilabs/sunspot"
    exit 1
fi

# Check solana config
SOLANA_URL=$(solana config get | grep "RPC URL" | awk '{print $3}')
echo "Solana RPC: $SOLANA_URL"
echo "Keypair: $KEYPAIR_PATH"
echo ""

cd "$CIRCUIT_DIR"

# Step 1: Compile to CCS
echo "1. Converting Noir circuit to CCS format..."
if [ ! -f "target/eligibility.json" ]; then
    echo "   Circuit not compiled. Run build-circuit.sh first."
    exit 1
fi

sunspot compile --input target/eligibility.json --output target/eligibility.ccs

# Step 2: Setup (generate keys)
echo ""
echo "2. Generating proving and verification keys..."
sunspot setup --ccs target/eligibility.ccs --output target/

# Step 3: Deploy verifier program
echo ""
echo "3. Deploying verifier program to Solana..."
VERIFIER_PROGRAM_ID=$(sunspot deploy \
    --vk target/vk.bin \
    --keypair "$KEYPAIR_PATH" \
    --url "$SOLANA_URL" \
    2>&1 | grep "Program ID" | awk '{print $3}')

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Verifier Program ID: $VERIFIER_PROGRAM_ID"
echo ""
echo "Update the following files with this program ID:"
echo "  - programs/confidex_dex/src/cpi/verifier.rs (SUNSPOT_VERIFIER_PROGRAM_ID)"
echo "  - frontend/.env.local (NEXT_PUBLIC_VERIFIER_PROGRAM_ID)"
echo ""

# Save program ID
echo "$VERIFIER_PROGRAM_ID" > target/verifier_program_id.txt
echo "Program ID saved to: $CIRCUIT_DIR/target/verifier_program_id.txt"
