use anchor_lang::prelude::*;

use crate::cpi::arcium::{verify_position_params_sync, EncryptedU64};
use crate::error::ConfidexError;
use crate::oracle::{get_sol_usd_price, validate_price_deviation};
use crate::state::{ConfidentialPosition, PerpetualMarket, FundingRateState, PositionSide, PositionStatus};

/// Maximum deviation between user entry price and oracle price (1% = 100 bps)
const MAX_ENTRY_PRICE_DEVIATION_BPS: u16 = 100;

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
        constraint = perp_market.active @ ConfidexError::MarketNotActive
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

    #[account(
        seeds = [FundingRateState::SEED, perp_market.key().as_ref()],
        bump = funding_state.bump,
    )]
    pub funding_state: Account<'info, FundingRateState>,

    #[account(
        init,
        payer = trader,
        space = ConfidentialPosition::SIZE,
        seeds = [
            ConfidentialPosition::SEED,
            trader.key().as_ref(),
            perp_market.key().as_ref(),
            &perp_market.position_count.to_le_bytes()
        ],
        bump
    )]
    pub position: Account<'info, ConfidentialPosition>,

    /// CHECK: Pyth oracle for mark price verification
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

    #[account(mut)]
    pub trader: Signer<'info>,

    /// CHECK: Arcium program for MPC verification
    pub arcium_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Parameters for opening a position
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenPositionParams {
    /// Position side (long or short)
    pub side: PositionSide,
    /// Leverage level (1-20x)
    pub leverage: u8,
    /// Encrypted position size in underlying units (64 bytes via Arcium)
    pub encrypted_size: [u8; 64],
    /// Encrypted collateral amount in USDC (64 bytes via Arcium)
    pub encrypted_collateral: [u8; 64],
    /// Encrypted entry price (64 bytes via Arcium)
    pub encrypted_entry_price: [u8; 64],
    /// Public liquidation threshold price (verified by MPC)
    /// For longs: price below which position can be liquidated
    /// For shorts: price above which position can be liquidated
    pub liquidation_threshold: u64,
    /// ZK proof of trader eligibility (blacklist non-membership)
    pub eligibility_proof: [u8; 388],
}

pub fn handler(ctx: Context<OpenPosition>, params: OpenPositionParams) -> Result<()> {
    let clock = Clock::get()?;
    let perp_market = &mut ctx.accounts.perp_market;
    let funding_state = &ctx.accounts.funding_state;
    let position = &mut ctx.accounts.position;

    // Validate leverage
    require!(
        perp_market.validate_leverage(params.leverage),
        ConfidexError::InvalidLeverage
    );

    // Check open interest limits
    // Note: We can't check exact size since it's encrypted, but we track position count
    // The actual OI update will happen via MPC callback after position verification
    require!(
        perp_market.position_count < u64::MAX,
        ConfidexError::OpenInterestLimitExceeded
    );

    // Fetch current oracle price and validate user's entry price
    let oracle_price = get_sol_usd_price(&ctx.accounts.oracle)?;
    msg!("Oracle SOL/USD price: {} (6 decimals)", oracle_price);

    // Extract user's claimed entry price from encrypted params (hybrid format: first 8 bytes are plaintext)
    let user_entry_price = u64::from_le_bytes(
        params.encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8])
    );

    // Validate entry price is within acceptable deviation from oracle
    let price_valid = validate_price_deviation(user_entry_price, oracle_price, MAX_ENTRY_PRICE_DEVIATION_BPS)?;
    require!(
        price_valid,
        ConfidexError::InvalidOraclePrice
    );

    msg!("Entry price {} validated against oracle price {} (within {}bps)",
        user_entry_price, oracle_price, MAX_ENTRY_PRICE_DEVIATION_BPS);

    // TODO: Verify eligibility proof via Sunspot verifier CPI
    // For now, we'll mark it as needing verification
    // In production, this would CPI to the eligibility_verifier program

    // TODO: Transfer encrypted collateral from trader to vault via C-SPL CPI
    // This would use confidential_transfer instruction

    // === MPC VERIFICATION ===
    // Verify that the claimed liquidation threshold matches the encrypted position params
    // The MPC computes: threshold = entry_price * (1 - maintenance_margin / leverage) for longs
    //                   threshold = entry_price * (1 + maintenance_margin / leverage) for shorts
    let is_long = matches!(params.side, PositionSide::Long);
    let threshold_valid = verify_position_params_sync(
        &ctx.accounts.arcium_program,
        &perp_market.arcium_cluster,
        &params.encrypted_entry_price,
        params.liquidation_threshold,
        params.leverage,
        is_long,
        perp_market.maintenance_margin_bps,
    )?;

    require!(
        threshold_valid,
        ConfidexError::InvalidLiquidationThreshold
    );

    // Initialize position
    position.trader = ctx.accounts.trader.key();
    position.market = perp_market.key();
    position.position_id = perp_market.position_count;
    position.created_at = clock.unix_timestamp;
    position.last_updated = clock.unix_timestamp;
    position.side = params.side;
    position.leverage = params.leverage;

    // Store encrypted data
    position.encrypted_size = params.encrypted_size;
    position.encrypted_entry_price = params.encrypted_entry_price;
    position.encrypted_collateral = params.encrypted_collateral;
    position.encrypted_realized_pnl = [0u8; 64]; // Zero initialized

    // Store public liquidation thresholds
    match params.side {
        PositionSide::Long => {
            position.liquidatable_below_price = params.liquidation_threshold;
            position.liquidatable_above_price = u64::MAX; // Not applicable for longs
        }
        PositionSide::Short => {
            position.liquidatable_below_price = 0; // Not applicable for shorts
            position.liquidatable_above_price = params.liquidation_threshold;
        }
    }
    position.last_threshold_update = clock.unix_timestamp;
    position.threshold_verified = true; // Verified via MPC above

    // Record cumulative funding at entry for later settlement
    position.entry_cumulative_funding = match params.side {
        PositionSide::Long => perp_market.cumulative_funding_long,
        PositionSide::Short => perp_market.cumulative_funding_short,
    };

    position.status = PositionStatus::Open;
    position.eligibility_proof_verified = false; // Will be set after ZK verification
    position.partial_close_count = 0;
    position.auto_deleverage_priority = 0;
    position.last_margin_add = 0;
    position.margin_add_count = 0;
    position.bump = ctx.bumps.position;

    // Increment market position count
    perp_market.position_count = perp_market.position_count.saturating_add(1);

    msg!(
        "Position opened: {} #{} on market {} ({:?} {}x)",
        ctx.accounts.trader.key(),
        position.position_id,
        perp_market.key(),
        params.side,
        params.leverage
    );

    Ok(())
}
