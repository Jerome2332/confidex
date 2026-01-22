use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ExchangeState, PerpetualMarket, FundingRateState};

/// Uses Box<Account<>> for large account types to reduce stack usage.
#[derive(Accounts)]
#[instruction(
    max_leverage: u8,
    maintenance_margin_bps: u16,
    initial_margin_bps: u16,
)]
pub struct InitializePerpMarket<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,

    #[account(
        init,
        payer = authority,
        space = PerpetualMarket::SIZE,
        seeds = [PerpetualMarket::SEED, underlying_mint.key().as_ref()],
        bump
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

    #[account(
        init,
        payer = authority,
        space = FundingRateState::SIZE,
        seeds = [FundingRateState::SEED, perp_market.key().as_ref()],
        bump
    )]
    pub funding_state: Box<Account<'info, FundingRateState>>,

    /// CHECK: Underlying asset mint (e.g., SOL)
    pub underlying_mint: AccountInfo<'info>,

    /// CHECK: Quote/collateral token mint (e.g., USDC)
    pub quote_mint: AccountInfo<'info>,

    /// CHECK: Pyth oracle price feed
    pub oracle_price_feed: AccountInfo<'info>,

    /// CHECK: Confidential collateral vault (C-SPL)
    pub collateral_vault: AccountInfo<'info>,

    /// CHECK: Insurance fund token account
    pub insurance_fund: AccountInfo<'info>,

    /// CHECK: Fee recipient account
    pub fee_recipient: AccountInfo<'info>,

    /// CHECK: Confidential quote token mint (C-SPL USDC)
    pub c_quote_mint: AccountInfo<'info>,

    #[account(
        mut,
        constraint = authority.key() == exchange.authority @ ConfidexError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializePerpMarket>,
    max_leverage: u8,
    maintenance_margin_bps: u16,
    initial_margin_bps: u16,
    taker_fee_bps: u16,
    maker_fee_bps: u16,
    liquidation_fee_bps: u16,
    min_position_size: u64,
    tick_size: u64,
    max_open_interest: u64,
    funding_interval_seconds: u64,
    max_funding_rate_bps: u16,
) -> Result<()> {
    // Validate parameters
    require!(
        max_leverage >= 1 && max_leverage <= 20,
        ConfidexError::InvalidLeverage
    );
    require!(
        maintenance_margin_bps > 0 && maintenance_margin_bps <= 5000,
        ConfidexError::InvalidMarginBps
    );
    require!(
        initial_margin_bps >= maintenance_margin_bps,
        ConfidexError::InvalidMarginBps
    );
    require!(
        taker_fee_bps <= 1000 && maker_fee_bps <= 1000,
        ConfidexError::InvalidFeeBps
    );
    require!(
        liquidation_fee_bps <= 1000,
        ConfidexError::InvalidFeeBps
    );
    require!(
        funding_interval_seconds >= 60,
        ConfidexError::InvalidFundingInterval
    );

    let clock = Clock::get()?;

    // Initialize perpetual market
    let perp_market = &mut ctx.accounts.perp_market;
    perp_market.underlying_mint = ctx.accounts.underlying_mint.key();
    perp_market.quote_mint = ctx.accounts.quote_mint.key();
    perp_market.max_leverage = max_leverage;
    perp_market.maintenance_margin_bps = maintenance_margin_bps;
    perp_market.initial_margin_bps = initial_margin_bps;
    perp_market.taker_fee_bps = taker_fee_bps;
    perp_market.maker_fee_bps = maker_fee_bps;
    perp_market.liquidation_fee_bps = liquidation_fee_bps;
    perp_market.min_position_size = min_position_size;
    perp_market.tick_size = tick_size;
    perp_market.max_open_interest = max_open_interest;
    perp_market.total_long_open_interest = 0;
    perp_market.total_short_open_interest = 0;
    perp_market.position_count = 0;
    perp_market.index = ctx.accounts.exchange.pair_count; // Reuse pair_count as market index
    perp_market.last_funding_time = clock.unix_timestamp;
    perp_market.cumulative_funding_long = 0;
    perp_market.cumulative_funding_short = 0;
    perp_market.oracle_price_feed = ctx.accounts.oracle_price_feed.key();
    perp_market.collateral_vault = ctx.accounts.collateral_vault.key();
    perp_market.insurance_fund = ctx.accounts.insurance_fund.key();
    perp_market.fee_recipient = ctx.accounts.fee_recipient.key();
    perp_market.c_quote_mint = ctx.accounts.c_quote_mint.key();
    perp_market.active = true;
    perp_market.bump = ctx.bumps.perp_market;

    // Initialize funding state
    let funding_state = &mut ctx.accounts.funding_state;
    funding_state.market = ctx.accounts.perp_market.key();
    funding_state.current_rate_bps = 0;
    funding_state.last_calculation_time = clock.unix_timestamp;
    funding_state.funding_interval_seconds = funding_interval_seconds;
    funding_state.max_funding_rate_bps = max_funding_rate_bps;
    funding_state.hourly_rates = [0i32; 24];
    funding_state.rate_index = 0;
    funding_state.rates_filled = 0;
    funding_state.total_long_funding_paid = 0;
    funding_state.total_short_funding_paid = 0;
    funding_state.bump = ctx.bumps.funding_state;

    // Increment market count
    ctx.accounts.exchange.pair_count += 1;

    msg!(
        "Perpetual market initialized: {} with {}x max leverage",
        ctx.accounts.underlying_mint.key(),
        max_leverage
    );

    Ok(())
}
