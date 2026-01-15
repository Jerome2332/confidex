//! Sunspot ZK Verifier CPI integration
//!
//! This module provides helpers for verifying Groth16 proofs
//! using the Sunspot verifier program deployed on Solana.
//!
//! The eligibility circuit proves:
//! - User's address is NOT in the blacklist (SMT non-membership)
//! - Proof is generated off-chain and verified on-chain
//!
//! Reference: https://github.com/reilabs/sunspot

use anchor_lang::prelude::*;

/// Sunspot Verifier Program ID (devnet)
/// This will be set after deploying the eligibility verifier circuit
pub const SUNSPOT_VERIFIER_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
]);

/// Groth16 proof size (compressed)
/// π = (A, B, C) where A, C are G1 points (64 bytes each) and B is G2 (128 bytes)
/// Plus some overhead for the proof format
pub const GROTH16_PROOF_SIZE: usize = 388;

/// Public inputs for the eligibility circuit
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EligibilityPublicInputs {
    /// Merkle root of the blacklist SMT (32 bytes)
    pub blacklist_root: [u8; 32],
}

/// Verification result
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VerificationResult {
    /// Proof is valid
    Valid,
    /// Proof is invalid
    Invalid,
    /// Verification failed (error)
    Failed,
}

/// Verify an eligibility proof using Sunspot
///
/// The proof demonstrates that the user's address is NOT in the blacklist
/// without revealing the address itself.
///
/// # Arguments
/// * `verifier_program` - The Sunspot verifier program account
/// * `proof` - The Groth16 proof (388 bytes)
/// * `blacklist_root` - The current blacklist merkle root (public input)
/// * `address` - The user's address (used to derive the expected witness)
///
/// # Returns
/// * `Ok(true)` if proof is valid
/// * `Ok(false)` if proof is invalid
/// * `Err(_)` if verification fails
pub fn verify_eligibility_proof(
    _verifier_program: &AccountInfo,
    proof: &[u8; GROTH16_PROOF_SIZE],
    blacklist_root: &[u8; 32],
    _address: &Pubkey,
) -> Result<bool> {
    // TODO: Implement actual CPI to Sunspot verifier
    //
    // The flow will be:
    // 1. Format public inputs (blacklist_root)
    // 2. CPI to Sunspot verifier with proof and public inputs
    // 3. Sunspot performs Groth16 verification on-chain
    // 4. Return result
    //
    // CPI instruction format (estimated):
    // - instruction discriminator: [u8; 8]
    // - proof: [u8; 388]
    // - public_inputs: Vec<[u8; 32]>

    msg!("Sunspot CPI: verify_eligibility_proof");
    msg!("  Blacklist root: {:?}", &blacklist_root[0..8]);
    msg!("  Proof length: {} bytes", proof.len());

    // Validate proof length
    if proof.len() != GROTH16_PROOF_SIZE {
        msg!("Invalid proof length");
        return Ok(false);
    }

    // For development, accept all proofs
    // This MUST be replaced with actual verification before production
    //
    // In production:
    // let ix = sunspot::verify_proof(proof, public_inputs);
    // invoke(&ix, &[verifier_program.clone()])?;
    // Parse result from account data

    msg!("Proof verification: ACCEPTED (development mode)");

    Ok(true)
}

/// Verify a generic Groth16 proof with custom public inputs
///
/// This is a more flexible version that can be used for other circuits
/// beyond just eligibility proofs.
pub fn verify_groth16_proof(
    _verifier_program: &AccountInfo,
    _verification_key_account: &AccountInfo,
    proof: &[u8],
    public_inputs: &[[u8; 32]],
) -> Result<VerificationResult> {
    msg!("Sunspot CPI: verify_groth16_proof");
    msg!("  Proof length: {} bytes", proof.len());
    msg!("  Public inputs count: {}", public_inputs.len());

    // Validate inputs
    if proof.len() != GROTH16_PROOF_SIZE {
        msg!("Invalid proof length");
        return Ok(VerificationResult::Invalid);
    }

    if public_inputs.is_empty() {
        msg!("No public inputs provided");
        return Ok(VerificationResult::Invalid);
    }

    // TODO: Actual CPI to Sunspot verifier
    // For development, accept all validly-formatted proofs

    Ok(VerificationResult::Valid)
}

/// Decode a Groth16 proof from bytes
///
/// Proof structure (BN254 curve):
/// - A: G1 point (64 bytes) - compressed
/// - B: G2 point (128 bytes) - compressed
/// - C: G1 point (64 bytes) - compressed
/// - Plus encoding overhead
#[derive(Clone)]
pub struct Groth16Proof {
    /// Point A on G1
    pub a: [u8; 64],
    /// Point B on G2
    pub b: [u8; 128],
    /// Point C on G1
    pub c: [u8; 64],
}

impl Groth16Proof {
    /// Parse a proof from bytes
    pub fn from_bytes(data: &[u8; GROTH16_PROOF_SIZE]) -> Option<Self> {
        // Simplified parsing - actual format depends on Sunspot encoding
        if data.len() < 256 {
            return None;
        }

        let mut a = [0u8; 64];
        let mut b = [0u8; 128];
        let mut c = [0u8; 64];

        a.copy_from_slice(&data[0..64]);
        b.copy_from_slice(&data[64..192]);
        c.copy_from_slice(&data[192..256]);

        Some(Self { a, b, c })
    }
}

/// Generate a placeholder proof for testing
/// WARNING: This is for development only and produces invalid proofs
pub fn generate_test_proof() -> [u8; GROTH16_PROOF_SIZE] {
    let mut proof = [0u8; GROTH16_PROOF_SIZE];

    // Fill with deterministic test data
    for (i, byte) in proof.iter_mut().enumerate() {
        *byte = (i % 256) as u8;
    }

    proof
}
