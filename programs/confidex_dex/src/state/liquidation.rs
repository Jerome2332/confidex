use anchor_lang::prelude::*;

/// Global liquidation configuration
/// Controls liquidation parameters and insurance fund management
/// Size: 8 (discriminator) + 104 = 112 bytes
#[account]
#[derive(Default)]
pub struct LiquidationConfig {
    /// Authority that can update liquidation settings
    pub authority: Pubkey,

    /// Liquidation bonus in basis points (reward for liquidators)
    /// e.g., 50 = 0.5% of position value goes to liquidator
    pub liquidation_bonus_bps: u16,

    /// Share of liquidation proceeds going to insurance fund (basis points)
    /// e.g., 2500 = 25% of remaining collateral after liquidation
    pub insurance_fund_share_bps: u16,

    /// Maximum position value that can be liquidated in a single transaction
    /// Prevents draining the insurance fund in one large liquidation
    pub max_liquidation_per_tx: u64,

    /// Minimum position value required for liquidation
    /// Prevents gas-inefficient small liquidations
    pub min_liquidation_threshold: u64,

    /// Whether auto-deleveraging is enabled
    /// ADL force-closes profitable positions when insurance fund is depleted
    pub adl_enabled: bool,

    /// Insurance fund depletion threshold that triggers ADL (basis points of total)
    /// e.g., 1000 = ADL triggers when insurance fund drops to 10% of initial
    pub adl_trigger_threshold_bps: u16,

    /// Total number of liquidations performed
    pub total_liquidations: u64,

    /// Total number of ADL events
    pub total_adl_events: u64,

    /// Total insurance fund payouts
    pub total_insurance_payouts: u64,

    /// Unix timestamp of last liquidation
    pub last_liquidation_time: i64,

    /// Insurance fund token account
    pub insurance_fund: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}

impl LiquidationConfig {
    pub const SIZE: usize = 8 +   // discriminator
        32 +  // authority
        2 +   // liquidation_bonus_bps
        2 +   // insurance_fund_share_bps
        8 +   // max_liquidation_per_tx
        8 +   // min_liquidation_threshold
        1 +   // adl_enabled
        2 +   // adl_trigger_threshold_bps
        8 +   // total_liquidations
        8 +   // total_adl_events
        8 +   // total_insurance_payouts
        8 +   // last_liquidation_time
        32 +  // insurance_fund
        1;    // bump
    // Total: 112 bytes

    pub const SEED: &'static [u8] = b"liquidation_config";

    /// Calculate liquidator bonus from position notional value
    pub fn calculate_liquidator_bonus(&self, notional_value: u64) -> u64 {
        (notional_value as u128 * self.liquidation_bonus_bps as u128 / 10000) as u64
    }

    /// Calculate insurance fund share from remaining collateral
    pub fn calculate_insurance_share(&self, remaining_collateral: u64) -> u64 {
        (remaining_collateral as u128 * self.insurance_fund_share_bps as u128 / 10000) as u64
    }

    /// Check if a position can be liquidated (meets minimum threshold)
    pub fn can_liquidate(&self, position_value: u64) -> bool {
        position_value >= self.min_liquidation_threshold &&
        position_value <= self.max_liquidation_per_tx
    }

    /// Check if ADL should be triggered based on insurance fund balance
    pub fn should_trigger_adl(&self, current_balance: u64, initial_balance: u64) -> bool {
        if !self.adl_enabled || initial_balance == 0 {
            return false;
        }

        let threshold = (initial_balance as u128 * self.adl_trigger_threshold_bps as u128 / 10000) as u64;
        current_balance < threshold
    }
}

/// Auto-deleverage priority calculator
/// Higher leverage + higher profit = higher ADL priority
pub struct AdlPriority;

impl AdlPriority {
    /// Calculate ADL priority score
    /// Score = leverage * profit_ratio * 1000
    /// Higher score = liquidated first in ADL
    pub fn calculate(leverage: u8, profit_ratio_bps: i32) -> u64 {
        if profit_ratio_bps <= 0 {
            // Negative or zero profit = low priority (won't be ADL'd)
            return 0;
        }

        (leverage as u64) * (profit_ratio_bps as u64)
    }
}
