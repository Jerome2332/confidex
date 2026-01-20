use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::cpi::arcium::{
    calculate_pnl_sync, calculate_funding_sync, add_encrypted, sub_encrypted, EncryptedU64
};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price;
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide, PositionStatus};

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
        constraint = position.is_open() @ ConfidexError::PositionNotOpen
    )]
    pub position: Box<Account<'info, ConfidentialPosition>>,

    /// CHECK: Pyth oracle for mark price / exit price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// Trader's USDC token account
    /// NOTE: Using standard SPL token transfer as fallback until C-SPL SDK is available.
    #[account(
        mut,
        constraint = trader_collateral_account.mint == perp_market.quote_mint @ ConfidexError::InvalidMint,
        constraint = trader_collateral_account.owner == trader.key() @ ConfidexError::InvalidOwner
    )]
    pub trader_collateral_account: Account<'info, TokenAccount>,

    /// Market's collateral vault (USDC)
    /// NOTE: Using standard SPL token vault as fallback until C-SPL SDK is available.
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

    /// CHECK: Vault authority PDA - seeds = ["vault", perp_market]
    #[account(
        seeds = [b"vault", perp_market.key().as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    /// CHECK: Arcium program for MPC calculations
    pub arcium_program: AccountInfo<'info>,

    /// SPL Token program for collateral transfer
    pub token_program: Program<'info, Token>,
}

/// Parameters for closing a position
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClosePositionParams {
    /// Encrypted amount to close (64 bytes) - for partial closes
    /// If full_close is true, this is ignored
    pub encrypted_close_size: [u8; 64],
    /// Encrypted exit price (64 bytes via Arcium)
    /// Should match oracle price at execution time
    pub encrypted_exit_price: [u8; 64],
    /// Whether to close the full position
    pub full_close: bool,
    /// Payout amount in USDC (for SPL token transfer fallback)
    /// NOTE: This is plaintext until C-SPL SDK is available.
    /// For full close, this should be the original collateral amount.
    /// In production with MPC, this would be computed encrypted.
    pub payout_amount: u64,
}

pub fn handler(ctx: Context<ClosePosition>, params: ClosePositionParams) -> Result<()> {
    let clock = Clock::get()?;

    // Get keys before mutable borrows
    let perp_market_key = ctx.accounts.perp_market.key();
    let vault_authority_bump = ctx.bumps.vault_authority;

    let perp_market = &mut ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    // Calculate funding owed since position was opened
    let current_cumulative_funding = match position.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };
    let funding_delta = current_cumulative_funding
        .saturating_sub(position.entry_cumulative_funding);

    // === ORACLE PRICE FOR PNL ===
    let is_long = matches!(position.side, PositionSide::Long);

    // Fetch current oracle price for SOL/USD
    let oracle_price = get_sol_usd_price(&ctx.accounts.oracle)?;

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract exit price from encrypted params anymore.
    // Use oracle price directly for PnL calculation via MPC.
    // The MPC will compute PnL using the encrypted entry price and public oracle price.
    let exit_price = oracle_price;

    // 1. Calculate PnL via MPC
    // PnL = (exit_price - entry_price) * size for longs
    //       (entry_price - exit_price) * size for shorts
    let (encrypted_pnl, is_profit) = calculate_pnl_sync(
        &ctx.accounts.arcium_program,
        &position.encrypted_size,
        &position.encrypted_entry_price,
        exit_price,
        is_long,
    )?;

    #[cfg(feature = "debug")]
    msg!(
        "MPC calculated PnL: is_profit={}, position={:?}",
        is_profit,
        position.position_id
    );

    // 2. Calculate funding payment via MPC
    // Funding = size * funding_delta
    let (encrypted_funding, is_receiving_funding) = calculate_funding_sync(
        &ctx.accounts.arcium_program,
        &position.encrypted_size,
        funding_delta as i64,
        is_long,
    )?;

    #[cfg(feature = "debug")]
    msg!(
        "MPC calculated funding: is_receiving={}, position={:?}",
        is_receiving_funding,
        position.position_id
    );

    // 3. Calculate final payout: collateral + pnl - funding - fees
    // Start with collateral
    let mut payout = position.encrypted_collateral;

    // Add/subtract PnL
    if is_profit {
        payout = add_encrypted(&ctx.accounts.arcium_program, &payout, &encrypted_pnl)?;
    } else {
        payout = sub_encrypted(&ctx.accounts.arcium_program, &payout, &encrypted_pnl)?;
    }

    // Add/subtract funding
    if is_receiving_funding {
        payout = add_encrypted(&ctx.accounts.arcium_program, &payout, &encrypted_funding)?;
    } else {
        payout = sub_encrypted(&ctx.accounts.arcium_program, &payout, &encrypted_funding)?;
    }

    // Update position's realized PnL
    position.encrypted_realized_pnl = encrypted_pnl;

    // Transfer collateral back to trader (SPL Token fallback)
    // NOTE: In production with MPC, payout_amount would be computed from encrypted payout.
    // For now, we use the plaintext payout_amount passed by the frontend.
    if params.payout_amount > 0 {
        let vault_authority_seeds = &[
            b"vault" as &[u8],
            perp_market_key.as_ref(),
            &[vault_authority_bump],
        ];
        let signer_seeds = &[&vault_authority_seeds[..]];

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
            params.payout_amount,
        )?;

        msg!(
            "Transferred {} USDC from vault to trader",
            params.payout_amount
        );
    }

    // TODO: Calculate and transfer fees to fee_recipient
    // Fee = size * taker_fee_bps / 10000

    if params.full_close {
        // Mark position as closed
        position.status = PositionStatus::Closed;

        // Update market open interest
        // Note: Actual OI reduction happens via MPC callback since size is encrypted
        // For now, we just decrement position count

        msg!(
            "Position fully closed: {} #{:?} on market {}",
            position.trader,
            position.position_id,
            perp_market.key()
        );
    } else {
        // Partial close
        position.partial_close_count = position.partial_close_count.saturating_add(1);

        // MPC updates for partial close:
        // 1. Update encrypted_size = encrypted_size - close_size
        position.encrypted_size = sub_encrypted(
            &ctx.accounts.arcium_program,
            &position.encrypted_size,
            &params.encrypted_close_size,
        )?;

        // 2. Update encrypted_collateral proportionally
        // For simplicity, we reduce collateral by the same proportion as size
        // In production, this would be a more complex MPC calculation
        // Note: The payout calculated above is for the closed portion
        position.encrypted_collateral = sub_encrypted(
            &ctx.accounts.arcium_program,
            &position.encrypted_collateral,
            &payout,
        )?;

        // 3. Recalculate liquidation threshold would require another MPC call
        // For now, mark threshold as needing re-verification
        position.threshold_verified = false;

        msg!(
            "Position partially closed: {} #{:?} on market {} (close #{})",
            position.trader,
            position.position_id,
            perp_market.key(),
            position.partial_close_count
        );
    }

    position.last_updated_hour = ConfidentialPosition::coarse_timestamp(clock.unix_timestamp);

    Ok(())
}
