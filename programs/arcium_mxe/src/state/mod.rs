use anchor_lang::prelude::*;

/// Arcium Program ID (devnet)
/// From @arcium-hq/client v0.6.2
/// Base58: Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ
pub const ARCIUM_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x92, 0x6f, 0x09, 0xaa, 0x6d, 0x48, 0x7d, 0xe2,
    0xd8, 0x8c, 0x37, 0x6a, 0x16, 0x1d, 0x07, 0x7f,
    0xb0, 0x81, 0x0b, 0x13, 0x23, 0x6b, 0x7c, 0x76,
    0x47, 0xa0, 0x70, 0x28, 0x03, 0xfa, 0x5d, 0x89,
]);

/// MXE configuration state
#[account]
pub struct MxeConfig {
    /// Authority that can update configuration
    pub authority: Pubkey,
    /// Arcium cluster ID for this MXE
    pub cluster_id: Pubkey,
    /// Cluster offset (123, 456, or 789 on devnet)
    pub cluster_offset: u16,
    /// Arcium program ID for CPI
    pub arcium_program: Pubkey,
    /// Total computations queued
    pub computation_count: u64,
    /// Total computations completed
    pub completed_count: u64,
    /// Authority bump for PDA signing
    pub authority_bump: u8,
    /// PDA bump
    pub bump: u8,
}

impl MxeConfig {
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        32 + // cluster_id
        2 +  // cluster_offset
        32 + // arcium_program
        8 +  // computation_count
        8 +  // completed_count
        1 +  // authority_bump
        1;   // bump

    pub const SEED: &'static [u8] = b"mxe_config";
    pub const AUTHORITY_SEED: &'static [u8] = b"mxe_authority";
}

/// Pending computation request
#[account]
pub struct ComputationRequest {
    /// Unique request ID
    pub request_id: [u8; 32],
    /// Type of computation
    pub computation_type: ComputationType,
    /// Requester (program that initiated)
    pub requester: Pubkey,
    /// Callback program
    pub callback_program: Pubkey,
    /// Callback instruction discriminator
    pub callback_discriminator: [u8; 8],
    /// Input data (encrypted values)
    pub inputs: Vec<u8>,
    /// Status
    pub status: ComputationStatus,
    /// Created timestamp
    pub created_at: i64,
    /// Completed timestamp (0 if pending)
    pub completed_at: i64,
    /// Result data (empty until completed)
    pub result: Vec<u8>,
    /// Callback account 1 (e.g., buy_order for order matching)
    pub callback_account_1: Pubkey,
    /// Callback account 2 (e.g., sell_order for order matching)
    pub callback_account_2: Pubkey,
    /// PDA bump
    pub bump: u8,
}

impl ComputationRequest {
    pub const BASE_SIZE: usize = 8 + // discriminator
        32 + // request_id
        1 +  // computation_type
        32 + // requester
        32 + // callback_program
        8 +  // callback_discriminator
        4 +  // inputs vec length prefix
        1 +  // status
        8 +  // created_at
        8 +  // completed_at
        4 +  // result vec length prefix
        32 + // callback_account_1
        32 + // callback_account_2
        1;   // bump

    pub const SEED: &'static [u8] = b"computation";

    /// Max size with typical encrypted inputs (2x 64-byte values + result)
    pub const MAX_SIZE: usize = Self::BASE_SIZE + 256 + 128;
}

/// Types of MPC computations supported
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ComputationType {
    // === Spot DEX Operations ===
    /// Compare two encrypted prices (returns encrypted bool)
    ComparePrices,
    /// Calculate fill amount from order sizes
    CalculateFill,
    /// Add two encrypted values
    Add,
    /// Subtract two encrypted values
    Subtract,
    /// Multiply two encrypted values
    Multiply,

    // === Perpetuals Operations ===
    /// Verify that claimed liquidation threshold matches encrypted position data
    /// Inputs: encrypted_collateral, encrypted_size, encrypted_entry_price, claimed_threshold (public)
    /// Output: valid (bool, revealed)
    VerifyPositionParams,
    /// Check if position should be liquidated based on mark price
    /// Inputs: encrypted_collateral, encrypted_size, encrypted_entry_price, mark_price (public)
    /// Output: should_liquidate (bool, revealed)
    CheckLiquidation,
    /// Calculate PnL for a position
    /// Inputs: encrypted_size, encrypted_entry_price, exit_price (public), is_long (public)
    /// Output: encrypted_pnl
    CalculatePnl,
    /// Calculate funding payment for a position
    /// Inputs: encrypted_size, funding_rate (public), funding_delta (public)
    /// Output: encrypted_funding_payment
    CalculateFunding,
    /// Calculate margin ratio for health check
    /// Inputs: encrypted_collateral, encrypted_size, encrypted_entry_price, mark_price (public)
    /// Output: margin_ratio_bps (u16, can be revealed for liquidation)
    CalculateMarginRatio,
    /// Update encrypted collateral after funding settlement
    /// Inputs: encrypted_collateral, encrypted_funding_payment
    /// Output: new_encrypted_collateral
    UpdateCollateral,
}

/// Status of a computation request
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum ComputationStatus {
    /// Queued, waiting for cluster pickup
    #[default]
    Pending,
    /// Being processed by Arx nodes
    Processing,
    /// Completed successfully
    Completed,
    /// Failed
    Failed,
    /// Expired (past valid_before window)
    Expired,
}
