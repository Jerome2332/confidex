use anchor_lang::prelude::*;
use crate::state::{ComputationRequest, ComputationStatus, ComputationType, MxeConfig};

#[derive(Accounts)]
pub struct QueueComputation<'info> {
    #[account(
        mut,
        seeds = [MxeConfig::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, MxeConfig>,

    #[account(
        init,
        payer = requester,
        space = ComputationRequest::MAX_SIZE,
        seeds = [
            ComputationRequest::SEED,
            &config.computation_count.to_le_bytes()
        ],
        bump
    )]
    pub request: Account<'info, ComputationRequest>,

    #[account(mut)]
    pub requester: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<QueueComputation>,
    buy_price_encrypted: [u8; 64],
    sell_price_encrypted: [u8; 64],
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

    // Pack inputs (2x 64-byte encrypted values)
    let mut inputs = Vec::with_capacity(128);
    inputs.extend_from_slice(&buy_price_encrypted);
    inputs.extend_from_slice(&sell_price_encrypted);

    request.request_id = request_id;
    request.computation_type = ComputationType::ComparePrices;
    request.requester = ctx.accounts.requester.key();
    request.callback_program = callback_program;
    request.callback_discriminator = callback_discriminator;
    request.inputs = inputs;
    request.status = ComputationStatus::Pending;
    request.created_at = clock.unix_timestamp;
    request.completed_at = 0;
    request.result = Vec::new();
    request.bump = ctx.bumps.request;

    config.computation_count = config.computation_count.saturating_add(1);

    emit!(ComputationQueued {
        request_id,
        computation_type: ComputationType::ComparePrices,
        requester: ctx.accounts.requester.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!("Price comparison queued: request_id={:?}", &request_id[0..8]);

    Ok(())
}

#[event]
pub struct ComputationQueued {
    pub request_id: [u8; 32],
    pub computation_type: ComputationType,
    pub requester: Pubkey,
    pub timestamp: i64,
}
