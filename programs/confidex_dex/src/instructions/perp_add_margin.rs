use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide};

#[derive(Accounts)]
pub struct AddMargin<'info> {
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
        constraint = position.is_open() @ ConfidexError::PositionNotOpen
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// CHECK: Trader's confidential collateral token account (C-SPL USDC)
    #[account(mut)]
    pub trader_collateral_account: AccountInfo<'info>,

    /// CHECK: Market's confidential collateral vault (C-SPL USDC)
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,
}

/// Parameters for adding margin
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddMarginParams {
    /// Encrypted amount of collateral to add (64 bytes via Arcium)
    pub encrypted_amount: [u8; 64],
    /// New liquidation threshold after adding margin
    /// Must be verified by MPC to match new position parameters
    pub new_liquidation_threshold: u64,
}

pub fn handler(ctx: Context<AddMargin>, params: AddMarginParams) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    // TODO: Transfer encrypted collateral from trader to vault via C-SPL CPI
    // This would use confidential_transfer instruction

    // TODO: Submit MPC request to:
    // 1. Add encrypted_amount to encrypted_collateral
    // 2. Verify new_liquidation_threshold matches updated position
    // 3. Store new_encrypted_collateral in position

    // Update liquidation threshold
    // This moves the threshold further from current price, making liquidation less likely
    match position.side {
        PositionSide::Long => {
            // For longs, new threshold should be LOWER (safer)
            position.liquidatable_below_price = params.new_liquidation_threshold;
        }
        PositionSide::Short => {
            // For shorts, new threshold should be HIGHER (safer)
            position.liquidatable_above_price = params.new_liquidation_threshold;
        }
    }

    position.last_threshold_update = clock.unix_timestamp;
    position.threshold_verified = false; // Needs MPC verification
    position.last_updated = clock.unix_timestamp;
    position.last_margin_add = clock.unix_timestamp;
    position.margin_add_count = position.margin_add_count.saturating_add(1);

    msg!(
        "Margin added to position {} #{} (add #{})",
        position.trader,
        position.position_id,
        position.margin_add_count
    );

    Ok(())
}
