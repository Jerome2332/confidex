use anchor_lang::prelude::*;

/// Order side (buy or sell)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum Side {
    #[default]
    Buy,
    Sell,
}

/// Order type
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum OrderType {
    #[default]
    Limit,
    Market,
}

/// Order status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum OrderStatus {
    #[default]
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    /// Pending async MPC match computation
    Matching,
}

/// Confidential order account
/// All amounts and prices are encrypted via Arcium
/// Size: 8 (discriminator) + 277 = 285 bytes
#[account]
pub struct ConfidentialOrder {
    /// Order maker's public key
    pub maker: Pubkey,

    /// Trading pair this order belongs to
    pub pair: Pubkey,

    /// Buy or Sell
    pub side: Side,

    /// Limit or Market
    pub order_type: OrderType,

    /// Encrypted order amount (64 bytes via Arcium)
    pub encrypted_amount: [u8; 64],

    /// Encrypted limit price (64 bytes via Arcium)
    pub encrypted_price: [u8; 64],

    /// Encrypted filled amount (64 bytes via Arcium)
    pub encrypted_filled: [u8; 64],

    /// Current order status
    pub status: OrderStatus,

    /// Unix timestamp when order was created
    pub created_at: i64,

    /// Sequential order ID
    pub order_id: u64,

    /// Whether eligibility ZK proof has been verified
    pub eligibility_proof_verified: bool,

    /// Pending MPC match request ID (for async flow)
    /// All zeros if no pending request
    pub pending_match_request: [u8; 32],

    /// PDA bump seed
    pub bump: u8,
}

impl ConfidentialOrder {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // maker
        32 + // pair
        1 +  // side
        1 +  // order_type
        64 + // encrypted_amount
        64 + // encrypted_price
        64 + // encrypted_filled
        1 +  // status
        8 +  // created_at
        8 +  // order_id
        1 +  // eligibility_proof_verified
        32 + // pending_match_request
        1;   // bump
    // Total: 317 bytes

    pub const SEED: &'static [u8] = b"order";

    pub fn is_open(&self) -> bool {
        matches!(self.status, OrderStatus::Open | OrderStatus::PartiallyFilled | OrderStatus::Matching)
    }

    pub fn has_pending_match(&self) -> bool {
        self.pending_match_request != [0u8; 32]
    }

    pub fn can_match(&self, other: &ConfidentialOrder) -> bool {
        // Orders must be on opposite sides
        self.side != other.side &&
        // Both must be open
        self.is_open() && other.is_open() &&
        // Both must be on the same pair
        self.pair == other.pair &&
        // Both must have verified eligibility
        self.eligibility_proof_verified && other.eligibility_proof_verified
    }
}
