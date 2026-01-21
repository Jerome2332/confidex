use anchor_lang::prelude::*;

use crate::cpi::arcium::{add_encrypted, calculate_funding_sync, sub_encrypted};
use crate::error::ConfidexError;
use crate::state::{ConfidentialPosition, FundingRateState, PerpetualMarket, PositionSide};

/// Settle accumulated funding payments for a position
/// Can be called by anyone (keeper crank) or by the position owner
#[derive(Accounts)]
pub struct SettleFunding<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    #[account(
        seeds = [FundingRateState::SEED, perp_market.key().as_ref()],
        bump = funding_state.bump,
        constraint = funding_state.market == perp_market.key() @ ConfidexError::InvalidFundingState
    )]
    pub funding_state: Account<'info, FundingRateState>,

    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            position.trader.as_ref(),
            perp_market.key().as_ref(),
            &position.position_seed.to_le_bytes()
        ],
        bump = position.bump,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.is_open() @ ConfidexError::PositionNotOpen
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// CHECK: Market's confidential collateral vault
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: AccountInfo<'info>,

    /// CHECK: Arcium program for MPC computations
    pub arcium_program: AccountInfo<'info>,

    /// Anyone can settle funding for any position (keeper crank)
    pub keeper: Signer<'info>,
}

pub fn handler(ctx: Context<SettleFunding>) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    // Calculate cumulative funding delta since position entry
    let current_cumulative_funding = match position.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };

    let funding_delta = current_cumulative_funding
        .saturating_sub(position.entry_cumulative_funding);

    // Skip if no funding to settle
    if funding_delta == 0 {
        msg!("No funding to settle for position {} #{:?}",
            position.trader, position.position_id);
        return Ok(());
    }

    // Calculate funding payment via MPC
    // funding_payment = encrypted_size * funding_delta / SCALE
    let is_long = matches!(position.side, PositionSide::Long);
    let (encrypted_funding, is_receiving) = calculate_funding_sync(
        &ctx.accounts.arcium_program,
        &position.encrypted_size,
        funding_delta as i64,
        is_long,
    )?;

    // Update encrypted collateral based on funding direction
    // is_receiving = true: position receives funding (add to collateral)
    // is_receiving = false: position pays funding (subtract from collateral)
    if is_receiving {
        position.encrypted_collateral = add_encrypted(
            &ctx.accounts.arcium_program,
            &position.encrypted_collateral,
            &encrypted_funding,
        )?;
    } else {
        position.encrypted_collateral = sub_encrypted(
            &ctx.accounts.arcium_program,
            &position.encrypted_collateral,
            &encrypted_funding,
        )?;
    }

    // Determine funding direction for logging
    // Positive rate = longs pay shorts
    // Negative rate = shorts pay longs
    let is_paying = !is_receiving;

    // Update position's entry cumulative funding to current
    // This marks the funding as "settled" for this position
    position.entry_cumulative_funding = current_cumulative_funding;
    position.last_updated_hour = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);

    // After MPC settles funding, the liquidation threshold may need updating
    // Mark as needing re-verification - position cannot be liquidated until re-verified
    // TODO (POST-HACKATHON): Queue MPC callback for threshold recalculation:
    //   queue_verify_position_params(mxe_accounts, position, leverage, mm_bps);
    // For now, user must call verify_position_params manually to re-enable liquidation
    position.threshold_verified = false;

    msg!(
        "Funding settled for position {} #{:?}: delta={}, direction={}",
        position.trader,
        position.position_id,
        funding_delta,
        if is_paying { "paying" } else { "receiving" }
    );

    // Emit funding settlement event (privacy-preserving: no amounts)
    emit!(FundingSettled {
        position_id: position.position_id,
        trader: position.trader,
        market: perp_market.key(),
        funding_delta,
        is_paying,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct FundingSettled {
    pub position_id: [u8; 16],
    pub trader: Pubkey,
    pub market: Pubkey,
    /// Cumulative funding delta (scaled by 1e18)
    pub funding_delta: i128,
    /// True if position paid funding, false if received
    pub is_paying: bool,
    pub timestamp: i64,
}
