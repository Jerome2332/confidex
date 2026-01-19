use anchor_lang::prelude::*;

use crate::cpi::arcium::{calculate_pnl_sync, check_liquidation_sync};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
use crate::state::{
    ConfidentialPosition, LiquidationConfig, PerpetualMarket, PositionSide, PositionStatus,
};

/// Auto-Deleverage (ADL) instruction
/// Used when insurance fund is depleted and profitable positions must be force-closed
/// to cover losses from underwater liquidations
#[derive(Accounts)]
pub struct AutoDeleverage<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    /// The underwater position being liquidated (bankrupt)
    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            bankrupt_position.trader.as_ref(),
            perp_market.key().as_ref(),
            &bankrupt_position.position_id.to_le_bytes()
        ],
        bump = bankrupt_position.bump,
        constraint = bankrupt_position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = bankrupt_position.is_open() @ ConfidexError::PositionNotOpen
    )]
    pub bankrupt_position: Account<'info, ConfidentialPosition>,

    /// The profitable counter-position being deleveraged
    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            target_position.trader.as_ref(),
            perp_market.key().as_ref(),
            &target_position.position_id.to_le_bytes()
        ],
        bump = target_position.bump,
        constraint = target_position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = target_position.is_open() @ ConfidexError::PositionNotOpen,
        // Target must be opposite side of bankrupt position
        constraint = target_position.side != bankrupt_position.side @ ConfidexError::InvalidOrderSide
    )]
    pub target_position: Account<'info, ConfidentialPosition>,

    #[account(
        seeds = [LiquidationConfig::SEED],
        bump = liquidation_config.bump,
        constraint = liquidation_config.adl_enabled @ ConfidexError::Unauthorized
    )]
    pub liquidation_config: Account<'info, LiquidationConfig>,

    /// CHECK: Pyth oracle for current mark price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// CHECK: Market's confidential collateral vault
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: AccountInfo<'info>,

    /// CHECK: Insurance fund (must be depleted for ADL to trigger)
    #[account(
        constraint = insurance_fund.key() == liquidation_config.insurance_fund @ ConfidexError::InvalidVault
    )]
    pub insurance_fund: AccountInfo<'info>,

    /// CHECK: Arcium program for MPC computations
    pub arcium_program: AccountInfo<'info>,

    /// Keeper/admin that triggers ADL
    /// Could be permissionless with proper incentive design
    #[account(mut)]
    pub keeper: Signer<'info>,
}

pub fn handler(ctx: Context<AutoDeleverage>) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let bankrupt_position = &mut ctx.accounts.bankrupt_position;
    let target_position = &mut ctx.accounts.target_position;
    let liquidation_config = &ctx.accounts.liquidation_config;

    // Verify insurance fund is below ADL trigger threshold
    // ADL only triggers when insurance fund is depleted
    let insurance_balance = ctx.accounts.insurance_fund.lamports();
    let adl_threshold = perp_market
        .insurance_fund_target
        .saturating_mul(liquidation_config.adl_trigger_threshold_bps as u64)
        .saturating_div(10000);
    require!(
        insurance_balance < adl_threshold,
        ConfidexError::InsuranceFundNotDepleted
    );

    // Verify target position has high ADL priority (most profitable)
    // In production, this would be verified via MPC
    require!(
        target_position.auto_deleverage_priority > 0,
        ConfidexError::InvalidAdlThreshold
    );

    // Get mark price from oracle for settlement price (6 decimal precision)
    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;
    msg!("ADL settlement mark price: {}", mark_price);

    // Step 1: Verify bankrupt position is truly underwater via MPC
    // This checks that the position should be liquidated (loss > collateral)
    let is_bankrupt_long = matches!(bankrupt_position.side, PositionSide::Long);
    let should_liquidate = check_liquidation_sync(
        &ctx.accounts.arcium_program,
        &perp_market.key(), // Using market key as cluster placeholder
        &bankrupt_position.encrypted_collateral,
        &bankrupt_position.encrypted_size,
        &bankrupt_position.encrypted_entry_price,
        mark_price,
        is_bankrupt_long,
        perp_market.maintenance_margin_bps,
    )?;

    require!(should_liquidate, ConfidexError::NotLiquidatable);

    // Step 2: Calculate PnL for the target position (to verify profitability)
    let is_target_long = matches!(target_position.side, PositionSide::Long);
    let (encrypted_pnl, is_profit) = calculate_pnl_sync(
        &ctx.accounts.arcium_program,
        &target_position.encrypted_size,
        &target_position.encrypted_entry_price,
        mark_price,
        is_target_long,
    )?;

    // Target must be profitable to be selected for ADL
    require!(is_profit, ConfidexError::InvalidAdlThreshold);

    msg!(
        "ADL verified: bankrupt position underwater, target position profitable"
    );

    // Step 3-5: Calculate ADL amounts and update positions
    // NOTE: Full ADL with encrypted size reduction requires a new MPC circuit (CALCULATE_ADL_AMOUNTS)
    // For now, we mark positions and emit events. The encrypted size/collateral updates
    // would happen via callback when the ADL MPC circuit is implemented.

    // Store the calculated PnL for the callback (unused for now)
    let _ = encrypted_pnl;

    // Mark bankrupt position as auto-deleveraged
    bankrupt_position.status = PositionStatus::AutoDeleveraged;
    bankrupt_position.last_updated = clock.unix_timestamp;

    // Update target position (partial close via ADL)
    // The actual encrypted size reduction happens via MPC
    target_position.last_updated = clock.unix_timestamp;
    target_position.partial_close_count = target_position.partial_close_count.saturating_add(1);

    // Update liquidation stats
    // Note: In production, this would be a separate counter update

    msg!(
        "ADL executed: bankrupt position {} #{} covered by target position {} #{}",
        bankrupt_position.trader,
        bankrupt_position.position_id,
        target_position.trader,
        target_position.position_id
    );

    // Emit ADL event (privacy-preserving: no amounts)
    emit!(AutoDeleverageExecuted {
        bankrupt_position_id: bankrupt_position.position_id,
        bankrupt_trader: bankrupt_position.trader,
        target_position_id: target_position.position_id,
        target_trader: target_position.trader,
        market: perp_market.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct AutoDeleverageExecuted {
    pub bankrupt_position_id: u64,
    pub bankrupt_trader: Pubkey,
    pub target_position_id: u64,
    pub target_trader: Pubkey,
    pub market: Pubkey,
    pub timestamp: i64,
}
