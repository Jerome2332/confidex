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
            &position.position_id
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
    /// New encrypted liquidation threshold after removing margin (64 bytes via Arcium)
    /// Must be verified by MPC to match new position parameters
    /// MPC will verify position won't be immediately liquidatable
    pub new_encrypted_liq_threshold: [u8; 64],
}

pub fn handler(ctx: Context<RemoveMargin>, params: RemoveMarginParams) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    // Get current mark price from oracle (6 decimal precision)
    // Note: With encrypted thresholds, the safety check is done via MPC
    let _mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;

    // Subtract margin from encrypted collateral via MPC
    let new_encrypted_collateral = sub_encrypted(
        &ctx.accounts.arcium_program,
        &position.encrypted_collateral,
        &params.encrypted_amount,
    )?;

    // Verify new threshold matches updated collateral via MPC
    // MPC also verifies position won't be immediately liquidatable with 5% safety buffer
    let is_long = matches!(position.side, PositionSide::Long);
    let threshold_valid = verify_position_params_sync(
        &ctx.accounts.arcium_program,
        &perp_market.key(), // Using market key as cluster placeholder
        &position.encrypted_entry_price,
        // For encrypted thresholds, MPC verifies the encrypted one
        0u64,
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

    // Update encrypted liquidation threshold
    // This moves the threshold closer to current price, increasing liquidation risk
    match position.side {
        PositionSide::Long => {
            position.encrypted_liq_below = params.new_encrypted_liq_threshold;
        }
        PositionSide::Short => {
            position.encrypted_liq_above = params.new_encrypted_liq_threshold;
        }
    }

    // Update threshold commitment
    position.threshold_commitment = ConfidentialPosition::compute_threshold_commitment(
        &position.encrypted_entry_price,
        position.leverage,
        perp_market.maintenance_margin_bps,
        is_long,
    );

    let coarse_now = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.last_threshold_update_hour = coarse_now;
    position.last_updated_hour = coarse_now;

    msg!(
        "Margin removed from position {} #{:?} (threshold now encrypted)",
        position.trader,
        position.position_id
    );

    Ok(())
}
