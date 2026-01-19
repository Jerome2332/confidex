// Confidex Shared Circuit Library
// Common utilities for all ZK circuits
//
// This library provides:
// - Poseidon2 hash helpers
// - Merkle tree utilities
// - Common types and constants

mod poseidon;
mod merkle;

// Re-export commonly used items
pub use poseidon::hash_2;
pub use poseidon::hash_3;
pub use poseidon::hash_n;
pub use merkle::verify_merkle_path;
pub use merkle::compute_merkle_root;

// Tree depth constants
pub global TREE_DEPTH_20: u32 = 20;
pub global TREE_DEPTH_32: u32 = 32;

// Field element size in bits
pub global FIELD_BITS: u32 = 254;
