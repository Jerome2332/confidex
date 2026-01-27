//! Close Position Instruction (V7 - Async MPC)
//!
//! Two-phase async close position flow:
//!
//! Phase 1: User calls initiate_close_position
//!   - Validate position can be closed
//!   - Capture oracle exit price
//!   - Set pending_close = true
//!   - Queue MPC computation for PnL + funding
//!   - Emit ClosePositionInitiated event
//!
//! Phase 2: Crank triggers close_position_callback (via MPC callback)
//!   - Receive computed encrypted_pnl, encrypted_funding from MPC
//!   - Calculate final payout: collateral + pnl - funding - fees
//!   - Transfer tokens to trader
//!   - Mark position as Closed (or update for partial close)
//!   - Emit PositionClosed event

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi::arcium::{calculate_pnl, MxeCpiAccounts};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide, PositionStatus};

/// Accounts for initiating position close (Phase 1)
/// MXE accounts are included to queue the PnL computation
#[derive(Accounts)]
pub struct InitiateClosePosition<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

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
        constraint = !position.pending_close @ ConfidexError::PositionPendingClose,
        constraint = !position.has_pending_margin_operation() @ ConfidexError::PositionHasPendingOperation
    )]
    pub position: Box<Account<'info, ConfidentialPosition>>,

    /// CHECK: Pyth oracle for mark price / exit price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    // === MXE CPI ACCOUNTS ===
    // Required to queue PnL computation

    /// CHECK: MXE signer PDA
    #[account(mut)]
    pub mxe_sign_pda: AccountInfo<'info>,

    /// CHECK: MXE account
    #[account(mut)]
    pub mxe_account: AccountInfo<'info>,

    /// CHECK: Cluster mempool
    #[account(mut)]
    pub mempool_account: AccountInfo<'info>,

    /// CHECK: Cluster executing pool
    #[account(mut)]
    pub executing_pool: AccountInfo<'info>,

    /// CHECK: Computation account
    #[account(mut)]
    pub computation_account: AccountInfo<'info>,

    /// CHECK: Computation definition for calculate_pnl circuit
    pub comp_def_account: AccountInfo<'info>,

    /// CHECK: Cluster account
    #[account(mut)]
    pub cluster_account: AccountInfo<'info>,

    /// CHECK: Arcium fee pool
    #[account(mut)]
    pub pool_account: AccountInfo<'info>,

    /// CHECK: Arcium clock
    #[account(mut)]
    pub clock_account: AccountInfo<'info>,

    /// System program
    pub system_program: Program<'info, System>,

    /// CHECK: Arcium main program
    pub arcium_program: AccountInfo<'info>,

    /// CHECK: MXE program
    pub mxe_program: AccountInfo<'info>,
}

/// Parameters for initiating position close
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitiateClosePositionParams {
    /// Encrypted amount to close (64 bytes) - for partial closes
    /// If full_close is true, this is ignored
    pub encrypted_close_size: [u8; 64],
    /// Whether to close the full position
    pub full_close: bool,
    /// Computation offset for MXE (unique per computation)
    pub computation_offset: u64,
    /// MXE public key for encryption
    pub mxe_pub_key: [u8; 32],
    /// Nonce for MXE encryption
    pub nonce: u128,
}

/// Initiate position close - Phase 1
///
/// Validates position can be closed, captures oracle price, and queues
/// MPC computation for PnL calculation. Actual transfer happens in callback.
pub fn initiate_close_position(
    ctx: Context<InitiateClosePosition>,
    params: InitiateClosePositionParams,
) -> Result<()> {
    let clock = Clock::get()?;
    let position = &mut ctx.accounts.position;
    let perp_market = &ctx.accounts.perp_market;

    // Fetch current oracle price for exit
    let exit_price = get_sol_usd_price(&ctx.accounts.oracle)?;

    // Calculate funding owed since position was opened
    let current_cumulative_funding = match position.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };
    let _funding_delta = current_cumulative_funding
        .saturating_sub(position.entry_cumulative_funding);

    msg!(
        "Initiating close for position {:?}, exit_price={}, funding_delta={}",
        position.position_id,
        exit_price,
        _funding_delta
    );

    // Build MXE CPI accounts
    let mxe_accounts = MxeCpiAccounts {
        payer: &ctx.accounts.trader.to_account_info(),
        sign_pda_account: &ctx.accounts.mxe_sign_pda,
        mxe_account: &ctx.accounts.mxe_account,
        mempool_account: &ctx.accounts.mempool_account,
        executing_pool: &ctx.accounts.executing_pool,
        computation_account: &ctx.accounts.computation_account,
        comp_def_account: &ctx.accounts.comp_def_account,
        cluster_account: &ctx.accounts.cluster_account,
        pool_account: &ctx.accounts.pool_account,
        clock_account: &ctx.accounts.clock_account,
        system_program: &ctx.accounts.system_program.to_account_info(),
        arcium_program: &ctx.accounts.arcium_program,
        mxe_program: &ctx.accounts.mxe_program,
    };

    // Queue MPC PnL calculation
    let is_long = matches!(position.side, PositionSide::Long);
    let queued = calculate_pnl(
        mxe_accounts,
        params.computation_offset,
        &position.encrypted_size,
        &position.encrypted_entry_price,
        exit_price,
        is_long,
        &params.mxe_pub_key,
        params.nonce,
    )?;

    msg!("Queued PnL MPC computation, request_id={:?}", &queued.request_id[0..8]);

    // Set pending close state
    position.set_pending_close(
        exit_price,
        params.full_close,
        params.encrypted_close_size,
        queued.request_id,
    );

    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.last_updated_hour = coarse_time;

    emit!(ClosePositionInitiated {
        position: position.key(),
        trader: position.trader,
        market: position.market,
        exit_price,
        full_close: params.full_close,
        request_id: queued.request_id,
        timestamp: coarse_time,
    });

    msg!(
        "Close position initiated: position={:?}, full_close={}",
        position.position_id,
        params.full_close
    );

    Ok(())
}

/// Event emitted when close position is initiated
#[event]
pub struct ClosePositionInitiated {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    /// Exit price from oracle (public)
    pub exit_price: u64,
    pub full_close: bool,
    pub request_id: [u8; 32],
    pub timestamp: i64,
}

// ============================================================================
// LEGACY PLAINTEXT CLOSE (for hackathon-era positions)
// ============================================================================

/// Accounts for closing legacy positions with plaintext data
/// Used when position.is_legacy_plaintext_position() returns true
/// These positions cannot use MPC because their encrypted fields contain zeros
#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

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
        constraint = !position.pending_close @ ConfidexError::PositionPendingClose,
        // CRITICAL: Only allow legacy positions (plaintext data, no MPC-compatible encryption)
        constraint = position.is_legacy_plaintext_position() @ ConfidexError::InvalidPositionType
    )]
    pub position: Box<Account<'info, ConfidentialPosition>>,

    /// CHECK: Pyth oracle for mark price / exit price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// Trader's USDC token account
    #[account(
        mut,
        constraint = trader_collateral_account.mint == perp_market.quote_mint @ ConfidexError::InvalidMint,
        constraint = trader_collateral_account.owner == trader.key() @ ConfidexError::InvalidOwner
    )]
    pub trader_collateral_account: Account<'info, TokenAccount>,

    /// Market's collateral vault (USDC)
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    /// CHECK: Fee recipient account
    #[account(
        mut,
        constraint = fee_recipient.key() == perp_market.fee_recipient @ ConfidexError::Unauthorized
    )]
    pub fee_recipient: AccountInfo<'info>,

    /// CHECK: Vault authority PDA
    #[account(
        seeds = [b"vault", perp_market.key().as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    /// CHECK: Arcium program (unused in legacy flow, kept for ABI compatibility)
    pub arcium_program: AccountInfo<'info>,

    /// SPL Token program
    pub token_program: Program<'info, Token>,
}

/// Parameters for legacy close
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClosePositionParams {
    /// Unused - kept for ABI compatibility
    pub encrypted_close_size: [u8; 64],
    /// Unused - kept for ABI compatibility
    pub encrypted_exit_price: [u8; 64],
    /// Whether to fully close the position
    pub full_close: bool,
    /// Unused - payout is calculated from plaintext position data
    pub payout_amount: u64,
}

/// Close a legacy position with plaintext data
///
/// This handler is for positions created during the hackathon period that have
/// plaintext values stored in bytes 0-8 of encrypted fields. These positions
/// cannot use the MPC flow because bytes 16-48 (ciphertext region) are zeros.
///
/// The handler reads plaintext values directly and performs settlement.
/// New positions with proper V2 encryption should use initiate_close_position.
#[allow(unused_variables)]
pub fn handler(ctx: Context<ClosePosition>, params: ClosePositionParams) -> Result<()> {
    let clock = Clock::get()?;
    let position = &mut ctx.accounts.position;
    let perp_market = &ctx.accounts.perp_market;

    msg!("Closing LEGACY position with plaintext data (hackathon-era position)");

    // Double-check this is a legacy position
    require!(
        position.is_legacy_plaintext_position(),
        ConfidexError::InvalidPositionType
    );

    // Fetch current oracle price for exit
    let exit_price = get_sol_usd_price(&ctx.accounts.oracle)?;

    // Read plaintext position data
    let position_size = position.get_size_plaintext();
    let entry_price = position.get_entry_price_plaintext();
    let collateral = position.get_collateral_plaintext();

    msg!(
        "Legacy position data: size={}, entry_price={}, collateral={}, exit_price={}",
        position_size,
        entry_price,
        collateral,
        exit_price
    );

    // Calculate PnL using plaintext values
    // PnL = size * (exit_price - entry_price) for longs
    // PnL = size * (entry_price - exit_price) for shorts
    // Note: All prices are in 6-decimal USDC scale
    let pnl: i64 = match position.side {
        PositionSide::Long => {
            let price_diff = exit_price as i64 - entry_price as i64;
            let size_scaled = position_size as i64;
            // PnL = size * price_diff / PRICE_SCALE (assuming 1e6 scale)
            size_scaled.saturating_mul(price_diff) / 1_000_000
        }
        PositionSide::Short => {
            let price_diff = entry_price as i64 - exit_price as i64;
            let size_scaled = position_size as i64;
            size_scaled.saturating_mul(price_diff) / 1_000_000
        }
    };

    msg!("Calculated PnL: {} (positive=profit, negative=loss)", pnl);

    // Calculate payout: collateral + pnl (capped at 0 minimum)
    let payout_before_fees = if pnl >= 0 {
        collateral.saturating_add(pnl as u64)
    } else {
        collateral.saturating_sub(pnl.unsigned_abs())
    };

    // Calculate taker fee
    let taker_fee = payout_before_fees
        .checked_mul(perp_market.taker_fee_bps as u64)
        .ok_or(ConfidexError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    let net_payout = payout_before_fees.saturating_sub(taker_fee);

    msg!(
        "Legacy close: payout_before_fees={}, taker_fee={}, net_payout={}",
        payout_before_fees,
        taker_fee,
        net_payout
    );

    // Transfer payout to trader
    if net_payout > 0 {
        let market_key = perp_market.key();
        let seeds = &[
            b"vault".as_ref(),
            market_key.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    to: ctx.accounts.trader_collateral_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            net_payout,
        )?;

        msg!("Transferred {} to trader", net_payout);
    }

    // Update position state
    position.status = PositionStatus::Closed;
    position.set_realized_pnl_plaintext(pnl);
    let coarse_time = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);
    position.last_updated_hour = coarse_time;

    // Emit close event (without amounts for privacy consistency)
    emit!(LegacyPositionClosed {
        position: position.key(),
        trader: position.trader,
        market: position.market,
        exit_price,
        timestamp: coarse_time,
    });

    msg!(
        "Legacy position closed: position={:?}, pnl={}",
        position.position_id,
        pnl
    );

    Ok(())
}

/// Event emitted when a legacy position is closed
#[event]
pub struct LegacyPositionClosed {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    /// Exit price from oracle (public)
    pub exit_price: u64,
    pub timestamp: i64,
}
