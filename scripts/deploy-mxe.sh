#!/bin/bash
# Deploy the Arcium MXE program to Solana devnet
# Prerequisites: Solana CLI, Arcium CLI (arcup)

set -e

KEYPAIR_PATH="${SOLANA_KEYPAIR:-$HOME/.config/solana/devnet.json}"
MXE_KEYPAIR="./target/deploy/arcium_mxe-keypair.json"
# NOTE: Cluster 123 does NOT exist on devnet (Jan 2026)
# Valid clusters: 456, 789 (both run v0.5.1)
# Reference: https://docs.arcium.com/developers/deployment
CLUSTER_OFFSET="${ARCIUM_CLUSTER_OFFSET:-456}"

echo "=== Deploying Arcium MXE Program ==="
echo ""

# Check solana config
SOLANA_URL=$(solana config get | grep "RPC URL" | awk '{print $3}')
echo "Solana RPC: $SOLANA_URL"
echo "Keypair: $KEYPAIR_PATH"
echo "Cluster offset: $CLUSTER_OFFSET"
echo ""

# Build the program if needed
if [ ! -f "target/deploy/arcium_mxe.so" ]; then
    echo "Building MXE program..."
    cargo-build-sbf --manifest-path programs/arcium_mxe/Cargo.toml
fi

# Deploy to Solana
echo "1. Deploying MXE program to Solana..."
if [ ! -f "$MXE_KEYPAIR" ]; then
    echo "   Generating new program keypair..."
    solana-keygen new --no-bip39-passphrase --outfile "$MXE_KEYPAIR"
fi

MXE_PROGRAM_ID=$(solana address -k "$MXE_KEYPAIR")
echo "   Program ID: $MXE_PROGRAM_ID"

solana program deploy \
    --program-id "$MXE_KEYPAIR" \
    --keypair "$KEYPAIR_PATH" \
    --url "$SOLANA_URL" \
    target/deploy/arcium_mxe.so

echo ""
echo "2. Registering with Arcium cluster..."
# In production, this would use the Arcium CLI:
# arcium deploy --cluster-offset $CLUSTER_OFFSET --keypair-path "$KEYPAIR_PATH" --rpc-url "$SOLANA_URL"
echo "   (Simulated - actual registration requires arcium CLI)"
echo "   Cluster offset: $CLUSTER_OFFSET"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "MXE Program ID: $MXE_PROGRAM_ID"
echo ""
echo "Update the following files:"
echo "  - lib/src/constants.ts (MXE_PROGRAM_ID)"
echo "  - programs/confidex_dex/src/cpi/arcium.rs (ARCIUM_MXE_PROGRAM_ID)"
echo "  - frontend/.env.local (NEXT_PUBLIC_MXE_PROGRAM_ID)"
echo ""

# Save program ID
echo "$MXE_PROGRAM_ID" > target/deploy/mxe_program_id.txt
echo "Program ID saved to: target/deploy/mxe_program_id.txt"
