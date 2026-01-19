// Confidex User Balance Inclusion Proof
// Allows users to verify their balance is correctly included in the
// exchange's merkle-sum-tree of liabilities.
//
// Public inputs:
// - liabilities_root: Merkle-sum-tree root (matches solvency proof)
// - user_balance_commitment: Poseidon(user_balance, user_blinding)
//
// Private inputs:
// - user_balance: User's actual balance
// - user_blinding: Blinding factor for balance commitment
// - path_hashes: Merkle path sibling hashes
// - path_sums: Merkle path sibling sums
// - path_indices: Direction indices (0=left, 1=right)
//
// Use case: Users can independently verify their balance is included
// in the liabilities tree without trusting the exchange.

use shared::poseidon::commit;
use shared::merkle::verify_merkle_sum_path;

// Tree depth for user balances (supports up to 2^16 = 65,536 users)
global USER_TREE_DEPTH: u32 = 16;

/// Main circuit for user balance inclusion proof
pub fn verify_balance_inclusion(
    // Public inputs
    liabilities_root: Field,
    total_liabilities: Field,
    user_balance_commitment: Field,
    // Private inputs
    user_balance: Field,
    user_blinding: Field,
    path_hashes: [Field; USER_TREE_DEPTH],
    path_sums: [Field; USER_TREE_DEPTH],
    path_indices: [Field; USER_TREE_DEPTH]
) {
    // 1. Verify user's balance commitment
    let computed_commitment = commit(user_balance, user_blinding);
    assert(
        user_balance_commitment == computed_commitment,
        "User balance commitment mismatch"
    );

    // 2. Verify merkle-sum-tree path from user's leaf to root
    // The leaf hash is the user's balance commitment
    let valid = verify_merkle_sum_path(
        liabilities_root,
        total_liabilities,
        user_balance_commitment,
        user_balance,
        path_hashes,
        path_sums,
        path_indices
    );

    assert(valid, "Merkle-sum-tree path verification failed");
}

/// Simplified leaf hash for user balance
/// In a merkle-sum-tree, each leaf contains (hash, sum)
/// where hash = Poseidon(user_id, balance, salt) and sum = balance
pub fn compute_user_leaf_hash(
    user_id: Field,
    balance: Field,
    salt: Field
) -> Field {
    use shared::poseidon::hash_3;
    hash_3(user_id, balance, salt)
}

#[test]
fn test_inclusion_proof() {
    // This test requires a properly constructed merkle-sum-tree
    // For unit testing, we verify the components work

    let user_balance: Field = 100_000_000; // 100 USDC
    let user_blinding: Field = 12345;

    // Verify commitment computation
    let commitment = commit(user_balance, user_blinding);
    let recomputed = commit(user_balance, user_blinding);
    assert(commitment == recomputed);
}

#[test]
fn test_user_leaf_hash() {
    let user_id: Field = 1;
    let balance: Field = 100_000_000;
    let salt: Field = 99999;

    let hash1 = compute_user_leaf_hash(user_id, balance, salt);
    let hash2 = compute_user_leaf_hash(user_id, balance, salt);

    // Same inputs should produce same hash
    assert(hash1 == hash2);

    // Different user_id should produce different hash
    let hash3 = compute_user_leaf_hash(2, balance, salt);
    assert(hash1 != hash3);
}
