// Confidex Range Proof Circuit
// Proves that a hidden value lies within a specified range
//
// Public inputs:
// - commitment: Poseidon(value, blinding_factor)
// - min_bound: Minimum allowed value (inclusive)
// - max_bound: Maximum allowed value (inclusive)
//
// Private inputs:
// - value: The actual amount being proven
// - blinding_factor: Random blinding for the commitment
//
// Use case: Prove order amounts are within protocol limits without
// revealing the actual amount.

use shared::poseidon::commit;

/// Main circuit entry point
fn main(
    // Public inputs
    commitment: pub Field,
    min_bound: pub Field,
    max_bound: pub Field,
    // Private inputs
    value: Field,
    blinding_factor: Field
) {
    // 1. Verify the commitment matches the private value
    let computed_commitment = commit(value, blinding_factor);
    assert(commitment == computed_commitment, "Commitment verification failed");

    // 2. Verify value is within the specified range
    // Convert to u64 for safe comparison (handles Field wraparound)
    let value_u64 = value as u64;
    let min_u64 = min_bound as u64;
    let max_u64 = max_bound as u64;

    // Range check: min <= value <= max
    assert(value_u64 >= min_u64, "Value below minimum");
    assert(value_u64 <= max_u64, "Value above maximum");
}

/// Helper to generate a commitment for testing
fn make_commitment(value: Field, blinding: Field) -> Field {
    commit(value, blinding)
}

#[test]
fn test_valid_range_proof() {
    // Test case: value = 500, range = [100, 1000]
    let value: Field = 500;
    let blinding: Field = 12345678;
    let commitment = make_commitment(value, blinding);

    let min_bound: Field = 100;
    let max_bound: Field = 1000;

    // This should pass
    main(commitment, min_bound, max_bound, value, blinding);
}

#[test]
fn test_value_at_min() {
    // Test case: value exactly at minimum
    let value: Field = 100;
    let blinding: Field = 99999;
    let commitment = make_commitment(value, blinding);

    main(commitment, 100, 1000, value, blinding);
}

#[test]
fn test_value_at_max() {
    // Test case: value exactly at maximum
    let value: Field = 1000;
    let blinding: Field = 11111;
    let commitment = make_commitment(value, blinding);

    main(commitment, 100, 1000, value, blinding);
}

#[test(should_fail_with = "Value below minimum")]
fn test_value_below_min() {
    let value: Field = 50;
    let blinding: Field = 12345;
    let commitment = make_commitment(value, blinding);

    main(commitment, 100, 1000, value, blinding);
}

#[test(should_fail_with = "Value above maximum")]
fn test_value_above_max() {
    let value: Field = 2000;
    let blinding: Field = 12345;
    let commitment = make_commitment(value, blinding);

    main(commitment, 100, 1000, value, blinding);
}

#[test(should_fail_with = "Commitment verification failed")]
fn test_wrong_commitment() {
    let value: Field = 500;
    let blinding: Field = 12345;
    let wrong_commitment: Field = 99999; // Not the correct commitment

    main(wrong_commitment, 100, 1000, value, blinding);
}

#[test(should_fail_with = "Commitment verification failed")]
fn test_wrong_blinding() {
    let value: Field = 500;
    let correct_blinding: Field = 12345;
    let wrong_blinding: Field = 54321;
    let commitment = make_commitment(value, correct_blinding);

    // Try to prove with wrong blinding factor
    main(commitment, 100, 1000, value, wrong_blinding);
}

#[test]
fn test_large_value() {
    // Test with larger values (still within u64 range)
    let value: Field = 1_000_000_000; // 1 billion (e.g., 1000 USDC with 6 decimals)
    let blinding: Field = 987654321;
    let commitment = make_commitment(value, blinding);

    let min_bound: Field = 0;
    let max_bound: Field = 10_000_000_000; // 10 billion max

    main(commitment, min_bound, max_bound, value, blinding);
}

#[test]
fn test_zero_value() {
    // Edge case: zero value
    let value: Field = 0;
    let blinding: Field = 11111;
    let commitment = make_commitment(value, blinding);

    main(commitment, 0, 1000, value, blinding);
}

#[test]
fn print_sample_commitment() {
    // Print a sample commitment for testing integration
    let value: Field = 1000000; // 1 USDC (6 decimals)
    let blinding: Field = 0x1234567890abcdef;
    let commitment = make_commitment(value, blinding);

    std::println("Sample commitment:");
    std::println(commitment);
    std::println("Value:");
    std::println(value);
    std::println("Blinding:");
    std::println(blinding);
}
