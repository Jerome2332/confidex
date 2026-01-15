use anchor_lang::prelude::*;

/// Global exchange state account
/// Size: 8 (discriminator) + 150 = 158 bytes
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
}

impl ExchangeState {
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
        1;   // bump
    // Total: 158 bytes

    pub const SEED: &'static [u8] = b"exchange";

    pub fn validate_fees(maker_fee_bps: u16, taker_fee_bps: u16) -> bool {
        maker_fee_bps <= 10000 && taker_fee_bps <= 10000
    }
}
