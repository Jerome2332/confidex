// Poseidon2 Hash Helpers
// Provides convenient wrappers around std::hash::poseidon2_permutation

use std::hash::poseidon2_permutation;

/// Hash two field elements into one using Poseidon2
/// This is the core building block for merkle trees
pub fn hash_2(left: Field, right: Field) -> Field {
    let state: [Field; 4] = [left, right, 0, 0];
    let result = poseidon2_permutation(state, 4);
    result[0]
}

/// Hash three field elements into one using Poseidon2
/// Useful for merkle-sum trees: H(left_hash, right_hash, sum)
pub fn hash_3(a: Field, b: Field, c: Field) -> Field {
    let state: [Field; 4] = [a, b, c, 0];
    let result = poseidon2_permutation(state, 4);
    result[0]
}

/// Hash N field elements into one using Poseidon2
/// Uses sponge construction for variable-length input
pub fn hash_n<let N: u32>(inputs: [Field; N]) -> Field {
    // For inputs up to 3 elements, use single permutation
    if N <= 3 {
        let mut state: [Field; 4] = [0; 4];
        for i in 0..N {
            state[i] = inputs[i];
        }
        let result = poseidon2_permutation(state, 4);
        return result[0];
    }

    // For longer inputs, use sponge construction
    // Process 3 elements at a time (rate = 3, capacity = 1)
    let mut state: [Field; 4] = [0; 4];

    // Absorb phase
    let mut i: u32 = 0;
    for _ in 0..(N / 3) {
        state[0] = state[0] + inputs[i];
        state[1] = state[1] + inputs[i + 1];
        state[2] = state[2] + inputs[i + 2];
        state = poseidon2_permutation(state, 4);
        i += 3;
    }

    // Handle remaining elements
    let remaining = N % 3;
    if remaining > 0 {
        state[0] = state[0] + inputs[i];
        if remaining > 1 {
            state[1] = state[1] + inputs[i + 1];
        }
        state = poseidon2_permutation(state, 4);
    }

    // Squeeze phase - return first element
    state[0]
}

/// Create a commitment to a value with a blinding factor
/// commitment = Poseidon2(value, blinding_factor)
pub fn commit(value: Field, blinding: Field) -> Field {
    hash_2(value, blinding)
}

/// Create a commitment to multiple values with a blinding factor
/// commitment = Poseidon2(v1, v2, ..., vn, blinding)
pub fn commit_n<let N: u32>(values: [Field; N], blinding: Field) -> Field {
    let mut inputs: [Field; 10] = [0; 10]; // Max 9 values + 1 blinding
    assert(N < 10, "Too many values for commitment");

    for i in 0..N {
        inputs[i] = values[i];
    }
    inputs[N] = blinding;

    // Hash all inputs
    hash_n(inputs)
}

#[test]
fn test_hash_2() {
    // Test that hash_2(0, 0) produces expected empty tree level 1 hash
    let result = hash_2(0, 0);
    // This should match the pre-computed value in blacklist.ts
    // 0x18dfb8dc9b82229cff974efefc8df78b1ce96d9d844236b496785c698bc6732e
    std::println(result);
}

#[test]
fn test_hash_3() {
    let result = hash_3(1, 2, 3);
    std::println(result);
}

#[test]
fn test_commit() {
    let value = 1000; // e.g., amount
    let blinding = 12345; // random blinding factor
    let commitment = commit(value, blinding);
    std::println(commitment);

    // Verify commitment is reproducible
    let commitment2 = commit(value, blinding);
    assert(commitment == commitment2);
}
