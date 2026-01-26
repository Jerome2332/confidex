//! Cancel order callback from MXE
//!
//! This instruction receives the decrypted refund_amount from the MXE's
//! calculate_refund callback. It performs the actual balance refund
//! without needing to read plaintext from order accounts.
//!
//! SECURITY: Only the MXE authority PDA can call this instruction.
//! The refund_amount is computed via MPC and passed securely - it is NOT
//! emitted in events to preserve privacy.

use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, OrderStatus, Side, TradingPair, UserConfidentialBalance};
use crate::cpi::arcium::ARCIUM_MXE_PROGRAM_ID;

/// MXE authority PDA seed (must match MXE program)
const MXE_AUTHORITY_SEED: &[u8] = b"mxe_authority";

/// Accounts for MPC-based cancel order callback
#[derive(Accounts)]
pub struct CancelOrderCallback<'info> {
    /// MXE authority PDA - must be the signer
    /// This ensures only the MXE callback can invoke cancellation
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID,
    )]
    pub mxe_authority: AccountInfo<'info>,

    /// Order to cancel - will be marked Inactive
    #[account(
        mut,
        constraint = order.is_active() @ ConfidexError::OrderNotOpen,
    )]
    pub order: Box<Account<'info, ConfidentialOrder>>,

    /// User's base token balance - for sell order refunds
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            order.maker.as_ref(),
            pair.base_mint.as_ref()
        ],
        bump = user_base_balance.bump,
    )]
    pub user_base_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// User's quote token balance - for buy order refunds
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            order.maker.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = user_quote_balance.bump,
    )]
    pub user_quote_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Trading pair account
    #[account(
        mut,
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump,
        constraint = order.pair == pair.key() @ ConfidexError::InvalidOrder,
    )]
    pub pair: Box<Account<'info, TradingPair>>,

    /// Exchange state
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,
}

/// Cancel order using decrypted refund amount from MPC
///
/// This is called by the MXE's calculate_refund_callback with the
/// revealed refund_amount. This value was computed via MPC as:
/// refund_amount = encrypted_amount - encrypted_filled
///
/// IMPORTANT: This function does NOT emit the refund_amount in events
/// to preserve privacy. Only order ID and timestamp are emitted.
pub fn handler(
    ctx: Context<CancelOrderCallback>,
    refund_amount: u64,
) -> Result<()> {
    let order = &mut ctx.accounts.order;
    let pair = &mut ctx.accounts.pair;
    let user_base_balance = &mut ctx.accounts.user_base_balance;
    let user_quote_balance = &mut ctx.accounts.user_quote_balance;
    let clock = Clock::get()?;

    // Perform the refund based on order side
    if refund_amount > 0 {
        match order.side {
            Side::Buy => {
                // Buy orders escrow quote tokens (USDC)
                // Refund quote tokens back to user
                let current_balance = user_quote_balance.get_balance();
                user_quote_balance.set_balance(current_balance + refund_amount);
            }
            Side::Sell => {
                // Sell orders escrow base tokens (SOL)
                // Refund base tokens back to user
                let current_balance = user_base_balance.get_balance();
                user_base_balance.set_balance(current_balance + refund_amount);
            }
        }
    }

    // Mark order as Inactive
    order.status = OrderStatus::Inactive;

    // Decrement open order count
    pair.open_order_count = pair.open_order_count.checked_sub(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    msg!("MPC cancel order complete");

    // Coarse timestamp for event (hour precision for privacy)
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    // Emit minimal cancellation event - NO AMOUNTS for privacy
    emit!(OrderCancelledPrivate {
        order_id: order.order_id,
        maker: order.maker,
        pair: order.pair,
        timestamp: coarse_time,
    });

    Ok(())
}

/// Privacy-preserving cancellation event
///
/// Unlike OrderCancelled in cancel_order.rs, this event does NOT include
/// the refund_amount to preserve privacy.
#[event]
pub struct OrderCancelledPrivate {
    /// Hash-based order ID (no sequential correlation)
    pub order_id: [u8; 16],
    pub maker: Pubkey,
    pub pair: Pubkey,
    /// Coarse timestamp (hour precision for privacy)
    pub timestamp: i64,
}
