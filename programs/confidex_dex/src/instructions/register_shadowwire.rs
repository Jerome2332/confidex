use anchor_lang::prelude::*;

use crate::state::user_shadowwire::{UserShadowWireAccount, MAX_SUPPORTED_MINTS};

/// Accounts for registering a user's ShadowWire account
///
/// Creates a UserShadowWireAccount that links the user's Solana wallet
/// to their ShadowWire pool for private settlement.
#[derive(Accounts)]
pub struct RegisterShadowWireAccount<'info> {
    /// User's ShadowWire account PDA
    #[account(
        init,
        payer = owner,
        space = UserShadowWireAccount::SIZE,
        seeds = [UserShadowWireAccount::SEED, owner.key().as_ref()],
        bump
    )]
    pub user_account: Box<Account<'info, UserShadowWireAccount>>,

    /// User (owner of the account)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Parameters for register_shadowwire_account instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterShadowWireParams {
    /// ShadowWire pool address for this user
    pub pool_address: Pubkey,
    /// Initial supported mints (e.g., USDC, SOL)
    /// Maximum 10 mints
    pub supported_mints: Vec<Pubkey>,
}

/// Register a user's ShadowWire account for private settlement
///
/// This must be called before a user can settle orders via ShadowWire.
/// The user must also deposit funds to their ShadowWire pool via the
/// ShadowWire API/frontend before settlement can occur.
///
/// # Arguments
/// * `ctx` - Instruction context
/// * `params` - Registration parameters including pool address and supported mints
///
/// # Errors
/// * `ShadowWireError::MaxMintsExceeded` - More than 10 mints provided
pub fn handler(ctx: Context<RegisterShadowWireAccount>, params: RegisterShadowWireParams) -> Result<()> {
    let user_account = &mut ctx.accounts.user_account;
    let clock = Clock::get()?;

    // Validate mint count
    require!(
        params.supported_mints.len() <= MAX_SUPPORTED_MINTS,
        crate::state::user_shadowwire::ShadowWireError::MaxMintsExceeded
    );

    // Initialize account
    user_account.owner = ctx.accounts.owner.key();
    user_account.pool_address = params.pool_address;
    user_account.mint_count = 0;
    user_account.supported_mints = [Pubkey::default(); MAX_SUPPORTED_MINTS];
    user_account.is_active = true;
    user_account.created_at = clock.unix_timestamp;
    user_account.last_activity = clock.unix_timestamp;
    user_account.bump = ctx.bumps.user_account;

    // Add supported mints
    for mint in params.supported_mints {
        user_account.add_mint(mint)?;
    }

    // Emit registration event
    emit!(ShadowWireAccountRegistered {
        owner: user_account.owner,
        pool_address: params.pool_address,
        mint_count: user_account.mint_count,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "ShadowWire account registered for user: {} with pool: {}",
        user_account.owner,
        params.pool_address
    );

    Ok(())
}

/// Accounts for updating a user's ShadowWire account
#[derive(Accounts)]
pub struct UpdateShadowWireAccount<'info> {
    /// User's ShadowWire account PDA
    #[account(
        mut,
        seeds = [UserShadowWireAccount::SEED, owner.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == owner.key(),
    )]
    pub user_account: Box<Account<'info, UserShadowWireAccount>>,

    /// User (owner of the account)
    pub owner: Signer<'info>,
}

/// Parameters for update_shadowwire_account instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateShadowWireParams {
    /// New pool address (optional - set to current if unchanged)
    pub pool_address: Option<Pubkey>,
    /// Mints to add (will skip if already present)
    pub add_mints: Vec<Pubkey>,
    /// Whether to activate/deactivate the account
    pub is_active: Option<bool>,
}

/// Update a user's ShadowWire account
///
/// Allows users to add new supported mints or update their pool address.
///
/// # Arguments
/// * `ctx` - Instruction context
/// * `params` - Update parameters
pub fn update_handler(ctx: Context<UpdateShadowWireAccount>, params: UpdateShadowWireParams) -> Result<()> {
    let user_account = &mut ctx.accounts.user_account;
    let clock = Clock::get()?;

    // Update pool address if provided
    if let Some(pool_address) = params.pool_address {
        user_account.pool_address = pool_address;
    }

    // Add new mints
    for mint in params.add_mints {
        user_account.add_mint(mint)?;
    }

    // Update active status if provided
    if let Some(is_active) = params.is_active {
        user_account.is_active = is_active;
    }

    // Update last activity
    user_account.last_activity = clock.unix_timestamp;

    emit!(ShadowWireAccountUpdated {
        owner: user_account.owner,
        pool_address: user_account.pool_address,
        mint_count: user_account.mint_count,
        is_active: user_account.is_active,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "ShadowWire account updated for user: {}",
        user_account.owner
    );

    Ok(())
}

/// Event emitted when a ShadowWire account is registered
#[event]
pub struct ShadowWireAccountRegistered {
    /// User's wallet
    pub owner: Pubkey,
    /// ShadowWire pool address
    pub pool_address: Pubkey,
    /// Number of supported mints
    pub mint_count: u8,
    /// Timestamp when registered
    pub timestamp: i64,
}

/// Event emitted when a ShadowWire account is updated
#[event]
pub struct ShadowWireAccountUpdated {
    /// User's wallet
    pub owner: Pubkey,
    /// ShadowWire pool address
    pub pool_address: Pubkey,
    /// Number of supported mints
    pub mint_count: u8,
    /// Whether account is active
    pub is_active: bool,
    /// Timestamp when updated
    pub timestamp: i64,
}
