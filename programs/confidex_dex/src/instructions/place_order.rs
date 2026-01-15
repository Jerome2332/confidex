use anchor_lang::prelude::*;

use crate::cpi::verifier::{verify_eligibility_proof, GROTH16_PROOF_SIZE};
use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, OrderStatus, OrderType, Side, TradingPair};

#[derive(Accounts)]
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

    /// CHECK: Sunspot ZK verifier program for eligibility proofs
    /// Will be validated when CPI integration is complete
    pub verifier_program: AccountInfo<'info>,

    #[account(mut)]
    pub maker: Signer<'info>,

    pub system_program: Program<'info, System>,
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
    let clock = Clock::get()?;

    // Verify eligibility proof using Sunspot verifier CPI
    let proof_valid = verify_eligibility_proof(
        &ctx.accounts.verifier_program,
        &eligibility_proof,
        &exchange.blacklist_root,
        &ctx.accounts.maker.key(),
    )?;

    require!(proof_valid, ConfidexError::EligibilityProofFailed);

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
