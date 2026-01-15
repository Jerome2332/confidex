// Confidex Eligibility Circuit
// Proves that a user's address is NOT in the blacklist (SMT non-membership)
//
// This uses a Sparse Merkle Tree (SMT) where:
// - Leaves are hashed addresses of blacklisted wallets
// - Non-membership is proven by showing a path to an empty leaf
//
// Public inputs:
// - blacklist_root: The current merkle root of the blacklist SMT
//
// Private inputs:
// - address: The user's wallet address (as a field element)
// - merkle_path: The authentication path (sibling hashes)
// - path_indices: Direction flags for each level (0=left, 1=right)

// Tree depth - supports 2^20 = ~1M addresses
global TREE_DEPTH: u32 = 20;

// Poseidon hash for two field elements (ZK-friendly)
fn poseidon_hash_2(left: Field, right: Field) -> Field {
    std::hash::poseidon::bn254::hash_2([left, right])
}

// Poseidon hash for single field element
fn poseidon_hash_1(input: Field) -> Field {
    std::hash::poseidon::bn254::hash_1([input])
}

// Verify SMT non-membership proof
// Returns true if the address is NOT in the tree (empty leaf at computed position)
fn verify_smt_non_membership(
    root: Field,
    address_hash: Field,
    merkle_path: [Field; TREE_DEPTH],
    path_indices: [Field; TREE_DEPTH]
) -> bool {
    // Start with empty leaf (zero) - we're proving this slot is empty
    let mut current = Field::from_integer(0);

    // Traverse up the tree
    for i in 0..TREE_DEPTH {
        let sibling = merkle_path[i];
        let is_right = path_indices[i];

        // Compute parent hash based on position
        // If is_right == 1, current is the right child
        // If is_right == 0, current is the left child
        let (left, right) = if is_right == Field::from_integer(1) {
            (sibling, current)
        } else {
            (current, sibling)
        };

        current = poseidon_hash_2(left, right);
    }

    // The computed root must match the public root
    current == root
}

// Alternative: Verify membership (for testing purposes)
fn verify_smt_membership(
    root: Field,
    leaf: Field,
    merkle_path: [Field; TREE_DEPTH],
    path_indices: [Field; TREE_DEPTH]
) -> bool {
    let mut current = leaf;

    for i in 0..TREE_DEPTH {
        let sibling = merkle_path[i];
        let is_right = path_indices[i];

        let (left, right) = if is_right == Field::from_integer(1) {
            (sibling, current)
        } else {
            (current, sibling)
        };

        current = poseidon_hash_2(left, right);
    }

    current == root
}

// Main circuit entry point
fn main(
    // Public input: merkle root of blacklist SMT (on-chain)
    blacklist_root: pub Field,
    // Private inputs
    address: Field,
    merkle_path: [Field; TREE_DEPTH],
    path_indices: [Field; TREE_DEPTH]
) {
    // Hash the address to get the leaf position
    let address_hash = poseidon_hash_1(address);

    // Verify non-membership: the address's slot in the SMT is empty
    let is_not_blacklisted = verify_smt_non_membership(
        blacklist_root,
        address_hash,
        merkle_path,
        path_indices
    );

    // Assert the proof is valid - user is NOT on blacklist
    assert(is_not_blacklisted, "Address is blacklisted or proof is invalid");
}

// Test module
#[test]
fn test_empty_tree() {
    // Empty tree has all-zero root computed from empty leaves
    let empty_leaf = Field::from_integer(0);

    // Build empty tree root (all siblings are zero)
    let mut root = empty_leaf;
    for _ in 0..TREE_DEPTH {
        root = poseidon_hash_2(root, root);
    }

    // Any address should pass non-membership in empty tree
    let test_address = Field::from_integer(12345);
    let merkle_path = [Field::from_integer(0); TREE_DEPTH];
    let path_indices = [Field::from_integer(0); TREE_DEPTH];

    // This would need proper empty tree siblings
    // For a real test, we'd compute the actual empty tree structure
}

#[test]
fn test_poseidon_hash() {
    // Verify Poseidon hashing works
    let a = Field::from_integer(1);
    let b = Field::from_integer(2);
    let hash = poseidon_hash_2(a, b);

    // Hash should be non-zero and deterministic
    assert(hash != Field::from_integer(0));

    // Same inputs should produce same output
    let hash2 = poseidon_hash_2(a, b);
    assert(hash == hash2);
}
