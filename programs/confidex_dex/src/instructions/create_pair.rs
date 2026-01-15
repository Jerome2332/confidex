use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ExchangeState, TradingPair};

#[derive(Accounts)]
pub struct CreatePair<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        init,
        payer = authority,
        space = TradingPair::SIZE,
        seeds = [
            TradingPair::SEED,
            base_mint.key().as_ref(),
            quote_mint.key().as_ref()
        ],
        bump
    )]
    pub pair: Account<'info, TradingPair>,

    /// Base token mint (e.g., SOL wrapped)
    pub base_mint: Account<'info, anchor_spl::token::Mint>,

    /// Quote token mint (e.g., USDC)
    pub quote_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreatePair>, min_order_size: u64, tick_size: u64) -> Result<()> {
    let exchange = &mut ctx.accounts.exchange;
    let pair = &mut ctx.accounts.pair;

    pair.base_mint = ctx.accounts.base_mint.key();
    pair.quote_mint = ctx.accounts.quote_mint.key();
    pair.c_base_mint = Pubkey::default(); // Set when C-SPL mints are created
    pair.c_quote_mint = Pubkey::default();
    pair.c_base_vault = Pubkey::default();
    pair.c_quote_vault = Pubkey::default();
    pair.min_order_size = min_order_size;
    pair.tick_size = tick_size;
    pair.active = true;
    pair.open_order_count = 0;
    pair.index = exchange.pair_count;
    pair.bump = ctx.bumps.pair;

    exchange.pair_count = exchange.pair_count.checked_add(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    msg!("Trading pair created: {} / {} (index: {})",
         ctx.accounts.base_mint.key(),
         ctx.accounts.quote_mint.key(),
         pair.index);

    Ok(())
}
