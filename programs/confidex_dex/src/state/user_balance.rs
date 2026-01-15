use anchor_lang::prelude::*;

/// User's confidential balance for a specific token
/// Tracks wrapped tokens before C-SPL integration
#[account]
pub struct UserConfidentialBalance {
    /// Owner of this balance
    pub owner: Pubkey,
    /// Token mint this balance is for
    pub mint: Pubkey,
    /// Encrypted balance (64 bytes via Arcium)
    /// For now, stores plaintext amount until Arcium integration
    pub encrypted_balance: [u8; 64],
    /// Total deposited (for auditing/debugging - remove in production)
    pub total_deposited: u64,
    /// Total withdrawn
    pub total_withdrawn: u64,
    /// PDA bump
    pub bump: u8,
}

impl UserConfidentialBalance {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // owner
        32 + // mint
        64 + // encrypted_balance
        8 +  // total_deposited
        8 +  // total_withdrawn
        1;   // bump
    // Total: 153 bytes

    pub const SEED: &'static [u8] = b"user_balance";

    /// Get current balance as u64 (development only - will be encrypted)
    pub fn get_balance(&self) -> u64 {
        u64::from_le_bytes(
            self.encrypted_balance[0..8].try_into().unwrap_or([0u8; 8])
        )
    }

    /// Set balance (development only - will use encrypted ops)
    pub fn set_balance(&mut self, amount: u64) {
        self.encrypted_balance[0..8].copy_from_slice(&amount.to_le_bytes());
    }
}
