use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
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

    /// CHECK: MXE authority PDA for signing CPI
    #[account(
        seeds = [MxeConfig::AUTHORITY_SEED],
        bump = config.authority_bump
    )]
    pub mxe_authority: UncheckedAccount<'info>,

    /// CHECK: Arcium cluster authority (validated by cluster signature)
    pub cluster_authority: Signer<'info>,

    /// CHECK: The callback program to CPI to (validated against request.callback_program)
    #[account(
        constraint = callback_program.key() == request.callback_program @ ErrorCode::InvalidCallbackProgram
    )]
    pub callback_program: UncheckedAccount<'info>,

    /// CHECK: First callback account (e.g., buy_order) - validated against request
    #[account(
        mut,
        constraint = callback_account_1.key() == request.callback_account_1 @ ErrorCode::InvalidCallbackAccount
    )]
    pub callback_account_1: UncheckedAccount<'info>,

    /// CHECK: Second callback account (e.g., sell_order) - validated against request
    #[account(
        mut,
        constraint = callback_account_2.key() == request.callback_account_2 @ ErrorCode::InvalidCallbackAccount
    )]
    pub callback_account_2: UncheckedAccount<'info>,
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

    // CPI to the callback program with the result
    if success {
        // Build callback instruction data: discriminator + request_id + result (as vec with length prefix)
        let mut callback_data = Vec::with_capacity(8 + 32 + 4 + result.len());
        callback_data.extend_from_slice(&request.callback_discriminator);
        callback_data.extend_from_slice(&request_id);
        // Anchor expects Vec<u8> with 4-byte length prefix
        callback_data.extend_from_slice(&(result.len() as u32).to_le_bytes());
        callback_data.extend_from_slice(&result);

        let callback_ix = Instruction {
            program_id: request.callback_program,
            accounts: vec![
                // MXE authority as signer (so DEX can verify callback is from MXE)
                AccountMeta::new_readonly(ctx.accounts.mxe_authority.key(), true),
                // Callback accounts (buy_order, sell_order for order matching)
                AccountMeta::new(request.callback_account_1, false),
                AccountMeta::new(request.callback_account_2, false),
            ],
            data: callback_data,
        };

        // Sign with MXE authority PDA
        let authority_seeds: &[&[u8]] = &[
            MxeConfig::AUTHORITY_SEED,
            &[config.authority_bump],
        ];

        // Pass all required accounts for CPI
        invoke_signed(
            &callback_ix,
            &[
                ctx.accounts.mxe_authority.to_account_info(),
                ctx.accounts.callback_account_1.to_account_info(),
                ctx.accounts.callback_account_2.to_account_info(),
            ],
            &[authority_seeds],
        )?;

        msg!("CPI callback sent to program: {} with accounts: {}, {}",
            request.callback_program,
            request.callback_account_1,
            request.callback_account_2
        );
    }

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
    #[msg("Callback program does not match request")]
    InvalidCallbackProgram,
    #[msg("Callback account does not match stored account")]
    InvalidCallbackAccount,
}
