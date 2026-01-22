use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide};

/// Accounts for removing margin from a position (V6 - Async MPC)
///
/// The async flow:
/// 1. User calls remove_margin → position marked pending (no transfer yet)
/// 2. Crank detects MarginOperationInitiated event
/// 3. Crank calls MXE sub_encrypted() with position's encrypted data
/// 4. MXE verifies safety (new threshold won't cause immediate liquidation)
/// 5. MXE callback transfers tokens and updates position
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
            &position.position_seed.to_le_bytes()
        ],
        bump = position.bump,
        constraint = position.trader == trader.key() @ ConfidexError::Unauthorized,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = position.threshold_verified @ ConfidexError::ThresholdNotVerified,
        constraint = !position.has_pending_mpc_request() @ ConfidexError::OperationPending
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// CHECK: Pyth oracle for current mark price (safety check)
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Parameters for removing margin (V6 - simplified for async MPC)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RemoveMarginParams {
    /// Plaintext amount of collateral to remove (USDC with 6 decimals)
    /// The MPC will compute new encrypted values and verify safety
    pub amount: u64,
}

/// Initiate margin remove operation
///
/// V6: This instruction marks the position as pending MPC update.
/// The actual token transfer happens in margin_operation_callback
/// after MPC verifies the position won't be immediately liquidatable.
pub fn handler(ctx: Context<RemoveMargin>, params: RemoveMarginParams) -> Result<()> {
    let clock = Clock::get()?;
    let position = &mut ctx.accounts.position;

    // Validate amount
    require!(params.amount > 0, ConfidexError::InvalidCollateral);

    // =========================================================================
    // PRELIMINARY SAFETY CHECKS (plaintext validation)
    // =========================================================================
    // These checks use the plaintext prefix of encrypted_collateral for fast
    // on-chain validation BEFORE the expensive MPC computation.
    //
    // This is acceptable because:
    // 1. It only REJECTS obvious bad requests early (saves gas + MPC resources)
    // 2. It does NOT bypass MPC - the actual encrypted computation still happens
    // 3. MPC will perform the authoritative encrypted safety verification
    // 4. Worst case: a legitimate request is rejected early (user retries)
    //
    // The plaintext prefix is set by the frontend during encryption for UI display
    // and matches the actual encrypted value (enforced by MPC callback).
    // =========================================================================
    let current_collateral = position.get_collateral_plaintext();
    require!(
        params.amount <= current_collateral,
        ConfidexError::InsufficientCollateral
    );

    // Get current mark price for safety check reference (logged for debugging)
    let mark_price = get_sol_usd_price(&ctx.accounts.oracle)?;
    msg!("Mark price for margin remove safety check: {}", mark_price);

    // Minimum collateral check (5% safety buffer)
    // This is a PRELIMINARY check - MPC will verify position won't be
    // immediately liquidatable after the margin removal
    let min_required = current_collateral
        .saturating_mul(5)
        .saturating_div(100);
    let remaining = current_collateral.saturating_sub(params.amount);
    require!(
        remaining >= min_required || remaining == 0, // Allow full withdrawal if closing
        ConfidexError::InsufficientCollateral
    );

    // Generate unique request ID for MPC callback matching
    let request_id = ConfidentialPosition::generate_request_id(
        &position.key(),
        clock.slot,
    );

    // Store margin operation intent
    // Note: Tokens NOT transferred yet - MPC must verify safety first
    position.pending_mpc_request = request_id;
    position.pending_margin_amount = params.amount;
    position.pending_margin_is_add = false; // This is a remove operation

    let coarse_now = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.last_updated_hour = coarse_now;

    emit!(MarginRemoveInitiated {
        position: position.key(),
        trader: ctx.accounts.trader.key(),
        market: ctx.accounts.perp_market.key(),
        request_id,
        amount: params.amount,
        mark_price,
        timestamp: coarse_now,
    });

    msg!(
        "Margin remove initiated: position={}, amount={}, request_id={:?}",
        position.key(),
        params.amount,
        &request_id[0..8]
    );

    Ok(())
}

/// Event emitted when a margin remove operation is initiated
#[event]
pub struct MarginRemoveInitiated {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub request_id: [u8; 32],
    pub amount: u64,
    pub mark_price: u64,
    pub timestamp: i64,
}
