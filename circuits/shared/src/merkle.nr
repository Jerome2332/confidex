// Merkle Tree Utilities
// Provides generic merkle tree verification functions

use crate::poseidon::hash_2;
use crate::poseidon::hash_3;

/// Verify a merkle path leads from a leaf to the expected root
///
/// # Arguments
/// * `root` - Expected merkle root
/// * `leaf` - Leaf value to verify
/// * `path` - Array of sibling hashes along the path
/// * `indices` - Array of path directions (0 = left, 1 = right)
///
/// # Returns
/// * `bool` - True if the path is valid
pub fn verify_merkle_path<let DEPTH: u32>(
    root: Field,
    leaf: Field,
    path: [Field; DEPTH],
    indices: [Field; DEPTH]
) -> bool {
    let computed_root = compute_merkle_root(leaf, path, indices);
    computed_root == root
}

/// Compute the merkle root from a leaf and its path
///
/// # Arguments
/// * `leaf` - Starting leaf value
/// * `path` - Array of sibling hashes along the path
/// * `indices` - Array of path directions (0 = leaf is left, 1 = leaf is right)
///
/// # Returns
/// * `Field` - Computed merkle root
pub fn compute_merkle_root<let DEPTH: u32>(
    leaf: Field,
    path: [Field; DEPTH],
    indices: [Field; DEPTH]
) -> Field {
    let mut current = leaf;

    for i in 0..DEPTH {
        let sibling = path[i];
        let is_right = indices[i];

        // Position current node based on path direction
        let (left, right) = if is_right == 1 {
            (sibling, current)
        } else {
            (current, sibling)
        };

        current = hash_2(left, right);
    }

    current
}

/// Verify SMT non-membership by checking path leads to empty leaf
/// This is a specialized version for sparse merkle trees where
/// we prove a slot is empty (contains 0)
///
/// # Arguments
/// * `root` - Expected SMT root
/// * `path` - Array of sibling hashes
/// * `indices` - Array of path directions
///
/// # Returns
/// * `bool` - True if the slot at this path is empty
pub fn verify_smt_non_membership<let DEPTH: u32>(
    root: Field,
    path: [Field; DEPTH],
    indices: [Field; DEPTH]
) -> bool {
    // Start with empty leaf (0)
    let empty_leaf: Field = 0;
    verify_merkle_path(root, empty_leaf, path, indices)
}

/// Merkle-Sum-Tree node hash
/// Combines child hashes with their sum
///
/// # Arguments
/// * `left_hash` - Left child hash
/// * `right_hash` - Right child hash
/// * `sum` - Sum of values in this subtree
///
/// # Returns
/// * `Field` - Hash of this node
pub fn hash_sum_node(left_hash: Field, right_hash: Field, sum: Field) -> Field {
    hash_3(left_hash, right_hash, sum)
}

/// Verify a merkle-sum-tree path
/// Each node contains (hash, sum) where sum is the total of all leaves in subtree
///
/// # Arguments
/// * `root_hash` - Expected root hash
/// * `root_sum` - Expected total sum at root
/// * `leaf_hash` - Hash of the leaf value
/// * `leaf_value` - Actual value at leaf (for sum calculation)
/// * `path_hashes` - Sibling hashes along path
/// * `path_sums` - Sibling sums along path
/// * `indices` - Path directions
///
/// # Returns
/// * `bool` - True if path is valid and sums are correct
pub fn verify_merkle_sum_path<let DEPTH: u32>(
    root_hash: Field,
    root_sum: Field,
    leaf_hash: Field,
    leaf_value: Field,
    path_hashes: [Field; DEPTH],
    path_sums: [Field; DEPTH],
    indices: [Field; DEPTH]
) -> bool {
    let mut current_hash = leaf_hash;
    let mut current_sum = leaf_value;

    for i in 0..DEPTH {
        let sibling_hash = path_hashes[i];
        let sibling_sum = path_sums[i];
        let is_right = indices[i];

        // Compute new sum
        current_sum = current_sum + sibling_sum;

        // Position nodes based on path direction
        let (left_hash, right_hash) = if is_right == 1 {
            (sibling_hash, current_hash)
        } else {
            (current_hash, sibling_hash)
        };

        // Compute parent hash including sum
        current_hash = hash_sum_node(left_hash, right_hash, current_sum);
    }

    // Verify both hash and sum match expected root
    (current_hash == root_hash) & (current_sum == root_sum)
}

#[test]
fn test_merkle_path_verification() {
    // Create a simple 2-level tree
    // Leaves: [A, B, C, D]
    // Level 1: [H(A,B), H(C,D)]
    // Level 2 (root): H(H(A,B), H(C,D))

    let leaf_a: Field = 1;
    let leaf_b: Field = 2;
    let leaf_c: Field = 3;
    let leaf_d: Field = 4;

    let hash_ab = hash_2(leaf_a, leaf_b);
    let hash_cd = hash_2(leaf_c, leaf_d);
    let root = hash_2(hash_ab, hash_cd);

    // Verify leaf A (index 0b00 = left-left)
    let path_a: [Field; 2] = [leaf_b, hash_cd];
    let indices_a: [Field; 2] = [0, 0]; // A is always on left

    let valid = verify_merkle_path(root, leaf_a, path_a, indices_a);
    assert(valid);

    // Verify leaf D (index 0b11 = right-right)
    let path_d: [Field; 2] = [leaf_c, hash_ab];
    let indices_d: [Field; 2] = [1, 1]; // D is always on right

    let valid_d = verify_merkle_path(root, leaf_d, path_d, indices_d);
    assert(valid_d);
}

#[test]
fn test_smt_non_membership() {
    // For an empty tree, all leaves are 0
    // Empty subtree roots are pre-computed
    let empty: Field = 0;
    let h1 = hash_2(empty, empty);     // Level 1
    let h2 = hash_2(h1, h1);           // Level 2
    let root = hash_2(h2, h2);         // Level 3 (root for depth 3)

    // Prove slot at index 0 is empty
    let path: [Field; 3] = [empty, h1, h2];
    let indices: [Field; 3] = [0, 0, 0];

    let valid = verify_smt_non_membership(root, path, indices);
    assert(valid);
}
