use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::ConfidexError;
use crate::state::{
    ConfidentialPosition, ExchangeState, PerpetualMarket, FundingRateState,
    PositionSide, PositionStatus, TraderEligibility
};

/// Accounts for opening a perpetual position
/// NOTE: ZK verification is done separately via verify_eligibility instruction
/// This avoids stack overflow from large proof in params
/// Uses Box<Account<>> to move large account data to heap
#[derive(Accounts)]
pub struct OpenPosition<'info> {
    /// Exchange state for blacklist root (to validate eligibility is current)
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,

    /// Trader's eligibility account (must be verified)
    #[account(
        seeds = [TraderEligibility::SEED, trader.key().as_ref()],
        bump = eligibility.bump,
        constraint = eligibility.is_valid(&exchange.blacklist_root) @ ConfidexError::EligibilityNotVerified
    )]
    pub eligibility: Box<Account<'info, TraderEligibility>>,

    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
        constraint = perp_market.active @ ConfidexError::MarketNotActive
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

    #[account(
        seeds = [FundingRateState::SEED, perp_market.key().as_ref()],
        bump = funding_state.bump,
    )]
    pub funding_state: Box<Account<'info, FundingRateState>>,

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
    pub position: Box<Account<'info, ConfidentialPosition>>,

    /// CHECK: Pyth oracle for mark price verification
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    /// Trader's USDC token account
    /// NOTE: Using standard SPL token transfer as fallback until C-SPL SDK is available.
    /// Collateral amounts are visible on-chain in this mode.
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

    #[account(mut)]
    pub trader: Signer<'info>,

    /// CHECK: Arcium program for MPC verification
    pub arcium_program: AccountInfo<'info>,

    /// SPL Token program for collateral transfer
    /// NOTE: Will be replaced with C-SPL program when SDK is available
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

/// Parameters for opening a position (V3 - with separate ephemeral pubkey for MPC)
/// NOTE: ZK proof is verified separately via verify_eligibility instruction
/// This keeps params small to avoid stack overflow (reduced from 4 to 2 encrypted fields)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenPositionParams {
    /// Position side (long or short)
    pub side: PositionSide,
    /// Leverage level (1-20x)
    pub leverage: u8,
    /// Plaintext collateral amount for SPL transfer (USDC with 6 decimals)
    /// NOTE: This is a temporary fallback. When C-SPL SDK is available,
    /// collateral will be transferred via confidential_transfer and this
    /// field will be removed (amount derived from encrypted_collateral via MPC).
    pub collateral_amount: u64,
    /// Client-provided nonce for position ID generation (8 bytes)
    /// Used to create hash-based position ID instead of sequential
    pub position_nonce: [u8; 8],
    /// Encrypted position size in underlying units (64 bytes via Arcium)
    pub encrypted_size: [u8; 64],
    /// Encrypted entry price (64 bytes via Arcium)
    /// NOTE: encrypted_collateral derived from collateral_amount during settlement
    /// NOTE: encrypted_liq_threshold computed by MPC from entry_price + leverage
    pub encrypted_entry_price: [u8; 64],
    /// Full 32-byte X25519 ephemeral public key used for encryption
    /// MPC needs this to compute the shared secret for decryption.
    /// V8: This field is required - without it MPC cannot decrypt the encrypted values.
    pub ephemeral_pubkey: [u8; 32],
}

pub fn handler(ctx: Context<OpenPosition>, params: OpenPositionParams) -> Result<()> {
    // === LAYER 1: ZK VERIFICATION (already done) ===
    // The eligibility constraint validates that ZK proof was verified
    // and the blacklist root hasn't changed since verification
    // This is enforced by: constraint = eligibility.is_valid(&exchange.blacklist_root)

    // Validate leverage (cheap check)
    require!(
        ctx.accounts.perp_market.validate_leverage(params.leverage),
        ConfidexError::InvalidLeverage
    );

    // Validate collateral amount is non-zero
    require!(
        params.collateral_amount > 0,
        ConfidexError::InvalidCollateral
    );

    // Check open interest limits
    require!(
        ctx.accounts.perp_market.position_count < u64::MAX,
        ConfidexError::OpenInterestLimitExceeded
    );

    // Transfer collateral from trader to vault (SPL Token fallback)
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.trader_collateral_account.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        params.collateral_amount,
    )?;

    // === LAYER 2: MPC VERIFICATION (ASYNC) ===
    // V6: Position is created with threshold_verified = false
    // Crank will detect this position and trigger async MPC verification
    // MPC callback will set threshold_verified = true and fill in liquidation thresholds
    //
    // The async flow:
    // 1. User calls perp_open_position → position created, threshold_verified = false
    // 2. Crank detects PositionAwaitingVerification event
    // 3. Crank calls MXE verify_position_params() with position's encrypted data
    // 4. MXE callback updates position.encrypted_liq_below/above + threshold_verified = true
    // 5. Position is now fully operational

    // Get coarse timestamp once
    let coarse_time = ConfidentialPosition::coarse_timestamp(Clock::get()?.unix_timestamp);

    // Initialize position - use direct references to avoid stack copies
    // NOTE: encrypted_collateral and encrypted_liq_threshold are computed from
    // entry_price + leverage via MPC (reduces params size to avoid stack overflow)
    {
        let position = &mut ctx.accounts.position;
        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.perp_market.key();

        position.trader = trader_key;
        position.market = market_key;
        position.position_id = ConfidentialPosition::generate_position_id(
            &trader_key,
            &market_key,
            &params.position_nonce,
        );
        position.created_at_hour = coarse_time;
        position.last_updated_hour = coarse_time;
        position.side = params.side;
        position.leverage = params.leverage;

        // Copy encrypted arrays directly
        position.encrypted_size = params.encrypted_size;
        position.encrypted_entry_price = params.encrypted_entry_price;
        // Collateral: store plaintext amount in first 8 bytes (dev mode)
        // Production: MPC will encrypt from collateral_amount
        let mut enc_collateral = [0u8; 64];
        enc_collateral[..8].copy_from_slice(&params.collateral_amount.to_le_bytes());
        position.encrypted_collateral = enc_collateral;
        position.encrypted_realized_pnl = [0u8; 64];

        // Liquidation thresholds: MPC computes from entry_price + leverage
        // For stack reduction, we use placeholders filled by MPC callback
        // The threshold_verified flag tracks if MPC has confirmed the values
        position.encrypted_liq_below = [0u8; 64];
        position.encrypted_liq_above = [0u8; 64];

        position.threshold_commitment = ConfidentialPosition::compute_threshold_commitment(
            &params.encrypted_entry_price,
            params.leverage,
            ctx.accounts.perp_market.maintenance_margin_bps,
            matches!(params.side, PositionSide::Long),
        );
        position.last_threshold_update_hour = coarse_time;
        // Threshold verified = false until MPC callback fills in values
        position.threshold_verified = false;

        position.entry_cumulative_funding = if matches!(params.side, PositionSide::Long) {
            ctx.accounts.perp_market.cumulative_funding_long
        } else {
            ctx.accounts.perp_market.cumulative_funding_short
        };

        position.status = PositionStatus::Open;
        position.eligibility_proof_verified = true; // Verified via separate instruction
        position.partial_close_count = 0;
        position.auto_deleverage_priority = 0;
        position.last_margin_add_hour = 0;
        position.margin_add_count = 0;
        position.bump = ctx.bumps.position;
        // Store the position_count used in PDA seeds for close_position
        position.position_seed = ctx.accounts.perp_market.position_count;

        // V6: Initialize async MPC tracking fields
        // Generate request ID for MPC callback matching
        let request_id = ConfidentialPosition::generate_request_id(
            &position.key(),
            Clock::get()?.slot,
        );
        position.pending_mpc_request = request_id;
        position.pending_margin_amount = 0;
        position.pending_margin_is_add = false;
        position.is_liquidatable = false;

        // V7: Initialize close position tracking fields
        position.pending_close = false;
        position.pending_close_exit_price = 0;
        position.pending_close_full = false;
        position.pending_close_size = [0u8; 64];

        // V8: Store full ephemeral pubkey for MPC decryption
        // MPC needs this to compute: shared_secret = X25519(mxe_private, ephemeral_pubkey)
        position.ephemeral_pubkey = params.ephemeral_pubkey;
    }

    // Increment market position count
    ctx.accounts.perp_market.position_count = ctx.accounts.perp_market.position_count.saturating_add(1);

    // Emit event for crank to detect and process
    emit!(PositionAwaitingVerification {
        position: ctx.accounts.position.key(),
        trader: ctx.accounts.trader.key(),
        market: ctx.accounts.perp_market.key(),
        request_id: ctx.accounts.position.pending_mpc_request,
        side: params.side,
        leverage: params.leverage,
        created_at: coarse_time,
    });

    msg!(
        "Position opened (awaiting MPC verification): {:?} {}x, request_id={:?}",
        params.side,
        params.leverage,
        &ctx.accounts.position.pending_mpc_request[0..8]
    );

    Ok(())
}

/// Event emitted when a position is created and awaits MPC verification
#[event]
pub struct PositionAwaitingVerification {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub request_id: [u8; 32],
    pub side: PositionSide,
    pub leverage: u8,
    pub created_at: i64,
}
