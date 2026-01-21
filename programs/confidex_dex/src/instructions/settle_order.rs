use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, Side, TradingPair, UserConfidentialBalance};

/// Accounts for settling matched orders
///
/// This instruction is called AFTER orders have been matched via MPC
/// (i.e., after finalize_match callback has set encrypted_filled > 0)
///
/// Settlement flow:
/// 1. Verify both orders have non-zero encrypted_filled (checked in handler)
/// 2. Orders can be Active (partial fill) or Inactive (full fill)
/// 3. Transfer tokens from seller's balance to buyer's balance
/// 4. Emit settlement event
#[derive(Accounts)]
pub struct SettleOrder<'info> {
    /// Trading pair account (for accessing vaults and mints)
    #[account(
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump
    )]
    pub pair: Account<'info, TradingPair>,

    /// Buy order - must have non-zero encrypted_filled (checked in handler)
    /// Note: Order may still be Active if partially filled
    #[account(
        mut,
        constraint = buy_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
    )]
    pub buy_order: Account<'info, ConfidentialOrder>,

    /// Sell order - must have non-zero encrypted_filled (checked in handler)
    /// Note: Order may still be Active if partially filled
    #[account(
        mut,
        constraint = sell_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
    )]
    pub sell_order: Account<'info, ConfidentialOrder>,

    /// Buyer's base token (SOL) balance - will receive tokens
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            buy_order.maker.as_ref(),
            pair.base_mint.as_ref()
        ],
        bump = buyer_base_balance.bump,
    )]
    pub buyer_base_balance: Account<'info, UserConfidentialBalance>,

    /// Buyer's quote token (USDC) balance - will have tokens deducted
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            buy_order.maker.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = buyer_quote_balance.bump,
    )]
    pub buyer_quote_balance: Account<'info, UserConfidentialBalance>,

    /// Seller's base token (SOL) balance - will have tokens deducted
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            sell_order.maker.as_ref(),
            pair.base_mint.as_ref()
        ],
        bump = seller_base_balance.bump,
    )]
    pub seller_base_balance: Account<'info, UserConfidentialBalance>,

    /// Seller's quote token (USDC) balance - will receive tokens
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            sell_order.maker.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = seller_quote_balance.bump,
    )]
    pub seller_quote_balance: Account<'info, UserConfidentialBalance>,

    /// Exchange state (for fee_recipient pubkey and fee_bps)
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Account<'info, ExchangeState>,

    /// Fee recipient's quote token (USDC) balance - receives taker fees
    /// Uses init_if_needed in case fee_recipient hasn't traded before
    #[account(
        init_if_needed,
        payer = crank,
        space = UserConfidentialBalance::SIZE,
        seeds = [
            UserConfidentialBalance::SEED,
            exchange.fee_recipient.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump,
    )]
    pub fee_recipient_balance: Account<'info, UserConfidentialBalance>,

    /// Crank operator (anyone can settle matched orders)
    #[account(mut)]
    pub crank: Signer<'info>,

    /// System program (required for init_if_needed)
    pub system_program: Program<'info, System>,
}

/// Settle matched orders by transferring tokens between users
///
/// For a BUY order (buyer wants base token, pays quote token):
/// - Buyer's quote balance: -fill_value (fill_amount * price)
/// - Buyer's base balance: +fill_amount
/// - Seller's base balance: -fill_amount
/// - Seller's quote balance: +fill_value
///
/// HACKATHON VERSION: Uses plaintext helpers from first 8 bytes of encrypted fields.
/// When C-SPL SDK is available, replace with proper confidential_transfer CPI.
pub fn handler(ctx: Context<SettleOrder>) -> Result<()> {
    let buy_order = &ctx.accounts.buy_order;
    let sell_order = &ctx.accounts.sell_order;
    let buyer_base_balance = &mut ctx.accounts.buyer_base_balance;
    let buyer_quote_balance = &mut ctx.accounts.buyer_quote_balance;
    let seller_base_balance = &mut ctx.accounts.seller_base_balance;
    let seller_quote_balance = &mut ctx.accounts.seller_quote_balance;
    let exchange = &ctx.accounts.exchange;
    let fee_recipient_balance = &mut ctx.accounts.fee_recipient_balance;

    // Initialize fee_recipient_balance if newly created
    if fee_recipient_balance.owner == Pubkey::default() {
        fee_recipient_balance.owner = exchange.fee_recipient;
        fee_recipient_balance.mint = ctx.accounts.pair.quote_mint;
        fee_recipient_balance.bump = ctx.bumps.fee_recipient_balance;
    }

    // ==========================================================================
    // IDEMPOTENCY CHECK
    // If both orders have encrypted_filled cleared (all zeros), they're already settled
    // Return success without making changes (idempotent behavior)
    // ==========================================================================
    if buy_order.encrypted_filled == [0u8; 64] && sell_order.encrypted_filled == [0u8; 64] {
        msg!("Orders already settled, skipping (idempotent)");
        return Ok(());
    }

    // Check encrypted_filled has been set by MPC callback
    // Non-zero first byte indicates price match confirmed
    require!(
        buy_order.encrypted_filled[0] != 0,
        ConfidexError::OrderNotFilled
    );
    require!(
        sell_order.encrypted_filled[0] != 0,
        ConfidexError::OrderNotFilled
    );

    // ==========================================================================
    // HACKATHON SETTLEMENT (Interim until C-SPL SDK available)
    // Uses plaintext values from first 8 bytes of encrypted fields
    // In production: Replace with C-SPL confidential_transfer CPI
    // ==========================================================================

    // Get fill amount from order's encrypted_filled (first 8 bytes = plaintext)
    let fill_amount = buy_order.get_filled_plaintext();
    require!(fill_amount > 0, ConfidexError::OrderNotFilled);

    // Get execution price from buy order (first 8 bytes of encrypted_price)
    // Price is in quote token units per base token (e.g., USDC per SOL)
    let price = buy_order.get_price_plaintext();
    require!(price > 0, ConfidexError::InvalidAmount);

    // Calculate fill value: fill_amount * price / 1e9
    // - fill_amount is in base token smallest units (lamports for SOL, 9 decimals)
    // - price is in quote token units per whole base token (USDC micros, 6 decimals)
    // - Result: value in quote token smallest units (USDC micros)
    //
    // Example: 1 SOL (1e9 lamports) * $100 (100_000_000 USDC micros) / 1e9 = 100_000_000 micros = $100
    let fill_value = (fill_amount as u128)
        .checked_mul(price as u128)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_div(1_000_000_000) // SOL decimals (9)
        .ok_or(ConfidexError::ArithmeticOverflow)? as u64;

    // ==========================================================================
    // CALCULATE TAKER FEE
    // Fee is deducted from quote tokens (USDC) paid by buyer
    // ==========================================================================
    let taker_fee = fill_value
        .checked_mul(exchange.taker_fee_bps as u64)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    let net_to_seller = fill_value
        .checked_sub(taker_fee)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    msg!("Settlement: fill_amount={} base, fill_value={} quote, price={}, taker_fee={}",
         fill_amount, fill_value, price, taker_fee);

    // ==========================================================================
    // TRANSFER BASE TOKEN (SOL): Seller → Buyer
    // ==========================================================================
    let seller_base_current = seller_base_balance.get_balance();
    let buyer_base_current = buyer_base_balance.get_balance();
    require!(
        seller_base_current >= fill_amount,
        ConfidexError::InsufficientBalance
    );
    seller_base_balance.set_balance(seller_base_current - fill_amount);
    buyer_base_balance.set_balance(buyer_base_current + fill_amount);

    // ==========================================================================
    // TRANSFER QUOTE TOKEN (USDC): Buyer → Seller (net of fee)
    // ==========================================================================
    let buyer_quote_current = buyer_quote_balance.get_balance();
    let seller_quote_current = seller_quote_balance.get_balance();
    require!(
        buyer_quote_current >= fill_value,
        ConfidexError::InsufficientBalance
    );
    buyer_quote_balance.set_balance(buyer_quote_current - fill_value);
    seller_quote_balance.set_balance(seller_quote_current + net_to_seller);

    // ==========================================================================
    // TRANSFER FEE TO FEE RECIPIENT
    // ==========================================================================
    if taker_fee > 0 {
        let fee_recipient_current = fee_recipient_balance.get_balance();
        fee_recipient_balance.set_balance(fee_recipient_current + taker_fee);
        msg!("Fee collected: {} quote tokens to fee_recipient", taker_fee);
    }

    // ==========================================================================
    // MARK ORDERS AS SETTLED
    // Clear encrypted_filled to prevent double-settlement
    // The crank checks if encrypted_filled[0] != 0 to determine if orders need settlement
    // ==========================================================================
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    buy_order.encrypted_filled = [0u8; 64];
    sell_order.encrypted_filled = [0u8; 64];

    msg!("Settlement complete - balances updated");

    // Coarse timestamp for event (hour precision for privacy)
    let coarse_time = crate::state::ConfidentialOrder::coarse_timestamp(Clock::get()?.unix_timestamp);

    // Emit settlement event
    // HACKATHON: Include fill details for debugging/demo
    // PRODUCTION: Remove amounts, only emit order IDs and timestamp
    emit!(OrderSettled {
        buy_order_id: buy_order.order_id,
        sell_order_id: sell_order.order_id,
        buyer: buy_order.maker,
        seller: sell_order.maker,
        pair: ctx.accounts.pair.key(),
        timestamp: coarse_time,
        // HACKATHON ONLY - remove these fields in production
        fill_amount,
        fill_value,
        taker_fee,
    });

    msg!(
        "Orders settled: buy={:?} sell={:?}",
        buy_order.order_id,
        sell_order.order_id
    );

    Ok(())
}

/// Settlement event
/// HACKATHON: Includes amounts for debugging/demo
/// PRODUCTION: Remove fill_amount, fill_value, and taker_fee fields
#[event]
pub struct OrderSettled {
    /// Hash-based order ID
    pub buy_order_id: [u8; 16],
    /// Hash-based order ID
    pub sell_order_id: [u8; 16],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    /// Trading pair
    pub pair: Pubkey,
    /// Coarse timestamp (hour precision for privacy)
    pub timestamp: i64,
    /// HACKATHON ONLY: Fill amount in base token units (remove in production)
    pub fill_amount: u64,
    /// HACKATHON ONLY: Fill value in quote token units (remove in production)
    pub fill_value: u64,
    /// HACKATHON ONLY: Taker fee in quote token units (remove in production)
    pub taker_fee: u64,
}
