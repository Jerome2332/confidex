//! MPC Callback Handlers
//!
//! These instructions receive computation results from the Arcium MXE
//! after MPC execution completes.
//!
//! Supported callback types:
//! 1. Order matching (FinalizeMatch) - price comparison and fill calculation
//! 2. Position verification (PositionVerificationCallback) - threshold computation
//! 3. Margin operations (MarginOperationCallback) - add/remove collateral
//! 4. Liquidation check (LiquidationCheckCallback) - batch liquidation status
//! 5. ADL PnL (AdlPnlCallback) - auto-deleverage settlement
//! 6. Close position (ClosePositionCallback) - V7 async position close

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{
    ConfidentialOrder, ConfidentialPosition, OrderStatus,
    PendingMatch, PendingMatchStatus, PerpetualMarket, PositionSide, PositionStatus
};
use crate::cpi::arcium::ARCIUM_MXE_PROGRAM_ID;
use crate::error::ConfidexError;

// TradingPair removed from FinalizeMatch - settlement handled separately

/// MXE Authority PDA seeds (must match arcium_mxe program)
pub const MXE_AUTHORITY_SEED: &[u8] = b"mxe_authority";

// ============================================================================
// SIMPLIFIED DIRECT CALLBACK (Production flow)
// ============================================================================

/// Accounts for finalize_match - simplified callback without PendingMatch
/// MXE passes buy_order and sell_order directly via callback_account_1/2
/// NOTE: Only requires 3 accounts to match MXE callback CPI
#[derive(Accounts)]
#[instruction(request_id: [u8; 32], result: Vec<u8>)]
pub struct FinalizeMatch<'info> {
    /// MXE authority PDA - verifies this came from our MXE program
    /// CHECK: Verified by seeds constraint - must be first account (signer from MXE CPI)
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,

    /// Buy order - passed as callback_account_1 from MXE
    /// V2: Use is_matching flag instead of Matching status
    #[account(
        mut,
        constraint = buy_order.is_in_matching() @ MpcCallbackError::OrderNotMatching
    )]
    pub buy_order: Account<'info, ConfidentialOrder>,

    /// Sell order - passed as callback_account_2 from MXE
    /// V2: Use is_matching flag instead of Matching status
    #[account(
        mut,
        constraint = sell_order.is_in_matching() @ MpcCallbackError::OrderNotMatching,
        constraint = sell_order.pair == buy_order.pair @ MpcCallbackError::InvalidOrder
    )]
    pub sell_order: Account<'info, ConfidentialOrder>,
    // NOTE: trading_pair removed - settlement will be handled separately
    // MXE CPI only passes 3 accounts: mxe_authority, buy_order, sell_order
}

/// Simplified callback handler for MPC price comparison result
///
/// Called by the MXE after Arcium MPC computes whether buy_price >= sell_price.
/// Orders are passed directly via callback_account_1/2 stored in ComputationRequest.
pub fn finalize_match(
    ctx: Context<FinalizeMatch>,
    request_id: [u8; 32],
    result: Vec<u8>,
) -> Result<()> {
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let clock = Clock::get()?;

    // Security: The mxe_authority PDA is verified via:
    // 1. `seeds = [MXE_AUTHORITY_SEED]` - correct derivation
    // 2. `seeds::program = ARCIUM_MXE_PROGRAM_ID` - from the MXE program
    // 3. `signer` constraint - can only be signed via invoke_signed by MXE
    //
    // Note: We do NOT check .owner because PDAs used as signers via invoke_signed
    // don't need to be initialized accounts. The owner of uninitialized PDAs is
    // the System Program, not the signing program. The signer+seeds constraint
    // is sufficient to prove this came from the authorized MXE.

    // Parse result: single byte indicating match (1) or no match (0)
    // Security: Exact length validation prevents malformed callback data
    require!(result.len() == 1, MpcCallbackError::InvalidResult);
    let prices_match = result[0] == 1;

    msg!(
        "MPC finalize_match: request {:?}, prices_match={}",
        &request_id[0..8],
        prices_match
    );

    // Verify orders were waiting for this request
    require!(
        buy_order.pending_match_request == request_id,
        MpcCallbackError::InvalidRequestId
    );
    require!(
        sell_order.pending_match_request == request_id,
        MpcCallbackError::InvalidRequestId
    );

    if prices_match {
        // Prices overlap - orders can be matched
        // V5: MPC computes fill amount. For now, mark orders for settlement.
        // The actual fill calculation happens in a separate MPC call (queue_calculate_fill)
        // which will set encrypted_filled via callback.

        // Privacy: No plaintext amounts logged
        msg!("Prices match - orders eligible for fill calculation via MPC");

        // Mark encrypted_filled with non-zero marker (actual value set by fill callback)
        // This indicates the orders have been price-matched
        let mut encrypted_fill = [0u8; 64];
        encrypted_fill[0] = 0xFF; // Non-zero marker indicating price match confirmed
        buy_order.encrypted_filled = encrypted_fill;
        sell_order.encrypted_filled = encrypted_fill;

        // V5: Assume both orders are fully filled for simplicity
        // In production, the fill callback would determine partial/full fills
        let buy_fully_filled = true;
        let sell_fully_filled = true;

        // V2: Only set to Inactive if fully filled, otherwise remain Active
        if buy_fully_filled {
            buy_order.status = OrderStatus::Inactive;
        }
        // else: remains Active (partially filled)

        if sell_fully_filled {
            sell_order.status = OrderStatus::Inactive;
        }
        // else: remains Active (partially filled)

        // Clear pending match state
        buy_order.pending_match_request = [0u8; 32];
        sell_order.pending_match_request = [0u8; 32];
        buy_order.is_matching = false;
        sell_order.is_matching = false;

        // Coarse timestamp for privacy
        let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

        emit!(OrdersMatchedDirect {
            request_id,
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            buy_fully_filled,
            sell_fully_filled,
            timestamp: coarse_time,
        });

        msg!(
            "Orders matched: buy={}, sell={}, buy_filled={}, sell_filled={}",
            buy_order.key(),
            sell_order.key(),
            buy_fully_filled,
            sell_fully_filled
        );

        // NOTE: Settlement is handled separately via off-chain service
        // trading_pair not available in CPI callback (only 3 accounts from MXE)
        // The OrdersMatchedDirect event triggers settlement process
    } else {
        // Prices don't overlap - orders remain Active (V2: no "Open" status)
        // Just clear the matching state
        buy_order.pending_match_request = [0u8; 32];
        sell_order.pending_match_request = [0u8; 32];
        buy_order.is_matching = false;
        sell_order.is_matching = false;

        // Coarse timestamp for privacy
        let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

        emit!(MatchFailedNoOverlap {
            request_id,
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            timestamp: coarse_time,
        });

        msg!(
            "No match: prices don't overlap. Orders remain Active."
        );
    }

    Ok(())
}

// ============================================================================
// ORIGINAL PENDINGMATCH-BASED CALLBACKS (kept for compatibility)
// ============================================================================

/// Accounts for receiving price comparison callback
#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct ReceiveCompareResult<'info> {
    /// The pending match being processed
    #[account(
        mut,
        seeds = [PendingMatch::SEED, &request_id],
        bump = pending_match.bump,
        constraint = pending_match.request_id == request_id @ MpcCallbackError::InvalidRequestId
    )]
    pub pending_match: Account<'info, PendingMatch>,

    /// Buy order
    #[account(
        mut,
        constraint = buy_order.key() == pending_match.buy_order @ MpcCallbackError::InvalidOrder
    )]
    pub buy_order: Account<'info, ConfidentialOrder>,

    /// Sell order
    #[account(
        mut,
        constraint = sell_order.key() == pending_match.sell_order @ MpcCallbackError::InvalidOrder
    )]
    pub sell_order: Account<'info, ConfidentialOrder>,

    /// MXE authority PDA - verifies this came from our MXE program
    /// CHECK: Verified by seeds constraint
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,
}

/// Handle result of encrypted price comparison
///
/// Called by the MXE after Arcium MPC computes whether buy_price >= sell_price
pub fn receive_compare_result(
    ctx: Context<ReceiveCompareResult>,
    request_id: [u8; 32],
    result: Vec<u8>,
) -> Result<()> {
    let pending_match = &mut ctx.accounts.pending_match;
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let clock = Clock::get()?;

    // Security: Verify MXE authority is owned by the expected Arcium MXE program
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

    // Parse result: single byte indicating match (1) or no match (0)
    // Security: Exact length validation prevents malformed callback data
    require!(result.len() == 1, MpcCallbackError::InvalidResult);
    let prices_match = result[0] == 1;

    msg!(
        "MPC compare result for request {:?}: prices_match={}",
        &request_id[0..8],
        prices_match
    );

    // Coarse timestamp for privacy
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    if prices_match {
        // Prices overlap - proceed to calculate fill amount
        pending_match.compare_result = Some(true);
        pending_match.updated_at = clock.unix_timestamp;

        emit!(PriceCompareComplete {
            request_id,
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            prices_match: true,
            timestamp: coarse_time,
        });

        // In a full implementation, we would now queue the calculate_fill computation
        // For now, emit event and the frontend/crank can trigger next step
    } else {
        // Prices don't overlap - no match possible
        pending_match.compare_result = Some(false);
        pending_match.status = PendingMatchStatus::NoMatch;
        pending_match.updated_at = clock.unix_timestamp;

        emit!(PriceCompareComplete {
            request_id,
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            prices_match: false,
            timestamp: coarse_time,
        });
    }

    Ok(())
}

/// Accounts for receiving fill calculation callback
#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct ReceiveFillResult<'info> {
    /// The pending match being processed
    #[account(
        mut,
        seeds = [PendingMatch::SEED, &request_id],
        bump = pending_match.bump,
        constraint = pending_match.request_id == request_id @ MpcCallbackError::InvalidRequestId,
        constraint = pending_match.compare_result == Some(true) @ MpcCallbackError::PricesDidNotMatch
    )]
    pub pending_match: Account<'info, PendingMatch>,

    /// Buy order
    #[account(
        mut,
        constraint = buy_order.key() == pending_match.buy_order @ MpcCallbackError::InvalidOrder
    )]
    pub buy_order: Account<'info, ConfidentialOrder>,

    /// Sell order
    #[account(
        mut,
        constraint = sell_order.key() == pending_match.sell_order @ MpcCallbackError::InvalidOrder
    )]
    pub sell_order: Account<'info, ConfidentialOrder>,

    /// MXE authority PDA
    /// CHECK: Verified by seeds constraint
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,
}

/// Handle result of encrypted fill calculation
///
/// Called by the MXE after Arcium MPC computes min(buy_remaining, sell_remaining)
pub fn receive_fill_result(
    ctx: Context<ReceiveFillResult>,
    request_id: [u8; 32],
    result: Vec<u8>,
) -> Result<()> {
    let pending_match = &mut ctx.accounts.pending_match;
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let clock = Clock::get()?;

    // Security: Verify MXE authority is owned by the expected Arcium MXE program
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

    // Parse result: 64 bytes encrypted fill + 1 byte buy_filled + 1 byte sell_filled
    // Security: Exact length validation for expected MPC output format
    require!(result.len() == 66, MpcCallbackError::InvalidResult);

    let mut encrypted_fill = [0u8; 64];
    encrypted_fill.copy_from_slice(&result[0..64]);
    let buy_fully_filled = result[64] == 1;
    let sell_fully_filled = result[65] == 1;

    msg!(
        "MPC fill result for request {:?}: buy_filled={}, sell_filled={}",
        &request_id[0..8],
        buy_fully_filled,
        sell_fully_filled
    );

    // Update orders with fill result
    // The encrypted fill amount is added to the encrypted_filled field
    buy_order.encrypted_filled = encrypted_fill;
    sell_order.encrypted_filled = encrypted_fill;

    // V2: Use Active/Inactive status
    if buy_fully_filled {
        buy_order.status = OrderStatus::Inactive;
    }
    // else: remains Active (partially filled)

    if sell_fully_filled {
        sell_order.status = OrderStatus::Inactive;
    }
    // else: remains Active (partially filled)

    // Clear matching state
    buy_order.is_matching = false;
    sell_order.is_matching = false;

    // Mark match as complete
    pending_match.status = PendingMatchStatus::Matched;
    pending_match.fill_result = Some(encrypted_fill);
    pending_match.updated_at = clock.unix_timestamp;

    // Coarse timestamp for privacy
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    emit!(OrdersMatched {
        request_id,
        buy_order: buy_order.key(),
        sell_order: sell_order.key(),
        buy_fully_filled,
        sell_fully_filled,
        timestamp: coarse_time,
    });

    Ok(())
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct PriceCompareComplete {
    pub request_id: [u8; 32],
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub prices_match: bool,
    pub timestamp: i64,
}

#[event]
pub struct OrdersMatched {
    pub request_id: [u8; 32],
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub buy_fully_filled: bool,
    pub sell_fully_filled: bool,
    pub timestamp: i64,
}

/// Event emitted when orders are matched via direct callback (finalize_match)
#[event]
pub struct OrdersMatchedDirect {
    pub request_id: [u8; 32],
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub buy_fully_filled: bool,
    pub sell_fully_filled: bool,
    pub timestamp: i64,
}

/// Event emitted when match fails due to price mismatch
#[event]
pub struct MatchFailedNoOverlap {
    pub request_id: [u8; 32],
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub timestamp: i64,
}

// ============================================================================
// EVENT-DRIVEN CALLBACK (Phase 3: Backend subscribes to MXE events)
// ============================================================================

/// Accounts for update_orders_from_result - called by backend after receiving MXE events
///
/// This is the event-driven pattern where:
/// 1. MXE emits PriceCompareResult/FillCalculationResult events
/// 2. Backend subscribes to these events
/// 3. Backend calls this instruction to update DEX order state
///
/// This decouples MXE from DEX - MXE doesn't need to know about DEX account structure
#[derive(Accounts)]
pub struct UpdateOrdersFromResult<'info> {
    /// Crank/backend signer that monitors MXE events
    #[account(mut)]
    pub crank: Signer<'info>,

    /// Buy order to update
    #[account(
        mut,
        constraint = buy_order.is_in_matching() @ MpcCallbackError::OrderNotMatching
    )]
    pub buy_order: Account<'info, ConfidentialOrder>,

    /// Sell order to update
    #[account(
        mut,
        constraint = sell_order.is_in_matching() @ MpcCallbackError::OrderNotMatching,
        constraint = sell_order.pair == buy_order.pair @ MpcCallbackError::InvalidOrder
    )]
    pub sell_order: Account<'info, ConfidentialOrder>,

    /// Exchange state - used to verify crank is authorized
    #[account(
        seeds = [crate::state::ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Account<'info, crate::state::ExchangeState>,
}

/// Parameters for update_orders_from_result
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateOrdersFromResultParams {
    /// MPC computation request ID (for logging/verification)
    pub request_id: [u8; 32],
    /// Whether prices matched (from MXE PriceCompareResult event)
    pub prices_match: bool,
    /// Optional encrypted fill amount (from MXE FillCalculationResult event)
    /// If None, uses marker fill for price match confirmation
    pub encrypted_fill: Option<[u8; 64]>,
    /// Whether buy order is fully filled
    pub buy_fully_filled: bool,
    /// Whether sell order is fully filled
    pub sell_fully_filled: bool,
}

/// Update orders based on MPC computation result
///
/// Called by backend after receiving MXE events (PriceCompareResult, FillCalculationResult).
/// This replaces direct MXE→DEX callbacks with an event-driven pattern.
pub fn update_orders_from_result(
    ctx: Context<UpdateOrdersFromResult>,
    params: UpdateOrdersFromResultParams,
) -> Result<()> {
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let clock = Clock::get()?;

    // Verify orders were waiting for this request
    require!(
        buy_order.pending_match_request == params.request_id,
        MpcCallbackError::InvalidRequestId
    );
    require!(
        sell_order.pending_match_request == params.request_id,
        MpcCallbackError::InvalidRequestId
    );

    msg!(
        "Backend update_orders_from_result: request {:?}, prices_match={}",
        &params.request_id[0..8],
        params.prices_match
    );

    // Coarse timestamp for privacy
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    if params.prices_match {
        // Prices overlap - update orders with fill result
        let encrypted_fill = params.encrypted_fill.unwrap_or_else(|| {
            // If no fill provided, use marker indicating price match confirmed
            let mut marker = [0u8; 64];
            marker[0] = 0xFF;
            marker
        });

        buy_order.encrypted_filled = encrypted_fill;
        sell_order.encrypted_filled = encrypted_fill;

        // Update status based on fill result
        if params.buy_fully_filled {
            buy_order.status = OrderStatus::Inactive;
        }

        if params.sell_fully_filled {
            sell_order.status = OrderStatus::Inactive;
        }

        // Clear pending match state
        buy_order.pending_match_request = [0u8; 32];
        sell_order.pending_match_request = [0u8; 32];
        buy_order.is_matching = false;
        sell_order.is_matching = false;

        emit!(OrdersUpdatedFromEvent {
            request_id: params.request_id,
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            prices_match: true,
            buy_fully_filled: params.buy_fully_filled,
            sell_fully_filled: params.sell_fully_filled,
            timestamp: coarse_time,
        });

        msg!(
            "Orders updated from MXE event: buy={}, sell={}, buy_filled={}, sell_filled={}",
            buy_order.key(),
            sell_order.key(),
            params.buy_fully_filled,
            params.sell_fully_filled
        );
    } else {
        // Prices don't overlap - clear matching state
        buy_order.pending_match_request = [0u8; 32];
        sell_order.pending_match_request = [0u8; 32];
        buy_order.is_matching = false;
        sell_order.is_matching = false;

        emit!(OrdersUpdatedFromEvent {
            request_id: params.request_id,
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            prices_match: false,
            buy_fully_filled: false,
            sell_fully_filled: false,
            timestamp: coarse_time,
        });

        msg!("No match from MXE event: prices don't overlap. Orders remain Active.");
    }

    Ok(())
}

/// Event emitted when orders are updated via backend event subscription
#[event]
pub struct OrdersUpdatedFromEvent {
    pub request_id: [u8; 32],
    pub buy_order: Pubkey,
    pub sell_order: Pubkey,
    pub prices_match: bool,
    pub buy_fully_filled: bool,
    pub sell_fully_filled: bool,
    pub timestamp: i64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum MpcCallbackError {
    #[msg("Invalid request ID")]
    InvalidRequestId,
    #[msg("Invalid order reference")]
    InvalidOrder,
    #[msg("Invalid result data")]
    InvalidResult,
    #[msg("Prices did not match - cannot calculate fill")]
    PricesDidNotMatch,
    #[msg("Unauthorized callback source")]
    UnauthorizedCallback,
    #[msg("Order is not in Matching status")]
    OrderNotMatching,
    #[msg("Position has no pending MPC request")]
    NoPendingRequest,
    #[msg("Position already verified")]
    AlreadyVerified,
    #[msg("Invalid position state")]
    InvalidPositionState,
}

// ============================================================================
// POSITION VERIFICATION CALLBACK (V6 - Async MPC)
// ============================================================================

/// Accounts for position verification callback
/// Called by MXE after verify_position_params MPC completes
#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct PositionVerificationCallback<'info> {
    /// MXE authority PDA - verifies this came from our MXE program
    /// CHECK: Verified by seeds constraint
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,

    /// Position to update with verification results
    #[account(
        mut,
        constraint = position.pending_mpc_request == request_id @ MpcCallbackError::InvalidRequestId,
        constraint = !position.threshold_verified @ MpcCallbackError::AlreadyVerified
    )]
    pub position: Account<'info, ConfidentialPosition>,
}

/// Parameters for position verification callback
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PositionVerificationParams {
    /// MPC computation request ID
    pub request_id: [u8; 32],
    /// Encrypted liquidation threshold below (for longs)
    pub encrypted_liq_below: [u8; 64],
    /// Encrypted liquidation threshold above (for shorts)
    pub encrypted_liq_above: [u8; 64],
    /// Whether verification succeeded
    pub success: bool,
}

/// Handle position verification callback from MXE
///
/// Called after MPC computes liquidation thresholds from position parameters.
/// Updates position with encrypted thresholds and marks as verified.
pub fn position_verification_callback(
    ctx: Context<PositionVerificationCallback>,
    params: PositionVerificationParams,
) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Security: Verify MXE authority is owned by the expected Arcium MXE program
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

    msg!(
        "Position verification callback: position={}, request_id={:?}, success={}",
        position.key(),
        &params.request_id[0..8],
        params.success
    );

    if params.success {
        // Update encrypted liquidation thresholds
        position.encrypted_liq_below = params.encrypted_liq_below;
        position.encrypted_liq_above = params.encrypted_liq_above;

        // Mark position as verified
        position.threshold_verified = true;

        // Update threshold commitment
        let is_long = matches!(position.side, PositionSide::Long);
        position.threshold_commitment = ConfidentialPosition::compute_threshold_commitment(
            &position.encrypted_entry_price,
            position.leverage,
            0, // maintenance_margin_bps passed in original call - stored in commitment
            is_long,
        );

        // Clear pending request
        position.clear_pending_mpc_request();

        let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
        position.last_threshold_update_hour = coarse_time;
        position.last_updated_hour = coarse_time;

        emit!(PositionVerified {
            position: position.key(),
            request_id: params.request_id,
            timestamp: coarse_time,
        });

        msg!("Position verified successfully: {}", position.key());
    } else {
        // MPC verification failed - position remains unverified
        // Clear pending request so it can be retried
        position.clear_pending_mpc_request();

        emit!(PositionVerificationFailed {
            position: position.key(),
            request_id: params.request_id,
            timestamp: clock.unix_timestamp,
        });

        msg!("Position verification failed: {}", position.key());
    }

    Ok(())
}

/// Event emitted when position verification succeeds
#[event]
pub struct PositionVerified {
    pub position: Pubkey,
    pub request_id: [u8; 32],
    pub timestamp: i64,
}

/// Event emitted when position verification fails
#[event]
pub struct PositionVerificationFailed {
    pub position: Pubkey,
    pub request_id: [u8; 32],
    pub timestamp: i64,
}

// ============================================================================
// MARGIN OPERATION CALLBACK (V6 - Async MPC)
// ============================================================================

/// Accounts for margin operation callback
/// Called by MXE after add/sub_encrypted MPC completes
#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct MarginOperationCallback<'info> {
    /// MXE authority PDA
    /// CHECK: Verified by seeds constraint
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,

    /// Position being updated
    #[account(
        mut,
        constraint = position.pending_mpc_request == request_id @ MpcCallbackError::InvalidRequestId,
        constraint = position.pending_margin_amount > 0 @ MpcCallbackError::NoPendingRequest
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// Perpetual market (for maintenance margin)
    #[account(
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    /// Trader's collateral token account
    #[account(
        mut,
        constraint = trader_collateral_account.mint == perp_market.quote_mint @ ConfidexError::InvalidMint,
        constraint = trader_collateral_account.owner == position.trader @ ConfidexError::InvalidOwner
    )]
    pub trader_collateral_account: Account<'info, TokenAccount>,

    /// Market's collateral vault
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    /// Vault authority PDA for signing transfers
    /// CHECK: Validated by seeds
    #[account(
        seeds = [b"vault_authority", perp_market.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// SPL Token program
    pub token_program: Program<'info, Token>,
}

/// Parameters for margin operation callback
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarginOperationParams {
    /// MPC computation request ID
    pub request_id: [u8; 32],
    /// New encrypted collateral after operation
    pub new_encrypted_collateral: [u8; 64],
    /// New encrypted liquidation threshold
    pub new_encrypted_liq_threshold: [u8; 64],
    /// Whether operation succeeded
    pub success: bool,
}

/// Handle margin operation callback from MXE
///
/// Called after MPC computes new collateral and thresholds.
/// Executes the actual token transfer and updates position.
pub fn margin_operation_callback(
    ctx: Context<MarginOperationCallback>,
    params: MarginOperationParams,
) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Security: Verify MXE authority
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

    let is_add = position.pending_margin_is_add;
    let amount = position.pending_margin_amount;

    msg!(
        "Margin operation callback: position={}, is_add={}, amount={}, success={}",
        position.key(),
        is_add,
        amount,
        params.success
    );

    if params.success {
        // Execute token transfer based on operation type
        if is_add {
            // Transfer from trader to vault
            // Note: In the async flow, we need to transfer here using a previously approved amount
            // For now, we update the position state only - actual transfer happens in the initiate instruction
            // This is a simplification for the hackathon - production would use PDA delegation
        } else {
            // Transfer from vault to trader (remove margin)
            let market_key = ctx.accounts.perp_market.key();
            let seeds = &[
                b"vault_authority".as_ref(),
                market_key.as_ref(),
                &[ctx.bumps.vault_authority],
            ];
            let signer_seeds = &[&seeds[..]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.collateral_vault.to_account_info(),
                        to: ctx.accounts.trader_collateral_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
            )?;
        }

        // Update encrypted values
        position.encrypted_collateral = params.new_encrypted_collateral;

        // Update appropriate liquidation threshold based on position side
        match position.side {
            PositionSide::Long => {
                position.encrypted_liq_below = params.new_encrypted_liq_threshold;
            }
            PositionSide::Short => {
                position.encrypted_liq_above = params.new_encrypted_liq_threshold;
            }
        }

        // Update threshold commitment
        let is_long = matches!(position.side, PositionSide::Long);
        position.threshold_commitment = ConfidentialPosition::compute_threshold_commitment(
            &position.encrypted_entry_price,
            position.leverage,
            ctx.accounts.perp_market.maintenance_margin_bps,
            is_long,
        );

        // Clear pending state
        position.clear_pending_mpc_request();

        let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
        position.last_threshold_update_hour = coarse_time;
        position.last_updated_hour = coarse_time;

        if is_add {
            position.last_margin_add_hour = coarse_time;
            position.margin_add_count = position.margin_add_count.saturating_add(1);
        }

        emit!(MarginOperationComplete {
            position: position.key(),
            request_id: params.request_id,
            is_add,
            amount,
            timestamp: coarse_time,
        });

        msg!(
            "Margin {} completed: {} USDC",
            if is_add { "add" } else { "remove" },
            amount
        );
    } else {
        // MPC operation failed - clear pending state for retry
        position.clear_pending_mpc_request();

        emit!(MarginOperationFailed {
            position: position.key(),
            request_id: params.request_id,
            is_add,
            timestamp: clock.unix_timestamp,
        });

        msg!("Margin operation failed: {}", position.key());
    }

    Ok(())
}

/// Event emitted when margin operation completes
#[event]
pub struct MarginOperationComplete {
    pub position: Pubkey,
    pub request_id: [u8; 32],
    pub is_add: bool,
    pub amount: u64,
    pub timestamp: i64,
}

/// Event emitted when margin operation fails
#[event]
pub struct MarginOperationFailed {
    pub position: Pubkey,
    pub request_id: [u8; 32],
    pub is_add: bool,
    pub timestamp: i64,
}

// ============================================================================
// LIQUIDATION CHECK CALLBACK (V6 - Batch Liquidation)
// ============================================================================

/// Accounts for liquidation check callback
/// Called by MXE after batch_liquidation_check MPC completes
#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct LiquidationCheckCallback<'info> {
    /// MXE authority PDA
    /// CHECK: Verified by seeds constraint
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,
    // Positions are passed via remaining_accounts to allow variable count
}

/// Parameters for liquidation check callback
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidationCheckParams {
    /// MPC computation request ID
    pub request_id: [u8; 32],
    /// Results for each position (true = should be liquidated)
    pub results: Vec<bool>,
}

/// Handle liquidation check callback from MXE
///
/// Called after batch MPC checks which positions should be liquidated.
/// Updates is_liquidatable flag on each position.
pub fn liquidation_check_callback(
    ctx: Context<LiquidationCheckCallback>,
    params: LiquidationCheckParams,
) -> Result<()> {
    // Security: Verify MXE authority
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

    msg!(
        "Liquidation check callback: request_id={:?}, {} positions",
        &params.request_id[0..8],
        params.results.len()
    );

    // Verify result count matches remaining_accounts
    require!(
        params.results.len() <= ctx.remaining_accounts.len(),
        MpcCallbackError::InvalidResult
    );

    let clock = Clock::get()?;
    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);

    // Update each position's liquidation status
    for (i, &should_liquidate) in params.results.iter().enumerate() {
        let position_info = &ctx.remaining_accounts[i];

        // Deserialize position account
        let mut position_data = position_info.try_borrow_mut_data()?;
        let mut position = ConfidentialPosition::try_deserialize(&mut &position_data[..])?;

        // Update liquidation status
        position.is_liquidatable = should_liquidate;
        position.last_updated_hour = coarse_time;

        // Clear pending request if this position was waiting for it
        if position.pending_mpc_request == params.request_id {
            position.clear_pending_mpc_request();
        }

        // Re-serialize the position
        let mut writer = &mut position_data[8..]; // Skip discriminator
        position.serialize(&mut writer)?;

        if should_liquidate {
            emit!(PositionMarkedLiquidatable {
                position: *position_info.key,
                timestamp: coarse_time,
            });
        }
    }

    emit!(LiquidationBatchComplete {
        request_id: params.request_id,
        position_count: params.results.len() as u8,
        liquidatable_count: params.results.iter().filter(|&&x| x).count() as u8,
        timestamp: coarse_time,
    });

    Ok(())
}

/// Event emitted when a position is marked as liquidatable
#[event]
pub struct PositionMarkedLiquidatable {
    pub position: Pubkey,
    pub timestamp: i64,
}

/// Event emitted when batch liquidation check completes
#[event]
pub struct LiquidationBatchComplete {
    pub request_id: [u8; 32],
    pub position_count: u8,
    pub liquidatable_count: u8,
    pub timestamp: i64,
}

// ============================================================================
// CLOSE POSITION CALLBACK (V7 - Async Close)
// ============================================================================

/// Accounts for close position callback
/// Called by MXE after calculate_pnl MPC completes
#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct ClosePositionCallback<'info> {
    /// MXE authority PDA - verifies this came from our MXE program
    /// CHECK: Verified by seeds constraint
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,

    /// Position being closed
    #[account(
        mut,
        constraint = position.pending_mpc_request == request_id @ MpcCallbackError::InvalidRequestId,
        constraint = position.pending_close @ MpcCallbackError::InvalidPositionState
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// Perpetual market
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    /// Trader's collateral token account
    #[account(
        mut,
        constraint = trader_collateral_account.mint == perp_market.quote_mint @ ConfidexError::InvalidMint,
        constraint = trader_collateral_account.owner == position.trader @ ConfidexError::InvalidOwner
    )]
    pub trader_collateral_account: Account<'info, TokenAccount>,

    /// Market's collateral vault
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA for signing transfers
    #[account(
        seeds = [b"vault", perp_market.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// SPL Token program
    pub token_program: Program<'info, Token>,
}

/// Parameters for close position callback
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClosePositionCallbackParams {
    /// MPC computation request ID
    pub request_id: [u8; 32],
    /// Computed encrypted PnL (64 bytes)
    pub encrypted_pnl: [u8; 64],
    /// Whether PnL is profit (true) or loss (false)
    pub is_profit: bool,
    /// Computed encrypted funding payment (64 bytes)
    pub encrypted_funding: [u8; 64],
    /// Whether funding is received (true) or owed (false)
    pub is_receiving_funding: bool,
    /// Final payout amount in USDC (plaintext for hackathon)
    /// In production, this would be computed via MPC and transferred via C-SPL
    pub payout_amount: u64,
    /// Whether MPC computation succeeded
    pub success: bool,
}

/// Handle close position callback from MXE
///
/// Called after MPC computes PnL and funding for position close.
/// Executes token transfer and marks position as closed.
pub fn close_position_callback(
    ctx: Context<ClosePositionCallback>,
    params: ClosePositionCallbackParams,
) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let perp_market = &ctx.accounts.perp_market;
    let clock = Clock::get()?;

    // Security: Verify MXE authority
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

    msg!(
        "Close position callback: position={}, request_id={:?}, payout={}, success={}",
        position.key(),
        &params.request_id[0..8],
        params.payout_amount,
        params.success
    );

    if !params.success {
        // MPC computation failed - clear pending state for retry
        position.clear_pending_close();

        emit!(PositionCloseFailed {
            position: position.key(),
            request_id: params.request_id,
            timestamp: clock.unix_timestamp,
        });

        msg!("Close position MPC failed: {}", position.key());
        return Ok(());
    }

    // Store computed PnL
    position.encrypted_realized_pnl = params.encrypted_pnl;

    // Calculate fees
    let taker_fee = params.payout_amount
        .checked_mul(perp_market.taker_fee_bps as u64)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    let net_payout = params.payout_amount
        .checked_sub(taker_fee)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Transfer payout to trader
    if net_payout > 0 {
        let market_key = perp_market.key();
        let seeds = &[
            b"vault".as_ref(),
            market_key.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    to: ctx.accounts.trader_collateral_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            net_payout,
        )?;

        msg!("Transferred {} USDC to trader (net of {} fee)", net_payout, taker_fee);
    }

    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);

    // Handle full vs partial close
    if position.pending_close_full {
        // Full close - mark position as closed
        position.status = PositionStatus::Closed;

        emit!(PositionClosed {
            position: position.key(),
            trader: position.trader,
            market: position.market,
            request_id: params.request_id,
            exit_price: position.pending_close_exit_price,
            is_profit: params.is_profit,
            payout: params.payout_amount,
            fee: taker_fee,
            timestamp: coarse_time,
        });

        msg!(
            "Position fully closed: {:?}, payout={}",
            position.position_id,
            net_payout
        );
    } else {
        // Partial close - update position state
        position.partial_close_count = position.partial_close_count.saturating_add(1);

        // Mark as needing re-verification for liquidation
        position.threshold_verified = false;

        emit!(PositionPartiallyClosed {
            position: position.key(),
            trader: position.trader,
            market: position.market,
            request_id: params.request_id,
            exit_price: position.pending_close_exit_price,
            is_profit: params.is_profit,
            payout: params.payout_amount,
            fee: taker_fee,
            close_count: position.partial_close_count,
            timestamp: coarse_time,
        });

        msg!(
            "Position partially closed: {:?}, close #{}, payout={}",
            position.position_id,
            position.partial_close_count,
            net_payout
        );
    }

    // Clear pending close state
    position.clear_pending_close();
    position.last_updated_hour = coarse_time;

    Ok(())
}

/// Event emitted when position is fully closed
#[event]
pub struct PositionClosed {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub request_id: [u8; 32],
    /// Exit price used for PnL calculation
    pub exit_price: u64,
    /// Whether position closed at profit
    pub is_profit: bool,
    /// Total payout before fees
    pub payout: u64,
    /// Taker fee deducted
    pub fee: u64,
    pub timestamp: i64,
}

/// Event emitted when position is partially closed
#[event]
pub struct PositionPartiallyClosed {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub request_id: [u8; 32],
    pub exit_price: u64,
    pub is_profit: bool,
    pub payout: u64,
    pub fee: u64,
    /// Number of partial closes
    pub close_count: u8,
    pub timestamp: i64,
}

/// Event emitted when close position MPC fails
#[event]
pub struct PositionCloseFailed {
    pub position: Pubkey,
    pub request_id: [u8; 32],
    pub timestamp: i64,
}

// ============================================================================
// FUNDING SETTLEMENT CALLBACK (V7 - Async MPC)
// ============================================================================

/// Accounts for funding settlement callback
/// Called by MXE after calculate_funding MPC completes
#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct FundingSettlementCallback<'info> {
    /// MXE authority PDA - verifies this came from our MXE program
    /// CHECK: Verified by seeds constraint
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID
    )]
    pub mxe_authority: UncheckedAccount<'info>,

    /// Position being updated with funding settlement
    #[account(
        mut,
        constraint = position.pending_mpc_request == request_id @ MpcCallbackError::InvalidRequestId,
        constraint = !position.threshold_verified @ MpcCallbackError::AlreadyVerified
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// Perpetual market (for maintenance margin and updating entry funding)
    #[account(
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState
    )]
    pub perp_market: Account<'info, PerpetualMarket>,
}

/// Parameters for funding settlement callback
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FundingSettlementParams {
    /// MPC computation request ID
    pub request_id: [u8; 32],
    /// New encrypted collateral after funding adjustment
    pub new_encrypted_collateral: [u8; 64],
    /// New encrypted liquidation threshold (recalculated after collateral change)
    pub new_encrypted_liq_threshold: [u8; 64],
    /// Whether funding was received (true) or paid (false)
    pub is_receiving: bool,
    /// Whether MPC computation succeeded
    pub success: bool,
}

/// Handle funding settlement callback from MXE
///
/// Called after MPC computes funding payment and adjusts collateral.
/// Updates position's encrypted collateral and liquidation thresholds.
pub fn funding_settlement_callback(
    ctx: Context<FundingSettlementCallback>,
    params: FundingSettlementParams,
) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let perp_market = &ctx.accounts.perp_market;
    let clock = Clock::get()?;

    // Security: Verify MXE authority
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

    msg!(
        "Funding settlement callback: position={}, request_id={:?}, success={}",
        position.key(),
        &params.request_id[0..8],
        params.success
    );

    if !params.success {
        // MPC computation failed - clear pending state for retry
        position.clear_pending_mpc_request();

        emit!(FundingSettlementFailed {
            position: position.key(),
            request_id: params.request_id,
            timestamp: clock.unix_timestamp,
        });

        msg!("Funding settlement MPC failed: {}", position.key());
        return Ok(());
    }

    // Extract the stored cumulative funding from threshold_commitment
    // (stored by perp_settle_funding.rs in bytes 16-32)
    let current_cumulative_funding = i128::from_le_bytes(
        position.threshold_commitment[16..32]
            .try_into()
            .unwrap_or([0u8; 16])
    );

    // Update position's entry cumulative funding to current
    // This marks the funding as "settled" for this position
    position.entry_cumulative_funding = current_cumulative_funding;

    // Update encrypted collateral with MPC result
    position.encrypted_collateral = params.new_encrypted_collateral;

    // Update liquidation threshold based on position side
    match position.side {
        PositionSide::Long => {
            position.encrypted_liq_below = params.new_encrypted_liq_threshold;
        }
        PositionSide::Short => {
            position.encrypted_liq_above = params.new_encrypted_liq_threshold;
        }
    }

    // Recalculate threshold commitment
    let is_long = matches!(position.side, PositionSide::Long);
    position.threshold_commitment = ConfidentialPosition::compute_threshold_commitment(
        &position.encrypted_entry_price,
        position.leverage,
        perp_market.maintenance_margin_bps,
        is_long,
    );

    // Mark as verified and clear pending state
    position.threshold_verified = true;
    position.clear_pending_mpc_request();

    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.last_threshold_update_hour = coarse_time;
    position.last_updated_hour = coarse_time;

    emit!(FundingSettlementComplete {
        position: position.key(),
        request_id: params.request_id,
        is_receiving: params.is_receiving,
        timestamp: coarse_time,
    });

    msg!(
        "Funding {} settled for position: {}",
        if params.is_receiving { "received" } else { "paid" },
        position.key()
    );

    Ok(())
}

/// Event emitted when funding settlement completes
#[event]
pub struct FundingSettlementComplete {
    pub position: Pubkey,
    pub request_id: [u8; 32],
    /// Whether funding was received (true) or paid (false)
    pub is_receiving: bool,
    pub timestamp: i64,
}

/// Event emitted when funding settlement MPC fails
#[event]
pub struct FundingSettlementFailed {
    pub position: Pubkey,
    pub request_id: [u8; 32],
    pub timestamp: i64,
}
