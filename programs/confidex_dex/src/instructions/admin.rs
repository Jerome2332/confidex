use anchor_lang::prelude::*;

use crate::cpi::arcium::{ARCIUM_PROGRAM_ID, ARCIUM_MXE_PROGRAM_ID};
use crate::cpi::verifier::SUNSPOT_VERIFIER_PROGRAM_ID;
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

// ============================================================================
// Migrate Exchange Account (V4 → V5)
// ============================================================================
// This instruction resizes the ExchangeState account from 158 bytes to 262 bytes
// and initializes the new program ID fields with defaults.
// ============================================================================

/// Old V4 size for migration validation
pub const EXCHANGE_V4_SIZE: usize = 158;

#[derive(Accounts)]
pub struct MigrateExchange<'info> {
    /// CHECK: We use AccountInfo to handle both old and new sizes
    /// The exchange account that needs migration
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump,
    )]
    pub exchange: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn migrate_exchange_handler(ctx: Context<MigrateExchange>) -> Result<()> {
    let exchange_info = &ctx.accounts.exchange;
    let authority = &ctx.accounts.authority;
    let system_program = &ctx.accounts.system_program;

    // Get current size
    let current_size = exchange_info.data_len();
    msg!("Exchange current size: {} bytes", current_size);

    // Check if already migrated
    if current_size == ExchangeState::SIZE {
        msg!("Exchange already at V5 size ({}), no migration needed", ExchangeState::SIZE);
        return Ok(());
    }

    // Validate it's the old V4 format
    require!(
        current_size == EXCHANGE_V4_SIZE,
        ConfidexError::InvalidAccountSize
    );

    // Read existing V4 data before reallocation
    let v4_data = exchange_info.try_borrow_data()?;

    // Parse existing fields from V4 format (158 bytes total data, 8 byte discriminator)
    // Skip discriminator (8 bytes)
    let authority_bytes: [u8; 32] = v4_data[8..40].try_into().map_err(|_| ConfidexError::InvalidAccountData)?;
    let saved_authority = Pubkey::from(authority_bytes);

    // Verify authority
    require!(
        saved_authority == authority.key(),
        ConfidexError::Unauthorized
    );

    let fee_recipient_bytes: [u8; 32] = v4_data[40..72].try_into().map_err(|_| ConfidexError::InvalidAccountData)?;
    let saved_fee_recipient = Pubkey::from(fee_recipient_bytes);

    let maker_fee_bps = u16::from_le_bytes(v4_data[72..74].try_into().map_err(|_| ConfidexError::InvalidAccountData)?);
    let taker_fee_bps = u16::from_le_bytes(v4_data[74..76].try_into().map_err(|_| ConfidexError::InvalidAccountData)?);
    let paused = v4_data[76] != 0;

    let mut blacklist_root = [0u8; 32];
    blacklist_root.copy_from_slice(&v4_data[77..109]);

    let arcium_cluster_bytes: [u8; 32] = v4_data[109..141].try_into().map_err(|_| ConfidexError::InvalidAccountData)?;
    let saved_arcium_cluster = Pubkey::from(arcium_cluster_bytes);

    let pair_count = u64::from_le_bytes(v4_data[141..149].try_into().map_err(|_| ConfidexError::InvalidAccountData)?);
    let order_count = u64::from_le_bytes(v4_data[149..157].try_into().map_err(|_| ConfidexError::InvalidAccountData)?);
    let bump = v4_data[157];

    // Drop borrow before realloc
    drop(v4_data);

    // Calculate additional space needed
    let additional_space = ExchangeState::SIZE - current_size;
    msg!("Reallocating {} additional bytes", additional_space);

    // Calculate additional rent needed
    let rent = Rent::get()?;
    let current_rent = rent.minimum_balance(current_size);
    let new_rent = rent.minimum_balance(ExchangeState::SIZE);
    let additional_rent = new_rent.saturating_sub(current_rent);

    // Transfer additional rent from authority to exchange
    if additional_rent > 0 {
        let cpi_context = CpiContext::new(
            system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: authority.to_account_info(),
                to: exchange_info.clone(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, additional_rent)?;
        msg!("Transferred {} lamports for additional rent", additional_rent);
    }

    // Realloc the account
    exchange_info.realloc(ExchangeState::SIZE, false)?;
    msg!("Account reallocated to {} bytes", ExchangeState::SIZE);

    // Write back all data including new V5 fields
    let mut data = exchange_info.try_borrow_mut_data()?;

    // Keep the discriminator unchanged (first 8 bytes)
    // Write existing fields back
    data[8..40].copy_from_slice(&saved_authority.to_bytes());
    data[40..72].copy_from_slice(&saved_fee_recipient.to_bytes());
    data[72..74].copy_from_slice(&maker_fee_bps.to_le_bytes());
    data[74..76].copy_from_slice(&taker_fee_bps.to_le_bytes());
    data[76] = if paused { 1 } else { 0 };
    data[77..109].copy_from_slice(&blacklist_root);
    data[109..141].copy_from_slice(&saved_arcium_cluster.to_bytes());
    data[141..149].copy_from_slice(&pair_count.to_le_bytes());
    data[149..157].copy_from_slice(&order_count.to_le_bytes());
    data[157] = bump;

    // Write new V5 fields (program IDs)
    // arcium_program_id at offset 158
    data[158..190].copy_from_slice(&ARCIUM_PROGRAM_ID.to_bytes());
    // mxe_program_id at offset 190
    data[190..222].copy_from_slice(&ARCIUM_MXE_PROGRAM_ID.to_bytes());
    // verifier_program_id at offset 222
    data[222..254].copy_from_slice(&SUNSPOT_VERIFIER_PROGRAM_ID.to_bytes());

    msg!("Exchange migrated to V5 format successfully");
    msg!("New program IDs: arcium={}, mxe={}, verifier={}",
         ARCIUM_PROGRAM_ID, ARCIUM_MXE_PROGRAM_ID, SUNSPOT_VERIFIER_PROGRAM_ID);

    Ok(())
}

// ============================================================================
// Update Program IDs (admin only)
// ============================================================================

#[derive(Accounts)]
pub struct UpdateProgramIds<'info> {
    #[account(
        mut,
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    pub authority: Signer<'info>,
}

/// Parameters for updating program IDs and cluster configuration
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateProgramIdsParams {
    /// New Arcium core program ID (None = keep current)
    pub arcium_program_id: Option<Pubkey>,
    /// New MXE program ID (None = keep current)
    pub mxe_program_id: Option<Pubkey>,
    /// New verifier program ID (None = keep current)
    pub verifier_program_id: Option<Pubkey>,
    /// New Arcium cluster account (None = keep current)
    /// This is the cluster PDA derived from offset (e.g., 456 for devnet v0.6.3)
    pub arcium_cluster: Option<Pubkey>,
}

pub fn update_program_ids_handler(
    ctx: Context<UpdateProgramIds>,
    params: UpdateProgramIdsParams,
) -> Result<()> {
    let exchange = &mut ctx.accounts.exchange;

    if let Some(arcium_program_id) = params.arcium_program_id {
        require!(
            ExchangeState::validate_program_id(&arcium_program_id),
            ConfidexError::InvalidProgramId
        );
        exchange.arcium_program_id = arcium_program_id;
        msg!("Arcium program ID updated: {}", arcium_program_id);
    }

    if let Some(mxe_program_id) = params.mxe_program_id {
        require!(
            ExchangeState::validate_program_id(&mxe_program_id),
            ConfidexError::InvalidProgramId
        );
        exchange.mxe_program_id = mxe_program_id;
        msg!("MXE program ID updated: {}", mxe_program_id);
    }

    if let Some(verifier_program_id) = params.verifier_program_id {
        require!(
            ExchangeState::validate_program_id(&verifier_program_id),
            ConfidexError::InvalidProgramId
        );
        exchange.verifier_program_id = verifier_program_id;
        msg!("Verifier program ID updated: {}", verifier_program_id);
    }

    if let Some(arcium_cluster) = params.arcium_cluster {
        require!(
            ExchangeState::validate_program_id(&arcium_cluster),
            ConfidexError::InvalidProgramId
        );
        exchange.arcium_cluster = arcium_cluster;
        msg!("Arcium cluster updated: {}", arcium_cluster);
    }

    msg!("Program IDs update complete");
    Ok(())
}

// ============================================================================
// Admin Force Close Position (for broken V2 / legacy positions)
// ============================================================================

use crate::state::{ConfidentialPosition, PositionStatus};
// Note: TokenAccount already imported at top of file
use anchor_spl::token::{self, Token, Transfer};

/// Accounts for admin force-closing a broken/legacy position
/// This is used when positions cannot be closed via MPC due to:
/// - Broken V2 encryption (truncated ephemeral pubkey)
/// - Legacy hackathon positions (plaintext format)
#[derive(Accounts)]
pub struct AdminForceClosePosition<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

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
            position.trader.as_ref(),
            perp_market.key().as_ref(),
            &position.position_seed.to_le_bytes()
        ],
        bump = position.bump,
        constraint = position.market == perp_market.key() @ ConfidexError::InvalidFundingState,
        constraint = position.status == PositionStatus::Open @ ConfidexError::PositionNotOpen,
        // Only allow force-close for broken/legacy positions
        constraint = position.is_legacy_plaintext_position() @ ConfidexError::InvalidPositionType
    )]
    pub position: Box<Account<'info, ConfidentialPosition>>,

    /// The trader who owns this position (receives refund)
    /// CHECK: We verify this matches position.trader
    #[account(
        mut,
        constraint = trader.key() == position.trader @ ConfidexError::Unauthorized
    )]
    pub trader: AccountInfo<'info>,

    /// Trader's collateral token account (receives refund)
    #[account(
        mut,
        constraint = trader_collateral_account.owner == position.trader @ ConfidexError::InvalidOwner,
        constraint = trader_collateral_account.mint == perp_market.quote_mint @ ConfidexError::InvalidMint
    )]
    pub trader_collateral_account: Account<'info, TokenAccount>,

    /// Market's collateral vault (source of refund)
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA
    #[account(
        seeds = [b"vault", perp_market.key().as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// Parameters for admin force-close
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AdminForceCloseParams {
    /// Refund amount to return to trader (typically the collateral they deposited)
    /// Set to 0 to close position with no refund (e.g., for abandoned positions)
    pub refund_amount: u64,
}

/// Admin force-close a broken or legacy position
///
/// This is an EMERGENCY function for positions that cannot be closed normally because:
/// 1. **Broken V2 positions**: Frontend encrypted with truncated 16-byte ephemeral pubkey,
///    but MPC needs full 32 bytes to decrypt. These are permanently undecryptable.
/// 2. **Legacy hackathon positions**: Created before encryption was properly implemented.
///
/// SECURITY NOTES:
/// - Only exchange authority can call this
/// - Position must be marked as legacy/broken (threshold_verified = false)
/// - Refund amount is specified by admin (not calculated from encrypted data)
/// - This is a LOSSY operation - we cannot compute actual PnL
///
/// RECOMMENDED REFUND POLICY:
/// - Return the original collateral deposited by the trader
/// - This is fair since we cannot determine if they had profit or loss
pub fn admin_force_close_handler(
    ctx: Context<AdminForceClosePosition>,
    params: AdminForceCloseParams,
) -> Result<()> {
    // Capture keys before mutable borrow
    let position_key = ctx.accounts.position.key();
    let market_key = ctx.accounts.perp_market.key();
    let authority_key = ctx.accounts.authority.key();

    let position = &mut ctx.accounts.position;

    msg!(
        "Admin force-closing position {:?} for trader {}",
        position.position_id,
        position.trader
    );

    // Verify this is a broken/legacy position
    require!(
        position.is_legacy_plaintext_position(),
        ConfidexError::InvalidPositionType
    );

    // Log position details for audit trail
    let is_broken_v2 = position.is_broken_v2_position();
    let trader_key = position.trader;
    let position_id = position.position_id;

    msg!(
        "Position type: {} (threshold_verified={})",
        if is_broken_v2 { "BROKEN_V2" } else { "LEGACY_HACKATHON" },
        position.threshold_verified
    );

    // Transfer refund to trader if amount > 0
    if params.refund_amount > 0 {
        // Check vault has sufficient balance
        let vault_balance = ctx.accounts.collateral_vault.amount;
        require!(
            vault_balance >= params.refund_amount,
            ConfidexError::InsufficientBalance
        );

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
            params.refund_amount,
        )?;

        msg!("Refunded {} to trader", params.refund_amount);
    } else {
        msg!("No refund - position closed at zero value");
    }

    // Mark position as closed
    position.status = PositionStatus::Closed;
    position.last_updated_hour = ConfidentialPosition::coarse_timestamp(Clock::get()?.unix_timestamp);

    // Emit event for tracking
    emit!(AdminForceClosedPosition {
        position: position_key,
        trader: trader_key,
        market: market_key,
        refund_amount: params.refund_amount,
        position_type: if is_broken_v2 { "broken_v2".to_string() } else { "legacy_hackathon".to_string() },
        authority: authority_key,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Position force-closed by admin: {:?}, refund={}",
        position_id,
        params.refund_amount
    );

    Ok(())
}

/// Event emitted when admin force-closes a position
#[event]
pub struct AdminForceClosedPosition {
    pub position: Pubkey,
    pub trader: Pubkey,
    pub market: Pubkey,
    pub refund_amount: u64,
    pub position_type: String,
    pub authority: Pubkey,
    pub timestamp: i64,
}

// ============================================================================
// Admin Force Close V7 Position (for pre-V8 positions with 692 byte accounts)
// ============================================================================
// This instruction handles positions created before V8 that have 692 byte accounts
// instead of the new 724 byte format. It uses AccountInfo for the position
// to avoid deserialization errors from the size mismatch.
// ============================================================================

/// Accounts for admin force-closing a V7 position (692 bytes)
/// Uses AccountInfo to handle old account size
#[derive(Accounts)]
pub struct AdminForceCloseV7Position<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        mut,
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

    /// CHECK: V7 position account (692 bytes) - manual verification
    /// We use AccountInfo because the struct size changed in V8
    #[account(mut)]
    pub position: AccountInfo<'info>,

    /// CHECK: The trader who owns this position
    #[account(mut)]
    pub trader: AccountInfo<'info>,

    /// Trader's collateral token account (receives refund)
    #[account(
        mut,
        constraint = trader_collateral_account.mint == perp_market.quote_mint @ ConfidexError::InvalidMint
    )]
    pub trader_collateral_account: Account<'info, TokenAccount>,

    /// Market's collateral vault (source of refund)
    #[account(
        mut,
        constraint = collateral_vault.key() == perp_market.collateral_vault @ ConfidexError::InvalidVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA
    #[account(
        seeds = [b"vault", perp_market.key().as_ref()],
        bump
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// V7 position size (before ephemeral_pubkey was added)
const V7_POSITION_SIZE: usize = 692;

/// Admin force-close a V7 position (pre-V8, 692 bytes)
///
/// This handler manually parses V7 position data to avoid deserialization
/// errors from the size mismatch with V8 positions.
pub fn admin_force_close_v7_handler(
    ctx: Context<AdminForceCloseV7Position>,
    params: AdminForceCloseParams,
) -> Result<()> {
    let position_info = &ctx.accounts.position;
    let perp_market = &ctx.accounts.perp_market;

    // Verify position account size is V7
    require!(
        position_info.data_len() == V7_POSITION_SIZE,
        ConfidexError::InvalidAccountSize
    );

    // Verify position is owned by our program
    require!(
        position_info.owner == &crate::ID,
        ConfidexError::InvalidOwner
    );

    let data = position_info.try_borrow_data()?;

    // Parse V7 position fields manually
    // Layout: discriminator(8) + trader(32) + market(32) + ...
    let trader = Pubkey::try_from(&data[8..40]).map_err(|_| ConfidexError::InvalidAccountData)?;
    let market = Pubkey::try_from(&data[40..72]).map_err(|_| ConfidexError::InvalidAccountData)?;

    // position_id at offset 72 (16 bytes)
    let mut position_id = [0u8; 16];
    position_id.copy_from_slice(&data[72..88]);

    // side at offset 104, leverage at 105
    let _side = data[104];
    let _leverage = data[105];

    // threshold_verified at offset 530
    let threshold_verified = data[530] != 0;

    // status at offset 547 (0=Open, 1=Closed, etc.)
    let status = data[547];

    // Drop borrow before writing
    drop(data);

    // Verify constraints
    require!(
        trader == ctx.accounts.trader.key(),
        ConfidexError::Unauthorized
    );
    require!(
        market == perp_market.key(),
        ConfidexError::InvalidFundingState
    );
    require!(
        status == 0, // Open
        ConfidexError::PositionNotOpen
    );
    require!(
        !threshold_verified,
        ConfidexError::InvalidPositionType
    );
    require!(
        ctx.accounts.trader_collateral_account.owner == trader,
        ConfidexError::InvalidOwner
    );

    msg!(
        "Admin force-closing V7 position {:?} for trader {}",
        position_id,
        trader
    );

    // Transfer refund to trader if amount > 0
    if params.refund_amount > 0 {
        let vault_balance = ctx.accounts.collateral_vault.amount;
        require!(
            vault_balance >= params.refund_amount,
            ConfidexError::InsufficientBalance
        );

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
            params.refund_amount,
        )?;

        msg!("Refunded {} to trader", params.refund_amount);
    } else {
        msg!("No refund - position closed at zero value");
    }

    // Mark position as closed by writing status byte
    // status is at offset 547
    {
        let mut data = position_info.try_borrow_mut_data()?;
        data[547] = 1; // Closed
    }

    // Emit event
    emit!(AdminForceClosedPosition {
        position: position_info.key(),
        trader,
        market,
        refund_amount: params.refund_amount,
        position_type: "v7_broken_v2".to_string(),
        authority: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "V7 position force-closed by admin: {:?}, refund={}",
        position_id,
        params.refund_amount
    );

    Ok(())
}

// ============================================================================
// Admin Reset Order Matching (for stuck orders in MPC flow)
// ============================================================================
// This instruction allows the admin to reset the is_matching flag and clear
// the pending_match_request when an MPC callback never arrived (stuck flow).
// ============================================================================

use crate::state::ConfidentialOrder;

#[derive(Accounts)]
pub struct AdminResetOrderMatching<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        has_one = authority @ ConfidexError::Unauthorized
    )]
    pub exchange: Account<'info, ExchangeState>,

    #[account(
        mut,
        seeds = [
            ConfidentialOrder::SEED,
            order.maker.as_ref(),
            &order.order_nonce
        ],
        bump = order.bump,
        // Order must be stuck in matching (is_matching = true)
        constraint = order.is_matching @ ConfidexError::OrderNotMatching
    )]
    pub order: Account<'info, ConfidentialOrder>,

    pub authority: Signer<'info>,
}

/// Admin reset order matching status
///
/// This is an EMERGENCY function for orders that got stuck in the MPC matching
/// flow due to:
/// 1. MPC callback never arrived (network issues, MXE problems)
/// 2. Computation failed but no failure callback was received
///
/// After reset, the order can be:
/// - Cancelled by the user
/// - Re-entered into matching
///
/// SECURITY NOTES:
/// - Only exchange authority can call this
/// - Order must have is_matching = true (otherwise already active)
/// - Clears both is_matching flag and pending_match_request
pub fn admin_reset_order_matching_handler(
    ctx: Context<AdminResetOrderMatching>,
) -> Result<()> {
    // Capture keys before mutable borrow
    let order_pda = ctx.accounts.order.key();
    let authority_key = ctx.accounts.authority.key();

    let order = &mut ctx.accounts.order;

    // Capture values needed for event before mutable operations
    let order_id = order.order_id;
    let maker = order.maker;

    msg!(
        "Admin resetting matching for order {:?} (maker: {})",
        order_id,
        maker
    );

    // Log the stuck request for debugging
    if order.has_pending_match() {
        msg!(
            "Clearing pending_match_request: {:?}",
            order.pending_match_request
        );
    }

    // Reset the matching state
    order.is_matching = false;
    order.pending_match_request = [0u8; 32];

    emit!(AdminResetOrderMatchingEvent {
        order_id,
        order_pda,
        maker,
        authority: authority_key,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Order matching reset successfully - order can now be cancelled or re-matched");

    Ok(())
}

/// Event emitted when admin resets order matching
#[event]
pub struct AdminResetOrderMatchingEvent {
    pub order_id: [u8; 16],
    pub order_pda: Pubkey,
    pub maker: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

// ============================================================================
// Admin Force Cancel Order (for demo/emergency when MPC is unavailable)
// ============================================================================

use crate::state::{OrderStatus, Side, UserConfidentialBalance};

/// Accounts for admin force-cancelling an order
/// This bypasses MPC when it's unavailable (demo mode, MXE issues, etc.)
#[derive(Accounts)]
pub struct AdminForceCancelOrder<'info> {
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
        bump = pair.bump,
        constraint = order.pair == pair.key() @ ConfidexError::InvalidOrder,
    )]
    pub pair: Account<'info, TradingPair>,

    #[account(
        mut,
        seeds = [
            ConfidentialOrder::SEED,
            order.maker.as_ref(),
            &order.order_nonce
        ],
        bump = order.bump,
        // Order must be active (status=Active and not matching)
        constraint = order.is_active() @ ConfidexError::OrderNotOpen
    )]
    pub order: Account<'info, ConfidentialOrder>,

    /// User's base token balance - for sell order refunds
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            order.maker.as_ref(),
            pair.base_mint.as_ref()
        ],
        bump = user_base_balance.bump,
    )]
    pub user_base_balance: Account<'info, UserConfidentialBalance>,

    /// User's quote token balance - for buy order refunds
    #[account(
        mut,
        seeds = [
            UserConfidentialBalance::SEED,
            order.maker.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = user_quote_balance.bump,
    )]
    pub user_quote_balance: Account<'info, UserConfidentialBalance>,

    pub authority: Signer<'info>,
}

/// Admin force cancel order handler
///
/// This is an EMERGENCY/DEMO function for cancelling orders when MPC is unavailable.
/// The refund_amount is specified by admin based on off-chain computation or inspection.
///
/// Use cases:
/// 1. Demo mode - MPC not set up, need to cancel for UX
/// 2. MXE down - Users can't cancel via normal flow
/// 3. Legacy orders - Old format that MPC can't process
///
/// SECURITY NOTES:
/// - Only exchange authority can call this
/// - Admin specifies refund amount (trust required)
/// - Should only be used when MPC is genuinely unavailable
pub fn admin_force_cancel_order_handler(
    ctx: Context<AdminForceCancelOrder>,
    refund_amount: u64,
) -> Result<()> {
    // Capture keys before mutable borrows
    let order_pda = ctx.accounts.order.key();
    let authority_key = ctx.accounts.authority.key();

    let order = &mut ctx.accounts.order;
    let pair = &mut ctx.accounts.pair;
    let user_base_balance = &mut ctx.accounts.user_base_balance;
    let user_quote_balance = &mut ctx.accounts.user_quote_balance;
    let clock = Clock::get()?;

    msg!(
        "Admin force-cancelling order {:?} with refund {}",
        order.order_id,
        refund_amount
    );

    // Perform the refund based on order side
    if refund_amount > 0 {
        match order.side {
            Side::Buy => {
                // Buy orders escrow quote tokens (USDC)
                let current_balance = user_quote_balance.get_balance();
                user_quote_balance.set_balance(
                    current_balance.checked_add(refund_amount)
                        .ok_or(ConfidexError::ArithmeticOverflow)?
                );
                msg!("Refunded {} quote tokens to user", refund_amount);
            }
            Side::Sell => {
                // Sell orders escrow base tokens (SOL)
                let current_balance = user_base_balance.get_balance();
                user_base_balance.set_balance(
                    current_balance.checked_add(refund_amount)
                        .ok_or(ConfidexError::ArithmeticOverflow)?
                );
                msg!("Refunded {} base tokens to user", refund_amount);
            }
        }
    }

    // Mark order as Inactive (cancelled - privacy preserving, no separate Cancelled variant)
    order.status = OrderStatus::Inactive;

    // Clear any matching state
    order.is_matching = false;
    order.pending_match_request = [0u8; 32];

    // Decrement open order count
    pair.open_order_count = pair.open_order_count.checked_sub(1)
        .ok_or(ConfidexError::ArithmeticOverflow)?;

    // Coarse timestamp for event (hour precision for privacy)
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    emit!(AdminForceCancelOrderEvent {
        order_id: order.order_id,
        order_pda,
        maker: order.maker,
        authority: authority_key,
        refund_amount,
        timestamp: coarse_time,
    });

    msg!("Order force-cancelled successfully");

    Ok(())
}

/// Event emitted when admin force-cancels an order
#[event]
pub struct AdminForceCancelOrderEvent {
    pub order_id: [u8; 16],
    pub order_pda: Pubkey,
    pub maker: Pubkey,
    pub authority: Pubkey,
    pub refund_amount: u64,
    pub timestamp: i64,
}
