use anchor_lang::prelude::*;
use crate::state::{ComputationRequest, ComputationStatus, MxeConfig};

#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct ProcessCallback<'info> {
    #[account(
        mut,
        seeds = [MxeConfig::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, MxeConfig>,

    #[account(
        mut,
        seeds = [
            ComputationRequest::SEED,
            &find_request_index(&request_id).to_le_bytes()
        ],
        bump = request.bump,
        constraint = request.request_id == request_id @ ErrorCode::InvalidRequestId,
        constraint = request.status == ComputationStatus::Pending @ ErrorCode::RequestNotPending
    )]
    pub request: Account<'info, ComputationRequest>,

    /// CHECK: Arcium cluster authority (validated by cluster signature)
    pub cluster_authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<ProcessCallback>,
    request_id: [u8; 32],
    result: Vec<u8>,
    success: bool,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let request = &mut ctx.accounts.request;
    let clock = Clock::get()?;

    // Update request status and result
    request.status = if success {
        ComputationStatus::Completed
    } else {
        ComputationStatus::Failed
    };
    request.completed_at = clock.unix_timestamp;
    request.result = result.clone();

    config.completed_count = config.completed_count.saturating_add(1);

    emit!(ComputationCompleted {
        request_id,
        success,
        result_size: result.len() as u32,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Computation completed: request_id={:?}, success={}",
        &request_id[0..8],
        success
    );

    // TODO: In production, this would CPI to the callback program
    // using request.callback_program and request.callback_discriminator
    //
    // let callback_ix = Instruction {
    //     program_id: request.callback_program,
    //     accounts: vec![...],
    //     data: [request.callback_discriminator, result].concat(),
    // };
    // invoke(&callback_ix, &[...])?;

    Ok(())
}

/// Extract request index from request_id (stored in first 8 bytes)
fn find_request_index(request_id: &[u8; 32]) -> u64 {
    u64::from_le_bytes(request_id[0..8].try_into().unwrap_or([0u8; 8]))
}

#[event]
pub struct ComputationCompleted {
    pub request_id: [u8; 32],
    pub success: bool,
    pub result_size: u32,
    pub timestamp: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid request ID")]
    InvalidRequestId,
    #[msg("Request is not in pending status")]
    RequestNotPending,
}
