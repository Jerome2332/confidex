use anchor_lang::prelude::*;

use crate::cpi::arcium::{calculate_encrypted_fill, compare_encrypted_prices};
use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, OrderStatus, Side, TradingPair};

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        constraint = !exchange.paused @ ConfidexError::ExchangePaused
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
            buy_order.maker.as_ref(),
            &buy_order.order_id.to_le_bytes()
        ],
        bump = buy_order.bump,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
        constraint = buy_order.is_open() @ ConfidexError::OrderNotOpen,
        constraint = buy_order.eligibility_proof_verified @ ConfidexError::EligibilityNotVerified
    )]
    pub buy_order: Account<'info, ConfidentialOrder>,

    #[account(
        mut,
        seeds = [
            ConfidentialOrder::SEED,
            sell_order.maker.as_ref(),
            &sell_order.order_id.to_le_bytes()
        ],
        bump = sell_order.bump,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
        constraint = sell_order.is_open() @ ConfidexError::OrderNotOpen,
        constraint = sell_order.eligibility_proof_verified @ ConfidexError::EligibilityNotVerified
    )]
    pub sell_order: Account<'info, ConfidentialOrder>,

    /// CHECK: Arcium MXE program for encrypted computations
    /// Will be validated when CPI integration is complete
    pub arcium_program: AccountInfo<'info>,

    /// Crank operator (can be anyone)
    pub crank: Signer<'info>,
}

pub fn handler(ctx: Context<MatchOrders>) -> Result<()> {
    let pair = &mut ctx.accounts.pair;
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let exchange = &ctx.accounts.exchange;
    let clock = Clock::get()?;

    // Verify orders are on the same pair
    require!(
        buy_order.pair == sell_order.pair && buy_order.pair == pair.key(),
        ConfidexError::OrdersNotMatchable
    );

    // Compare encrypted prices via Arcium MPC
    // buy_price >= sell_price means match is possible
    let prices_match = compare_encrypted_prices(
        &ctx.accounts.arcium_program,
        &exchange.arcium_cluster,
        &buy_order.encrypted_price,
        &sell_order.encrypted_price,
    )?;

    require!(prices_match, ConfidexError::OrdersNotMatchable);

    // Calculate encrypted fill amounts via Arcium MPC
    let (fill_amount, buy_fully_filled, sell_fully_filled) = calculate_encrypted_fill(
        &ctx.accounts.arcium_program,
        &exchange.arcium_cluster,
        &buy_order.encrypted_amount,
        &buy_order.encrypted_filled,
        &sell_order.encrypted_amount,
        &sell_order.encrypted_filled,
    )?;

    // Update filled amounts by adding the fill to current filled
    let new_buy_filled = crate::cpi::arcium::add_encrypted(
        &ctx.accounts.arcium_program,
        &buy_order.encrypted_filled,
        &fill_amount,
    )?;
    let new_sell_filled = crate::cpi::arcium::add_encrypted(
        &ctx.accounts.arcium_program,
        &sell_order.encrypted_filled,
        &fill_amount,
    )?;

    // Update order states
    buy_order.encrypted_filled = new_buy_filled;
    sell_order.encrypted_filled = new_sell_filled;

    if buy_fully_filled {
        buy_order.status = OrderStatus::Filled;
        pair.open_order_count = pair.open_order_count.saturating_sub(1);
    } else {
        buy_order.status = OrderStatus::PartiallyFilled;
    }

    if sell_fully_filled {
        sell_order.status = OrderStatus::Filled;
        pair.open_order_count = pair.open_order_count.saturating_sub(1);
    } else {
        sell_order.status = OrderStatus::PartiallyFilled;
    }

    // TODO: Execute confidential settlement via C-SPL or ShadowWire

    emit!(TradeExecuted {
        buy_order_id: buy_order.order_id,
        sell_order_id: sell_order.order_id,
        buyer: buy_order.maker,
        seller: sell_order.maker,
        pair: pair.key(),
        timestamp: clock.unix_timestamp,
        // Note: No amounts or prices emitted for privacy
    });

    msg!("Trade executed: buy order {} matched with sell order {}",
         buy_order.order_id, sell_order.order_id);

    Ok(())
}

#[event]
pub struct TradeExecuted {
    pub buy_order_id: u64,
    pub sell_order_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub pair: Pubkey,
    pub timestamp: i64,
    // Note: No amounts or prices for privacy
}
