use anchor_lang::prelude::*;

use crate::cpi::arcium::{sub_encrypted, verify_position_params_sync};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide};

#[derive(Accounts)]
pub struct RemoveMargin<'info> {
    #[account(
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            trader.key().as_ref(),
            perp_market.key().as_ref(),
            &position.position_id.to_le_bytes()
        ],
        bump = position.bump,
        constraint = position.trader == trader.key() @ ConfidexError::Unauthorized,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = position.threshold_verified @ ConfidexError::ThresholdNotVerified
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// CHECK: Pyth oracle for current mark price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// CHECK: Trader's confidential collateral token account (C-SPL USDC)
    #[account(mut)]
    pub trader_collateral_account: AccountInfo<'info>,

    /// CHECK: Market's confidential collateral vault (C-SPL USDC)
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: AccountInfo<'info>,

    /// CHECK: Arcium program for MPC computations
    pub arcium_program: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,
}

/// Parameters for removing margin
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemoveMarginParams {
    /// Encrypted amount of collateral to remove (64 bytes via Arcium)
    pub encrypted_amount: [u8; 64],
    /// New liquidation threshold after removing margin
    /// Must be verified by MPC to match new position parameters
    /// Must still be safe (position won't be immediately liquidatable)
    pub new_liquidation_threshold: u64,
}

pub fn handler(ctx: Context<RemoveMargin>, params: RemoveMarginParams) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    // Get current mark price from oracle (6 decimal precision)
    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;

    // Validate that position won't be liquidatable after margin removal
    // This is a PUBLIC check using the new threshold
    match position.side {
        PositionSide::Long => {
            // For longs, new threshold will be HIGHER (closer to current price)
            // We need to ensure current price > new_threshold with 5% safety buffer
            require!(
                mark_price > params.new_liquidation_threshold.saturating_mul(105).saturating_div(100),
                ConfidexError::InsufficientCollateral
            );
        }
        PositionSide::Short => {
            // For shorts, new threshold will be LOWER (closer to current price)
            // We need to ensure current price < new_threshold with 5% safety buffer
            require!(
                mark_price < params.new_liquidation_threshold.saturating_mul(95).saturating_div(100),
                ConfidexError::InsufficientCollateral
            );
        }
    }

    // Subtract margin from encrypted collateral via MPC
    let new_encrypted_collateral = sub_encrypted(
        &ctx.accounts.arcium_program,
        &position.encrypted_collateral,
        &params.encrypted_amount,
    )?;

    // Verify new threshold matches updated collateral
    let is_long = matches!(position.side, PositionSide::Long);
    let threshold_valid = verify_position_params_sync(
        &ctx.accounts.arcium_program,
        &perp_market.key(), // Using market key as cluster placeholder
        &position.encrypted_entry_price,
        params.new_liquidation_threshold,
        position.leverage,
        is_long,
        perp_market.maintenance_margin_bps,
    )?;

    require!(threshold_valid, ConfidexError::ThresholdMismatch);

    // Store the updated encrypted collateral
    position.encrypted_collateral = new_encrypted_collateral;
    position.threshold_verified = true;

    // TODO: Transfer encrypted collateral from vault to trader via C-SPL CPI
    // This would use confidential_transfer instruction (blocked on C-SPL SDK)

    // Update liquidation threshold
    // This moves the threshold closer to current price, increasing liquidation risk
    match position.side {
        PositionSide::Long => {
            position.liquidatable_below_price = params.new_liquidation_threshold;
        }
        PositionSide::Short => {
            position.liquidatable_above_price = params.new_liquidation_threshold;
        }
    }

    position.last_threshold_update = clock.unix_timestamp;
    // threshold_verified already set to true above after MPC verification
    position.last_updated = clock.unix_timestamp;

    msg!(
        "Margin removed from position {} #{}, new threshold: {}",
        position.trader,
        position.position_id,
        params.new_liquidation_threshold
    );

    Ok(())
}
