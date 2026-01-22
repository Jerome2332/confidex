use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
use crate::state::{
    ConfidentialPosition, LiquidationConfig, PerpetualMarket, PositionSide, PositionStatus,
};

// ============================================================================
// AUTO-DELEVERAGE (V6 - Async MPC with Cached Liquidation Status)
// ============================================================================
//
// The ADL flow in V6 uses pre-computed liquidation status from batch MPC checks:
//
// 1. Keeper periodically calls initiate_liquidation_check() via crank
// 2. Crank triggers MPC batch_liquidation_check via MXE
// 3. liquidation_check_callback sets position.is_liquidatable = true for each
// 4. execute_adl reads the cached flag (no sync MPC needed at execution time)
//
// This is more efficient than per-position MPC calls during ADL execution.

/// Accounts for executing auto-deleverage
/// Uses cached is_liquidatable flag from batch MPC check
#[derive(Accounts)]
pub struct ExecuteAdl<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

    /// The underwater position being liquidated (bankrupt)
    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            bankrupt_position.trader.as_ref(),
            perp_market.key().as_ref(),
            &bankrupt_position.position_seed.to_le_bytes()
        ],
        bump = bankrupt_position.bump,
        constraint = bankrupt_position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = bankrupt_position.is_open() @ ConfidexError::PositionNotOpen,
        // V6: Use cached liquidation status from MPC batch check
        constraint = bankrupt_position.is_liquidatable @ ConfidexError::NotLiquidatable
    )]
    pub bankrupt_position: Box<Account<'info, ConfidentialPosition>>,

    /// The profitable counter-position being deleveraged
    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            target_position.trader.as_ref(),
            perp_market.key().as_ref(),
            &target_position.position_seed.to_le_bytes()
        ],
        bump = target_position.bump,
        constraint = target_position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = target_position.is_open() @ ConfidexError::PositionNotOpen,
        // Target must be opposite side of bankrupt position
        constraint = target_position.side != bankrupt_position.side @ ConfidexError::InvalidOrderSide
    )]
    pub target_position: Box<Account<'info, ConfidentialPosition>>,

    #[account(
        seeds = [LiquidationConfig::SEED],
        bump = liquidation_config.bump,
        constraint = liquidation_config.adl_enabled @ ConfidexError::Unauthorized
    )]
    pub liquidation_config: Box<Account<'info, LiquidationConfig>>,

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
    #[account(mut)]
    pub keeper: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Execute auto-deleverage using cached liquidation status
///
/// V6: This instruction uses the is_liquidatable flag that was set by
/// the batch liquidation check MPC callback. No sync MPC calls needed.
pub fn execute_adl(ctx: Context<ExecuteAdl>) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let bankrupt_position = &mut ctx.accounts.bankrupt_position;
    let target_position = &mut ctx.accounts.target_position;
    let liquidation_config = &ctx.accounts.liquidation_config;

    // Verify insurance fund is below ADL trigger threshold
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
    require!(
        target_position.auto_deleverage_priority > 0,
        ConfidexError::InvalidAdlThreshold
    );

    // Get mark price from oracle for settlement price (6 decimal precision)
    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;
    msg!("ADL settlement mark price: {}", mark_price);

    // V6: Liquidation eligibility already verified via cached is_liquidatable flag
    // The constraint check above ensures bankrupt_position.is_liquidatable == true
    msg!(
        "ADL executing: bankrupt position is_liquidatable=true (verified by MPC batch check)"
    );

    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);

    // Mark bankrupt position as auto-deleveraged
    bankrupt_position.status = PositionStatus::AutoDeleveraged;
    bankrupt_position.last_updated_hour = coarse_time;
    bankrupt_position.is_liquidatable = false; // Clear flag

    // Update target position (partial close via ADL)
    target_position.last_updated_hour = coarse_time;
    target_position.partial_close_count = target_position.partial_close_count.saturating_add(1);

    // NOTE: Full PnL calculation and collateral transfer would require another MPC call
    // For hackathon, we use plaintext values to complete the transfer
    // In production, this would be another async MPC flow

    emit!(AutoDeleverageExecuted {
        bankrupt_position_id: bankrupt_position.position_id,
        bankrupt_trader: bankrupt_position.trader,
        target_position_id: target_position.position_id,
        target_trader: target_position.trader,
        market: perp_market.key(),
        mark_price,
        timestamp: coarse_time,
    });

    msg!(
        "ADL executed: bankrupt position {} #{:?} covered by target position {} #{:?}",
        bankrupt_position.trader,
        bankrupt_position.position_id,
        target_position.trader,
        target_position.position_id
    );

    Ok(())
}

#[event]
pub struct AutoDeleverageExecuted {
    pub bankrupt_position_id: [u8; 16],
    pub bankrupt_trader: Pubkey,
    pub target_position_id: [u8; 16],
    pub target_trader: Pubkey,
    pub market: Pubkey,
    pub mark_price: u64,
    pub timestamp: i64,
}

// ============================================================================
// INITIATE BATCH LIQUIDATION CHECK (Trigger MPC)
// ============================================================================

/// Accounts for initiating a batch liquidation check
#[derive(Accounts)]
pub struct InitiateLiquidationCheck<'info> {
    #[account(
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    /// CHECK: Pyth oracle for current mark price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// Keeper that triggers the check
    #[account(mut)]
    pub keeper: Signer<'info>,

    pub system_program: Program<'info, System>,
    // Positions to check are passed via remaining_accounts
}

/// Initiate batch liquidation check for multiple positions
///
/// Marks positions as pending liquidation check and emits event for crank
/// to trigger MPC batch_liquidation_check call.
pub fn initiate_liquidation_check(ctx: Context<InitiateLiquidationCheck>) -> Result<()> {
    let clock = Clock::get()?;

    // Get current mark price
    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;

    // Generate request ID for this batch
    let request_id = ConfidentialPosition::generate_request_id(
        &ctx.accounts.perp_market.key(),
        clock.slot,
    );

    let position_count = ctx.remaining_accounts.len().min(10);
    require!(position_count > 0, ConfidexError::InvalidCollateral);

    // Mark each position as pending liquidation check
    for position_info in ctx.remaining_accounts.iter().take(position_count) {
        // Update position's pending request
        let mut position_data = position_info.try_borrow_mut_data()?;
        let mut position = ConfidentialPosition::try_deserialize(&mut &position_data[..])?;

        // Only check positions that are open and verified
        if position.is_open() && position.threshold_verified {
            position.pending_mpc_request = request_id;
            position.status = PositionStatus::PendingLiquidationCheck;

            // Re-serialize
            let mut writer = &mut position_data[8..];
            position.serialize(&mut writer)?;
        }
    }

    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);

    emit!(LiquidationCheckInitiated {
        market: ctx.accounts.perp_market.key(),
        request_id,
        mark_price,
        position_count: position_count as u8,
        timestamp: coarse_time,
    });

    msg!(
        "Liquidation check initiated: {} positions, mark_price={}, request_id={:?}",
        position_count,
        mark_price,
        &request_id[0..8]
    );

    Ok(())
}

#[event]
pub struct LiquidationCheckInitiated {
    pub market: Pubkey,
    pub request_id: [u8; 32],
    pub mark_price: u64,
    pub position_count: u8,
    pub timestamp: i64,
}

// ============================================================================
// LEGACY HANDLER (Kept for Anchor compatibility)
// ============================================================================

/// Legacy handler - redirects to execute_adl
/// Kept for backward compatibility with existing instruction discriminator
#[derive(Accounts)]
pub struct AutoDeleverage<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            bankrupt_position.trader.as_ref(),
            perp_market.key().as_ref(),
            &bankrupt_position.position_seed.to_le_bytes()
        ],
        bump = bankrupt_position.bump,
        constraint = bankrupt_position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = bankrupt_position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = bankrupt_position.is_liquidatable @ ConfidexError::NotLiquidatable
    )]
    pub bankrupt_position: Box<Account<'info, ConfidentialPosition>>,

    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            target_position.trader.as_ref(),
            perp_market.key().as_ref(),
            &target_position.position_seed.to_le_bytes()
        ],
        bump = target_position.bump,
        constraint = target_position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = target_position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = target_position.side != bankrupt_position.side @ ConfidexError::InvalidOrderSide
    )]
    pub target_position: Box<Account<'info, ConfidentialPosition>>,

    #[account(
        seeds = [LiquidationConfig::SEED],
        bump = liquidation_config.bump,
        constraint = liquidation_config.adl_enabled @ ConfidexError::Unauthorized
    )]
    pub liquidation_config: Box<Account<'info, LiquidationConfig>>,

    /// CHECK: Pyth oracle
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// CHECK: Collateral vault
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: AccountInfo<'info>,

    /// CHECK: Insurance fund
    #[account(
        constraint = insurance_fund.key() == liquidation_config.insurance_fund @ ConfidexError::InvalidVault
    )]
    pub insurance_fund: AccountInfo<'info>,

    #[account(mut)]
    pub keeper: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Legacy handler - same logic as execute_adl
pub fn handler(ctx: Context<AutoDeleverage>) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let bankrupt_position = &mut ctx.accounts.bankrupt_position;
    let target_position = &mut ctx.accounts.target_position;
    let liquidation_config = &ctx.accounts.liquidation_config;

    // Same logic as execute_adl
    let insurance_balance = ctx.accounts.insurance_fund.lamports();
    let adl_threshold = perp_market
        .insurance_fund_target
        .saturating_mul(liquidation_config.adl_trigger_threshold_bps as u64)
        .saturating_div(10000);
    require!(
        insurance_balance < adl_threshold,
        ConfidexError::InsuranceFundNotDepleted
    );

    require!(
        target_position.auto_deleverage_priority > 0,
        ConfidexError::InvalidAdlThreshold
    );

    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;
    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);

    bankrupt_position.status = PositionStatus::AutoDeleveraged;
    bankrupt_position.last_updated_hour = coarse_time;
    bankrupt_position.is_liquidatable = false;

    target_position.last_updated_hour = coarse_time;
    target_position.partial_close_count = target_position.partial_close_count.saturating_add(1);

    emit!(AutoDeleverageExecuted {
        bankrupt_position_id: bankrupt_position.position_id,
        bankrupt_trader: bankrupt_position.trader,
        target_position_id: target_position.position_id,
        target_trader: target_position.trader,
        market: perp_market.key(),
        mark_price,
        timestamp: coarse_time,
    });

    Ok(())
}
