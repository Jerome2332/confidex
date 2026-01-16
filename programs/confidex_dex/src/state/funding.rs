use anchor_lang::prelude::*;

/// Funding rate state for a perpetual market
/// Tracks current funding rate and historical data for TWAP calculation
/// Size: 8 (discriminator) + 168 = 176 bytes
#[account]
#[derive(Default)]
pub struct FundingRateState {
    /// Perpetual market this funding state belongs to
    pub market: Pubkey,

    /// Current funding rate in basis points (signed: + = longs pay shorts)
    /// Range: -max_funding_rate_bps to +max_funding_rate_bps
    pub current_rate_bps: i32,

    /// Unix timestamp of last funding rate calculation
    pub last_calculation_time: i64,

    /// Funding interval in seconds (e.g., 3600 = hourly)
    pub funding_interval_seconds: u64,

    /// Maximum funding rate in basis points (cap)
    pub max_funding_rate_bps: u16,

    /// Historical hourly rates for TWAP calculation (last 24 hours)
    pub hourly_rates: [i32; 24],

    /// Current index in hourly_rates array (circular buffer)
    pub rate_index: u8,

    /// Number of rate slots filled (0-24)
    pub rates_filled: u8,

    /// Total funding paid by longs (for statistics, in quote decimals)
    pub total_long_funding_paid: u64,

    /// Total funding paid by shorts (for statistics, in quote decimals)
    pub total_short_funding_paid: u64,

    /// PDA bump seed
    pub bump: u8,
}

impl FundingRateState {
    pub const SIZE: usize = 8 +   // discriminator
        32 +  // market
        4 +   // current_rate_bps (i32)
        8 +   // last_calculation_time
        8 +   // funding_interval_seconds
        2 +   // max_funding_rate_bps
        96 +  // hourly_rates (24 * 4 bytes)
        1 +   // rate_index
        1 +   // rates_filled
        8 +   // total_long_funding_paid
        8 +   // total_short_funding_paid
        1;    // bump
    // Total: 176 bytes

    pub const SEED: &'static [u8] = b"funding";

    /// Check if funding rate needs to be updated
    pub fn needs_update(&self, current_time: i64) -> bool {
        current_time >= self.last_calculation_time + self.funding_interval_seconds as i64
    }

    /// Calculate time until next funding
    pub fn time_until_next_funding(&self, current_time: i64) -> i64 {
        let next_funding = self.last_calculation_time + self.funding_interval_seconds as i64;
        (next_funding - current_time).max(0)
    }

    /// Add a new hourly rate to history (circular buffer)
    pub fn add_hourly_rate(&mut self, rate: i32) {
        self.hourly_rates[self.rate_index as usize] = rate;
        self.rate_index = (self.rate_index + 1) % 24;
        if self.rates_filled < 24 {
            self.rates_filled += 1;
        }
    }

    /// Calculate 8-hour TWAP of funding rates
    pub fn calculate_twap_8h(&self) -> i32 {
        if self.rates_filled == 0 {
            return 0;
        }

        let hours_to_average = self.rates_filled.min(8) as usize;
        let mut sum: i64 = 0;

        for i in 0..hours_to_average {
            let idx = if self.rate_index >= i as u8 + 1 {
                (self.rate_index - i as u8 - 1) as usize
            } else {
                (24 + self.rate_index as usize - i - 1) % 24
            };
            sum += self.hourly_rates[idx] as i64;
        }

        (sum / hours_to_average as i64) as i32
    }

    /// Clamp funding rate to max bounds
    pub fn clamp_rate(&self, rate: i32) -> i32 {
        let max = self.max_funding_rate_bps as i32;
        rate.clamp(-max, max)
    }

    /// Calculate funding rate based on open interest imbalance
    /// Returns positive if longs pay shorts, negative if shorts pay longs
    pub fn calculate_rate_from_oi(
        long_oi: u64,
        short_oi: u64,
        base_rate_bps: i32,
    ) -> i32 {
        if long_oi == 0 && short_oi == 0 {
            return 0;
        }

        let total_oi = long_oi.saturating_add(short_oi);
        let imbalance = if long_oi > short_oi {
            // More longs than shorts - longs pay
            ((long_oi - short_oi) as i128 * 10000 / total_oi as i128) as i32
        } else {
            // More shorts than longs - shorts pay (negative rate)
            -((short_oi - long_oi) as i128 * 10000 / total_oi as i128) as i32
        };

        // Scale by base rate
        (imbalance as i64 * base_rate_bps as i64 / 10000) as i32
    }
}
