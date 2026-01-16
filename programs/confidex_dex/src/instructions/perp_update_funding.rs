use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{PerpetualMarket, FundingRateState};

/// Update funding rate for a perpetual market (keeper crank instruction)
#[derive(Accounts)]
pub struct UpdateFundingRate<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    #[account(
        mut,
        seeds = [FundingRateState::SEED, perp_market.key().as_ref()],
        bump = funding_state.bump,
        constraint = funding_state.market == perp_market.key() @ ConfidexError::InvalidFundingState
    )]
    pub funding_state: Account<'info, FundingRateState>,

    /// CHECK: Pyth oracle for mark price
    pub oracle: AccountInfo<'info>,

    /// Anyone can crank the funding rate update
    pub keeper: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateFundingRate>) -> Result<()> {
    let clock = Clock::get()?;
    let funding_state = &mut ctx.accounts.funding_state;
    let perp_market = &mut ctx.accounts.perp_market;

    // Check if funding needs to be updated
    require!(
        funding_state.needs_update(clock.unix_timestamp),
        ConfidexError::FundingNotDue
    );

    // Calculate new funding rate based on open interest imbalance
    let new_rate = FundingRateState::calculate_rate_from_oi(
        perp_market.total_long_open_interest,
        perp_market.total_short_open_interest,
        100, // Base rate of 1% per funding interval when imbalanced
    );

    // Clamp to max rate
    let clamped_rate = funding_state.clamp_rate(new_rate);

    // Update cumulative funding
    // Cumulative funding is scaled by 1e18 for precision
    let funding_delta = (clamped_rate as i128) * 1_000_000_000_000_000i128 / 10000; // Convert bps to scaled

    if clamped_rate > 0 {
        // Longs pay shorts
        perp_market.cumulative_funding_long = perp_market
            .cumulative_funding_long
            .saturating_add(funding_delta);
        perp_market.cumulative_funding_short = perp_market
            .cumulative_funding_short
            .saturating_sub(funding_delta);
    } else {
        // Shorts pay longs
        perp_market.cumulative_funding_long = perp_market
            .cumulative_funding_long
            .saturating_sub(funding_delta.abs());
        perp_market.cumulative_funding_short = perp_market
            .cumulative_funding_short
            .saturating_add(funding_delta.abs());
    }

    // Update funding state
    funding_state.current_rate_bps = clamped_rate;
    funding_state.add_hourly_rate(clamped_rate);
    funding_state.last_calculation_time = clock.unix_timestamp;

    // Update market last funding time
    perp_market.last_funding_time = clock.unix_timestamp;

    msg!(
        "Funding rate updated: {}bps (long OI: {}, short OI: {})",
        clamped_rate,
        perp_market.total_long_open_interest,
        perp_market.total_short_open_interest
    );

    Ok(())
}
