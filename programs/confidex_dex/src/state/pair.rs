use anchor_lang::prelude::*;

/// Trading pair configuration account
/// Size: 8 (discriminator) + 226 = 234 bytes
#[account]
#[derive(Default)]
pub struct TradingPair {
    /// Base token mint (e.g., SOL)
    pub base_mint: Pubkey,

    /// Quote token mint (e.g., USDC)
    pub quote_mint: Pubkey,

    /// Confidential base token mint (C-SPL)
    pub c_base_mint: Pubkey,

    /// Confidential quote token mint (C-SPL)
    pub c_quote_mint: Pubkey,

    /// Confidential base token vault
    pub c_base_vault: Pubkey,

    /// Confidential quote token vault
    pub c_quote_vault: Pubkey,

    /// Minimum order size in base token units
    pub min_order_size: u64,

    /// Tick size for price increments
    pub tick_size: u64,

    /// Whether the pair is active for trading
    pub active: bool,

    /// Number of currently open orders
    pub open_order_count: u64,

    /// Pair index (sequential identifier)
    pub index: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl TradingPair {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // base_mint
        32 + // quote_mint
        32 + // c_base_mint
        32 + // c_quote_mint
        32 + // c_base_vault
        32 + // c_quote_vault
        8 +  // min_order_size
        8 +  // tick_size
        1 +  // active
        8 +  // open_order_count
        8 +  // index
        1;   // bump
    // Total: 234 bytes

    pub const SEED: &'static [u8] = b"pair";
}
