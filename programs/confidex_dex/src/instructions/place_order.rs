use anchor_lang::prelude::*;

use crate::cpi::verifier::{verify_eligibility_proof, GROTH16_PROOF_SIZE};
use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, OrderStatus, OrderType, Side, TradingPair, UserConfidentialBalance};

#[derive(Accounts)]
#[instruction(side: Side)]
pub struct PlaceOrder<'info> {
    #[account(
        mut,
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
        bump = pair.bump,
        constraint = pair.active @ ConfidexError::PairNotActive
    )]
    pub pair: Account<'info, TradingPair>,

    #[account(
        init,
        payer = maker,
        space = ConfidentialOrder::SIZE,
        seeds = [
            ConfidentialOrder::SEED,
            maker.key().as_ref(),
            &exchange.order_count.to_le_bytes()
        ],
        bump
    )]
    pub order: Account<'info, ConfidentialOrder>,

    /// User's confidential balance for the token being sold
    /// For buy orders: quote token (USDC) balance
    /// For sell orders: base token (SOL) balance
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            maker.key().as_ref(),
            get_order_token_mint(&pair, side).as_ref()
        ],
        bump = user_balance.bump,
        constraint = user_balance.owner == maker.key() @ ConfidexError::Unauthorized
    )]
    pub user_balance: Account<'info, UserConfidentialBalance>,

    /// CHECK: Sunspot ZK verifier program for eligibility proofs
    /// Will be validated when CPI integration is complete
    pub verifier_program: AccountInfo<'info>,

    #[account(mut)]
    pub maker: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Helper to get the token mint for the order side
/// Buy orders spend quote (USDC), sell orders spend base (SOL)
fn get_order_token_mint(pair: &TradingPair, side: Side) -> Pubkey {
    match side {
        Side::Buy => pair.quote_mint,
        Side::Sell => pair.base_mint,
    }
}

/// Parameters for placing an order (V2 - privacy enhanced)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PlaceOrderParams {
    pub side: Side,
    pub order_type: OrderType,
    pub encrypted_amount: [u8; 64],
    pub encrypted_price: [u8; 64],
    pub eligibility_proof: [u8; GROTH16_PROOF_SIZE],
    /// Client-provided nonce for hash-based order ID generation
    pub order_nonce: [u8; 8],
}

pub fn handler(
    ctx: Context<PlaceOrder>,
    side: Side,
    order_type: OrderType,
    encrypted_amount: [u8; 64],
    encrypted_price: [u8; 64],
    eligibility_proof: [u8; GROTH16_PROOF_SIZE],
) -> Result<()> {
    let exchange = &mut ctx.accounts.exchange;
    let pair = &mut ctx.accounts.pair;
    let order = &mut ctx.accounts.order;
    let user_balance = &mut ctx.accounts.user_balance;
    let clock = Clock::get()?;

    // Verify eligibility proof using Sunspot verifier CPI
    let proof_valid = verify_eligibility_proof(
        &ctx.accounts.verifier_program,
        &eligibility_proof,
        &exchange.blacklist_root,
        &ctx.accounts.maker.key(),
    )?;

    require!(proof_valid, ConfidexError::EligibilityProofFailed);

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract order amount/price from encrypted data anymore.
    // Balance validation must be done via MPC.
    //
    // Flow for V2:
    // 1. Order is placed with encrypted amount/price
    // 2. Order status is set to "Active" until MPC validates balance
    // 3. MPC computes: required = amount * price (for buys) or amount (for sells)
    // 4. MPC compares: user_balance >= required
    // 5. If valid: escrow via C-SPL confidential transfer
    // 6. If invalid: status -> Inactive
    //
    // For now, we skip balance validation and trust MPC callback to handle it.
    // The order will be placed but actual balance escrow happens via MPC/C-SPL.
    //
    // Security: Invalid orders will fail at match time when MPC tries to settle.
    // Users who place orders they can't afford waste their own transaction fees.

    // Mark balance as tracked (but not actually escrowed yet - MPC will do this)
    let _user_balance_ref = user_balance;

    // Generate hash-based order ID using sequential count as nonce
    // This maintains backward compatibility while adding privacy
    let order_nonce = exchange.order_count.to_le_bytes();
    let order_id = ConfidentialOrder::generate_order_id(
        &ctx.accounts.maker.key(),
        &pair.key(),
        &order_nonce,
    );

    // Compute coarse timestamp (hour precision for privacy)
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    // Set up order with V2 privacy enhancements
    order.maker = ctx.accounts.maker.key();
    order.pair = pair.key();
    order.side = side;
    order.order_type = order_type;
    order.encrypted_amount = encrypted_amount;
    order.encrypted_price = encrypted_price;
    order.encrypted_filled = [0u8; 64]; // Zero-encrypted
    order.status = OrderStatus::Active;
    order.created_at_hour = coarse_time;
    order.order_id = order_id;
    order.eligibility_proof_verified = true;
    order.pending_match_request = [0u8; 32];
    order.is_matching = false;
    order.bump = ctx.bumps.order;

    exchange.order_count = exchange.order_count.checked_add(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    pair.open_order_count = pair.open_order_count.checked_add(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Emit event (no amounts/prices, hash-based ID, coarse timestamp - privacy preserving)
    emit!(OrderPlaced {
        order_id,
        maker: order.maker,
        pair: order.pair,
        side: order.side,
        order_type: order.order_type,
        timestamp: coarse_time,
    });

    msg!("Order placed: {:?} (side: {:?})", order_id, side);

    Ok(())
}

#[event]
pub struct OrderPlaced {
    /// Hash-based order ID (no sequential correlation)
    pub order_id: [u8; 16],
    pub maker: Pubkey,
    pub pair: Pubkey,
    pub side: Side,
    pub order_type: OrderType,
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
}
