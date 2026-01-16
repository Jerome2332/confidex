use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::ExchangeState;

// ============================================================================
// Pause Trading
// ============================================================================

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized,
        constraint = !exchange.paused @ ConfidexError::ExchangePaused
    )]
    pub exchange: Account<'info, ExchangeState>,

    pub authority: Signer<'info>,
}

pub fn pause_handler(ctx: Context<Pause>) -> Result<()> {
    ctx.accounts.exchange.paused = true;
    msg!("Exchange paused by authority");
    Ok(())
}

// ============================================================================
// Unpause Trading
// ============================================================================

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized,
        constraint = exchange.paused @ ConfidexError::ExchangeNotPaused
    )]
    pub exchange: Account<'info, ExchangeState>,

    pub authority: Signer<'info>,
}

pub fn unpause_handler(ctx: Context<Unpause>) -> Result<()> {
    ctx.accounts.exchange.paused = false;
    msg!("Exchange unpaused by authority");
    Ok(())
}

// ============================================================================
// Update Fees
// ============================================================================

#[derive(Accounts)]
pub struct UpdateFees<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    pub authority: Signer<'info>,
}

pub fn update_fees_handler(
    ctx: Context<UpdateFees>,
    maker_fee_bps: u16,
    taker_fee_bps: u16,
) -> Result<()> {
    require!(
        ExchangeState::validate_fees(maker_fee_bps, taker_fee_bps),
        ConfidexError::InvalidFeeBps
    );

    let exchange = &mut ctx.accounts.exchange;
    exchange.maker_fee_bps = maker_fee_bps;
    exchange.taker_fee_bps = taker_fee_bps;

    msg!("Fees updated: maker {} bps, taker {} bps", maker_fee_bps, taker_fee_bps);
    Ok(())
}

// ============================================================================
// Update Blacklist Root
// ============================================================================

#[derive(Accounts)]
pub struct UpdateBlacklist<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    pub authority: Signer<'info>,
}

pub fn update_blacklist_handler(
    ctx: Context<UpdateBlacklist>,
    new_root: [u8; 32],
) -> Result<()> {
    ctx.accounts.exchange.blacklist_root = new_root;
    msg!("Blacklist merkle root updated");
    Ok(())
}

// ============================================================================
// Set Pair Vaults
// ============================================================================

use crate::state::TradingPair;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct SetPairVaults<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
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

    /// Base token vault (owned by pair PDA)
    #[account(
        constraint = base_vault.mint == pair.base_mint @ ConfidexError::InvalidTokenMint,
        constraint = base_vault.owner == pair.key() @ ConfidexError::InvalidVault
    )]
    pub base_vault: Account<'info, TokenAccount>,

    /// Quote token vault (owned by pair PDA)
    #[account(
        constraint = quote_vault.mint == pair.quote_mint @ ConfidexError::InvalidTokenMint,
        constraint = quote_vault.owner == pair.key() @ ConfidexError::InvalidVault
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
}

pub fn set_pair_vaults_handler(ctx: Context<SetPairVaults>) -> Result<()> {
    let pair = &mut ctx.accounts.pair;

    pair.c_base_vault = ctx.accounts.base_vault.key();
    pair.c_quote_vault = ctx.accounts.quote_vault.key();

    msg!(
        "Pair vaults set: base={}, quote={}",
        pair.c_base_vault,
        pair.c_quote_vault
    );

    Ok(())
}
