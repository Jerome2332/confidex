use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, Side, TradingPair, UserConfidentialBalance};
use crate::settlement::types::SettlementMethod;

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
///
/// Uses Box<Account<>> for large account types to reduce stack usage.
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
    pub pair: Box<Account<'info, TradingPair>>,

    /// Buy order - must have non-zero encrypted_filled (checked in handler)
    /// Note: Order may still be Active if partially filled
    #[account(
        mut,
        constraint = buy_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
    )]
    pub buy_order: Box<Account<'info, ConfidentialOrder>>,

    /// Sell order - must have non-zero encrypted_filled (checked in handler)
    /// Note: Order may still be Active if partially filled
    #[account(
        mut,
        constraint = sell_order.pair == pair.key() @ ConfidexError::InvalidOrder,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
    )]
    pub sell_order: Box<Account<'info, ConfidentialOrder>>,

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
    pub buyer_base_balance: Box<Account<'info, UserConfidentialBalance>>,

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
    pub buyer_quote_balance: Box<Account<'info, UserConfidentialBalance>>,

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
    pub seller_base_balance: Box<Account<'info, UserConfidentialBalance>>,

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
    pub seller_quote_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Exchange state (for fee_recipient pubkey and fee_bps)
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,

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
    pub fee_recipient_balance: Box<Account<'info, UserConfidentialBalance>>,

    /// Crank operator (anyone can settle matched orders)
    #[account(mut)]
    pub crank: Signer<'info>,

    /// System program (required for init_if_needed)
    pub system_program: Program<'info, System>,
}

/// Parameters for settlement instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettleOrderParams {
    /// Settlement method selection
    /// 0 = ShadowWire (1% fee, full privacy)
    /// 1 = C-SPL (0% fee, Arcium MPC) - disabled until SDK available
    /// 2 = StandardSPL (fallback, no privacy)
    pub settlement_method: u8,
}

impl SettleOrderParams {
    /// Convert numeric method to enum
    pub fn method(&self) -> SettlementMethod {
        match self.settlement_method {
            0 => SettlementMethod::ShadowWire,
            1 => SettlementMethod::CSPL,
            _ => SettlementMethod::StandardSPL,
        }
    }
}

/// DEPRECATED: Legacy settlement handler - DO NOT USE
///
/// This instruction is disabled for production. It previously read plaintext
/// values from encrypted fields, which breaks privacy guarantees.
///
/// # Migration
///
/// Use `settle_order_callback` instead, which receives MPC-decrypted values
/// securely from the Arcium MXE. The callback flow:
/// 1. MPC computes fill_amount and price from encrypted order data
/// 2. MXE calls `settle_order_callback` with decrypted values
/// 3. Settlement executes without reading plaintext from on-chain data
///
/// # Error
///
/// This handler always returns `FeatureDisabled` error.
pub fn handler(_ctx: Context<SettleOrder>, _params: SettleOrderParams) -> Result<()> {
    // ==========================================================================
    // LEGACY HANDLER DISABLED
    // ==========================================================================
    //
    // This handler previously read plaintext from encrypted fields:
    //   let fill_amount = buy_order.get_filled_plaintext();
    //   let price = buy_order.get_price_plaintext();
    //
    // This broke privacy guarantees and has been removed.
    //
    // Use settle_order_callback instead, which receives MPC-decrypted values.
    // ==========================================================================

    msg!("ERROR: settle_order is deprecated. Use settle_order_callback with MPC-decrypted values.");
    Err(ConfidexError::FeatureDisabled.into())
}

/// Settlement event - PRIVACY PRESERVING
/// NO amounts emitted - amounts are only known to the MPC cluster and ShadowWire
#[event]
pub struct OrderSettled {
    /// Hash-based order ID
    pub buy_order_id: [u8; 16],
    /// Hash-based order ID
    pub sell_order_id: [u8; 16],
    /// Buyer's wallet
    pub buyer: Pubkey,
    /// Seller's wallet
    pub seller: Pubkey,
    /// Trading pair
    pub pair: Pubkey,
    /// Coarse timestamp (hour precision for privacy)
    pub timestamp: i64,
    /// Settlement method used (0=ShadowWire, 1=C-SPL, 2=StandardSPL)
    pub settlement_method: u8,
}
