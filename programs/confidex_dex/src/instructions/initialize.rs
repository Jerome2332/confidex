use anchor_lang::prelude::*;

use crate::cpi::arcium::{ARCIUM_PROGRAM_ID, ARCIUM_MXE_PROGRAM_ID};
use crate::cpi::verifier::SUNSPOT_VERIFIER_PROGRAM_ID;
use crate::error::ConfidexError;
use crate::state::ExchangeState;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = ExchangeState::SIZE,
        seeds = [ExchangeState::SEED],
        bump
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, maker_fee_bps: u16, taker_fee_bps: u16) -> Result<()> {
    require!(
        ExchangeState::validate_fees(maker_fee_bps, taker_fee_bps),
        ConfidexError::InvalidFeeBps
    );

    let exchange = &mut ctx.accounts.exchange;
    exchange.authority = ctx.accounts.authority.key();
    exchange.fee_recipient = ctx.accounts.authority.key();
    exchange.maker_fee_bps = maker_fee_bps;
    exchange.taker_fee_bps = taker_fee_bps;
    exchange.paused = false;
    exchange.blacklist_root = [0u8; 32];
    exchange.arcium_cluster = Pubkey::default();
    exchange.pair_count = 0;
    exchange.order_count = 0;
    exchange.bump = ctx.bumps.exchange;

    // V5: Initialize program IDs with devnet defaults
    // Admin can update these later via update_program_ids instruction
    exchange.arcium_program_id = ARCIUM_PROGRAM_ID;
    exchange.mxe_program_id = ARCIUM_MXE_PROGRAM_ID;
    exchange.verifier_program_id = SUNSPOT_VERIFIER_PROGRAM_ID;

    msg!("Exchange initialized (V5) with maker fee: {} bps, taker fee: {} bps",
         maker_fee_bps, taker_fee_bps);
    msg!("Program IDs: arcium={}, mxe={}, verifier={}",
         exchange.arcium_program_id, exchange.mxe_program_id, exchange.verifier_program_id);

    Ok(())
}
