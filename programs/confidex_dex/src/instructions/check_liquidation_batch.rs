use anchor_lang::prelude::*;

use crate::cpi::arcium::{
    queue_batch_liquidation_check, BatchLiquidationPositionData, MxeCpiAccounts,
};
use crate::error::ConfidexError;
use crate::oracle::get_sol_usd_price_for_liquidation;
use crate::state::{
    ConfidentialPosition, LiquidationBatchRequest, PerpetualMarket, PositionSide,
};

/// Maximum positions per batch check
pub const MAX_BATCH_SIZE: usize = 10;

#[derive(Accounts)]
#[instruction(position_keys: Vec<Pubkey>)]
pub struct CheckLiquidationBatch<'info> {
    #[account(
        seeds = [PerpetualMarket::SEED, perp_market.underlying_mint.as_ref()],
        bump = perp_market.bump,
    )]
    pub perp_market: Account<'info, PerpetualMarket>,

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
    pub batch_request: Account<'info, LiquidationBatchRequest>,

    /// CHECK: MXE config account for Arcium
    #[account(mut)]
    pub mxe_config: AccountInfo<'info>,

    /// CHECK: MPC request account (will be created by MXE)
    #[account(mut)]
    pub mpc_request: AccountInfo<'info>,

    /// CHECK: Arcium program for MPC
    pub arcium_program: AccountInfo<'info>,

    #[account(mut)]
    pub requester: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Parameters for batch liquidation check
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CheckLiquidationBatchParams {
    /// Position pubkeys to check (up to MAX_BATCH_SIZE)
    pub position_keys: Vec<Pubkey>,
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

    // Collect position data for MPC batch check
    // Remaining accounts should contain the position accounts in order
    let remaining_accounts = &ctx.remaining_accounts;
    require!(
        remaining_accounts.len() >= params.position_keys.len(),
        ConfidexError::InvalidAmount
    );

    let mut position_data: Vec<BatchLiquidationPositionData> = Vec::with_capacity(params.position_keys.len());
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
    batch_request.position_count = params.position_keys.len() as u8;
    batch_request.positions = positions_array;
    batch_request.results = [false; 10];
    batch_request.completed = false;
    batch_request.created_at = clock.unix_timestamp;
    batch_request.bump = ctx.bumps.batch_request;

    // Queue MPC batch liquidation check
    let mxe_accounts = MxeCpiAccounts {
        mxe_config: &ctx.accounts.mxe_config,
        request_account: &ctx.accounts.mpc_request,
        requester: &ctx.accounts.requester.to_account_info(),
        system_program: &ctx.accounts.system_program.to_account_info(),
        mxe_program: &ctx.accounts.arcium_program,
    };

    // Callback will update batch_request with results
    let callback_discriminator = [0xcb, 0xba, 0x7c, 0x1d, 0x2e, 0x3f, 0x40, 0x51]; // liquidation_batch_callback

    let computation = queue_batch_liquidation_check(
        mxe_accounts,
        &position_data,
        mark_price,
        &crate::ID, // Callback to this program
        callback_discriminator,
        &batch_request.key(),
    )?;

    // Store request ID
    batch_request.request_id = computation.request_id;

    msg!(
        "Queued batch liquidation check for {} positions at mark price {}",
        params.position_keys.len(),
        mark_price
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
