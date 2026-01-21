use anchor_lang::prelude::*;

/// Global exchange state account (V5 - configurable program IDs)
///
/// Size: 8 (discriminator) + 254 = 262 bytes
///
/// V5 Changes:
/// - Added arcium_program_id, mxe_program_id, verifier_program_id for admin configuration
/// - Program IDs no longer hardcoded - can be updated via admin instruction
#[account]
#[derive(Default)]
pub struct ExchangeState {
    /// Authority that can update exchange settings
    pub authority: Pubkey,

    /// Account that receives trading fees
    pub fee_recipient: Pubkey,

    /// Maker fee in basis points (e.g., 10 = 0.10%)
    pub maker_fee_bps: u16,

    /// Taker fee in basis points (e.g., 30 = 0.30%)
    pub taker_fee_bps: u16,

    /// Whether trading is paused
    pub paused: bool,

    /// Merkle root of blacklisted addresses (for ZK exclusion proofs)
    pub blacklist_root: [u8; 32],

    /// Arcium cluster public key for MPC operations
    pub arcium_cluster: Pubkey,

    /// Total number of trading pairs created
    pub pair_count: u64,

    /// Total number of orders placed
    pub order_count: u64,

    /// PDA bump seed
    pub bump: u8,

    // =============================================================================
    // V5: CONFIGURABLE PROGRAM IDS (admin-updateable)
    // =============================================================================
    // These replace hardcoded constants in cpi/arcium.rs and cpi/verifier.rs
    // Admin can update these to switch MXE deployments or verifier programs
    // without redeploying the DEX program.
    // =============================================================================

    /// Arcium core program ID (for MPC operations)
    /// Default: Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ
    pub arcium_program_id: Pubkey,

    /// MXE program ID (our custom MXE wrapper)
    /// Default: CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE
    pub mxe_program_id: Pubkey,

    /// ZK verifier program ID (Sunspot eligibility verifier)
    /// Default: 9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W
    pub verifier_program_id: Pubkey,
}

impl ExchangeState {
    /// V5 account size - includes configurable program IDs
    /// Increased from 158 bytes to 254 bytes (+96 for 3 Pubkeys)
    ///
    /// Calculation:
    ///   discriminator:       8
    ///   authority:          32  (offset 8)
    ///   fee_recipient:      32  (offset 40)
    ///   maker_fee_bps:       2  (offset 72)
    ///   taker_fee_bps:       2  (offset 74)
    ///   paused:              1  (offset 76)
    ///   blacklist_root:     32  (offset 77)
    ///   arcium_cluster:     32  (offset 109)
    ///   pair_count:          8  (offset 141)
    ///   order_count:         8  (offset 149)
    ///   bump:                1  (offset 157)
    ///   arcium_program_id:  32  (offset 158) [V5]
    ///   mxe_program_id:     32  (offset 190) [V5]
    ///   verifier_program_id:32  (offset 222) [V5]
    ///   Total:             254 bytes
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        32 + // fee_recipient
        2 +  // maker_fee_bps
        2 +  // taker_fee_bps
        1 +  // paused
        32 + // blacklist_root
        32 + // arcium_cluster
        8 +  // pair_count
        8 +  // order_count
        1 +  // bump
        32 + // arcium_program_id (V5)
        32 + // mxe_program_id (V5)
        32;  // verifier_program_id (V5)
    // Total: 254 bytes

    pub const SEED: &'static [u8] = b"exchange";

    pub fn validate_fees(maker_fee_bps: u16, taker_fee_bps: u16) -> bool {
        maker_fee_bps <= 10000 && taker_fee_bps <= 10000
    }

    /// Validate program ID is non-zero (basic sanity check)
    pub fn validate_program_id(program_id: &Pubkey) -> bool {
        *program_id != Pubkey::default()
    }
}
