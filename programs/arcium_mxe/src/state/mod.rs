use anchor_lang::prelude::*;

/// MXE configuration state
#[account]
pub struct MxeConfig {
    /// Authority that can update configuration
    pub authority: Pubkey,
    /// Arcium cluster ID for this MXE
    pub cluster_id: Pubkey,
    /// Total computations queued
    pub computation_count: u64,
    /// Total computations completed
    pub completed_count: u64,
    /// PDA bump
    pub bump: u8,
}

impl MxeConfig {
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        32 + // cluster_id
        8 +  // computation_count
        8 +  // completed_count
        1;   // bump

    pub const SEED: &'static [u8] = b"mxe_config";
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
        1;   // bump

    pub const SEED: &'static [u8] = b"computation";

    /// Max size with typical encrypted inputs (2x 64-byte values + result)
    pub const MAX_SIZE: usize = Self::BASE_SIZE + 256 + 128;
}

/// Types of MPC computations supported
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ComputationType {
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
