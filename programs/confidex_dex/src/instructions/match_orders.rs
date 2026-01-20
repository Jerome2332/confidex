use anchor_lang::prelude::*;

use crate::cpi::arcium::{
    calculate_encrypted_fill, compare_encrypted_prices, add_encrypted,
    queue_compare_prices, queue_calculate_fill, MxeCpiAccounts, USE_REAL_MPC,
};
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
            &buy_order.order_id
        ],
        bump = buy_order.bump,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
        constraint = buy_order.is_active() @ ConfidexError::OrderNotOpen,
        constraint = buy_order.eligibility_proof_verified @ ConfidexError::EligibilityNotVerified
    )]
    pub buy_order: Account<'info, ConfidentialOrder>,

    #[account(
        mut,
        seeds = [
            ConfidentialOrder::SEED,
            sell_order.maker.as_ref(),
            &sell_order.order_id
        ],
        bump = sell_order.bump,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
        constraint = sell_order.is_active() @ ConfidexError::OrderNotOpen,
        constraint = sell_order.eligibility_proof_verified @ ConfidexError::EligibilityNotVerified
    )]
    pub sell_order: Account<'info, ConfidentialOrder>,

    /// CHECK: Arcium MXE program for encrypted computations
    /// Will be validated when CPI integration is complete
    pub arcium_program: AccountInfo<'info>,

    /// CHECK: MXE config account (for async MPC)
    #[account(mut)]
    pub mxe_config: Option<AccountInfo<'info>>,

    /// CHECK: MPC request account (for async MPC, will be initialized)
    #[account(mut)]
    pub mpc_request: Option<AccountInfo<'info>>,

    pub system_program: Program<'info, System>,

    /// Crank operator (can be anyone)
    #[account(mut)]
    pub crank: Signer<'info>,
}

/// Discriminator for finalize_match callback (sha256("global:finalize_match")[0..8])
/// Production flow: MXE calls finalize_match with orders passed directly
pub const FINALIZE_MATCH_CALLBACK: [u8; 8] = [0x76, 0x52, 0x2a, 0x69, 0x60, 0xdd, 0xbc, 0xdd];

/// Discriminator for price comparison callback (legacy flow)
pub const PRICE_COMPARE_CALLBACK: [u8; 8] = [0x40, 0xfc, 0x33, 0x4b, 0xcd, 0x2e, 0x11, 0xcb];
/// Discriminator for fill calculation callback (legacy flow)
pub const FILL_CALC_CALLBACK: [u8; 8] = [0xef, 0x75, 0x28, 0x16, 0xfa, 0xba, 0xda, 0x57];

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

    // Check if we should use async MPC flow
    let use_async_mpc = USE_REAL_MPC
        && ctx.accounts.mxe_config.is_some()
        && ctx.accounts.mpc_request.is_some();

    if use_async_mpc {
        // === ASYNC MPC FLOW (Production) ===
        // Queue price comparison - result comes back via finalize_match callback
        // MXE stores callback_account_1 (buy_order) and callback_account_2 (sell_order)
        // and passes them to the DEX callback for direct order updates
        let mxe_accounts = MxeCpiAccounts {
            mxe_config: ctx.accounts.mxe_config.as_ref().unwrap(),
            request_account: ctx.accounts.mpc_request.as_ref().unwrap(),
            requester: &ctx.accounts.crank.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
            mxe_program: &ctx.accounts.arcium_program,
        };

        let buy_order_key = buy_order.key();
        let sell_order_key = sell_order.key();

        let queued = queue_compare_prices(
            Some(mxe_accounts),
            &buy_order.encrypted_price,
            &sell_order.encrypted_price,
            &crate::ID,  // callback to this program
            FINALIZE_MATCH_CALLBACK,  // Use production finalize_match callback
            &buy_order_key,   // callback_account_1: buy_order pubkey
            &sell_order_key,  // callback_account_2: sell_order pubkey
        )?;

        // Store pending match state for callback validation
        // V2: Use is_matching flag instead of Matching status
        buy_order.pending_match_request = queued.request_id;
        sell_order.pending_match_request = queued.request_id;
        buy_order.is_matching = true;
        sell_order.is_matching = true;

        // Coarse timestamp for privacy
        let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

        emit!(MatchQueued {
            buy_order_id: buy_order.order_id,
            sell_order_id: sell_order.order_id,
            request_id: queued.request_id,
            timestamp: coarse_time,
        });

        msg!(
            "Match queued via async MPC: buy={:?} sell={:?} request_id={:?}",
            buy_order.order_id,
            sell_order.order_id,
            &queued.request_id[0..8]
        );

        return Ok(());
    }

    // === SYNC MPC FLOW (legacy/simulation) ===
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
    let new_buy_filled = add_encrypted(
        &ctx.accounts.arcium_program,
        &buy_order.encrypted_filled,
        &fill_amount,
    )?;
    let new_sell_filled = add_encrypted(
        &ctx.accounts.arcium_program,
        &sell_order.encrypted_filled,
        &fill_amount,
    )?;

    // Update order states
    // V2: Use Active/Inactive status with internal tracking
    buy_order.encrypted_filled = new_buy_filled;
    sell_order.encrypted_filled = new_sell_filled;

    if buy_fully_filled {
        buy_order.status = OrderStatus::Inactive;  // V2: Filled -> Inactive
        pair.open_order_count = pair.open_order_count.saturating_sub(1);
    }
    // V2: No "PartiallyFilled" status - remains Active

    if sell_fully_filled {
        sell_order.status = OrderStatus::Inactive;  // V2: Filled -> Inactive
        pair.open_order_count = pair.open_order_count.saturating_sub(1);
    }
    // V2: No "PartiallyFilled" status - remains Active

    // TODO: Execute confidential settlement via C-SPL or ShadowWire

    // Coarse timestamp for privacy
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    emit!(TradeExecuted {
        buy_order_id: buy_order.order_id,
        sell_order_id: sell_order.order_id,
        buyer: buy_order.maker,
        seller: sell_order.maker,
        pair: pair.key(),
        timestamp: coarse_time,
        // Note: No amounts or prices emitted for privacy
    });

    msg!("Trade executed: buy order {:?} matched with sell order {:?}",
         buy_order.order_id, sell_order.order_id);

    Ok(())
}

#[event]
pub struct TradeExecuted {
    /// Hash-based order ID (no sequential correlation)
    pub buy_order_id: [u8; 16],
    /// Hash-based order ID (no sequential correlation)
    pub sell_order_id: [u8; 16],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub pair: Pubkey,
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
    // Note: No amounts or prices for privacy
}

#[event]
pub struct MatchQueued {
    /// Hash-based order ID (no sequential correlation)
    pub buy_order_id: [u8; 16],
    /// Hash-based order ID (no sequential correlation)
    pub sell_order_id: [u8; 16],
    pub request_id: [u8; 32],
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
}
