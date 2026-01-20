//! Confidex MXE Program
//!
//! This is the Arcium MXE wrapper for the Confidex DEX. It provides
//! encrypted computation capabilities for order matching, perpetuals,
//! and other operations that require privacy.
//!
//! Architecture:
//! 1. Frontend encrypts values using RescueCipher + x25519
//! 2. DEX program CPIs to this MXE to queue computations
//! 3. MXE queues computation with Arcium network
//! 4. Arcium Arx nodes execute via Cerberus MPC
//! 5. Results come back via callback to DEX
//!
//! Circuits defined in ../encrypted-ixs/src/lib.rs

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// Computation definition offsets (generated from circuit names)
const COMP_DEF_OFFSET_COMPARE_PRICES: u32 = comp_def_offset("compare_prices");
const COMP_DEF_OFFSET_CALCULATE_FILL: u32 = comp_def_offset("calculate_fill");
const COMP_DEF_OFFSET_VERIFY_POSITION_PARAMS: u32 = comp_def_offset("verify_position_params");
const COMP_DEF_OFFSET_CHECK_LIQUIDATION: u32 = comp_def_offset("check_liquidation");
const COMP_DEF_OFFSET_BATCH_LIQUIDATION_CHECK: u32 = comp_def_offset("batch_liquidation_check");
const COMP_DEF_OFFSET_CALCULATE_PNL: u32 = comp_def_offset("calculate_pnl");
const COMP_DEF_OFFSET_CALCULATE_FUNDING: u32 = comp_def_offset("calculate_funding");
const COMP_DEF_OFFSET_ADD_ENCRYPTED: u32 = comp_def_offset("add_encrypted");
const COMP_DEF_OFFSET_SUB_ENCRYPTED: u32 = comp_def_offset("sub_encrypted");
const COMP_DEF_OFFSET_MUL_ENCRYPTED: u32 = comp_def_offset("mul_encrypted");

declare_id!("DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM");

#[arcium_program]
pub mod confidex_mxe {
    use super::*;

    // =============================================================
    // COMPUTATION DEFINITION INITIALIZATION
    // These only need to be called once after deployment
    // =============================================================

    pub fn init_compare_prices_comp_def(ctx: Context<InitComparePricesCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_calculate_fill_comp_def(ctx: Context<InitCalculateFillCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_verify_position_params_comp_def(
        ctx: Context<InitVerifyPositionParamsCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_check_liquidation_comp_def(
        ctx: Context<InitCheckLiquidationCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_batch_liquidation_check_comp_def(
        ctx: Context<InitBatchLiquidationCheckCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_calculate_pnl_comp_def(ctx: Context<InitCalculatePnlCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_calculate_funding_comp_def(
        ctx: Context<InitCalculateFundingCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_add_encrypted_comp_def(ctx: Context<InitAddEncryptedCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_sub_encrypted_comp_def(ctx: Context<InitSubEncryptedCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_mul_encrypted_comp_def(ctx: Context<InitMulEncryptedCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // =============================================================
    // SPOT TRADING OPERATIONS
    // =============================================================

    /// Queue a price comparison for order matching
    ///
    /// Compares buy_price >= sell_price and returns result via callback
    pub fn compare_prices(
        ctx: Context<ComparePrices>,
        computation_offset: u64,
        buy_price_ciphertext: [u8; 32],
        sell_price_ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(buy_price_ciphertext)
            .encrypted_u64(sell_price_ciphertext)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ComparePricesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0, // No priority fee for devnet
        )?;

        Ok(())
    }

    /// Callback for price comparison result
    #[arcium_callback(encrypted_ix = "compare_prices")]
    pub fn compare_prices_callback(
        ctx: Context<ComparePricesCallback>,
        output: SignedComputationOutputs<ComparePricesOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ComparePricesOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Computation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(PriceCompareResult {
            computation_offset: ctx.accounts.computation_account.key(),
            prices_match: result.ciphertexts[0][0] != 0, // First byte of encrypted bool
            nonce: result.nonce.to_le_bytes(),
        });

        Ok(())
    }

    /// Queue fill amount calculation
    pub fn calculate_fill(
        ctx: Context<CalculateFill>,
        computation_offset: u64,
        buy_amount_ciphertext: [u8; 32],
        sell_amount_ciphertext: [u8; 32],
        buy_price_ciphertext: [u8; 32],
        sell_price_ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(buy_amount_ciphertext)
            .encrypted_u64(sell_amount_ciphertext)
            .encrypted_u64(buy_price_ciphertext)
            .encrypted_u64(sell_price_ciphertext)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CalculateFillCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for fill calculation result
    #[arcium_callback(encrypted_ix = "calculate_fill")]
    pub fn calculate_fill_callback(
        ctx: Context<CalculateFillCallback>,
        output: SignedComputationOutputs<CalculateFillOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CalculateFillOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Computation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(FillCalculationResult {
            computation_offset: ctx.accounts.computation_account.key(),
            fill_amount_ciphertext: result.ciphertexts[0], // fill_amount
            buy_fully_filled: result.ciphertexts[1][0] != 0,
            sell_fully_filled: result.ciphertexts[2][0] != 0,
            nonce: result.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // =============================================================
    // PERPETUALS OPERATIONS
    // =============================================================

    /// Queue position parameter verification
    pub fn verify_position_params(
        ctx: Context<VerifyPositionParams>,
        computation_offset: u64,
        entry_price_ciphertext: [u8; 32],
        leverage: u8,
        mm_bps: u16,
        is_long: bool,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(entry_price_ciphertext)
            .plaintext_u8(leverage)
            .plaintext_u16(mm_bps)
            .plaintext_bool(is_long)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![VerifyPositionParamsCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for position parameter verification
    #[arcium_callback(encrypted_ix = "verify_position_params")]
    pub fn verify_position_params_callback(
        ctx: Context<VerifyPositionParamsCallback>,
        output: SignedComputationOutputs<VerifyPositionParamsOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(VerifyPositionParamsOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Computation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(PositionParamsVerified {
            computation_offset: ctx.accounts.computation_account.key(),
            liq_threshold_ciphertext: result.ciphertexts[0],
            nonce: result.nonce.to_le_bytes(),
        });

        Ok(())
    }

    /// Queue single liquidation check
    pub fn check_liquidation(
        ctx: Context<CheckLiquidation>,
        computation_offset: u64,
        liq_threshold_ciphertext: [u8; 32],
        mark_price: u64,
        is_long: bool,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(liq_threshold_ciphertext)
            .plaintext_u64(mark_price)
            .plaintext_bool(is_long)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CheckLiquidationCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for liquidation check
    #[arcium_callback(encrypted_ix = "check_liquidation")]
    pub fn check_liquidation_callback(
        ctx: Context<CheckLiquidationCallback>,
        output: SignedComputationOutputs<CheckLiquidationOutput>,
    ) -> Result<()> {
        // The result is a revealed bool, not encrypted
        let should_liquidate = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckLiquidationOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Computation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(LiquidationCheckResult {
            computation_offset: ctx.accounts.computation_account.key(),
            should_liquidate,
        });

        Ok(())
    }

    /// Queue batch liquidation check (up to 10 positions)
    pub fn batch_liquidation_check(
        ctx: Context<BatchLiquidationCheck>,
        computation_offset: u64,
        thresholds: [[u8; 32]; 10],
        is_long: [bool; 10],
        count: u8,
        mark_price: u64,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let mut builder = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce);

        // Add all 10 thresholds
        for threshold in thresholds.iter() {
            builder = builder.encrypted_u64(*threshold);
        }

        // Add all 10 is_long flags
        for flag in is_long.iter() {
            builder = builder.plaintext_bool(*flag);
        }

        builder = builder.plaintext_u8(count).plaintext_u64(mark_price);

        let args = builder.build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![BatchLiquidationCheckCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for batch liquidation check
    #[arcium_callback(encrypted_ix = "batch_liquidation_check")]
    pub fn batch_liquidation_check_callback(
        ctx: Context<BatchLiquidationCheckCallback>,
        output: SignedComputationOutputs<BatchLiquidationCheckOutput>,
    ) -> Result<()> {
        // The output is a struct with 10 revealed bools wrapped in field_0
        let results = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(BatchLiquidationCheckOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Computation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(BatchLiquidationResult {
            computation_offset: ctx.accounts.computation_account.key(),
            r0: results.field_0,
            r1: results.field_1,
            r2: results.field_2,
            r3: results.field_3,
            r4: results.field_4,
            r5: results.field_5,
            r6: results.field_6,
            r7: results.field_7,
            r8: results.field_8,
            r9: results.field_9,
        });

        Ok(())
    }

    /// Queue PnL calculation
    pub fn calculate_pnl(
        ctx: Context<CalculatePnl>,
        computation_offset: u64,
        size_ciphertext: [u8; 32],
        entry_price_ciphertext: [u8; 32],
        exit_price: u64,
        is_long: bool,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(size_ciphertext)
            .encrypted_u64(entry_price_ciphertext)
            .plaintext_u64(exit_price)
            .plaintext_bool(is_long)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CalculatePnlCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for PnL calculation
    #[arcium_callback(encrypted_ix = "calculate_pnl")]
    pub fn calculate_pnl_callback(
        ctx: Context<CalculatePnlCallback>,
        output: SignedComputationOutputs<CalculatePnlOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CalculatePnlOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Computation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(PnlCalculationResult {
            computation_offset: ctx.accounts.computation_account.key(),
            pnl_ciphertext: result.ciphertexts[0],
            is_loss: result.ciphertexts[1][0] != 0,
            nonce: result.nonce.to_le_bytes(),
        });

        Ok(())
    }

    /// Queue funding calculation
    pub fn calculate_funding(
        ctx: Context<CalculateFunding>,
        computation_offset: u64,
        size_ciphertext: [u8; 32],
        funding_rate_bps: i64,
        time_delta_secs: u64,
        is_long: bool,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(size_ciphertext)
            .plaintext_i64(funding_rate_bps)
            .plaintext_u64(time_delta_secs)
            .plaintext_bool(is_long)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CalculateFundingCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for funding calculation
    #[arcium_callback(encrypted_ix = "calculate_funding")]
    pub fn calculate_funding_callback(
        ctx: Context<CalculateFundingCallback>,
        output: SignedComputationOutputs<CalculateFundingOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CalculateFundingOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Computation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(FundingCalculationResult {
            computation_offset: ctx.accounts.computation_account.key(),
            funding_amount_ciphertext: result.ciphertexts[0],
            is_paying: result.ciphertexts[1][0] != 0,
            nonce: result.nonce.to_le_bytes(),
        });

        Ok(())
    }
}

// =============================================================
// EVENTS
// =============================================================

#[event]
pub struct PriceCompareResult {
    pub computation_offset: Pubkey,
    pub prices_match: bool,
    pub nonce: [u8; 16],
}

#[event]
pub struct FillCalculationResult {
    pub computation_offset: Pubkey,
    pub fill_amount_ciphertext: [u8; 32],
    pub buy_fully_filled: bool,
    pub sell_fully_filled: bool,
    pub nonce: [u8; 16],
}

#[event]
pub struct PositionParamsVerified {
    pub computation_offset: Pubkey,
    pub liq_threshold_ciphertext: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct LiquidationCheckResult {
    pub computation_offset: Pubkey,
    pub should_liquidate: bool,
}

#[event]
pub struct BatchLiquidationResult {
    pub computation_offset: Pubkey,
    pub r0: bool,
    pub r1: bool,
    pub r2: bool,
    pub r3: bool,
    pub r4: bool,
    pub r5: bool,
    pub r6: bool,
    pub r7: bool,
    pub r8: bool,
    pub r9: bool,
}

#[event]
pub struct PnlCalculationResult {
    pub computation_offset: Pubkey,
    pub pnl_ciphertext: [u8; 32],
    pub is_loss: bool,
    pub nonce: [u8; 16],
}

#[event]
pub struct FundingCalculationResult {
    pub computation_offset: Pubkey,
    pub funding_amount_ciphertext: [u8; 32],
    pub is_paying: bool,
    pub nonce: [u8; 16],
}

// =============================================================
// ERRORS
// =============================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Computation was aborted or failed verification")]
    AbortedComputation,
    #[msg("MXE cluster is not set")]
    ClusterNotSet,
}

// =============================================================
// ACCOUNT STRUCTURES
// =============================================================

// Init computation definition accounts
#[init_computation_definition_accounts("compare_prices", payer)]
#[derive(Accounts)]
pub struct InitComparePricesCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("calculate_fill", payer)]
#[derive(Accounts)]
pub struct InitCalculateFillCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("verify_position_params", payer)]
#[derive(Accounts)]
pub struct InitVerifyPositionParamsCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("check_liquidation", payer)]
#[derive(Accounts)]
pub struct InitCheckLiquidationCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("batch_liquidation_check", payer)]
#[derive(Accounts)]
pub struct InitBatchLiquidationCheckCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("calculate_pnl", payer)]
#[derive(Accounts)]
pub struct InitCalculatePnlCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("calculate_funding", payer)]
#[derive(Accounts)]
pub struct InitCalculateFundingCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("add_encrypted", payer)]
#[derive(Accounts)]
pub struct InitAddEncryptedCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("sub_encrypted", payer)]
#[derive(Accounts)]
pub struct InitSubEncryptedCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("mul_encrypted", payer)]
#[derive(Accounts)]
pub struct InitMulEncryptedCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: comp_def_account initialized via CPI
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// Queue computation accounts
#[queue_computation_accounts("compare_prices", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ComparePrices<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: mempool_account checked by arcium program
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool checked by arcium program
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account checked by arcium program
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::AbortedComputation))]
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPARE_PRICES))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("calculate_fill", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CalculateFill<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: mempool_account checked by arcium program
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool checked by arcium program
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account checked by arcium program
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::AbortedComputation))]
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_FILL))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("verify_position_params", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct VerifyPositionParams<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: mempool_account checked by arcium program
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool checked by arcium program
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account checked by arcium program
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::AbortedComputation))]
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VERIFY_POSITION_PARAMS))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("check_liquidation", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckLiquidation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: mempool_account checked by arcium program
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool checked by arcium program
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account checked by arcium program
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::AbortedComputation))]
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_LIQUIDATION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("batch_liquidation_check", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct BatchLiquidationCheck<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: mempool_account checked by arcium program
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool checked by arcium program
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account checked by arcium program
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::AbortedComputation))]
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BATCH_LIQUIDATION_CHECK))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("calculate_pnl", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CalculatePnl<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: mempool_account checked by arcium program
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool checked by arcium program
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account checked by arcium program
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::AbortedComputation))]
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_PNL))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("calculate_funding", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CalculateFunding<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: mempool_account checked by arcium program
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool checked by arcium program
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account checked by arcium program
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::AbortedComputation))]
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_FUNDING))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// Callback accounts
#[callback_accounts("compare_prices")]
#[derive(Accounts)]
pub struct ComparePricesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPARE_PRICES))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account checked by arcium program via constraints
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar checked by account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("calculate_fill")]
#[derive(Accounts)]
pub struct CalculateFillCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_FILL))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account checked by arcium program via constraints
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar checked by account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("verify_position_params")]
#[derive(Accounts)]
pub struct VerifyPositionParamsCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VERIFY_POSITION_PARAMS))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account checked by arcium program via constraints
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar checked by account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("check_liquidation")]
#[derive(Accounts)]
pub struct CheckLiquidationCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_LIQUIDATION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account checked by arcium program via constraints
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar checked by account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("batch_liquidation_check")]
#[derive(Accounts)]
pub struct BatchLiquidationCheckCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BATCH_LIQUIDATION_CHECK))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account checked by arcium program via constraints
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar checked by account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("calculate_pnl")]
#[derive(Accounts)]
pub struct CalculatePnlCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_PNL))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account checked by arcium program via constraints
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar checked by account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("calculate_funding")]
#[derive(Accounts)]
pub struct CalculateFundingCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_FUNDING))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account checked by arcium program via constraints
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::AbortedComputation))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar checked by account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}
