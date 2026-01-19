use anchor_lang::prelude::*;

/// Perpetual market configuration account
/// Size: 8 (discriminator) + 342 = 350 bytes
#[account]
#[derive(Default)]
pub struct PerpetualMarket {
    /// Underlying asset mint (e.g., SOL)
    pub underlying_mint: Pubkey,

    /// Quote/collateral token mint (e.g., USDC)
    pub quote_mint: Pubkey,

    /// Maximum leverage allowed (1-20x)
    pub max_leverage: u8,

    /// Maintenance margin in basis points (e.g., 500 = 5%)
    /// Position liquidated when margin ratio falls below this
    pub maintenance_margin_bps: u16,

    /// Initial margin in basis points (e.g., 1000 = 10%)
    /// Required margin to open a position
    pub initial_margin_bps: u16,

    /// Taker fee in basis points
    pub taker_fee_bps: u16,

    /// Maker fee in basis points
    pub maker_fee_bps: u16,

    /// Liquidation fee in basis points (bonus for liquidators)
    pub liquidation_fee_bps: u16,

    /// Minimum position size in underlying units
    pub min_position_size: u64,

    /// Tick size for price increments
    pub tick_size: u64,

    /// Maximum open interest allowed (risk cap)
    pub max_open_interest: u64,

    /// Total long open interest (PUBLIC for funding calculation)
    pub total_long_open_interest: u64,

    /// Total short open interest (PUBLIC for funding calculation)
    pub total_short_open_interest: u64,

    /// Number of open positions in this market
    pub position_count: u64,

    /// Sequential market identifier
    pub index: u64,

    /// Last time funding was calculated
    pub last_funding_time: i64,

    /// Cumulative funding for long positions (scaled by 1e18)
    pub cumulative_funding_long: i128,

    /// Cumulative funding for short positions (scaled by 1e18)
    pub cumulative_funding_short: i128,

    /// Pyth oracle price feed account
    pub oracle_price_feed: Pubkey,

    /// Confidential collateral vault (C-SPL USDC)
    pub collateral_vault: Pubkey,

    /// Insurance fund for socialized losses
    pub insurance_fund: Pubkey,

    /// Target balance for insurance fund (in quote token units)
    /// ADL triggers when balance falls below adl_trigger_threshold_bps% of this
    pub insurance_fund_target: u64,

    /// Fee recipient account
    pub fee_recipient: Pubkey,

    /// Confidential quote token mint (C-SPL USDC)
    pub c_quote_mint: Pubkey,

    /// Arcium MPC cluster for encrypted computations
    pub arcium_cluster: Pubkey,

    /// Whether the market is active for trading
    pub active: bool,

    /// PDA bump seed
    pub bump: u8,
}

impl PerpetualMarket {
    pub const SIZE: usize = 8 +   // discriminator
        32 +  // underlying_mint
        32 +  // quote_mint
        1 +   // max_leverage
        2 +   // maintenance_margin_bps
        2 +   // initial_margin_bps
        2 +   // taker_fee_bps
        2 +   // maker_fee_bps
        2 +   // liquidation_fee_bps
        8 +   // min_position_size
        8 +   // tick_size
        8 +   // max_open_interest
        8 +   // total_long_open_interest
        8 +   // total_short_open_interest
        8 +   // position_count
        8 +   // index
        8 +   // last_funding_time
        16 +  // cumulative_funding_long (i128)
        16 +  // cumulative_funding_short (i128)
        32 +  // oracle_price_feed
        32 +  // collateral_vault
        32 +  // insurance_fund
        8 +   // insurance_fund_target
        32 +  // fee_recipient
        32 +  // c_quote_mint
        32 +  // arcium_cluster
        1 +   // active
        1;    // bump
    // Total: 390 bytes

    pub const SEED: &'static [u8] = b"perp_market";

    /// Validate leverage is within bounds
    pub fn validate_leverage(&self, leverage: u8) -> bool {
        leverage >= 1 && leverage <= self.max_leverage
    }

    /// Calculate required initial margin for a position
    pub fn required_initial_margin(&self, notional_value: u64) -> u64 {
        // margin = notional * initial_margin_bps / 10000
        (notional_value as u128 * self.initial_margin_bps as u128 / 10000) as u64
    }

    /// Calculate required maintenance margin for a position
    pub fn required_maintenance_margin(&self, notional_value: u64) -> u64 {
        // margin = notional * maintenance_margin_bps / 10000
        (notional_value as u128 * self.maintenance_margin_bps as u128 / 10000) as u64
    }

    /// Check if market can accept more open interest
    pub fn can_increase_open_interest(&self, additional: u64, is_long: bool) -> bool {
        let current = if is_long {
            self.total_long_open_interest
        } else {
            self.total_short_open_interest
        };
        current.saturating_add(additional) <= self.max_open_interest
    }
}
