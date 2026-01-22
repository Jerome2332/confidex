use anchor_lang::prelude::*;

use crate::cpi::arcium::{
    queue_batch_liquidation_check, BatchLiquidationPositionData, MxeCpiAccounts,
    ARCIUM_MXE_PROGRAM_ID, ARCIUM_PROGRAM_ID,
};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price_for_liquidation;
use crate::state::{
    ConfidentialPosition, LiquidationBatchRequest, PerpetualMarket,
};

/// Maximum positions per batch check
pub const MAX_BATCH_SIZE: usize = 10;

/// Uses Box<Account<>> for large account types to reduce stack usage.
/// MXE accounts are passed via remaining_accounts to keep stack under 4KB.
///
/// remaining_accounts layout:
///   0..position_count: Position accounts to check
///   position_count..position_count+11: MXE accounts (same order as MatchOrders)
#[derive(Accounts)]
#[instruction(params: CheckLiquidationBatchParams)]
pub struct CheckLiquidationBatch<'info> {
    #[account(
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Box<Account<'info, PerpetualMarket>>,

    /// CHECK: Pyth oracle for current mark price
    #[account(
        constraint = oracle.key() == perp_market.oracle_price_feed @ ConfidexError::InvalidOraclePrice
    )]
    pub oracle: AccountInfo<'info>,

    #[account(
        init,
        payer = requester,
        space = LiquidationBatchRequest::SIZE,
        seeds = [LiquidationBatchRequest::SEED, &Clock::get()?.slot.to_le_bytes()],
        bump
    )]
    pub batch_request: Box<Account<'info, LiquidationBatchRequest>>,

    #[account(mut)]
    pub requester: Signer<'info>,

    pub system_program: Program<'info, System>,

    // =========================================================================
    // ARCIUM MXE ACCOUNTS (11 accounts via remaining_accounts to reduce stack)
    // Order in remaining_accounts[position_count..position_count+11]:
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

/// Parameters for batch liquidation check
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CheckLiquidationBatchParams {
    /// Position pubkeys to check (up to MAX_BATCH_SIZE)
    pub position_keys: Vec<Pubkey>,
    /// Random seed for computation account derivation
    pub computation_offset: u64,
    /// X25519 public key for output encryption
    pub pub_key: [u8; 32],
    /// Encryption nonce
    pub nonce: u128,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, CheckLiquidationBatch<'info>>,
    params: CheckLiquidationBatchParams,
) -> Result<()> {
    let clock = Clock::get()?;

    // Validate batch size
    require!(
        !params.position_keys.is_empty() && params.position_keys.len() <= MAX_BATCH_SIZE,
        ConfidexError::InvalidAmount
    );

    // Fetch current mark price from oracle with strict validation for liquidations
    // Enforces: price < 60s old on mainnet, confidence < 1%
    let mark_price = get_sol_usd_price_for_liquidation(&ctx.accounts.oracle)?;

    // Remaining accounts layout:
    // [0..position_count]: Position accounts to check
    // [position_count..position_count+11]: MXE accounts
    let remaining_accounts = &ctx.remaining_accounts;
    let position_count = params.position_keys.len();
    require!(
        remaining_accounts.len() >= position_count + 11,
        ConfidexError::InvalidAccountCount
    );

    let mut position_data: Vec<BatchLiquidationPositionData> = Vec::with_capacity(position_count);
    let mut positions_array = [[0u8; 32]; 10];

    for (i, position_key) in params.position_keys.iter().enumerate() {
        // Verify the account matches the expected key
        require!(
            remaining_accounts[i].key() == *position_key,
            ConfidexError::OrderOwnerMismatch
        );

        // Deserialize position account
        let position_account = &remaining_accounts[i];
        let position_data_ref = position_account.try_borrow_data()?;

        // Skip discriminator (8 bytes)
        if position_data_ref.len() < ConfidentialPosition::SIZE {
            return Err(ConfidexError::InvalidAmount.into());
        }

        // Parse position fields we need
        // Offsets based on ConfidentialPosition struct layout:
        // 8 discriminator + 32 trader + 32 market + 16 position_id + 8 created_at_hour + 8 last_updated_hour + 1 side + 1 leverage
        // = 106 bytes to reach encrypted_size
        // Then: 64 encrypted_size + 64 encrypted_entry_price + 64 encrypted_collateral + 64 encrypted_realized_pnl
        // = 256 bytes of encrypted core data
        // Then: 64 encrypted_liq_below + 64 encrypted_liq_above
        let side_offset = 8 + 32 + 32 + 16 + 8 + 8;
        let side_byte = position_data_ref[side_offset];
        let is_long = side_byte == 0; // PositionSide::Long is default (0)

        // Get encrypted liquidation threshold based on side
        let encrypted_liq_below_offset = 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 + 64 + 64 + 64;
        let encrypted_liq_above_offset = encrypted_liq_below_offset + 64;

        let encrypted_threshold = if is_long {
            // For longs, use encrypted_liq_below
            let mut threshold = [0u8; 64];
            threshold.copy_from_slice(&position_data_ref[encrypted_liq_below_offset..encrypted_liq_below_offset + 64]);
            threshold
        } else {
            // For shorts, use encrypted_liq_above
            let mut threshold = [0u8; 64];
            threshold.copy_from_slice(&position_data_ref[encrypted_liq_above_offset..encrypted_liq_above_offset + 64]);
            threshold
        };

        position_data.push(BatchLiquidationPositionData {
            encrypted_liq_threshold: encrypted_threshold,
            is_long,
        });

        positions_array[i] = position_key.to_bytes();
    }

    // Initialize batch request account
    let batch_request = &mut ctx.accounts.batch_request;
    batch_request.market = ctx.accounts.perp_market.key();
    batch_request.mark_price = mark_price;
    batch_request.position_count = position_count as u8;
    batch_request.positions = positions_array;
    batch_request.results = [false; 10];
    batch_request.completed = false;
    batch_request.created_at = clock.unix_timestamp;
    batch_request.bump = ctx.bumps.batch_request;

    // Extract MXE accounts from remaining_accounts (after position accounts)
    // Store AccountInfo in local variables to avoid lifetime issues
    let mxe_start = position_count;
    let payer_info = ctx.accounts.requester.to_account_info();
    let system_program_info = ctx.accounts.system_program.to_account_info();

    let mxe_accounts = MxeCpiAccounts {
        payer: &payer_info,
        sign_pda_account: &remaining_accounts[mxe_start],
        mxe_account: &remaining_accounts[mxe_start + 1],
        mempool_account: &remaining_accounts[mxe_start + 2],
        executing_pool: &remaining_accounts[mxe_start + 3],
        computation_account: &remaining_accounts[mxe_start + 4],
        comp_def_account: &remaining_accounts[mxe_start + 5],
        cluster_account: &remaining_accounts[mxe_start + 6],
        pool_account: &remaining_accounts[mxe_start + 7],
        clock_account: &remaining_accounts[mxe_start + 8],
        system_program: &system_program_info,
        arcium_program: &remaining_accounts[mxe_start + 9],
        mxe_program: &remaining_accounts[mxe_start + 10],
    };

    // Queue MPC batch liquidation check
    let computation = queue_batch_liquidation_check(
        mxe_accounts,
        params.computation_offset,
        &position_data,
        mark_price,
        &params.pub_key,
        params.nonce,
    )?;

    // Store request ID
    batch_request.request_id = computation.request_id;

    msg!(
        "Queued batch liquidation check for {} positions at mark price {}, computation_offset={}",
        position_count,
        mark_price,
        params.computation_offset
    );

    Ok(())
}

/// Callback handler for batch liquidation results from MPC
#[derive(Accounts)]
pub struct LiquidationBatchCallback<'info> {
    #[account(
        mut,
        seeds = [LiquidationBatchRequest::SEED, batch_request.request_id.as_ref()],
        bump = batch_request.bump,
    )]
    pub batch_request: Account<'info, LiquidationBatchRequest>,

    /// CHECK: Must be the Arcium MXE program
    #[account(
        constraint = mxe_program.key() == crate::cpi::arcium::ARCIUM_MXE_PROGRAM_ID @ ConfidexError::Unauthorized
    )]
    pub mxe_program: Signer<'info>,
}

/// Callback params from MPC
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LiquidationBatchCallbackParams {
    /// Request ID matching the batch
    pub request_id: [u8; 32],
    /// Results: true = position is liquidatable
    pub results: Vec<bool>,
}

pub fn callback_handler(
    ctx: Context<LiquidationBatchCallback>,
    params: LiquidationBatchCallbackParams,
) -> Result<()> {
    let batch_request = &mut ctx.accounts.batch_request;

    // Verify request ID matches
    require!(
        batch_request.request_id == params.request_id,
        ConfidexError::Unauthorized
    );

    // Verify we haven't already processed this callback
    require!(
        !batch_request.completed,
        ConfidexError::InvalidAmount
    );

    // Copy results
    for (i, result) in params.results.iter().enumerate() {
        if i < 10 {
            batch_request.results[i] = *result;
        }
    }

    batch_request.completed = true;

    let liquidatable_count = params.results.iter().filter(|&&r| r).count();
    msg!(
        "Batch liquidation check complete: {}/{} positions liquidatable",
        liquidatable_count,
        params.results.len()
    );

    // Emit events for liquidatable positions (for crank to pick up)
    for (i, &is_liquidatable) in params.results.iter().enumerate() {
        if is_liquidatable && i < batch_request.position_count as usize {
            emit!(PositionLiquidatable {
                position_pubkey: Pubkey::new_from_array(batch_request.positions[i]),
                market: batch_request.market,
                mark_price: batch_request.mark_price,
                batch_index: i as u8,
            });
        }
    }

    Ok(())
}

/// Event emitted when a position is found to be liquidatable
#[event]
pub struct PositionLiquidatable {
    /// Position account pubkey
    pub position_pubkey: Pubkey,
    /// Market this position is on
    pub market: Pubkey,
    /// Mark price at which liquidation was triggered
    pub mark_price: u64,
    /// Index in the batch request
    pub batch_index: u8,
}
