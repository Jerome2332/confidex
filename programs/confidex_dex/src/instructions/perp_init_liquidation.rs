use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ExchangeState, LiquidationConfig};

#[derive(Accounts)]
pub struct InitializeLiquidationConfig<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        init,
        payer = authority,
        space = LiquidationConfig::SIZE,
        seeds = [LiquidationConfig::SEED],
        bump
    )]
    pub liquidation_config: Account<'info, LiquidationConfig>,

    /// CHECK: Insurance fund token account
    pub insurance_fund: AccountInfo<'info>,

    #[account(
        mut,
        constraint = authority.key() == exchange.authority @ ConfidexError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeLiquidationConfig>,
    liquidation_bonus_bps: u16,
    insurance_fund_share_bps: u16,
    max_liquidation_per_tx: u64,
    min_liquidation_threshold: u64,
    adl_enabled: bool,
    adl_trigger_threshold_bps: u16,
) -> Result<()> {
    // Validate parameters
    require!(
        liquidation_bonus_bps <= 1000, // Max 10% bonus
        ConfidexError::InvalidFeeBps
    );
    require!(
        insurance_fund_share_bps <= 5000, // Max 50% to insurance
        ConfidexError::InvalidFeeBps
    );
    require!(
        adl_trigger_threshold_bps <= 5000, // Trigger when fund drops to 50% or less
        ConfidexError::InvalidAdlThreshold
    );

    let config = &mut ctx.accounts.liquidation_config;
    config.authority = ctx.accounts.authority.key();
    config.liquidation_bonus_bps = liquidation_bonus_bps;
    config.insurance_fund_share_bps = insurance_fund_share_bps;
    config.max_liquidation_per_tx = max_liquidation_per_tx;
    config.min_liquidation_threshold = min_liquidation_threshold;
    config.adl_enabled = adl_enabled;
    config.adl_trigger_threshold_bps = adl_trigger_threshold_bps;
    config.total_liquidations = 0;
    config.total_adl_events = 0;
    config.total_insurance_payouts = 0;
    config.last_liquidation_time = 0;
    config.insurance_fund = ctx.accounts.insurance_fund.key();
    config.bump = ctx.bumps.liquidation_config;

    msg!(
        "Liquidation config initialized: {}bps bonus, {}bps insurance share",
        liquidation_bonus_bps,
        insurance_fund_share_bps
    );

    Ok(())
}
