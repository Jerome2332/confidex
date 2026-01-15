use anchor_lang::prelude::*;
use crate::state::MxeConfig;

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

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeMxe>, cluster_id: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.authority = ctx.accounts.authority.key();
    config.cluster_id = cluster_id;
    config.computation_count = 0;
    config.completed_count = 0;
    config.bump = ctx.bumps.config;

    msg!("MXE initialized with cluster: {}", cluster_id);

    Ok(())
}
