use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

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
    /// Pending MPC verification of liquidation eligibility
    PendingLiquidationCheck,
}

/// Confidential perpetual position account
/// Core position data (size, entry price, collateral, PnL) is encrypted via Arcium
/// Liquidation thresholds are now ENCRYPTED for full privacy
/// Size: 8 (discriminator) + 553 = 561 bytes
#[account]
pub struct ConfidentialPosition {
    /// Position owner's public key
    pub trader: Pubkey,

    /// Perpetual market this position belongs to
    pub market: Pubkey,

    /// Hash-based position ID (derived from trader + market + nonce)
    /// Prevents activity correlation via sequential IDs
    pub position_id: [u8; 16],

    /// Coarse timestamp when position was opened (hour precision)
    /// Reduces temporal correlation attacks
    pub created_at_hour: i64,

    /// Coarse timestamp of last update (hour precision)
    pub last_updated_hour: i64,

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

    // === ENCRYPTED LIQUIDATION THRESHOLDS (128 bytes) ===
    // These are now ENCRYPTED for full privacy
    // Liquidation eligibility is verified via MPC batch checks

    /// Encrypted mark price below which longs can be liquidated (64 bytes via Arcium)
    pub encrypted_liq_below: [u8; 64],

    /// Encrypted mark price above which shorts can be liquidated (64 bytes via Arcium)
    pub encrypted_liq_above: [u8; 64],

    /// Commitment hash for threshold verification: hash(entry_price || leverage || mm_bps || side)
    /// Used to verify threshold wasn't tampered with
    pub threshold_commitment: [u8; 32],

    /// Coarse timestamp of last threshold update (hour precision)
    pub last_threshold_update_hour: i64,

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

    /// Coarse timestamp of last margin addition (hour precision)
    pub last_margin_add_hour: i64,

    /// Number of times margin has been added
    pub margin_add_count: u8,

    /// PDA bump seed
    pub bump: u8,

    /// The position_count value used in PDA seed derivation
    /// Stored so close_position can derive the same PDA
    pub position_seed: u64,
}

impl ConfidentialPosition {
    pub const SIZE: usize = 8 +   // discriminator
        32 +  // trader
        32 +  // market
        16 +  // position_id (hash-based)
        8 +   // created_at_hour
        8 +   // last_updated_hour
        1 +   // side
        1 +   // leverage
        64 +  // encrypted_size
        64 +  // encrypted_entry_price
        64 +  // encrypted_collateral
        64 +  // encrypted_realized_pnl
        64 +  // encrypted_liq_below
        64 +  // encrypted_liq_above
        32 +  // threshold_commitment
        8 +   // last_threshold_update_hour
        1 +   // threshold_verified
        16 +  // entry_cumulative_funding (i128)
        1 +   // status
        1 +   // eligibility_proof_verified
        1 +   // partial_close_count
        8 +   // auto_deleverage_priority
        8 +   // last_margin_add_hour
        1 +   // margin_add_count
        1 +   // bump
        8;    // position_seed
    // Total: 576 bytes (8 + 32+32+16+8+8+1+1 + 64*6 + 32+8+1+16+1+1+1+8+8+1+1+8)

    pub const SEED: &'static [u8] = b"position";

    /// Generate a hash-based position ID from trader, market, and nonce
    /// Uses fixed-size array to avoid heap allocation
    pub fn generate_position_id(trader: &Pubkey, market: &Pubkey, nonce: &[u8; 8]) -> [u8; 16] {
        // Use fixed-size array (72 bytes) to avoid Vec allocation
        let mut data = [0u8; 72];
        data[..32].copy_from_slice(trader.as_ref());
        data[32..64].copy_from_slice(market.as_ref());
        data[64..72].copy_from_slice(nonce);
        let hash_result = hash(&data);
        let mut id = [0u8; 16];
        id.copy_from_slice(&hash_result.as_ref()[..16]);
        id
    }

    /// Generate threshold commitment: hash(entry_price_bytes || leverage || mm_bps || side)
    /// Uses fixed-size array to avoid heap allocation
    pub fn compute_threshold_commitment(
        encrypted_entry_price: &[u8; 64],
        leverage: u8,
        maintenance_margin_bps: u16,
        is_long: bool,
    ) -> [u8; 32] {
        // Use fixed-size array (68 bytes) to avoid Vec allocation
        let mut data = [0u8; 68];
        data[..64].copy_from_slice(encrypted_entry_price);
        data[64] = leverage;
        data[65..67].copy_from_slice(&maintenance_margin_bps.to_le_bytes());
        data[67] = if is_long { 1 } else { 0 };
        hash(&data).to_bytes()
    }

    /// Coarsen a timestamp to hour precision (privacy enhancement)
    pub fn coarse_timestamp(timestamp: i64) -> i64 {
        // Floor to nearest hour (3600 seconds)
        (timestamp / 3600) * 3600
    }

    /// Check if position is open and can be modified
    pub fn is_open(&self) -> bool {
        matches!(self.status, PositionStatus::Open)
    }

    /// Check if position is pending liquidation verification
    pub fn is_pending_liquidation_check(&self) -> bool {
        matches!(self.status, PositionStatus::PendingLiquidationCheck)
    }

    /// Check if position can potentially be liquidated
    /// With encrypted thresholds, this only checks basic eligibility
    /// Actual liquidation requires MPC verification
    pub fn can_be_liquidation_checked(&self) -> bool {
        self.is_open() && self.threshold_verified
    }

    /// Verify threshold commitment matches stored commitment
    pub fn verify_threshold_commitment(
        &self,
        leverage: u8,
        maintenance_margin_bps: u16,
        is_long: bool,
    ) -> bool {
        let expected = Self::compute_threshold_commitment(
            &self.encrypted_entry_price,
            leverage,
            maintenance_margin_bps,
            is_long,
        );
        self.threshold_commitment == expected
    }

    // =========================================================================
    // HACKATHON PLAINTEXT HELPERS
    // These methods read/write plaintext values from the first 8 bytes of
    // encrypted fields. This is a temporary solution until C-SPL SDK is available.
    // In production, these will be replaced with proper C-SPL encrypted operations.
    // =========================================================================

    /// Get collateral as plaintext u64 (hackathon only - reads first 8 bytes)
    /// In production: Use C-SPL encrypted balance operations
    pub fn get_collateral_plaintext(&self) -> u64 {
        u64::from_le_bytes(
            self.encrypted_collateral[0..8].try_into().unwrap_or([0u8; 8])
        )
    }

    /// Set collateral plaintext (hackathon only - writes to first 8 bytes)
    /// In production: Use C-SPL encrypted balance operations
    pub fn set_collateral_plaintext(&mut self, amount: u64) {
        self.encrypted_collateral[0..8].copy_from_slice(&amount.to_le_bytes());
    }

    /// Get position size as plaintext u64 (hackathon only - reads first 8 bytes)
    /// In production: Use C-SPL encrypted balance operations
    pub fn get_size_plaintext(&self) -> u64 {
        u64::from_le_bytes(
            self.encrypted_size[0..8].try_into().unwrap_or([0u8; 8])
        )
    }

    /// Set position size plaintext (hackathon only - writes to first 8 bytes)
    /// In production: Use C-SPL encrypted balance operations
    pub fn set_size_plaintext(&mut self, amount: u64) {
        self.encrypted_size[0..8].copy_from_slice(&amount.to_le_bytes());
    }

    /// Get entry price as plaintext u64 (hackathon only - reads first 8 bytes)
    /// In production: Use C-SPL encrypted balance operations
    pub fn get_entry_price_plaintext(&self) -> u64 {
        u64::from_le_bytes(
            self.encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8])
        )
    }

    /// Set entry price plaintext (hackathon only - writes to first 8 bytes)
    /// In production: Use C-SPL encrypted balance operations
    pub fn set_entry_price_plaintext(&mut self, price: u64) {
        self.encrypted_entry_price[0..8].copy_from_slice(&price.to_le_bytes());
    }

    /// Get realized PnL as plaintext i64 (hackathon only - reads first 8 bytes)
    /// Returns i64 because PnL can be negative (losses)
    /// In production: Use C-SPL encrypted balance operations
    pub fn get_realized_pnl_plaintext(&self) -> i64 {
        i64::from_le_bytes(
            self.encrypted_realized_pnl[0..8].try_into().unwrap_or([0u8; 8])
        )
    }

    /// Set realized PnL plaintext (hackathon only - writes to first 8 bytes)
    /// Accepts i64 because PnL can be negative (losses)
    /// In production: Use C-SPL encrypted balance operations
    pub fn set_realized_pnl_plaintext(&mut self, pnl: i64) {
        self.encrypted_realized_pnl[0..8].copy_from_slice(&pnl.to_le_bytes());
    }

    /// Add to realized PnL (hackathon only)
    /// Handles overflow safely using saturating arithmetic
    pub fn add_realized_pnl_plaintext(&mut self, delta: i64) {
        let current = self.get_realized_pnl_plaintext();
        let new_pnl = current.saturating_add(delta);
        self.set_realized_pnl_plaintext(new_pnl);
    }
}

/// Batch liquidation check request account
/// Used to queue multiple positions for MPC liquidation eligibility check
#[account]
pub struct LiquidationBatchRequest {
    /// Request ID for MPC tracking
    pub request_id: [u8; 32],

    /// Market for all positions in this batch
    pub market: Pubkey,

    /// Current mark price (public oracle price)
    pub mark_price: u64,

    /// Number of positions in this batch
    pub position_count: u8,

    /// Position pubkeys being checked (up to 10)
    pub positions: [[u8; 32]; 10],

    /// Results from MPC (filled by callback): true = liquidatable
    pub results: [bool; 10],

    /// Whether MPC has returned results
    pub completed: bool,

    /// Unix timestamp when batch was created
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl LiquidationBatchRequest {
    pub const SIZE: usize = 8 +   // discriminator
        32 +  // request_id
        32 +  // market
        8 +   // mark_price
        1 +   // position_count
        320 + // positions (32 * 10)
        10 +  // results (10 bools)
        1 +   // completed
        8 +   // created_at
        1;    // bump
    // Total: 421 bytes

    pub const SEED: &'static [u8] = b"liq_batch";
    pub const MAX_POSITIONS: usize = 10;
}
