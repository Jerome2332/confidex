//! MPC Callback Handlers
//!
//! These instructions receive computation results from the Arcium MXE
//! after MPC execution completes.
//!
//! Two flows are supported:
//! 1. PendingMatch-based: Original flow using PendingMatch accounts
//! 2. Direct callback: Simplified flow where MXE passes orders directly

use anchor_lang::prelude::*;
use crate::state::{ConfidentialOrder, OrderStatus, PendingMatch, PendingMatchStatus};
use crate::cpi::arcium::ARCIUM_MXE_PROGRAM_ID;

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

    // Security: Verify MXE authority is owned by the expected Arcium MXE program
    // This prevents spoofed callbacks from malicious programs
    require!(
        ctx.accounts.mxe_authority.owner == &ARCIUM_MXE_PROGRAM_ID,
        MpcCallbackError::UnauthorizedCallback
    );

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
}
