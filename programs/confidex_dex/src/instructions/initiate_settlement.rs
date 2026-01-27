use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{
    ConfidentialOrder, OrderStatus, SettlementMethod, SettlementRequest, SettlementStatus, Side,
    TradingPair,
};

/// Accounts for initiating ShadowWire settlement
///
/// This instruction creates a SettlementRequest account that tracks the
/// two-phase settlement process:
/// 1. Backend executes base token transfer via ShadowWire API
/// 2. Backend executes quote token transfer via ShadowWire API
/// 3. Finalize settlement marks orders as filled
///
/// The encrypted fill amounts are copied from orders but never read as plaintext.
/// The backend obtains decrypted values via MPC callbacks.
#[derive(Accounts)]
pub struct InitiateSettlement<'info> {
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

    /// Buy order - must be matched (have non-zero encrypted_filled)
    #[account(
        mut,
        constraint = buy_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
    )]
    pub buy_order: Box<Account<'info, ConfidentialOrder>>,

    /// Sell order - must be matched (have non-zero encrypted_filled)
    #[account(
        mut,
        constraint = sell_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
    )]
    pub sell_order: Box<Account<'info, ConfidentialOrder>>,

    /// Settlement request PDA - tracks settlement lifecycle
    #[account(
        init,
        payer = authority,
        space = SettlementRequest::SIZE,
        seeds = [
            SettlementRequest::SEED,
            buy_order.key().as_ref(),
            sell_order.key().as_ref(),
        ],
        bump
    )]
    pub settlement_request: Box<Account<'info, SettlementRequest>>,

    /// Crank authority (settlement initiator)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Parameters for initiate_settlement instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitiateSettlementParams {
    /// Settlement method selection (0=ShadowWire, 1=CSPL, 2=StandardSPL)
    pub settlement_method: u8,
}

/// Initiate ShadowWire settlement for matched orders
///
/// Creates a SettlementRequest that tracks the two-phase transfer process.
/// The backend will poll for pending settlements and execute transfers via
/// the ShadowWire API using MPC-decrypted amounts.
///
/// # Arguments
/// * `ctx` - Instruction context
/// * `params` - Settlement parameters including method selection
///
/// # Errors
/// * `OrderNotFilled` - Orders don't have non-zero encrypted_filled
/// * `InvalidOrder` - Orders are not from the same pair
pub fn handler(ctx: Context<InitiateSettlement>, params: InitiateSettlementParams) -> Result<()> {
    let buy_order = &ctx.accounts.buy_order;
    let sell_order = &ctx.accounts.sell_order;
    let pair = &ctx.accounts.pair;
    let settlement = &mut ctx.accounts.settlement_request;

    // Verify orders have been matched (encrypted_filled[0] != 0 indicates MPC set fill)
    // This is the privacy-preserving check - we don't read the actual amount
    require!(
        buy_order.encrypted_filled[0] != 0,
        ConfidexError::OrderNotFilled
    );
    require!(
        sell_order.encrypted_filled[0] != 0,
        ConfidexError::OrderNotFilled
    );

    // Verify orders are Active or Inactive with fills (can still settle partial fills)
    // Note: OrderStatus::Active means order is still tradeable (partial fill)
    // OrderStatus::Inactive means order is fully filled or cancelled
    require!(
        matches!(buy_order.status, OrderStatus::Active | OrderStatus::Inactive),
        ConfidexError::InvalidOrder
    );
    require!(
        matches!(sell_order.status, OrderStatus::Active | OrderStatus::Inactive),
        ConfidexError::InvalidOrder
    );

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize settlement request
    settlement.buy_order = buy_order.key();
    settlement.sell_order = sell_order.key();
    settlement.method = SettlementMethod::from(params.settlement_method);
    settlement.status = SettlementStatus::Pending;
    settlement.base_mint = pair.base_mint;
    settlement.quote_mint = pair.quote_mint;

    // Copy encrypted values - NO PLAINTEXT READS
    // Backend will obtain decrypted values via MPC callback
    settlement.encrypted_fill_amount = buy_order.encrypted_filled;

    // For fill_value, we'd ideally compute amount * price via MPC
    // For now, copy the encrypted price - backend will compute fill_value
    settlement.encrypted_fill_value = buy_order.encrypted_price;

    // Initialize transfer IDs as unset
    settlement.base_transfer_id = [0u8; 32];
    settlement.base_transfer_set = false;
    settlement.quote_transfer_id = [0u8; 32];
    settlement.quote_transfer_set = false;

    // Store trader pubkeys for backend reference
    settlement.buyer = buy_order.maker;
    settlement.seller = sell_order.maker;

    // Set timestamps
    settlement.created_at = now;
    settlement.expires_at = now + SettlementRequest::EXPIRY_SECONDS;
    settlement.bump = ctx.bumps.settlement_request;

    // Emit event WITHOUT amounts (privacy-preserving)
    emit!(SettlementInitiated {
        settlement_request: settlement.key(),
        buy_order: buy_order.key(),
        sell_order: sell_order.key(),
        buyer: buy_order.maker,
        seller: sell_order.maker,
        method: params.settlement_method,
        pair: pair.key(),
        timestamp: now,
    });

    msg!(
        "Settlement initiated: {} (buy: {}, sell: {})",
        settlement.key(),
        buy_order.key(),
        sell_order.key()
    );

    Ok(())
}

/// Event emitted when settlement is initiated
/// Note: NO amounts emitted to preserve privacy
#[event]
pub struct SettlementInitiated {
    /// Settlement request PDA
    pub settlement_request: Pubkey,
    /// Buy order being settled
    pub buy_order: Pubkey,
    /// Sell order being settled
    pub sell_order: Pubkey,
    /// Buyer's wallet
    pub buyer: Pubkey,
    /// Seller's wallet
    pub seller: Pubkey,
    /// Settlement method (0=ShadowWire, 1=CSPL, 2=StandardSPL)
    pub method: u8,
    /// Trading pair
    pub pair: Pubkey,
    /// Timestamp when settlement was initiated
    pub timestamp: i64,
}
