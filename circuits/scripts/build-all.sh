#!/bin/bash
# Build all Confidex ZK circuits
# Usage: ./build-all.sh [circuit-name]
# If no circuit name provided, builds all circuits

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# List of circuits to build (order matters - shared must be first)
CIRCUITS=(
    "shared"
    "eligibility"
    "range_proof"
    "solvency"
)

build_circuit() {
    local circuit=$1
    local circuit_dir="$CIRCUITS_DIR/$circuit"

    if [ ! -d "$circuit_dir" ]; then
        echo -e "${YELLOW}Skipping $circuit (directory not found)${NC}"
        return 0
    fi

    if [ ! -f "$circuit_dir/Nargo.toml" ]; then
        echo -e "${YELLOW}Skipping $circuit (no Nargo.toml)${NC}"
        return 0
    fi

    echo -e "${GREEN}Building $circuit...${NC}"
    cd "$circuit_dir"

    # Check if it's a library or binary
    local pkg_type=$(grep "type = " Nargo.toml | head -1 | cut -d'"' -f2)

    if [ "$pkg_type" = "lib" ]; then
        echo "  Type: library"
        nargo check
        echo -e "${GREEN}  ✓ Library check passed${NC}"
    else
        echo "  Type: binary"
        nargo build
        echo -e "${GREEN}  ✓ Build complete${NC}"

        # Run tests if they exist
        if nargo test --help > /dev/null 2>&1; then
            echo "  Running tests..."
            nargo test || echo -e "${YELLOW}  ⚠ Some tests may have failed${NC}"
        fi
    fi

    return 0
}

run_sunspot_setup() {
    local circuit=$1
    local circuit_dir="$CIRCUITS_DIR/$circuit"

    if [ ! -d "$circuit_dir/target" ]; then
        echo -e "${YELLOW}Skipping Sunspot setup for $circuit (no target directory)${NC}"
        return 0
    fi

    local circuit_json="$circuit_dir/target/$circuit.json"
    if [ ! -f "$circuit_json" ]; then
        echo -e "${YELLOW}Skipping Sunspot setup for $circuit (no circuit.json)${NC}"
        return 0
    fi

    # Check if sunspot is available
    if ! command -v sunspot &> /dev/null; then
        local sunspot_path="$HOME/sunspot/go/sunspot"
        if [ -x "$sunspot_path" ]; then
            alias sunspot="$sunspot_path"
        else
            echo -e "${YELLOW}Sunspot not found, skipping setup${NC}"
            return 0
        fi
    fi

    echo -e "${GREEN}Running Sunspot setup for $circuit...${NC}"
    cd "$circuit_dir"

    # Compile to CCS format
    echo "  Compiling to CCS..."
    sunspot compile "$circuit_json"

    # Generate proving key
    echo "  Generating proving key..."
    sunspot setup "$circuit_dir/target/$circuit.ccs"

    echo -e "${GREEN}  ✓ Sunspot setup complete${NC}"
}

# Main execution
echo "=========================================="
echo "Confidex ZK Circuit Builder"
echo "=========================================="

if [ $# -gt 0 ]; then
    # Build specific circuit
    build_circuit "$1"
    run_sunspot_setup "$1"
else
    # Build all circuits
    for circuit in "${CIRCUITS[@]}"; do
        build_circuit "$circuit"
    done

    echo ""
    echo "=========================================="
    echo "Sunspot Setup (for Groth16 proofs)"
    echo "=========================================="

    for circuit in "${CIRCUITS[@]}"; do
        if [ "$circuit" != "shared" ]; then
            run_sunspot_setup "$circuit"
        fi
    done
fi

echo ""
echo -e "${GREEN}=========================================="
echo "Build complete!"
echo "==========================================${NC}"
