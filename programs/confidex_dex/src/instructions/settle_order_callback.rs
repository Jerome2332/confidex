//! Settlement callback from MXE
//!
//! This instruction receives decrypted fill_amount and price from the MXE's
//! decrypt_for_settlement callback. It performs the actual token transfers
//! without needing to read plaintext from order accounts.
//!
//! SECURITY: Only the MXE authority PDA can call this instruction.
//! The values are decrypted via MPC and passed securely - they are NOT
//! emitted in events to preserve privacy.

use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, Side, TradingPair, UserConfidentialBalance};
use crate::settlement::types::SettlementMethod;
use crate::settlement::shadowwire::SHADOWWIRE_FEE_BPS;
use crate::cpi::arcium::ARCIUM_MXE_PROGRAM_ID;

/// MXE authority PDA seed (must match MXE program)
const MXE_AUTHORITY_SEED: &[u8] = b"mxe_authority";

/// Accounts for MPC-based settlement callback
#[derive(Accounts)]
pub struct SettleOrderCallback<'info> {
    /// MXE authority PDA - must be the signer
    /// This ensures only the MXE callback can invoke settlement
    #[account(
        signer,
        seeds = [MXE_AUTHORITY_SEED],
        bump,
        seeds::program = ARCIUM_MXE_PROGRAM_ID,
    )]
    pub mxe_authority: AccountInfo<'info>,

    /// Buy order - will have encrypted_filled cleared
    #[account(
        mut,
        constraint = buy_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
    )]
    pub buy_order: Box<Account<'info, ConfidentialOrder>>,

    /// Sell order - will have encrypted_filled cleared
    #[account(
        mut,
        constraint = sell_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
    )]
    pub sell_order: Box<Account<'info, ConfidentialOrder>>,

    /// Trading pair account
    #[account(
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump
    )]
    pub pair: Box<Account<'info, TradingPair>>,

    /// Buyer's base token balance - will receive tokens
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            buy_order.maker.as_ref(),
            pair.base_mint.as_ref()
        ],
        bump = buyer_base_balance.bump,
    )]
    pub buyer_base_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Buyer's quote token balance - will have tokens deducted
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            buy_order.maker.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = buyer_quote_balance.bump,
    )]
    pub buyer_quote_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Seller's base token balance - will have tokens deducted
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            sell_order.maker.as_ref(),
            pair.base_mint.as_ref()
        ],
        bump = seller_base_balance.bump,
    )]
    pub seller_base_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Seller's quote token balance - will receive tokens
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            sell_order.maker.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = seller_quote_balance.bump,
    )]
    pub seller_quote_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Fee recipient's quote token balance
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            exchange.fee_recipient.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = fee_recipient_balance.bump,
    )]
    pub fee_recipient_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Exchange state (for fee_recipient pubkey and fee_bps)
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,
}

/// Settle orders using decrypted values from MPC
///
/// This is called by the MXE's decrypt_for_settlement_callback with the
/// revealed fill_amount and price. These values were decrypted via MPC
/// and are passed securely (not read from storage).
///
/// IMPORTANT: This function does NOT emit the fill_amount or price in events
/// to preserve privacy. Only order IDs and timestamp are emitted.
pub fn handler(
    ctx: Context<SettleOrderCallback>,
    fill_amount: u64,
    price: u64,
) -> Result<()> {
    let buy_order = &ctx.accounts.buy_order;
    let sell_order = &ctx.accounts.sell_order;
    let buyer_base_balance = &mut ctx.accounts.buyer_base_balance;
    let buyer_quote_balance = &mut ctx.accounts.buyer_quote_balance;
    let seller_base_balance = &mut ctx.accounts.seller_base_balance;
    let seller_quote_balance = &mut ctx.accounts.seller_quote_balance;
    let exchange = &ctx.accounts.exchange;
    let fee_recipient_balance = &mut ctx.accounts.fee_recipient_balance;

    // Validate decrypted values
    require!(fill_amount > 0, ConfidexError::OrderNotFilled);
    require!(price > 0, ConfidexError::InvalidAmount);

    // Calculate fill value: fill_amount * price / 1e9
    let fill_value = (fill_amount as u128)
        .checked_mul(price as u128)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_div(1_000_000_000) // SOL decimals (9)
        .ok_or(ConfidexError::ArithmeticOverflow)? as u64;

    // Use ShadowWire as default settlement method (privacy-preserving)
    let settlement_fee = fill_value
        .checked_mul(SHADOWWIRE_FEE_BPS as u64)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Calculate taker fee
    let taker_fee = fill_value
        .checked_mul(exchange.taker_fee_bps as u64)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Net to seller = fill_value - taker_fee - settlement_fee
    let net_to_seller = fill_value
        .checked_sub(taker_fee)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_sub(settlement_fee)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Transfer base token: Seller → Buyer
    let seller_base_current = seller_base_balance.get_balance();
    let buyer_base_current = buyer_base_balance.get_balance();
    require!(
        seller_base_current >= fill_amount,
        ConfidexError::InsufficientBalance
    );
    seller_base_balance.set_balance(seller_base_current - fill_amount);
    buyer_base_balance.set_balance(buyer_base_current + fill_amount);

    // Transfer quote token: Buyer → Seller (net of fees)
    let buyer_quote_current = buyer_quote_balance.get_balance();
    let seller_quote_current = seller_quote_balance.get_balance();
    require!(
        buyer_quote_current >= fill_value,
        ConfidexError::InsufficientBalance
    );
    buyer_quote_balance.set_balance(buyer_quote_current - fill_value);
    seller_quote_balance.set_balance(seller_quote_current + net_to_seller);

    // Transfer fee to fee recipient
    if taker_fee > 0 {
        let fee_recipient_current = fee_recipient_balance.get_balance();
        fee_recipient_balance.set_balance(fee_recipient_current + taker_fee);
    }

    // Mark orders as settled by clearing encrypted_filled
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    buy_order.encrypted_filled = [0u8; 64];
    sell_order.encrypted_filled = [0u8; 64];

    msg!("MPC settlement complete");

    // Coarse timestamp for event (hour precision for privacy)
    let coarse_time = crate::state::ConfidentialOrder::coarse_timestamp(Clock::get()?.unix_timestamp);

    // Emit minimal settlement event - NO AMOUNTS for privacy
    emit!(OrderSettledPrivate {
        buy_order_id: buy_order.order_id,
        sell_order_id: sell_order.order_id,
        buyer: buy_order.maker,
        seller: sell_order.maker,
        pair: ctx.accounts.pair.key(),
        timestamp: coarse_time,
        settlement_method: SettlementMethod::ShadowWire as u8,
    });

    Ok(())
}

/// Privacy-preserving settlement event
///
/// Unlike OrderSettled in settle_order.rs, this event does NOT include
/// any amount information (fill_amount, fill_value, fees).
#[event]
pub struct OrderSettledPrivate {
    pub buy_order_id: [u8; 16],
    pub sell_order_id: [u8; 16],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub pair: Pubkey,
    pub timestamp: i64,
    pub settlement_method: u8,
}
