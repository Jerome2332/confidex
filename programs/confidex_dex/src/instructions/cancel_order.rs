use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, TradingPair, UserConfidentialBalance};

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

/// DEPRECATED: Legacy cancel order handler - DO NOT USE
///
/// This instruction is disabled for production. It previously read plaintext
/// values from encrypted fields, which breaks privacy guarantees.
///
/// # Migration
///
/// Use `cancel_order_callback` instead, which receives MPC-calculated refund
/// amount securely from the Arcium MXE. The callback flow:
/// 1. User initiates cancel (triggers MPC calculate_refund)
/// 2. MPC computes refund_amount = encrypted_amount - encrypted_filled
/// 3. MXE calls `cancel_order_callback` with decrypted refund_amount
/// 4. Cancellation executes without reading plaintext from on-chain data
///
/// # Error
///
/// This handler always returns `FeatureDisabled` error.
pub fn handler(_ctx: Context<CancelOrder>) -> Result<()> {
    // ==========================================================================
    // LEGACY HANDLER DISABLED
    // ==========================================================================
    //
    // This handler previously read plaintext from encrypted fields:
    //   let escrowed_amount = order.get_amount_plaintext();
    //   let filled_amount = order.get_filled_plaintext();
    //
    // And emitted refund_amount in events:
    //   emit!(OrderCancelled { refund_amount, ... });
    //
    // Both broke privacy guarantees and have been removed.
    //
    // Use cancel_order_callback instead, which receives MPC-calculated refund.
    // ==========================================================================

    msg!("ERROR: cancel_order is deprecated. Use cancel_order_callback with MPC-calculated refund.");
    Err(ConfidexError::FeatureDisabled.into())
}

/// Privacy-preserving cancellation event (legacy - kept for event schema compatibility)
///
/// Note: The refund_amount field has been removed for privacy.
/// Use cancel_order_callback which emits OrderCancelledPrivate instead.
#[event]
pub struct OrderCancelled {
    /// Hash-based order ID (no sequential correlation)
    pub order_id: [u8; 16],
    pub maker: Pubkey,
    pub pair: Pubkey,
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
}
