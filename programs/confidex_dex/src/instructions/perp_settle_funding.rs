use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialPosition, FundingRateState, PerpetualMarket, PositionSide};

/// Accounts for initiating funding settlement (V7 - Async MPC)
///
/// The async flow:
/// 1. Keeper calls settle_funding → funding delta stored, event emitted
/// 2. Crank detects FundingSettlementInitiated event
/// 3. Crank calls MXE calculate_funding with encrypted position size
/// 4. MXE callback → funding_settlement_callback updates encrypted collateral
///
/// IMPORTANT: This instruction no longer calls sync MPC functions (which panic).
/// All encrypted computation happens via the async MXE callback.
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
        constraint = position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = !position.has_pending_mpc_request() @ ConfidexError::OperationPending,
        constraint = !position.pending_close @ ConfidexError::OperationPending
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// Anyone can settle funding for any position (keeper crank)
    pub keeper: Signer<'info>,
}

/// Initiate funding settlement for a position (V7 - Async MPC)
///
/// This instruction calculates the funding delta and queues an MPC request
/// to compute the funding payment and update the encrypted collateral.
///
/// The actual encrypted computation is performed by the MXE, and the result
/// is applied via `funding_settlement_callback`.
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
        msg!(
            "No funding to settle for position {} #{:?}",
            position.trader,
            position.position_id
        );
        return Ok(());
    }

    // Generate unique request ID for MPC callback matching
    let request_id = ConfidentialPosition::generate_request_id(
        &position.key(),
        clock.slot,
    );

    // Store the pending funding operation
    position.pending_mpc_request = request_id;

    // Store the funding delta in the threshold_commitment field temporarily
    // (this field is recalculated by the callback anyway)
    // First 16 bytes: funding_delta as i128
    // Last 16 bytes: current_cumulative_funding for the callback to use
    let mut funding_data = [0u8; 32];
    funding_data[0..16].copy_from_slice(&funding_delta.to_le_bytes());
    funding_data[16..32].copy_from_slice(&current_cumulative_funding.to_le_bytes()[0..16]);
    position.threshold_commitment = funding_data;

    // Mark threshold as unverified - it will be recalculated by callback
    // This prevents any liquidation while funding is pending
    position.threshold_verified = false;

    let coarse_now = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.last_updated_hour = coarse_now;

    // Determine funding direction for the event
    // Positive rate = longs pay shorts
    // For longs: positive delta means paying, negative means receiving
    // For shorts: opposite
    let is_long = matches!(position.side, PositionSide::Long);
    let is_paying = if is_long {
        funding_delta > 0
    } else {
        funding_delta < 0
    };

    msg!(
        "Funding settlement initiated: position={}, delta={}, direction={}",
        position.key(),
        funding_delta,
        if is_paying { "paying" } else { "receiving" }
    );

    // Emit event for backend to trigger MXE calculate_funding
    emit!(FundingSettlementInitiated {
        position: position.key(),
        trader: position.trader,
        market: perp_market.key(),
        request_id,
        funding_delta,
        current_cumulative_funding,
        entry_cumulative_funding: position.entry_cumulative_funding,
        is_long,
        timestamp: coarse_now,
    });

    Ok(())
}

/// Event emitted when funding settlement is initiated
/// Backend subscribes to this event to trigger MXE calculate_funding
#[event]
pub struct FundingSettlementInitiated {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    /// Request ID for MPC callback matching
    pub request_id: [u8; 32],
    /// Cumulative funding delta since position entry (scaled by 1e18)
    pub funding_delta: i128,
    /// Current cumulative funding for the market (for callback)
    pub current_cumulative_funding: i128,
    /// Position's entry cumulative funding (for verification)
    pub entry_cumulative_funding: i128,
    /// Position side (needed for funding direction calculation)
    pub is_long: bool,
    pub timestamp: i64,
}

/// Legacy event kept for compatibility with old logs
/// New code should use FundingSettlementInitiated + callback events
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
