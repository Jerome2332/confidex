use anchor_lang::prelude::*;

/// Maximum number of supported token mints per user ShadowWire account
pub const MAX_SUPPORTED_MINTS: usize = 10;

/// User's ShadowWire account linking their wallet to ShadowWire pools
///
/// This account is created during user onboarding to enable ShadowWire settlement.
/// It stores the mapping between the user's Solana wallet and their ShadowWire pool,
/// along with which tokens they've enabled for private settlement.
///
/// Users must register before their orders can be settled via ShadowWire.
/// They can deposit funds to their pool through the ShadowWire API/frontend.
#[account]
pub struct UserShadowWireAccount {
    /// User's Solana wallet public key (owner of this account)
    pub owner: Pubkey,

    /// ShadowWire pool address for this user
    /// This is the user's unique identifier in the ShadowWire network
    pub pool_address: Pubkey,

    /// Number of supported mints currently registered
    pub mint_count: u8,

    /// Token mints this account can settle via ShadowWire
    /// Fixed-size array for deterministic account sizing
    pub supported_mints: [Pubkey; MAX_SUPPORTED_MINTS],

    /// Whether the user has completed onboarding and can use ShadowWire
    pub is_active: bool,

    /// Unix timestamp when account was created
    pub created_at: i64,

    /// Unix timestamp of last activity (deposit, withdraw, or settlement)
    pub last_activity: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl Default for UserShadowWireAccount {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            pool_address: Pubkey::default(),
            mint_count: 0,
            supported_mints: [Pubkey::default(); MAX_SUPPORTED_MINTS],
            is_active: false,
            created_at: 0,
            last_activity: 0,
            bump: 0,
        }
    }
}

impl UserShadowWireAccount {
    /// PDA seed prefix
    pub const SEED: &'static [u8] = b"shadowwire_user";

    /// Account size calculation
    /// discriminator (8) + owner (32) + pool_address (32) + mint_count (1) +
    /// supported_mints (32 * 10 = 320) + is_active (1) + created_at (8) +
    /// last_activity (8) + bump (1)
    pub const SIZE: usize = 8 + 32 + 32 + 1 + (32 * MAX_SUPPORTED_MINTS) + 1 + 8 + 8 + 1;
    // Total: 411 bytes

    /// Check if a mint is supported by this account
    pub fn supports_mint(&self, mint: &Pubkey) -> bool {
        for i in 0..self.mint_count as usize {
            if self.supported_mints[i] == *mint {
                return true;
            }
        }
        false
    }

    /// Add a mint to supported mints list
    /// Returns error if already at max capacity or mint already exists
    pub fn add_mint(&mut self, mint: Pubkey) -> Result<()> {
        // Check if already supported
        if self.supports_mint(&mint) {
            return Ok(()); // Already exists, no-op
        }

        // Check capacity
        require!(
            (self.mint_count as usize) < MAX_SUPPORTED_MINTS,
            ShadowWireError::MaxMintsExceeded
        );

        // Add mint
        self.supported_mints[self.mint_count as usize] = mint;
        self.mint_count += 1;

        Ok(())
    }

    /// Check if user can settle with ShadowWire
    pub fn can_settle(&self, base_mint: &Pubkey, quote_mint: &Pubkey) -> bool {
        self.is_active && self.supports_mint(base_mint) && self.supports_mint(quote_mint)
    }
}

/// ShadowWire-specific error codes
#[error_code]
pub enum ShadowWireError {
    #[msg("Maximum supported mints exceeded (limit: 10)")]
    MaxMintsExceeded,

    #[msg("User ShadowWire account not active")]
    AccountNotActive,

    #[msg("Token mint not supported by user's ShadowWire account")]
    MintNotSupported,

    #[msg("ShadowWire pool address mismatch")]
    PoolAddressMismatch,
}
