use anchor_lang::prelude::*;

use crate::cpi::arcium::{
    check_liquidation_sync, calculate_pnl_sync, calculate_funding_sync,
    add_encrypted, sub_encrypted, mul_encrypted, encrypt_value,
    queue_batch_liquidation_check, BatchLiquidationPositionData, EncryptedU64
};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
use crate::state::{
    ConfidentialPosition, LiquidationBatchRequest, LiquidationConfig,
    PerpetualMarket, PositionSide, PositionStatus,
};

/// Uses Box<Account<>> to move large account data to heap (avoids stack overflow)
#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
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
            position.trader.as_ref(),
            perp_market.key().as_ref(),
            &position.position_id
        ],
        bump = position.bump,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = position.threshold_verified @ ConfidexError::ThresholdNotVerified
    )]
    pub position: Box<Account<'info, ConfidentialPosition>>,

    /// Batch liquidation request that contains MPC verification results
    /// This must have been verified by MPC before liquidation can proceed
    #[account(
        mut,
        seeds = [LiquidationBatchRequest::SEED, batch_request.request_id.as_ref()],
        bump = batch_request.bump,
        constraint = batch_request.completed @ ConfidexError::ThresholdNotVerified,
        constraint = batch_request.market == perp_market.key() @ ConfidexError::InvalidFundingState
    )]
    pub batch_request: Box<Account<'info, LiquidationBatchRequest>>,

    #[account(
        seeds = [LiquidationConfig::SEED],
        bump = liquidation_config.bump,
    )]
    pub liquidation_config: Box<Account<'info, LiquidationConfig>>,

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

    /// CHECK: Arcium program for MPC calculations
    pub arcium_program: AccountInfo<'info>,
}

/// Index of the position within the batch request
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidatePositionParams {
    /// Index of this position in the batch request's results array
    pub batch_index: u8,
}

pub fn handler(ctx: Context<LiquidatePosition>, params: LiquidatePositionParams) -> Result<()> {
    let clock = Clock::get()?;
    let batch_request = &ctx.accounts.batch_request;
    let liquidation_config = &ctx.accounts.liquidation_config;

    // Fetch current mark price from Pyth oracle (6 decimal precision)
    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;

    // PRIVACY ENHANCEMENT (V2): Liquidation eligibility is verified via MPC batch check
    // The batch_request contains results from MPC comparing encrypted thresholds vs mark price
    // No public liquidation threshold is exposed

    // Verify the batch was checked at the same mark price (within tolerance)
    // This prevents stale batch results from being used
    let price_tolerance = mark_price / 100; // 1% tolerance
    require!(
        batch_request.mark_price >= mark_price.saturating_sub(price_tolerance)
            && batch_request.mark_price <= mark_price.saturating_add(price_tolerance),
        ConfidexError::StaleOraclePrice
    );

    // Verify this position is in the batch and MPC confirmed liquidation
    require!(
        (params.batch_index as usize) < batch_request.position_count as usize,
        ConfidexError::InvalidAmount
    );

    // Check that the position pubkey matches the batch entry (before mutable borrow)
    let position_key_bytes = ctx.accounts.position.key().to_bytes();
    require!(
        batch_request.positions[params.batch_index as usize] == position_key_bytes,
        ConfidexError::OrderOwnerMismatch
    );

    // Verify MPC confirmed this position is liquidatable
    require!(
        batch_request.results[params.batch_index as usize],
        ConfidexError::PositionNotLiquidatable
    );

    // Now take mutable references
    let perp_market = &mut ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    let is_long = matches!(position.side, PositionSide::Long);

    // === MPC CALCULATIONS FOR LIQUIDATION ===

    // Calculate funding owed since position was opened
    let current_cumulative_funding = match position.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };
    let funding_delta = current_cumulative_funding
        .saturating_sub(position.entry_cumulative_funding);

    // 1. Calculate PnL at liquidation price (mark_price)
    let (encrypted_pnl, is_profit) = calculate_pnl_sync(
        &ctx.accounts.arcium_program,
        &position.encrypted_size,
        &position.encrypted_entry_price,
        mark_price,
        is_long,
    )?;

    // 2. Calculate funding payment
    let (encrypted_funding, is_receiving_funding) = calculate_funding_sync(
        &ctx.accounts.arcium_program,
        &position.encrypted_size,
        funding_delta as i64,
        is_long,
    )?;

    // 3. Calculate remaining equity: collateral + pnl - funding
    let mut remaining_equity = position.encrypted_collateral;
    if is_profit {
        remaining_equity = add_encrypted(&ctx.accounts.arcium_program, &remaining_equity, &encrypted_pnl)?;
    } else {
        remaining_equity = sub_encrypted(&ctx.accounts.arcium_program, &remaining_equity, &encrypted_pnl)?;
    }
    if is_receiving_funding {
        remaining_equity = add_encrypted(&ctx.accounts.arcium_program, &remaining_equity, &encrypted_funding)?;
    } else {
        remaining_equity = sub_encrypted(&ctx.accounts.arcium_program, &remaining_equity, &encrypted_funding)?;
    }

    // 4. Calculate liquidator bonus: remaining_equity * liquidation_bonus_bps / 10000
    let fee_multiplier = encrypt_value(
        &ctx.accounts.arcium_program,
        &[0u8; 32],
        liquidation_config.liquidation_bonus_bps as u64,
    )?;
    let _liquidator_bonus = mul_encrypted(
        &ctx.accounts.arcium_program,
        &remaining_equity,
        &fee_multiplier,
    )?;
    // Note: In production, divide by 10000 via another MPC operation

    // 5. Calculate insurance fund contribution
    let insurance_multiplier = encrypt_value(
        &ctx.accounts.arcium_program,
        &[0u8; 32],
        liquidation_config.insurance_fund_share_bps as u64,
    )?;
    let _insurance_contribution = mul_encrypted(
        &ctx.accounts.arcium_program,
        &remaining_equity,
        &insurance_multiplier,
    )?;

    // TODO: Transfer collateral distribution via C-SPL CPI:
    // - liquidator_bonus to liquidator
    // - insurance_contribution to insurance fund
    // - remaining to close position (if any positive equity)

    // Mark position as liquidated with coarse timestamp
    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.status = PositionStatus::Liquidated;
    position.last_updated_hour = coarse_time;

    // Update market statistics
    // Note: Actual OI reduction happens via MPC callback since size is encrypted

    // Log liquidation event (privacy-preserving: hash-based ID, no threshold, no amounts)
    msg!(
        "Position liquidated on market {}",
        perp_market.key()
    );

    // Emit liquidation event (privacy-preserving: no amounts, no threshold, hash-based ID)
    emit!(PositionLiquidated {
        position_id: position.position_id,
        trader: position.trader,
        market: perp_market.key(),
        liquidator: ctx.accounts.liquidator.key(),
        side: position.side,
        mark_price,
        timestamp: coarse_time,
    });

    Ok(())
}

#[event]
pub struct PositionLiquidated {
    /// Hash-based position ID (no sequential correlation)
    pub position_id: [u8; 16],
    pub trader: Pubkey,
    pub market: Pubkey,
    pub liquidator: Pubkey,
    pub side: PositionSide,
    /// Public oracle price at liquidation time
    pub mark_price: u64,
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
}
