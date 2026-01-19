use anchor_lang::prelude::*;
use crate::state::{MxeConfig, ARCIUM_PROGRAM_ID};

#[derive(Accounts)]
pub struct InitializeMxe<'info> {
    #[account(
        init,
        payer = authority,
        space = MxeConfig::SIZE,
        seeds = [MxeConfig::SEED],
        bump
    )]
    pub config: Account<'info, MxeConfig>,

    /// CHECK: MXE authority PDA for signing callbacks
    #[account(
        seeds = [MxeConfig::AUTHORITY_SEED],
        bump
    )]
    pub mxe_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeMxe>,
    cluster_id: Pubkey,
    cluster_offset: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.authority = ctx.accounts.authority.key();
    config.cluster_id = cluster_id;
    config.cluster_offset = cluster_offset;
    config.arcium_program = ARCIUM_PROGRAM_ID;
    config.computation_count = 0;
    config.completed_count = 0;
    config.authority_bump = ctx.bumps.mxe_authority;
    config.bump = ctx.bumps.config;

    msg!(
        "MXE initialized with cluster: {}, offset: {}, arcium program: {}",
        cluster_id,
        cluster_offset,
        ARCIUM_PROGRAM_ID
    );

    Ok(())
}
