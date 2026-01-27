use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, OrderStatus, SettlementRequest, Side};

/// Accounts for finalizing ShadowWire settlement
///
/// Called after both ShadowWire transfers have been recorded.
/// Marks orders as filled and closes the settlement request account.
#[derive(Accounts)]
pub struct FinalizeSettlement<'info> {
    /// Settlement request - will be closed, rent returned to authority
    #[account(
        mut,
        close = authority,
        seeds = [
            SettlementRequest::SEED,
            settlement_request.buy_order.as_ref(),
            settlement_request.sell_order.as_ref(),
        ],
        bump = settlement_request.bump,
        constraint = settlement_request.buy_order == buy_order.key() @ ConfidexError::InvalidOrder,
        constraint = settlement_request.sell_order == sell_order.key() @ ConfidexError::InvalidOrder,
    )]
    pub settlement_request: Box<Account<'info, SettlementRequest>>,

    /// Buy order - will be marked as Inactive (filled)
    #[account(
        mut,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
    )]
    pub buy_order: Box<Account<'info, ConfidentialOrder>>,

    /// Sell order - will be marked as Inactive (filled)
    #[account(
        mut,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
    )]
    pub sell_order: Box<Account<'info, ConfidentialOrder>>,

    /// Crank authority - receives rent from closed settlement account
    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Finalize ShadowWire settlement after both transfers complete
///
/// This is the final step in the two-phase settlement process:
/// 1. initiate_settlement - creates SettlementRequest
/// 2. record_shadowwire_transfer (base) - records first transfer
/// 3. record_shadowwire_transfer (quote) - records second transfer
/// 4. finalize_settlement - marks orders filled, closes settlement account
///
/// # Arguments
/// * `ctx` - Instruction context
///
/// # Errors
/// * `SettlementFailed` - Settlement is not in QuoteTransferred state
pub fn handler(ctx: Context<FinalizeSettlement>) -> Result<()> {
    let settlement = &ctx.accounts.settlement_request;
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let clock = Clock::get()?;

    // Verify settlement is ready to finalize
    require!(
        settlement.can_finalize(),
        ConfidexError::SettlementFailed
    );

    // Verify both transfers have been recorded
    require!(
        settlement.base_transfer_set && settlement.quote_transfer_set,
        ConfidexError::SettlementFailed
    );

    // Mark orders as Inactive (filled)
    // Note: For partial fills, orders may still have remaining unfilled amounts,
    // but this settlement is for the matched portion. Orders can be re-matched
    // for remaining amounts if they were partially filled.
    buy_order.status = OrderStatus::Inactive;
    sell_order.status = OrderStatus::Inactive;

    // Clear matching flags
    buy_order.is_matching = false;
    sell_order.is_matching = false;
    buy_order.pending_match_request = [0u8; 32];
    sell_order.pending_match_request = [0u8; 32];

    // Emit completion event WITHOUT amounts (privacy-preserving)
    emit!(SettlementCompleted {
        settlement_request: settlement.key(),
        buy_order: buy_order.key(),
        sell_order: sell_order.key(),
        buy_order_id: buy_order.order_id,
        sell_order_id: sell_order.order_id,
        buyer: settlement.buyer,
        seller: settlement.seller,
        base_transfer_id: settlement.base_transfer_id,
        quote_transfer_id: settlement.quote_transfer_id,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Settlement finalized: {} (buy: {}, sell: {})",
        settlement.key(),
        buy_order.key(),
        sell_order.key()
    );

    // Settlement account will be closed automatically via `close = authority`
    Ok(())
}

/// Event emitted when settlement is completed
/// Note: NO amounts emitted to preserve privacy - only transfer IDs for verification
#[event]
pub struct SettlementCompleted {
    /// Settlement request PDA (now closed)
    pub settlement_request: Pubkey,
    /// Buy order PDA
    pub buy_order: Pubkey,
    /// Sell order PDA
    pub sell_order: Pubkey,
    /// Buy order hash-based ID
    pub buy_order_id: [u8; 16],
    /// Sell order hash-based ID
    pub sell_order_id: [u8; 16],
    /// Buyer's wallet
    pub buyer: Pubkey,
    /// Seller's wallet
    pub seller: Pubkey,
    /// ShadowWire transfer ID for base token
    pub base_transfer_id: [u8; 32],
    /// ShadowWire transfer ID for quote token
    pub quote_transfer_id: [u8; 32],
    /// Timestamp when settlement was completed
    pub timestamp: i64,
}
