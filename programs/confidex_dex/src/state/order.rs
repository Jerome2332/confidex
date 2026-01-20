use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

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

/// Order status - simplified for privacy
/// Internally we track detailed states, but externally we only expose Active/Inactive
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum OrderStatus {
    #[default]
    /// Order is active and can be matched (includes open, partially filled, matching)
    Active,
    /// Order is no longer active (filled or cancelled)
    Inactive,
}

/// Internal order state for matching logic
/// This is NOT stored on-chain, used only during computation
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InternalOrderState {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Matching,
}

/// Confidential order account
/// All amounts and prices are encrypted via Arcium
/// V2: Hash-based IDs, coarse timestamps, simplified status
/// Size: 8 (discriminator) + 329 = 337 bytes
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

    /// Current order status (Active/Inactive only - privacy preserving)
    pub status: OrderStatus,

    /// Coarse timestamp when order was created (hour precision for privacy)
    pub created_at_hour: i64,

    /// Hash-based order ID (prevents activity correlation)
    /// Generated from hash(maker, pair, nonce)
    pub order_id: [u8; 16],

    /// Whether eligibility ZK proof has been verified
    pub eligibility_proof_verified: bool,

    /// Pending MPC match request ID (for async flow)
    /// All zeros if no pending request
    pub pending_match_request: [u8; 32],

    /// Internal matching state flag
    /// true = currently in MPC matching flow
    pub is_matching: bool,

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
        8 +  // created_at_hour
        16 + // order_id (hash-based)
        1 +  // eligibility_proof_verified
        32 + // pending_match_request
        1 +  // is_matching
        1;   // bump
    // Total: 337 bytes

    pub const SEED: &'static [u8] = b"order";

    /// Check if order is active and can participate in matching
    pub fn is_active(&self) -> bool {
        matches!(self.status, OrderStatus::Active) && !self.is_matching
    }

    /// Check if order is currently in MPC matching flow
    pub fn is_in_matching(&self) -> bool {
        self.is_matching && matches!(self.status, OrderStatus::Active)
    }

    pub fn has_pending_match(&self) -> bool {
        self.pending_match_request != [0u8; 32]
    }

    pub fn can_match(&self, other: &ConfidentialOrder) -> bool {
        // Orders must be on opposite sides
        self.side != other.side &&
        // Both must be active and not in matching
        self.is_active() && other.is_active() &&
        // Both must be on the same pair
        self.pair == other.pair &&
        // Both must have verified eligibility
        self.eligibility_proof_verified && other.eligibility_proof_verified
    }

    /// Generate hash-based order ID for privacy (no sequential correlation)
    pub fn generate_order_id(maker: &Pubkey, pair: &Pubkey, nonce: &[u8; 8]) -> [u8; 16] {
        let mut data = Vec::with_capacity(72);
        data.extend_from_slice(maker.as_ref());
        data.extend_from_slice(pair.as_ref());
        data.extend_from_slice(nonce);
        let hash_result = hash(&data);
        let mut id = [0u8; 16];
        id.copy_from_slice(&hash_result.as_ref()[..16]);
        id
    }

    /// Floor timestamp to nearest hour for privacy (3600-second granularity)
    pub fn coarse_timestamp(timestamp: i64) -> i64 {
        (timestamp / 3600) * 3600
    }
}
