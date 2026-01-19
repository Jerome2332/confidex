//! Pending Match State
//!
//! Tracks the state of an order match that's awaiting MPC computation results.

use anchor_lang::prelude::*;

/// Tracks a pending match between two orders awaiting MPC results
#[account]
pub struct PendingMatch {
    /// MPC request ID (links to arcium_mxe computation request)
    pub request_id: [u8; 32],
    /// Buy order being matched
    pub buy_order: Pubkey,
    /// Sell order being matched
    pub sell_order: Pubkey,
    /// Trading pair
    pub trading_pair: Pubkey,
    /// Result of price comparison (None if pending)
    pub compare_result: Option<bool>,
    /// Result of fill calculation (None if pending)
    pub fill_result: Option<[u8; 64]>,
    /// Status
    pub status: PendingMatchStatus,
    /// Created timestamp
    pub created_at: i64,
    /// Last update timestamp
    pub updated_at: i64,
    /// PDA bump
    pub bump: u8,
}

impl PendingMatch {
    pub const SIZE: usize = 8 + // discriminator
        32 + // request_id
        32 + // buy_order
        32 + // sell_order
        32 + // trading_pair
        1 + 1 + // compare_result Option<bool>
        1 + 64 + // fill_result Option<[u8; 64]>
        1 + // status
        8 + // created_at
        8 + // updated_at
        1; // bump

    pub const SEED: &'static [u8] = b"pending_match";
}

/// Status of a pending match
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum PendingMatchStatus {
    /// Waiting for price comparison result
    #[default]
    AwaitingCompare,
    /// Waiting for fill calculation result
    AwaitingFill,
    /// Match completed successfully
    Matched,
    /// Prices didn't match
    NoMatch,
    /// Computation failed
    Failed,
}
