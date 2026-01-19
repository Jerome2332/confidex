use anchor_lang::prelude::*;

use crate::cpi::arcium::{
    calculate_pnl_sync, calculate_funding_sync, add_encrypted, sub_encrypted, EncryptedU64
};
use crate::error::ConfidexError;
use crate::oracle::{get_sol_usd_price, validate_price_deviation};
use crate::state::{ConfidentialPosition, PerpetualMarket, PositionSide, PositionStatus};

/// Maximum allowed deviation between user exit price and oracle price (1% = 100 bps)
const MAX_EXIT_PRICE_DEVIATION_BPS: u16 = 100;

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
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
            &position.position_id.to_le_bytes()
        ],
        bump = position.bump,
        constraint = position.trader == trader.key() @ ConfidexError::Unauthorized,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.is_open() @ ConfidexError::PositionNotOpen
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// CHECK: Pyth oracle for mark price / exit price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// CHECK: Trader's confidential collateral token account (C-SPL USDC)
    #[account(mut)]
    pub trader_collateral_account: AccountInfo<'info>,

    /// CHECK: Market's confidential collateral vault (C-SPL USDC)
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: AccountInfo<'info>,

    /// CHECK: Fee recipient account
    #[account(
        mut,
        constraint = fee_recipient.key() == perp_market.fee_recipient @ ConfidexError::Unauthorized
    )]
    pub fee_recipient: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    /// CHECK: Arcium program for MPC calculations
    pub arcium_program: AccountInfo<'info>,
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
}

pub fn handler(ctx: Context<ClosePosition>, params: ClosePositionParams) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let position = &mut ctx.accounts.position;

    // Calculate funding owed since position was opened
    let current_cumulative_funding = match position.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };
    let funding_delta = current_cumulative_funding
        .saturating_sub(position.entry_cumulative_funding);

    // === ORACLE PRICE VALIDATION ===
    let is_long = matches!(position.side, PositionSide::Long);

    // Fetch current oracle price for SOL/USD
    let oracle_price = get_sol_usd_price(&ctx.accounts.oracle)?;
    msg!("Oracle SOL/USD price: {} (6 decimals)", oracle_price);

    // Get user-provided exit price from encrypted params (plaintext is in first 8 bytes)
    let user_exit_price = u64::from_le_bytes(
        params.encrypted_exit_price[0..8].try_into().unwrap_or([0u8; 8])
    );

    // Validate user exit price is within acceptable deviation from oracle
    let price_valid = validate_price_deviation(
        user_exit_price,
        oracle_price,
        MAX_EXIT_PRICE_DEVIATION_BPS,
    )?;

    require!(price_valid, ConfidexError::InvalidOraclePrice);

    // Use oracle price for PnL calculation (more reliable than user-provided)
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

    msg!(
        "MPC calculated PnL: is_profit={}, position={}",
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

    msg!(
        "MPC calculated funding: is_receiving={}, position={}",
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

    // TODO: Transfer payout from vault to trader via C-SPL CPI
    // Amount = payout (calculated above)

    // TODO: Calculate and transfer fees to fee_recipient
    // Fee = size * taker_fee_bps / 10000

    if params.full_close {
        // Mark position as closed
        position.status = PositionStatus::Closed;

        // Update market open interest
        // Note: Actual OI reduction happens via MPC callback since size is encrypted
        // For now, we just decrement position count

        msg!(
            "Position fully closed: {} #{} on market {}",
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
            "Position partially closed: {} #{} on market {} (close #{})",
            position.trader,
            position.position_id,
            perp_market.key(),
            position.partial_close_count
        );
    }

    position.last_updated = clock.unix_timestamp;

    Ok(())
}
