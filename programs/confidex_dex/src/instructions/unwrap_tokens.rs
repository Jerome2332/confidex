use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ConfidexError;
use crate::state::{ExchangeState, TradingPair, UserConfidentialBalance};

/// Unwrap confidential tokens back to standard SPL tokens
/// This withdraws tokens from the pair's vault
#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct UnwrapTokens<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump
        // Note: Unwrapping is allowed even when paused (user funds access)
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump
    )]
    pub pair: Account<'info, TradingPair>,

    /// The mint of the token being unwrapped
    pub token_mint: Account<'info, Mint>,

    /// User's token account to receive unwrapped tokens
    #[account(
        mut,
        constraint = user_token_account.mint == token_mint.key() @ ConfidexError::InvalidTokenMint,
        constraint = user_token_account.owner == user.key() @ ConfidexError::Unauthorized
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Vault to withdraw tokens from
    #[account(
        mut,
        constraint = is_valid_vault(&pair, &token_mint.key(), &vault.key()) @ ConfidexError::InvalidVault
    )]
    pub vault: Account<'info, TokenAccount>,

    /// User's confidential balance account
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            user.key().as_ref(),
            token_mint.key().as_ref()
        ],
        bump = user_confidential_balance.bump,
        constraint = user_confidential_balance.owner == user.key() @ ConfidexError::Unauthorized
    )]
    pub user_confidential_balance: Account<'info, UserConfidentialBalance>,

    /// Pair PDA for signing vault transfers
    /// CHECK: PDA signer for vault
    #[account(
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump
    )]
    pub pair_authority: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<UnwrapTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, ConfidexError::OrderBelowMinimum);

    let pair = &ctx.accounts.pair;
    let token_mint = &ctx.accounts.token_mint;
    let user_balance = &mut ctx.accounts.user_confidential_balance;

    // Verify the token is part of this trading pair
    require!(
        token_mint.key() == pair.base_mint || token_mint.key() == pair.quote_mint,
        ConfidexError::InvalidTokenMint
    );

    // Check user has sufficient balance
    // TODO: When Arcium integration is ready, this will be an encrypted comparison
    let current_balance = u64::from_le_bytes(
        user_balance.encrypted_balance[0..8].try_into().unwrap()
    );
    require!(current_balance >= amount, ConfidexError::InsufficientBalance);

    // Update user's confidential balance
    let new_balance = current_balance
        .checked_sub(amount)
        .ok_or(ConfidexError::ArithmeticOverflow)?;
    user_balance.encrypted_balance[0..8].copy_from_slice(&new_balance.to_le_bytes());

    user_balance.total_withdrawn = user_balance.total_withdrawn
        .checked_add(amount)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Transfer tokens from vault to user using PDA signature
    let base_mint = pair.base_mint;
    let quote_mint = pair.quote_mint;
    let bump = pair.bump;

    let seeds = &[
        TradingPair::SEED,
        base_mint.as_ref(),
        quote_mint.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.pair_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;

    emit!(TokensUnwrapped {
        user: ctx.accounts.user.key(),
        mint: token_mint.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Unwrapped {} tokens of mint {}", amount, token_mint.key());

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
pub struct TokensUnwrapped {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
