use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, OrderStatus, TradingPair};

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
            &order.order_id
        ],
        bump = order.bump,
        constraint = order.maker == maker.key() @ ConfidexError::OrderOwnerMismatch,
        constraint = order.is_active() @ ConfidexError::OrderNotOpen
    )]
    pub order: Account<'info, ConfidentialOrder>,

    pub maker: Signer<'info>,
}

pub fn handler(ctx: Context<CancelOrder>) -> Result<()> {
    let pair = &mut ctx.accounts.pair;
    let order = &mut ctx.accounts.order;
    let clock = Clock::get()?;

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
}
