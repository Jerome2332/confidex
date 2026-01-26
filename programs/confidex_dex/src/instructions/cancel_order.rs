use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, OrderStatus, Side, TradingPair, UserConfidentialBalance};

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        mut,
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump
    )]
    pub pair: Account<'info, TradingPair>,

    #[account(
        mut,
        seeds = [
            ConfidentialOrder::SEED,
            order.maker.as_ref(),
            &order.order_nonce
        ],
        bump = order.bump,
        constraint = order.maker == maker.key() @ ConfidexError::OrderOwnerMismatch,
        constraint = order.is_active() @ ConfidexError::OrderNotOpen
    )]
    pub order: Account<'info, ConfidentialOrder>,

    /// User's base token (SOL) balance - for sell order refunds
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            maker.key().as_ref(),
            pair.base_mint.as_ref()
        ],
        bump = user_base_balance.bump,
    )]
    pub user_base_balance: Account<'info, UserConfidentialBalance>,

    /// User's quote token (USDC) balance - for buy order refunds
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            maker.key().as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = user_quote_balance.bump,
    )]
    pub user_quote_balance: Account<'info, UserConfidentialBalance>,

    pub maker: Signer<'info>,
}

/// Cancel order handler
///
/// # DEPRECATED REFUND CALCULATION
///
/// This handler uses deprecated plaintext methods to calculate refunds.
/// In the future, this will be replaced with MPC-based refund calculation
/// via `cancel_order_callback` (Phase 3.3).
///
/// The MPC flow would be:
/// 1. Queue `calculate_refund` MPC with encrypted_amount and encrypted_filled
/// 2. MPC callback calls `cancel_order_callback` with decrypted refund_amount
/// 3. DEX updates balances without reading plaintext
#[allow(deprecated)]
pub fn handler(ctx: Context<CancelOrder>) -> Result<()> {
    let pair = &mut ctx.accounts.pair;
    let order = &mut ctx.accounts.order;
    let user_base_balance = &mut ctx.accounts.user_base_balance;
    let user_quote_balance = &mut ctx.accounts.user_quote_balance;
    let clock = Clock::get()?;

    // ==========================================================================
    // DEPRECATED: HACKATHON REFUND
    // Uses plaintext values - will be replaced with MPC-based refund (Phase 3.3)
    // ==========================================================================

    // Get remaining (unfilled) amount to refund
    let escrowed_amount = order.get_amount_plaintext();
    let filled_amount = order.get_filled_plaintext();
    let refund_amount = escrowed_amount.saturating_sub(filled_amount);

    if refund_amount > 0 {
        match order.side {
            Side::Buy => {
                // Buy orders escrow quote tokens (USDC)
                // Refund quote tokens back to user
                let current_balance = user_quote_balance.get_balance();
                user_quote_balance.set_balance(current_balance + refund_amount);
                msg!("Refunded {} quote tokens on buy order cancel", refund_amount);
            }
            Side::Sell => {
                // Sell orders escrow base tokens (SOL)
                // Refund base tokens back to user
                let current_balance = user_base_balance.get_balance();
                user_base_balance.set_balance(current_balance + refund_amount);
                msg!("Refunded {} base tokens on sell order cancel", refund_amount);
            }
        }
    }

    // V2: Simplified status - Active -> Inactive
    order.status = OrderStatus::Inactive;

    pair.open_order_count = pair.open_order_count.checked_sub(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Coarse timestamp for privacy
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    emit!(OrderCancelled {
        order_id: order.order_id,
        maker: order.maker,
        pair: order.pair,
        timestamp: coarse_time,
        // HACKATHON ONLY - remove in production
        refund_amount,
    });

    msg!("Order cancelled: {:?}", order.order_id);

    Ok(())
}

#[event]
pub struct OrderCancelled {
    /// Hash-based order ID (no sequential correlation)
    pub order_id: [u8; 16],
    pub maker: Pubkey,
    pub pair: Pubkey,
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
    /// HACKATHON ONLY: Refund amount (remove in production)
    pub refund_amount: u64,
}
