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

    // Extract order amount from encrypted_amount
    // Development: First 8 bytes contain plaintext amount
    // Production: Would use MPC to compare encrypted values
    let order_amount = u64::from_le_bytes(
        encrypted_amount[0..8].try_into().map_err(|_| ConfidexError::InvalidAmount)?
    );

    // For buy orders with limit price, calculate total cost
    // For sell orders, the amount is the base token amount
    let required_balance = match side {
        Side::Buy => {
            // Extract price from encrypted_price (first 8 bytes, USDC with 6 decimals)
            let price = u64::from_le_bytes(
                encrypted_price[0..8].try_into().map_err(|_| ConfidexError::InvalidAmount)?
            );
            // Calculate: amount (in base decimals) * price (in quote decimals) / base_decimals
            // SOL has 9 decimals, USDC has 6, price is in USDC per SOL
            // total_usdc = (sol_amount * price_usdc) / 1e9
            order_amount
                .checked_mul(price)
                .ok_or(ConfidexError::ArithmeticOverflow)?
                .checked_div(1_000_000_000) // Divide by SOL decimals
                .ok_or(ConfidexError::ArithmeticOverflow)?
        }
        Side::Sell => order_amount,
    };

    // Check user has sufficient balance
    let current_balance = user_balance.get_balance();
    msg!("Order requires {} tokens, user has {} in balance", required_balance, current_balance);

    require!(
        current_balance >= required_balance,
        ConfidexError::InsufficientBalance
    );

    // Debit user's balance (escrow for order)
    let new_balance = current_balance
        .checked_sub(required_balance)
        .ok_or(ConfidexError::ArithmeticOverflow)?;
    user_balance.set_balance(new_balance);

    msg!("Escrowed {} tokens, new balance: {}", required_balance, new_balance);

    // Set up order
    order.maker = ctx.accounts.maker.key();
    order.pair = pair.key();
    order.side = side;
    order.order_type = order_type;
    order.encrypted_amount = encrypted_amount;
    order.encrypted_price = encrypted_price;
    order.encrypted_filled = [0u8; 64]; // Zero-encrypted
    order.status = OrderStatus::Open;
    order.created_at = clock.unix_timestamp;
    order.order_id = exchange.order_count;
    order.eligibility_proof_verified = true;
    order.bump = ctx.bumps.order;

    exchange.order_count = exchange.order_count.checked_add(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    pair.open_order_count = pair.open_order_count.checked_add(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Emit event (no amounts/prices - privacy preserving)
    emit!(OrderPlaced {
        order_id: order.order_id,
        maker: order.maker,
        pair: order.pair,
        side: order.side,
        order_type: order.order_type,
        timestamp: clock.unix_timestamp,
    });

    msg!("Order placed: {} (side: {:?})", order.order_id, side);

    Ok(())
}

#[event]
pub struct OrderPlaced {
    pub order_id: u64,
    pub maker: Pubkey,
    pub pair: Pubkey,
    pub side: Side,
    pub order_type: OrderType,
    pub timestamp: i64,
}
