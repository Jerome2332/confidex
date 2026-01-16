use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{
    ConfidentialPosition, LiquidationConfig, PerpetualMarket, PositionSide, PositionStatus,
};

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            position.trader.as_ref(),
            perp_market.key().as_ref(),
            &position.position_id.to_le_bytes()
        ],
        bump = position.bump,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = position.threshold_verified @ ConfidexError::ThresholdNotVerified
    )]
    pub position: Account<'info, ConfidentialPosition>,

    #[account(
        seeds = [LiquidationConfig::SEED],
        bump = liquidation_config.bump,
    )]
    pub liquidation_config: Account<'info, LiquidationConfig>,

    /// CHECK: Pyth oracle for current mark price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// CHECK: Market's confidential collateral vault (C-SPL USDC)
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: AccountInfo<'info>,

    /// CHECK: Insurance fund account for socialized losses
    #[account(
        mut,
        constraint = insurance_fund.key() == perp_market.insurance_fund @ ConfidexError::InvalidVault
    )]
    pub insurance_fund: AccountInfo<'info>,

    /// CHECK: Liquidator's collateral token account (receives liquidation bonus)
    #[account(mut)]
    pub liquidator_collateral_account: AccountInfo<'info>,

    /// Anyone can liquidate - incentivized by liquidation bonus
    #[account(mut)]
    pub liquidator: Signer<'info>,
}

pub fn handler(ctx: Context<LiquidatePosition>) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;
    let liquidation_config = &ctx.accounts.liquidation_config;

    // TODO: Get current mark price from Pyth oracle
    // For now, we'll use a placeholder - in production this would be:
    // let mark_price = get_pyth_price(&ctx.accounts.oracle)?;
    let mark_price: u64 = 0; // Placeholder - oracle integration needed

    // Check if position is liquidatable using PUBLIC thresholds
    // This is the key privacy-preserving check: we only check the public threshold
    // The actual position size/collateral remains encrypted
    require!(
        position.is_liquidatable(mark_price),
        ConfidexError::PositionNotLiquidatable
    );

    // TODO: Submit MPC computation to:
    // 1. Calculate exact liquidation amounts from encrypted position data
    // 2. Determine if position is fully liquidatable or needs insurance fund
    // 3. Calculate liquidator bonus
    // 4. Execute confidential transfers

    // TODO: Transfer collateral distribution via C-SPL CPI:
    // - Liquidation bonus (liquidation_fee_bps) to liquidator
    // - Insurance fund share (insurance_fund_share_bps) to insurance
    // - Remaining to close position

    // Calculate funding owed since position was opened
    let current_cumulative_funding = match position.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };
    let _funding_delta = current_cumulative_funding
        .saturating_sub(position.entry_cumulative_funding);

    // Mark position as liquidated
    position.status = PositionStatus::Liquidated;
    position.last_updated = clock.unix_timestamp;

    // Update market statistics
    // Note: Actual OI reduction happens via MPC callback since size is encrypted

    // Update liquidation config stats
    // Note: These would be updated via a separate admin instruction
    // liquidation_config.total_liquidations += 1;
    // liquidation_config.last_liquidation_time = clock.unix_timestamp;

    msg!(
        "Position liquidated: {} #{} on market {} by liquidator {}",
        position.trader,
        position.position_id,
        perp_market.key(),
        ctx.accounts.liquidator.key()
    );

    // Emit liquidation event (privacy-preserving: no amounts)
    emit!(PositionLiquidated {
        position_id: position.position_id,
        trader: position.trader,
        market: perp_market.key(),
        liquidator: ctx.accounts.liquidator.key(),
        side: position.side,
        mark_price,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct PositionLiquidated {
    pub position_id: u64,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub liquidator: Pubkey,
    pub side: PositionSide,
    pub mark_price: u64,
    pub timestamp: i64,
}
