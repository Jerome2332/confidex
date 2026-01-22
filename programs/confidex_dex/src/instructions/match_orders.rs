use anchor_lang::prelude::*;

use crate::cpi::arcium::{
    queue_compare_prices, MxeCpiAccounts, ARCIUM_MXE_PROGRAM_ID, ARCIUM_PROGRAM_ID,
};
use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, Side, TradingPair};

/// Accounts required for order matching with full Arcium MPC support.
///
/// The MXE requires 12 accounts per Arcium's `#[queue_computation_accounts]` macro.
/// All accounts after `system_program` are Arcium infrastructure accounts that must
/// be derived by the client using the Arcium SDK.
/// Accounts required for order matching with full Arcium MPC support.
///
/// Uses Box<Account<>> for large account types to reduce stack usage.
/// The MXE accounts are passed via remaining_accounts to keep stack under 4KB.
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct MatchOrders<'info> {
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
        constraint = !exchange.paused @ ConfidexError::ExchangePaused
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,

    #[account(
        mut,
        seeds = [
            TradingPair::SEED,
            pair.base_mint.as_ref(),
            pair.quote_mint.as_ref()
        ],
        bump = pair.bump
    )]
    pub pair: Box<Account<'info, TradingPair>>,

    #[account(
        mut,
        seeds = [
            ConfidentialOrder::SEED,
            buy_order.maker.as_ref(),
            &buy_order.order_nonce
        ],
        bump = buy_order.bump,
        constraint = buy_order.side == Side::Buy @ ConfidexError::InvalidOrderSide,
        constraint = buy_order.is_active() @ ConfidexError::OrderNotOpen,
        constraint = buy_order.eligibility_proof_verified @ ConfidexError::EligibilityNotVerified,
        constraint = !buy_order.is_matching @ ConfidexError::OrderAlreadyMatching
    )]
    pub buy_order: Box<Account<'info, ConfidentialOrder>>,

    #[account(
        mut,
        seeds = [
            ConfidentialOrder::SEED,
            sell_order.maker.as_ref(),
            &sell_order.order_nonce
        ],
        bump = sell_order.bump,
        constraint = sell_order.side == Side::Sell @ ConfidexError::InvalidOrderSide,
        constraint = sell_order.is_active() @ ConfidexError::OrderNotOpen,
        constraint = sell_order.eligibility_proof_verified @ ConfidexError::EligibilityNotVerified,
        constraint = !sell_order.is_matching @ ConfidexError::OrderAlreadyMatching
    )]
    pub sell_order: Box<Account<'info, ConfidentialOrder>>,

    pub system_program: Program<'info, System>,

    /// Crank operator (payer for MPC fees)
    #[account(mut)]
    pub crank: Signer<'info>,

    // =========================================================================
    // ARCIUM MXE ACCOUNTS (11 accounts via remaining_accounts to reduce stack)
    // Order in remaining_accounts[0..10]:
    //   0: sign_pda_account (mut)
    //   1: mxe_account (mut)
    //   2: mempool_account (mut)
    //   3: executing_pool (mut)
    //   4: computation_account (mut)
    //   5: comp_def_account
    //   6: cluster_account (mut)
    //   7: pool_account (mut)
    //   8: clock_account (mut)
    //   9: arcium_program
    //  10: mxe_program
    // =========================================================================
}

/// Input parameters for match_orders instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MatchOrdersParams {
    /// Random seed for computation account derivation
    pub computation_offset: u64,
    /// X25519 public key for output encryption (from ephemeral keypair)
    pub pub_key: [u8; 32],
    /// Encryption nonce
    pub nonce: u128,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, MatchOrders<'info>>,
    params: MatchOrdersParams,
) -> Result<()> {
    let clock = Clock::get()?;

    // Verify orders are on the same pair
    require!(
        ctx.accounts.buy_order.pair == ctx.accounts.sell_order.pair
            && ctx.accounts.buy_order.pair == ctx.accounts.pair.key(),
        ConfidexError::OrdersNotMatchable
    );

    // Extract MXE accounts from remaining_accounts (11 accounts)
    require!(
        ctx.remaining_accounts.len() >= 11,
        ConfidexError::InvalidAccountCount
    );

    // Copy encrypted prices to avoid borrowing issues
    let buy_price = ctx.accounts.buy_order.encrypted_price;
    let sell_price = ctx.accounts.sell_order.encrypted_price;
    let buy_order_id = ctx.accounts.buy_order.order_id;
    let sell_order_id = ctx.accounts.sell_order.order_id;

    // Store AccountInfo in local variables to avoid lifetime issues
    let payer_info = ctx.accounts.crank.to_account_info();
    let system_program_info = ctx.accounts.system_program.to_account_info();

    // Build MXE CPI accounts structure from remaining_accounts
    let mxe_accounts = MxeCpiAccounts {
        payer: &payer_info,
        sign_pda_account: &ctx.remaining_accounts[0],
        mxe_account: &ctx.remaining_accounts[1],
        mempool_account: &ctx.remaining_accounts[2],
        executing_pool: &ctx.remaining_accounts[3],
        computation_account: &ctx.remaining_accounts[4],
        comp_def_account: &ctx.remaining_accounts[5],
        cluster_account: &ctx.remaining_accounts[6],
        pool_account: &ctx.remaining_accounts[7],
        clock_account: &ctx.remaining_accounts[8],
        system_program: &system_program_info,
        arcium_program: &ctx.remaining_accounts[9],
        mxe_program: &ctx.remaining_accounts[10],
    };

    // Queue price comparison via MPC
    // Result will come back via finalize_match callback from MXE
    // Pass order pubkeys so MXE callback can CPI back to DEX with them
    let buy_order_key = ctx.accounts.buy_order.key();
    let sell_order_key = ctx.accounts.sell_order.key();

    let queued = queue_compare_prices(
        mxe_accounts,
        params.computation_offset,
        &buy_price,
        &sell_price,
        &params.pub_key,
        params.nonce,
        Some(&buy_order_key),
        Some(&sell_order_key),
    )?;

    // Store pending match state for callback validation
    ctx.accounts.buy_order.pending_match_request = queued.request_id;
    ctx.accounts.sell_order.pending_match_request = queued.request_id;
    ctx.accounts.buy_order.is_matching = true;
    ctx.accounts.sell_order.is_matching = true;

    // Coarse timestamp for privacy (hour precision)
    let coarse_time = ConfidentialOrder::coarse_timestamp(clock.unix_timestamp);

    emit!(MatchQueued {
        buy_order_id,
        sell_order_id,
        request_id: queued.request_id,
        computation_offset: params.computation_offset,
        timestamp: coarse_time,
    });

    msg!(
        "Match queued via MPC: buy={:?} sell={:?} computation_offset={}",
        buy_order_id,
        sell_order_id,
        params.computation_offset
    );

    Ok(())
}

#[event]
pub struct MatchQueued {
    /// Hash-based order ID (no sequential correlation)
    pub buy_order_id: [u8; 16],
    /// Hash-based order ID (no sequential correlation)
    pub sell_order_id: [u8; 16],
    /// Request ID for tracking MPC computation
    pub request_id: [u8; 32],
    /// Computation offset used for account derivation
    pub computation_offset: u64,
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
}

/// Event emitted after MPC callback confirms match and orders are updated
#[event]
pub struct TradeExecuted {
    /// Hash-based order ID (no sequential correlation)
    pub buy_order_id: [u8; 16],
    /// Hash-based order ID (no sequential correlation)
    pub sell_order_id: [u8; 16],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub pair: Pubkey,
    /// Coarse timestamp (hour precision)
    pub timestamp: i64,
    // Note: No amounts or prices for privacy
}
