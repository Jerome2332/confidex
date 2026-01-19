// Confidex Eligibility Circuit - Poseidon2 / Sunspot Compatible
// Proves SMT non-membership for blacklist checking
//
// Public inputs: blacklist_root (merkle root of blacklist SMT)
// Private inputs: merkle_path, path_indices
//
// The circuit proves that a specific path in the SMT leads to an empty leaf,
// demonstrating that the address (derived from path_indices) is NOT blacklisted.

use std::hash::poseidon2_permutation;

// Tree depth - supports 2^20 = ~1M addresses
global TREE_DEPTH: u32 = 20;

// Poseidon2 sponge hash for 2 inputs -> 1 output
fn hash_2(left: Field, right: Field) -> Field {
    let state: [Field; 4] = [left, right, 0, 0];
    let result = poseidon2_permutation(state, 4);
    result[0]
}

// Verify SMT non-membership by checking path leads to empty leaf
fn verify_smt_non_membership(
    root: Field,
    merkle_path: [Field; TREE_DEPTH],
    path_indices: [Field; TREE_DEPTH]
) -> bool {
    // Start with empty leaf (0) - we're proving this slot is empty
    let mut current: Field = 0;
    
    // Traverse up the tree from leaf to root
    for i in 0..TREE_DEPTH {
        let sibling = merkle_path[i];
        let is_right = path_indices[i];
        
        // Position current node based on path direction
        let (left, right) = if is_right == 1 {
            (sibling, current)
        } else {
            (current, sibling)
        };
        
        current = hash_2(left, right);
    }
    
    // Computed root must match public blacklist root
    current == root
}

// Main circuit entry point
fn main(
    blacklist_root: pub Field,
    merkle_path: [Field; TREE_DEPTH],
    path_indices: [Field; TREE_DEPTH]
) {
    let valid = verify_smt_non_membership(blacklist_root, merkle_path, path_indices);
    assert(valid, "Address is blacklisted or proof invalid");
}

// Test: compute empty tree values
#[test]
fn print_empty_tree_values() {
    let mut h: [Field; 21] = [0; 21];
    h[0] = 0;
    for i in 1..21 {
        h[i] = hash_2(h[i-1], h[i-1]);
    }
    std::println(h[20]); // root
    for i in 0..20 {
        std::println(h[i]);
    }
}
