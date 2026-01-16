use anchor_lang::prelude::*;

/// Position side (long or short)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum PositionSide {
    #[default]
    Long,
    Short,
}

/// Position status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum PositionStatus {
    #[default]
    Open,
    Closed,
    Liquidated,
    AutoDeleveraged,
}

/// Confidential perpetual position account
/// Core position data (size, entry price, collateral, PnL) is encrypted via Arcium
/// Liquidation thresholds are PUBLIC to enable liquidation without revealing position details
/// Size: 8 (discriminator) + 425 = 433 bytes
#[account]
pub struct ConfidentialPosition {
    /// Position owner's public key
    pub trader: Pubkey,

    /// Perpetual market this position belongs to
    pub market: Pubkey,

    /// Sequential position ID
    pub position_id: u64,

    /// Unix timestamp when position was opened
    pub created_at: i64,

    /// Unix timestamp of last update
    pub last_updated: i64,

    /// Position side (PUBLIC: needed for funding direction)
    pub side: PositionSide,

    /// Leverage level 1-20x (PUBLIC: needed for risk management)
    pub leverage: u8,

    // === ENCRYPTED CORE DATA (256 bytes total) ===

    /// Encrypted position size in underlying units (64 bytes via Arcium)
    pub encrypted_size: [u8; 64],

    /// Encrypted average entry price (64 bytes via Arcium)
    pub encrypted_entry_price: [u8; 64],

    /// Encrypted collateral/margin amount in USDC (64 bytes via Arcium)
    pub encrypted_collateral: [u8; 64],

    /// Encrypted accumulated realized PnL (64 bytes via Arcium)
    pub encrypted_realized_pnl: [u8; 64],

    // === PUBLIC LIQUIDATION THRESHOLDS ===
    // These MUST be public for the liquidation engine to work
    // They are verified by MPC to match the encrypted position data

    /// Mark price below which longs can be liquidated (in quote decimals)
    pub liquidatable_below_price: u64,

    /// Mark price above which shorts can be liquidated (in quote decimals)
    pub liquidatable_above_price: u64,

    /// Unix timestamp of last threshold update
    pub last_threshold_update: i64,

    /// Whether MPC has verified the threshold matches position data
    pub threshold_verified: bool,

    // === FUNDING ===

    /// Cumulative funding at position entry (for calculating funding owed)
    pub entry_cumulative_funding: i128,

    // === STATUS ===

    /// Current position status
    pub status: PositionStatus,

    /// Whether eligibility ZK proof has been verified
    pub eligibility_proof_verified: bool,

    /// Number of partial closes performed
    pub partial_close_count: u8,

    // === AUTO-DELEVERAGE ===

    /// Priority ranking for ADL (higher = deleveraged first)
    pub auto_deleverage_priority: u64,

    // === MARGIN MANAGEMENT ===

    /// Unix timestamp of last margin addition
    pub last_margin_add: i64,

    /// Number of times margin has been added
    pub margin_add_count: u8,

    /// PDA bump seed
    pub bump: u8,
}

impl ConfidentialPosition {
    pub const SIZE: usize = 8 +   // discriminator
        32 +  // trader
        32 +  // market
        8 +   // position_id
        8 +   // created_at
        8 +   // last_updated
        1 +   // side
        1 +   // leverage
        64 +  // encrypted_size
        64 +  // encrypted_entry_price
        64 +  // encrypted_collateral
        64 +  // encrypted_realized_pnl
        8 +   // liquidatable_below_price
        8 +   // liquidatable_above_price
        8 +   // last_threshold_update
        1 +   // threshold_verified
        16 +  // entry_cumulative_funding (i128)
        1 +   // status
        1 +   // eligibility_proof_verified
        1 +   // partial_close_count
        8 +   // auto_deleverage_priority
        8 +   // last_margin_add
        1 +   // margin_add_count
        1;    // bump
    // Total: 433 bytes

    pub const SEED: &'static [u8] = b"position";

    /// Check if position is open and can be modified
    pub fn is_open(&self) -> bool {
        matches!(self.status, PositionStatus::Open)
    }

    /// Check if position can be liquidated based on mark price
    /// This is a PUBLIC check using public liquidation thresholds
    pub fn is_liquidatable(&self, mark_price: u64) -> bool {
        if !self.is_open() || !self.threshold_verified {
            return false;
        }

        match self.side {
            PositionSide::Long => mark_price <= self.liquidatable_below_price,
            PositionSide::Short => mark_price >= self.liquidatable_above_price,
        }
    }

    /// Check if position is at risk (approaching liquidation)
    /// Returns true if price is within 10% of liquidation threshold
    pub fn is_at_risk(&self, mark_price: u64) -> bool {
        if !self.is_open() || !self.threshold_verified {
            return false;
        }

        match self.side {
            PositionSide::Long => {
                // At risk if price is within 10% above liquidation price
                let risk_threshold = self.liquidatable_below_price
                    .saturating_mul(110)
                    .saturating_div(100);
                mark_price <= risk_threshold
            }
            PositionSide::Short => {
                // At risk if price is within 10% below liquidation price
                let risk_threshold = self.liquidatable_above_price
                    .saturating_mul(90)
                    .saturating_div(100);
                mark_price >= risk_threshold
            }
        }
    }
}
