use anchor_lang::prelude::*;

/// Trader's ZK eligibility status
/// Tracks whether a trader has been verified as not on blacklist
/// This allows splitting ZK verification from position operations to avoid stack overflow
#[account]
pub struct TraderEligibility {
    /// Owner of this eligibility record
    pub trader: Pubkey,
    /// Whether the trader's eligibility proof has been verified
    pub is_verified: bool,
    /// The blacklist root at time of verification
    /// If exchange blacklist root changes, verification is invalidated
    pub verified_blacklist_root: [u8; 32],
    /// Unix timestamp when eligibility was verified (second precision)
    pub verified_at: i64,
    /// Number of times eligibility has been verified
    pub verification_count: u32,
    /// PDA bump
    pub bump: u8,
}

impl TraderEligibility {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // trader
        1 +  // is_verified
        32 + // verified_blacklist_root
        8 +  // verified_at
        4 +  // verification_count
        1;   // bump
    // Total: 86 bytes

    pub const SEED: &'static [u8] = b"trader_eligibility";

    /// Check if eligibility is still valid for the current blacklist root
    pub fn is_valid(&self, current_blacklist_root: &[u8; 32]) -> bool {
        self.is_verified && self.verified_blacklist_root == *current_blacklist_root
    }
}
