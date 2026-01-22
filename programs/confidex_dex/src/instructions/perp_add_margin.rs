use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::ConfidexError;
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide};

/// Accounts for adding margin to a position (V6 - Async MPC)
///
/// The async flow:
/// 1. User calls add_margin → tokens transferred, position marked pending
/// 2. Crank detects MarginOperationInitiated event
/// 3. Crank calls MXE add_encrypted() with position's encrypted data
/// 4. MXE callback updates position.encrypted_collateral + thresholds
#[derive(Accounts)]
pub struct AddMargin<'info> {
    #[account(
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    #[account(
        mut,
        seeds = [
            ConfidentialPosition::SEED,
            trader.key().as_ref(),
            perp_market.key().as_ref(),
            &position.position_seed.to_le_bytes()
        ],
        bump = position.bump,
        constraint = position.trader == trader.key() @ ConfidexError::Unauthorized,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.is_open() @ ConfidexError::PositionNotOpen,
        constraint = position.threshold_verified @ ConfidexError::ThresholdNotVerified,
        constraint = !position.has_pending_mpc_request() @ ConfidexError::OperationPending
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// Trader's collateral token account (SPL USDC)
    #[account(
        mut,
        constraint = trader_collateral_account.mint == perp_market.quote_mint @ ConfidexError::InvalidMint,
        constraint = trader_collateral_account.owner == trader.key() @ ConfidexError::InvalidOwner
    )]
    pub trader_collateral_account: Account<'info, TokenAccount>,

    /// Market's collateral vault
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub trader: Signer<'info>,

    /// SPL Token program for collateral transfer
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

/// Parameters for adding margin (V6 - simplified for async MPC)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddMarginParams {
    /// Plaintext amount of collateral to add (USDC with 6 decimals)
    /// The MPC will compute new encrypted values
    pub amount: u64,
}

/// Initiate margin add operation
///
/// V6: This instruction transfers tokens immediately and marks the position
/// as pending MPC update. The actual encrypted collateral update happens
/// via the margin_operation_callback when MPC completes.
pub fn handler(ctx: Context<AddMargin>, params: AddMarginParams) -> Result<()> {
    let clock = Clock::get()?;
    let position = &mut ctx.accounts.position;

    // Validate amount
    require!(params.amount > 0, ConfidexError::InvalidCollateral);

    // Transfer collateral from trader to vault immediately
    // This ensures funds are secured before MPC processes
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.trader_collateral_account.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        params.amount,
    )?;

    // Generate unique request ID for MPC callback matching
    let request_id = ConfidentialPosition::generate_request_id(
        &position.key(),
        clock.slot,
    );

    // Store margin operation intent
    // The actual encrypted collateral update happens in margin_operation_callback
    // when MPC completes the computation
    position.pending_mpc_request = request_id;
    position.pending_margin_amount = params.amount;
    position.pending_margin_is_add = true;

    // NOTE: Tokens are already transferred to vault (line 85-95 above)
    // We do NOT update encrypted_collateral here - that's done by MPC callback
    // The position is now in a "pending margin add" state:
    // - Tokens secured in vault
    // - Crank will detect MarginOperationInitiated event
    // - Crank triggers MXE add_encrypted computation
    // - MXE callback (margin_operation_callback) updates encrypted_collateral

    let coarse_now = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.last_updated_hour = coarse_now;

    emit!(MarginOperationInitiated {
        position: position.key(),
        trader: ctx.accounts.trader.key(),
        market: ctx.accounts.perp_market.key(),
        request_id,
        amount: params.amount,
        is_add: true,
        timestamp: coarse_now,
    });

    msg!(
        "Margin add initiated: position={}, amount={}, request_id={:?}",
        position.key(),
        params.amount,
        &request_id[0..8]
    );

    Ok(())
}

/// Event emitted when a margin operation is initiated
#[event]
pub struct MarginOperationInitiated {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub request_id: [u8; 32],
    pub amount: u64,
    pub is_add: bool,
    pub timestamp: i64,
}
