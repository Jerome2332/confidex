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

// ============================================================================
// Close Perpetual Market (admin only - for migration)
// ============================================================================

use crate::state::PerpetualMarket;
use anchor_lang::system_program;

#[derive(Accounts)]
pub struct ClosePerpMarket<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    /// CHECK: We're closing this account, so we don't deserialize it (handles old layouts)
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, underlying_mint.key().as_ref()],
        bump,
    )]
    pub perp_market: AccountInfo<'info>,

    /// CHECK: The underlying mint for deriving the PDA
    pub underlying_mint: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn close_perp_market_handler(ctx: Context<ClosePerpMarket>) -> Result<()> {
    // Transfer all lamports from perp_market to authority
    let perp_market = &ctx.accounts.perp_market;
    let authority = &ctx.accounts.authority;

    let lamports = perp_market.lamports();
    **perp_market.try_borrow_mut_lamports()? = 0;
    **authority.try_borrow_mut_lamports()? = authority
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Zero out the account data
    let mut data = perp_market.try_borrow_mut_data()?;
    data.fill(0);

    msg!("Perp market closed for migration, {} lamports returned", lamports);
    Ok(())
}

// ============================================================================
// Close Funding State (admin only - for migration)
// ============================================================================

use crate::state::FundingRateState;

#[derive(Accounts)]
pub struct CloseFundingState<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    /// CHECK: Perp market PDA for seed derivation (may be closed already)
    pub perp_market: AccountInfo<'info>,

    /// CHECK: We're closing this account, so we don't deserialize it
    #[account(
        mut,
        seeds = [FundingRateState::SEED, perp_market.key().as_ref()],
        bump,
    )]
    pub funding_state: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn close_funding_state_handler(ctx: Context<CloseFundingState>) -> Result<()> {
    let funding_state = &ctx.accounts.funding_state;
    let authority = &ctx.accounts.authority;

    let lamports = funding_state.lamports();
    **funding_state.try_borrow_mut_lamports()? = 0;
    **authority.try_borrow_mut_lamports()? = authority
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mut data = funding_state.try_borrow_mut_data()?;
    data.fill(0);

    msg!("Funding state closed for migration, {} lamports returned", lamports);
    Ok(())
}

// ============================================================================
// Set Perpetual Market Vaults (admin only)
// ============================================================================

#[derive(Accounts)]
pub struct SetPerpMarketVaults<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    /// Collateral token vault (USDC) - must be owned by a PDA or the program
    #[account(
        constraint = collateral_vault.mint == perp_market.quote_mint @ ConfidexError::InvalidTokenMint
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    /// Insurance fund token account (USDC)
    #[account(
        constraint = insurance_fund.mint == perp_market.quote_mint @ ConfidexError::InvalidTokenMint
    )]
    pub insurance_fund: Account<'info, TokenAccount>,

    /// Fee recipient token account (USDC)
    #[account(
        constraint = fee_recipient.mint == perp_market.quote_mint @ ConfidexError::InvalidTokenMint
    )]
    pub fee_recipient: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
}

pub fn set_perp_market_vaults_handler(ctx: Context<SetPerpMarketVaults>) -> Result<()> {
    let perp_market = &mut ctx.accounts.perp_market;

    perp_market.collateral_vault = ctx.accounts.collateral_vault.key();
    perp_market.insurance_fund = ctx.accounts.insurance_fund.key();
    perp_market.fee_recipient = ctx.accounts.fee_recipient.key();

    msg!(
        "Perp market vaults updated: collateral={}, insurance={}, fee_recipient={}",
        perp_market.collateral_vault,
        perp_market.insurance_fund,
        perp_market.fee_recipient
    );

    Ok(())
}

// ============================================================================
// Update Perpetual Market Config (admin only)
// ============================================================================

#[derive(Accounts)]
pub struct UpdatePerpMarketConfig<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    pub authority: Signer<'info>,
}

/// Parameters for updating perpetual market configuration
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdatePerpMarketParams {
    /// New max leverage (None = keep current)
    pub max_leverage: Option<u8>,
    /// New maintenance margin bps (None = keep current)
    pub maintenance_margin_bps: Option<u16>,
    /// New initial margin bps (None = keep current)
    pub initial_margin_bps: Option<u16>,
    /// New taker fee bps (None = keep current)
    pub taker_fee_bps: Option<u16>,
    /// New maker fee bps (None = keep current)
    pub maker_fee_bps: Option<u16>,
    /// New max open interest (None = keep current)
    pub max_open_interest: Option<u64>,
    /// New active status (None = keep current)
    pub active: Option<bool>,
    /// New Arcium cluster (None = keep current)
    pub arcium_cluster: Option<Pubkey>,
}

pub fn update_perp_market_config_handler(
    ctx: Context<UpdatePerpMarketConfig>,
    params: UpdatePerpMarketParams,
) -> Result<()> {
    let perp_market = &mut ctx.accounts.perp_market;

    if let Some(max_leverage) = params.max_leverage {
        require!(max_leverage >= 1 && max_leverage <= 100, ConfidexError::InvalidLeverage);
        perp_market.max_leverage = max_leverage;
    }

    if let Some(maintenance_margin_bps) = params.maintenance_margin_bps {
        require!(maintenance_margin_bps > 0 && maintenance_margin_bps < 10000, ConfidexError::InvalidFeeBps);
        perp_market.maintenance_margin_bps = maintenance_margin_bps;
    }

    if let Some(initial_margin_bps) = params.initial_margin_bps {
        require!(initial_margin_bps > 0 && initial_margin_bps < 10000, ConfidexError::InvalidFeeBps);
        perp_market.initial_margin_bps = initial_margin_bps;
    }

    if let Some(taker_fee_bps) = params.taker_fee_bps {
        perp_market.taker_fee_bps = taker_fee_bps;
    }

    if let Some(maker_fee_bps) = params.maker_fee_bps {
        perp_market.maker_fee_bps = maker_fee_bps;
    }

    if let Some(max_open_interest) = params.max_open_interest {
        perp_market.max_open_interest = max_open_interest;
    }

    if let Some(active) = params.active {
        perp_market.active = active;
    }

    if let Some(arcium_cluster) = params.arcium_cluster {
        perp_market.arcium_cluster = arcium_cluster;
    }

    msg!("Perp market config updated");

    Ok(())
}
