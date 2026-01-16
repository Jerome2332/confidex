use anchor_lang::prelude::*;

use crate::error::ConfidexError;
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

    // TODO: Verify insurance fund is below ADL trigger threshold
    // This would check the balance of the insurance fund account
    // let insurance_balance = get_token_balance(&ctx.accounts.insurance_fund)?;
    // let threshold = liquidation_config.adl_trigger_threshold_bps;
    // require!(insurance_balance < threshold, ConfidexError::InsuranceFundNotDepleted);

    // Verify target position has high ADL priority (most profitable)
    // In production, this would be verified via MPC
    require!(
        target_position.auto_deleverage_priority > 0,
        ConfidexError::InvalidAdlThreshold
    );

    // TODO: Submit MPC computation to:
    // 1. Verify bankrupt position is truly underwater (loss > collateral)
    // 2. Calculate the deleveraging amount needed
    // 3. Reduce target position size proportionally
    // 4. Transfer PnL from target to cover bankrupt position loss
    // 5. Update encrypted position data for both positions

    // TODO: Get mark price from oracle for settlement price
    // let mark_price = get_pyth_price(&ctx.accounts.oracle)?;

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
