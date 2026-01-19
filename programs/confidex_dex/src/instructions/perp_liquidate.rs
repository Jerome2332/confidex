use anchor_lang::prelude::*;

use crate::cpi::arcium::{
    check_liquidation_sync, calculate_pnl_sync, calculate_funding_sync,
    add_encrypted, sub_encrypted, mul_encrypted, encrypt_value, EncryptedU64
};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
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

    /// CHECK: Arcium program for MPC calculations
    pub arcium_program: AccountInfo<'info>,
}

pub fn handler(ctx: Context<LiquidatePosition>) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;
    let liquidation_config = &ctx.accounts.liquidation_config;

    // Fetch current mark price from Pyth oracle (6 decimal precision)
    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;
    msg!("Oracle mark price for liquidation: {} (6 decimals)", mark_price);

    // Check if position is liquidatable using PUBLIC thresholds
    // This is the key privacy-preserving check: we only check the public threshold
    // The actual position size/collateral remains encrypted
    require!(
        position.is_liquidatable(mark_price),
        ConfidexError::PositionNotLiquidatable
    );

    let is_long = matches!(position.side, PositionSide::Long);

    // === MPC VERIFICATION ===
    // Double-check liquidation eligibility via MPC using encrypted position data
    let mpc_confirms_liquidation = check_liquidation_sync(
        &ctx.accounts.arcium_program,
        &perp_market.arcium_cluster,
        &position.encrypted_collateral,
        &position.encrypted_size,
        &position.encrypted_entry_price,
        mark_price,
        is_long,
        perp_market.maintenance_margin_bps,
    )?;

    require!(
        mpc_confirms_liquidation,
        ConfidexError::PositionNotLiquidatable
    );

    msg!("MPC confirmed liquidation eligibility for position {}", position.position_id);

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
    let liquidator_bonus = mul_encrypted(
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
    let insurance_contribution = mul_encrypted(
        &ctx.accounts.arcium_program,
        &remaining_equity,
        &insurance_multiplier,
    )?;

    msg!(
        "MPC calculated liquidation amounts for position {}",
        position.position_id
    );

    // TODO: Transfer collateral distribution via C-SPL CPI:
    // - liquidator_bonus to liquidator
    // - insurance_contribution to insurance fund
    // - remaining to close position (if any positive equity)

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
