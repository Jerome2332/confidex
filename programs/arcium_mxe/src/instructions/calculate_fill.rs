use anchor_lang::prelude::*;
use crate::state::{ComputationRequest, ComputationStatus, ComputationType, MxeConfig};
use crate::instructions::compare_prices::{QueueComputation, ComputationQueued};

pub fn handler(
    ctx: Context<QueueComputation>,
    buy_amount_encrypted: [u8; 64],
    buy_filled_encrypted: [u8; 64],
    sell_amount_encrypted: [u8; 64],
    sell_filled_encrypted: [u8; 64],
    callback_program: Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let request = &mut ctx.accounts.request;
    let clock = Clock::get()?;

    // Generate request ID from counter
    let mut request_id = [0u8; 32];
    request_id[0..8].copy_from_slice(&config.computation_count.to_le_bytes());
    request_id[8..16].copy_from_slice(&clock.unix_timestamp.to_le_bytes());

    // Pack inputs (4x 64-byte encrypted values = 256 bytes)
    let mut inputs = Vec::with_capacity(256);
    inputs.extend_from_slice(&buy_amount_encrypted);
    inputs.extend_from_slice(&buy_filled_encrypted);
    inputs.extend_from_slice(&sell_amount_encrypted);
    inputs.extend_from_slice(&sell_filled_encrypted);

    request.request_id = request_id;
    request.computation_type = ComputationType::CalculateFill;
    request.requester = ctx.accounts.requester.key();
    request.callback_program = callback_program;
    request.callback_discriminator = callback_discriminator;
    request.inputs = inputs;
    request.status = ComputationStatus::Pending;
    request.created_at = clock.unix_timestamp;
    request.completed_at = 0;
    request.result = Vec::new();
    // Fill calculation doesn't need callback accounts (used in PendingMatch flow)
    request.callback_account_1 = Pubkey::default();
    request.callback_account_2 = Pubkey::default();
    request.bump = ctx.bumps.request;

    config.computation_count = config.computation_count.saturating_add(1);

    emit!(ComputationQueued {
        request_id,
        computation_type: ComputationType::CalculateFill,
        requester: ctx.accounts.requester.key(),
        callback_account_1: Pubkey::default(),
        callback_account_2: Pubkey::default(),
        timestamp: clock.unix_timestamp,
    });

    msg!("Fill calculation queued: request_id={:?}", &request_id[0..8]);

    Ok(())
}
