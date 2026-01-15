use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ConfidexError;
use crate::state::{ExchangeState, TradingPair, UserConfidentialBalance};

/// Wrap standard SPL tokens into confidential tokens for trading
/// This deposits tokens into the pair's vault and will mint C-SPL tokens
/// when the confidential token infrastructure is available
#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct WrapTokens<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        constraint = !exchange.paused @ ConfidexError::ExchangePaused
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump,
        constraint = pair.active @ ConfidexError::PairNotActive
    )]
    pub pair: Account<'info, TradingPair>,

    /// The mint of the token being wrapped (must be base or quote of pair)
    pub token_mint: Account<'info, Mint>,

    /// User's token account to transfer from
    #[account(
        mut,
        constraint = user_token_account.mint == token_mint.key() @ ConfidexError::InvalidTokenMint,
        constraint = user_token_account.owner == user.key() @ ConfidexError::Unauthorized
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Vault to receive the tokens (pair's base or quote vault)
    #[account(
        mut,
        constraint = is_valid_vault(&pair, &token_mint.key(), &vault.key()) @ ConfidexError::InvalidVault
    )]
    pub vault: Account<'info, TokenAccount>,

    /// User's confidential balance account (will track wrapped amount)
    #[account(
        init_if_needed,
        payer = user,
        space = UserConfidentialBalance::SIZE,
        seeds = [
            UserConfidentialBalance::SEED,
            user.key().as_ref(),
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub user_confidential_balance: Account<'info, UserConfidentialBalance>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WrapTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, ConfidexError::OrderBelowMinimum);

    let pair = &ctx.accounts.pair;
    let token_mint = &ctx.accounts.token_mint;

    // Verify the token is part of this trading pair
    require!(
        token_mint.key() == pair.base_mint || token_mint.key() == pair.quote_mint,
        ConfidexError::InvalidTokenMint
    );

    // Transfer tokens from user to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Update user's confidential balance
    let user_balance = &mut ctx.accounts.user_confidential_balance;

    if user_balance.owner == Pubkey::default() {
        // Initialize new balance account
        user_balance.owner = ctx.accounts.user.key();
        user_balance.mint = token_mint.key();
        user_balance.bump = ctx.bumps.user_confidential_balance;
    }

    user_balance.total_deposited = user_balance.total_deposited
        .checked_add(amount)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // TODO: When Arcium integration is ready, encrypt the balance update
    // For now, store plaintext amount in first 8 bytes of encrypted_balance
    let current_balance = u64::from_le_bytes(
        user_balance.encrypted_balance[0..8].try_into().unwrap()
    );
    let new_balance = current_balance
        .checked_add(amount)
        .ok_or(ConfidexError::ArithmeticOverflow)?;
    user_balance.encrypted_balance[0..8].copy_from_slice(&new_balance.to_le_bytes());

    emit!(TokensWrapped {
        user: ctx.accounts.user.key(),
        mint: token_mint.key(),
        // Note: Amount is emitted for wrap/unwrap as these are user-initiated
        // and the user knows their own amount. Only order amounts are hidden.
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Wrapped {} tokens of mint {}", amount, token_mint.key());

    Ok(())
}

/// Check if the vault is valid for the given token mint and pair
fn is_valid_vault(pair: &TradingPair, mint: &Pubkey, vault: &Pubkey) -> bool {
    if *mint == pair.base_mint {
        *vault == pair.c_base_vault
    } else if *mint == pair.quote_mint {
        *vault == pair.c_quote_vault
    } else {
        false
    }
}

#[event]
pub struct TokensWrapped {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
