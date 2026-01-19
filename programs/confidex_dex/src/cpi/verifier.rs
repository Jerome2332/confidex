//! Sunspot ZK Verifier CPI integration
//!
//! This module provides helpers for verifying Groth16 proofs
//! using the Sunspot verifier program deployed on Solana.
//!
//! The eligibility circuit proves:
//! - User's address is NOT in the blacklist (SMT non-membership)
//! - Proof is generated off-chain and verified on-chain
//!
//! Reference: https://github.com/solana-foundation/noir-examples

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke;

/// Sunspot Verifier Program ID (devnet)
/// Deployed verifier for the eligibility circuit
/// Rebuilt Jan 17 2026 with current verification key
/// Address: 9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W
pub const SUNSPOT_VERIFIER_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    // Base58: 9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W
    0x82, 0xdb, 0x6f, 0x8a, 0x7a, 0x8c, 0x1d, 0x85,
    0xb3, 0xfa, 0xfb, 0xf9, 0xfc, 0x10, 0xa1, 0x21,
    0x26, 0x36, 0x4d, 0x3c, 0x12, 0xa8, 0x34, 0x1c,
    0x94, 0xf4, 0x6d, 0x15, 0x0d, 0xe6, 0x6a, 0x01,
]);

/// Feature flag to enable/disable actual ZK verification
/// Set to true for production, false for development testing
pub const ZK_VERIFICATION_ENABLED: bool = true; // Production: Real ZK verification via Sunspot

/// Groth16 proof size for Sunspot/gnark format
/// Layout: A(64) + B(128) + C(64) + num_commitments(4) + commitment_pok(64) = 324 bytes
/// Note: proofs with Pedersen commitments are 324 + N*64 bytes
pub const GROTH16_PROOF_SIZE: usize = 324;

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
    verifier_program: &AccountInfo,
    proof: &[u8; GROTH16_PROOF_SIZE],
    blacklist_root: &[u8; 32],
    _address: &Pubkey,
) -> Result<bool> {
    msg!("Sunspot CPI: verify_eligibility_proof");
    msg!("  Blacklist root: {:?}", &blacklist_root[0..8]);
    msg!("  Proof length: {} bytes", proof.len());

    // Validate proof length
    if proof.len() != GROTH16_PROOF_SIZE {
        msg!("Invalid proof length");
        return Ok(false);
    }

    // Check if ZK verification is enabled
    if !ZK_VERIFICATION_ENABLED {
        msg!("ZK verification DISABLED - accepting proof without verification");
        return Ok(true);
    }

    // Build CPI instruction data: [proof_bytes || witness_bytes]
    // Sunspot/gnark witness format:
    // - num_inputs (u32 BE): 1
    // - padding (4 bytes): 0
    // - num_field_elements (u32 BE): 1
    // - blacklist_root (32 bytes)
    // Total witness: 44 bytes
    let mut verifier_data = Vec::with_capacity(GROTH16_PROOF_SIZE + 44);
    verifier_data.extend_from_slice(proof);
    // Build witness in gnark format
    verifier_data.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]); // num_inputs = 1 (BE)
    verifier_data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // padding
    verifier_data.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]); // num_field_elements = 1 (BE)
    verifier_data.extend_from_slice(blacklist_root);

    // Build the CPI instruction
    // Sunspot verifiers take zero accounts - all data is in instruction
    let verify_ix = Instruction {
        program_id: verifier_program.key(),
        accounts: vec![],
        data: verifier_data,
    };

    msg!("Invoking Sunspot verifier at: {}", verifier_program.key());

    // Invoke the verifier program
    // If the proof is invalid, this will return an error
    match invoke(&verify_ix, &[]) {
        Ok(_) => {
            msg!("ZK proof verification: VALID");
            Ok(true)
        }
        Err(e) => {
            msg!("ZK proof verification FAILED: {:?}", e);
            Ok(false)
        }
    }
}

/// Verify a generic Groth16 proof with custom public inputs
///
/// This is a more flexible version that can be used for other circuits
/// beyond just eligibility proofs (e.g., range proofs, solvency proofs).
///
/// # Arguments
/// * `verifier_program` - The Sunspot verifier program account for this specific circuit
/// * `_verification_key_account` - Reserved for future use (some verifiers may store VK on-chain)
/// * `proof` - The Groth16 proof (324 bytes standard, may be larger with commitments)
/// * `public_inputs` - Array of 32-byte field elements as public inputs
///
/// # Returns
/// * `VerificationResult::Valid` - Proof verified successfully
/// * `VerificationResult::Invalid` - Proof verification failed
/// * `VerificationResult::Failed` - Error during verification
pub fn verify_groth16_proof(
    verifier_program: &AccountInfo,
    _verification_key_account: &AccountInfo,
    proof: &[u8],
    public_inputs: &[[u8; 32]],
) -> Result<VerificationResult> {
    msg!("Sunspot CPI: verify_groth16_proof");
    msg!("  Verifier program: {}", verifier_program.key());
    msg!("  Proof length: {} bytes", proof.len());
    msg!("  Public inputs count: {}", public_inputs.len());

    // Validate proof length (must be at least standard size)
    if proof.len() < GROTH16_PROOF_SIZE {
        msg!("Invalid proof length: {} < {}", proof.len(), GROTH16_PROOF_SIZE);
        return Ok(VerificationResult::Invalid);
    }

    if public_inputs.is_empty() {
        msg!("No public inputs provided");
        return Ok(VerificationResult::Invalid);
    }

    // Check if ZK verification is enabled
    if !ZK_VERIFICATION_ENABLED {
        msg!("ZK verification DISABLED - accepting proof without verification");
        return Ok(VerificationResult::Valid);
    }

    // Build CPI instruction data: [proof_bytes || witness_bytes]
    // Sunspot/gnark witness format:
    // - num_inputs (u32 BE): number of public inputs
    // - padding (4 bytes): 0
    // - num_field_elements (u32 BE): number of field elements
    // - inputs (32 bytes each): field element data
    //
    // Total witness: 12 + (public_inputs.len() * 32) bytes
    let num_inputs = public_inputs.len() as u32;
    let witness_size = 12 + (public_inputs.len() * 32);
    let mut verifier_data = Vec::with_capacity(proof.len() + witness_size);

    // Copy proof bytes
    verifier_data.extend_from_slice(proof);

    // Build witness in gnark format
    verifier_data.extend_from_slice(&num_inputs.to_be_bytes()); // num_inputs (BE)
    verifier_data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // padding
    verifier_data.extend_from_slice(&num_inputs.to_be_bytes()); // num_field_elements (BE)

    // Append each public input as a 32-byte field element
    for input in public_inputs {
        verifier_data.extend_from_slice(input);
    }

    // Build the CPI instruction
    // Sunspot verifiers take zero accounts - all data is in instruction
    let verify_ix = Instruction {
        program_id: verifier_program.key(),
        accounts: vec![],
        data: verifier_data,
    };

    msg!("Invoking Sunspot verifier with {} inputs", num_inputs);

    // Invoke the verifier program
    // If the proof is invalid, this will return an error
    match invoke(&verify_ix, &[]) {
        Ok(_) => {
            msg!("ZK proof verification: VALID");
            Ok(VerificationResult::Valid)
        }
        Err(e) => {
            msg!("ZK proof verification FAILED: {:?}", e);
            Ok(VerificationResult::Invalid)
        }
    }
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
