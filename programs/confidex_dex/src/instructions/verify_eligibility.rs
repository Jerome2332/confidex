use anchor_lang::prelude::*;

use crate::cpi::verifier::{verify_eligibility_proof, GROTH16_PROOF_SIZE};
use crate::error::ConfidexError;
use crate::state::{ExchangeState, TraderEligibility};

/// Accounts for verifying trader eligibility via ZK proof
/// This is a separate instruction to avoid stack overflow from large proof in position params
#[derive(Accounts)]
pub struct VerifyEligibility<'info> {
    /// Exchange state containing the blacklist root
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Account<'info, ExchangeState>,

    /// Trader's eligibility account (created if doesn't exist)
    #[account(
        init_if_needed,
        payer = trader,
        space = TraderEligibility::SIZE,
        seeds = [TraderEligibility::SEED, trader.key().as_ref()],
        bump
    )]
    pub eligibility: Account<'info, TraderEligibility>,

    /// CHECK: Sunspot ZK verifier program for eligibility proofs
    pub verifier_program: AccountInfo<'info>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Parameters for verifying eligibility
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VerifyEligibilityParams {
    /// ZK proof of trader eligibility (blacklist non-membership)
    /// 324 bytes - Groth16 proof verified via Sunspot on-chain
    pub eligibility_proof: [u8; GROTH16_PROOF_SIZE],
}

/// Verify a trader's eligibility to trade on the exchange
/// This proves the trader is not on the blacklist using a ZK proof
/// The result is stored in the TraderEligibility account for later use
pub fn handler(ctx: Context<VerifyEligibility>, params: VerifyEligibilityParams) -> Result<()> {
    let clock = Clock::get()?;

    // Verify the ZK proof via Sunspot CPI
    let proof_valid = verify_eligibility_proof(
        &ctx.accounts.verifier_program,
        &params.eligibility_proof,
        &ctx.accounts.exchange.blacklist_root,
        &ctx.accounts.trader.key(),
    )?;

    require!(proof_valid, ConfidexError::EligibilityProofFailed);

    // Update the eligibility account
    let eligibility = &mut ctx.accounts.eligibility;
    eligibility.trader = ctx.accounts.trader.key();
    eligibility.is_verified = true;
    eligibility.verified_blacklist_root = ctx.accounts.exchange.blacklist_root;
    eligibility.verified_at = clock.unix_timestamp;
    eligibility.verification_count = eligibility.verification_count.saturating_add(1);
    eligibility.bump = ctx.bumps.eligibility;

    msg!(
        "Trader eligibility verified: {} (proof #{}, blacklist root: {:?})",
        ctx.accounts.trader.key(),
        eligibility.verification_count,
        &ctx.accounts.exchange.blacklist_root[0..8]
    );

    Ok(())
}

/// Event emitted when eligibility is verified
#[event]
pub struct EligibilityVerified {
    pub trader: Pubkey,
    pub verification_count: u32,
    pub timestamp: i64,
}
