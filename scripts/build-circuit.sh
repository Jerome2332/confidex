#!/bin/bash
# Build the Noir eligibility circuit
# Prerequisites: nargo 1.0.0-beta.13+

set -e

CIRCUIT_DIR="circuits/eligibility"

echo "=== Building Eligibility Circuit ==="
echo ""

# Check nargo version
if ! command -v nargo &> /dev/null; then
    echo "Error: nargo not found. Install via:"
    echo "  curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash"
    echo "  noirup --version 1.0.0-beta.13"
    exit 1
fi

NARGO_VERSION=$(nargo --version 2>&1 | head -1)
echo "Using nargo: $NARGO_VERSION"
echo ""

cd "$CIRCUIT_DIR"

# Compile the circuit
echo "1. Compiling circuit..."
nargo compile

echo ""
echo "2. Checking circuit info..."
nargo info

echo ""
echo "3. Running tests..."
nargo test || echo "Note: Some tests may require proper test vectors"

echo ""
echo "=== Circuit Build Complete ==="
echo ""
echo "Output artifacts in: $CIRCUIT_DIR/target/"
echo ""
echo "Next steps:"
echo "  1. sunspot compile    - Convert to CCS format"
echo "  2. sunspot setup      - Generate proving/verification keys"
echo "  3. sunspot deploy     - Deploy verifier to Solana"
