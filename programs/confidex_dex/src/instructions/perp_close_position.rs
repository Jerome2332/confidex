use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide, PositionStatus};

#[derive(Accounts)]
pub struct ClosePosition<'info> {
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

    /// CHECK: Pyth oracle for mark price / exit price
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

    /// CHECK: Fee recipient account
    #[account(
        mut,
        constraint = fee_recipient.key() == perp_market.fee_recipient @ ConfidexError::Unauthorized
    )]
    pub fee_recipient: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,
}

/// Parameters for closing a position
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClosePositionParams {
    /// Encrypted amount to close (64 bytes) - for partial closes
    /// If full_close is true, this is ignored
    pub encrypted_close_size: [u8; 64],
    /// Encrypted exit price (64 bytes via Arcium)
    /// Should match oracle price at execution time
    pub encrypted_exit_price: [u8; 64],
    /// Whether to close the full position
    pub full_close: bool,
}

pub fn handler(ctx: Context<ClosePosition>, params: ClosePositionParams) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    // Calculate funding owed since position was opened
    let current_cumulative_funding = match position.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };
    let funding_delta = current_cumulative_funding
        .saturating_sub(position.entry_cumulative_funding);

    // TODO: Submit MPC computation to:
    // 1. Calculate funding payment: encrypted_size * funding_delta
    // 2. Calculate PnL: (exit_price - entry_price) * size for longs
    //                   (entry_price - exit_price) * size for shorts
    // 3. Calculate final payout: collateral + pnl - funding - fees
    // 4. Execute confidential transfer from vault to trader

    // TODO: Transfer payout from vault to trader via C-SPL CPI
    // Amount = collateral + PnL - funding_payment - fees

    // TODO: Transfer fees to fee_recipient

    if params.full_close {
        // Mark position as closed
        position.status = PositionStatus::Closed;

        // Update market open interest
        // Note: Actual OI reduction happens via MPC callback since size is encrypted
        // For now, we just decrement position count

        msg!(
            "Position fully closed: {} #{} on market {}",
            position.trader,
            position.position_id,
            perp_market.key()
        );
    } else {
        // Partial close
        position.partial_close_count = position.partial_close_count.saturating_add(1);

        // TODO: MPC needs to:
        // 1. Verify close_size <= position_size
        // 2. Update encrypted_size = encrypted_size - close_size
        // 3. Update encrypted_collateral proportionally
        // 4. Recalculate liquidation threshold

        msg!(
            "Position partially closed: {} #{} on market {} (close #{})",
            position.trader,
            position.position_id,
            perp_market.key(),
            position.partial_close_count
        );
    }

    position.last_updated = clock.unix_timestamp;

    Ok(())
}
