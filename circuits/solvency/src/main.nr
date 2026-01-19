// Confidex Solvency Proof Circuit
// Proves that the exchange is solvent: reserves >= total liabilities
//
// Public inputs:
// - liabilities_root: Merkle-sum-tree root of user balances
// - total_liabilities: Sum of all user balances (at tree root)
// - reserves_commitment: Poseidon(actual_reserves, blinding)
// - solvency_ratio_bps: (reserves/liabilities) * 10000 in basis points
//
// Private inputs:
// - actual_reserves: Real reserve amount
// - reserves_blinding: Blinding factor for reserves commitment
//
// Use case: Exchange periodically proves solvency without revealing
// exact reserve amounts, only that reserves >= liabilities.

use shared::poseidon::commit;

/// Main circuit entry point - Basic solvency proof
fn main(
    // Public inputs
    liabilities_root: pub Field,
    total_liabilities: pub Field,
    reserves_commitment: pub Field,
    solvency_ratio_bps: pub Field,
    // Private inputs
    actual_reserves: Field,
    reserves_blinding: Field
) {
    // 1. Verify reserves commitment
    let computed_commitment = commit(actual_reserves, reserves_blinding);
    assert(reserves_commitment == computed_commitment, "Reserves commitment mismatch");

    // 2. Verify solvency: reserves >= liabilities
    let reserves_u64 = actual_reserves as u64;
    let liabilities_u64 = total_liabilities as u64;
    assert(reserves_u64 >= liabilities_u64, "Insolvent: reserves < liabilities");

    // 3. Verify claimed solvency ratio (within 1 basis point tolerance)
    // Ratio = (reserves / liabilities) * 10000 bps
    // To avoid division, we verify: claimed_ratio * liabilities ≈ reserves * 10000

    // Handle zero liabilities edge case
    if liabilities_u64 == 0 {
        // With zero liabilities, any non-negative reserves means 100% solvent
        // Ratio should be 10000 (100%) or higher
        assert(solvency_ratio_bps as u64 >= 10000, "Invalid ratio for zero liabilities");
    } else {
        // Compute expected ratio in bps
        let computed_ratio_bps = (reserves_u64 * 10000) / liabilities_u64;
        let claimed_ratio = solvency_ratio_bps as u64;

        // Allow 1 basis point tolerance for rounding
        let diff = if computed_ratio_bps > claimed_ratio {
            computed_ratio_bps - claimed_ratio
        } else {
            claimed_ratio - computed_ratio_bps
        };

        assert(diff <= 1, "Solvency ratio mismatch");
    }

    // Note: We don't verify the liabilities_root here.
    // That verification happens in a separate inclusion proof circuit
    // where users can verify their balance is in the tree.
    // This circuit only verifies reserves >= claimed total liabilities.

    // The liabilities_root is a public input so it can be verified
    // against the on-chain state separately.
    let _ = liabilities_root; // Acknowledge usage
}

/// Helper to compute reserves commitment
fn make_reserves_commitment(reserves: Field, blinding: Field) -> Field {
    commit(reserves, blinding)
}

#[test]
fn test_solvent_exchange() {
    // Exchange has 1000 USDC in reserves, 800 USDC in liabilities
    let reserves: Field = 1000_000_000; // 1000 USDC (6 decimals)
    let liabilities: Field = 800_000_000; // 800 USDC
    let blinding: Field = 12345678;

    let commitment = make_reserves_commitment(reserves, blinding);
    let liabilities_root: Field = 0x1234; // Placeholder
    let ratio_bps: Field = 12500; // 125% = (1000/800) * 10000

    main(liabilities_root, liabilities, commitment, ratio_bps, reserves, blinding);
}

#[test]
fn test_exactly_solvent() {
    // Edge case: reserves == liabilities (100% ratio)
    let reserves: Field = 1000_000_000;
    let liabilities: Field = 1000_000_000;
    let blinding: Field = 99999;

    let commitment = make_reserves_commitment(reserves, blinding);
    let ratio_bps: Field = 10000; // 100%

    main(0, liabilities, commitment, ratio_bps, reserves, blinding);
}

#[test]
fn test_zero_liabilities() {
    // Edge case: no liabilities (should pass with any positive reserves)
    let reserves: Field = 1000_000_000;
    let liabilities: Field = 0;
    let blinding: Field = 11111;

    let commitment = make_reserves_commitment(reserves, blinding);
    let ratio_bps: Field = 10000; // 100% (or any value >= 10000)

    main(0, liabilities, commitment, ratio_bps, reserves, blinding);
}

#[test(should_fail_with = "Insolvent: reserves < liabilities")]
fn test_insolvent() {
    // Exchange has less reserves than liabilities
    let reserves: Field = 800_000_000;
    let liabilities: Field = 1000_000_000;
    let blinding: Field = 12345;

    let commitment = make_reserves_commitment(reserves, blinding);
    let ratio_bps: Field = 8000; // 80%

    main(0, liabilities, commitment, ratio_bps, reserves, blinding);
}

#[test(should_fail_with = "Reserves commitment mismatch")]
fn test_wrong_commitment() {
    let reserves: Field = 1000_000_000;
    let liabilities: Field = 800_000_000;
    let blinding: Field = 12345;

    let wrong_commitment: Field = 99999;
    let ratio_bps: Field = 12500;

    main(0, liabilities, wrong_commitment, ratio_bps, reserves, blinding);
}

#[test(should_fail_with = "Solvency ratio mismatch")]
fn test_wrong_ratio() {
    let reserves: Field = 1000_000_000;
    let liabilities: Field = 800_000_000;
    let blinding: Field = 12345;

    let commitment = make_reserves_commitment(reserves, blinding);
    let wrong_ratio_bps: Field = 15000; // Claimed 150% but actual is 125%

    main(0, liabilities, commitment, wrong_ratio_bps, reserves, blinding);
}

#[test]
fn test_large_reserves() {
    // Test with large values
    let reserves: Field = 1_000_000_000_000; // 1M USDC
    let liabilities: Field = 500_000_000_000; // 500K USDC
    let blinding: Field = 987654321;

    let commitment = make_reserves_commitment(reserves, blinding);
    let ratio_bps: Field = 20000; // 200%

    main(0, liabilities, commitment, ratio_bps, reserves, blinding);
}

#[test]
fn print_sample_values() {
    // Print sample values for integration testing
    let reserves: Field = 1000_000_000;
    let liabilities: Field = 800_000_000;
    let blinding: Field = 0xabcdef123456;

    let commitment = make_reserves_commitment(reserves, blinding);

    std::println("Sample solvency proof values:");
    std::println("Reserves:");
    std::println(reserves);
    std::println("Liabilities:");
    std::println(liabilities);
    std::println("Blinding:");
    std::println(blinding);
    std::println("Commitment:");
    std::println(commitment);
}
