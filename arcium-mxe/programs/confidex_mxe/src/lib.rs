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
//! 5. MXE callback receives result, calls verify_output(), then CPIs to DEX
//!
//! IMPORTANT: All MPC results are verified via output.verify_output() before
//! being passed to the DEX. This is a CRITICAL security requirement per Arcium docs.
//!
//! Circuits defined in ../encrypted-ixs/src/lib.rs
//!
//! IMPORTANT: Circuit bytecode is stored offchain to avoid excessive on-chain costs.
//! Arx nodes fetch circuits from CIRCUIT_BASE_URL and verify via circuit_hash! macro.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

/// Base URL for offchain circuit storage (GitHub Releases)
///
/// Arx nodes will fetch {CIRCUIT_BASE_URL}/{circuit_name}.arcis and verify against circuit_hash!
const CIRCUIT_BASE_URL: &str = "https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits";

/// DEX Program ID (must match confidex_dex program)
/// Base58: 63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB
/// Note: These bytes were corrected on 2026-01-28 - previous bytes were wrong
const DEX_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x4a, 0xf5, 0x1f, 0x1c, 0x8e, 0x5d, 0x88, 0x92,
    0x55, 0x2d, 0xce, 0x32, 0x61, 0xe8, 0x26, 0xe8,
    0xfd, 0x18, 0xd2, 0xc3, 0xde, 0xb4, 0xe1, 0x75,
    0x52, 0x51, 0xe1, 0x1e, 0xf3, 0x7b, 0xe3, 0x78,
]);

/// MXE authority PDA seed (for signing CPIs to DEX)
const MXE_AUTHORITY_SEED: &[u8] = b"mxe_authority";

/// DEX finalize_match instruction discriminator
/// sha256("global:finalize_match")[0..8] = 06672f07420155cf
const DEX_FINALIZE_MATCH_DISCRIMINATOR: [u8; 8] = [0x06, 0x67, 0x2f, 0x07, 0x42, 0x01, 0x55, 0xcf];

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
const COMP_DEF_OFFSET_CHECK_BALANCE: u32 = comp_def_offset("check_balance");
const COMP_DEF_OFFSET_CHECK_ORDER_BALANCE: u32 = comp_def_offset("check_order_balance");
const COMP_DEF_OFFSET_DECRYPT_FOR_SETTLEMENT: u32 = comp_def_offset("decrypt_for_settlement");
const COMP_DEF_OFFSET_CALCULATE_REFUND: u32 = comp_def_offset("calculate_refund");
const COMP_DEF_OFFSET_BATCH_COMPARE_PRICES: u32 = comp_def_offset("batch_compare_prices");
const COMP_DEF_OFFSET_BATCH_CALCULATE_FILL: u32 = comp_def_offset("batch_calculate_fill");

/// DEX settle_order_callback instruction discriminator
/// sha256("global:settle_order_callback")[0..8]
const DEX_SETTLE_ORDER_CALLBACK_DISCRIMINATOR: [u8; 8] = [0x8d, 0x47, 0x94, 0x0c, 0x9f, 0x81, 0xa2, 0xe3];

/// DEX cancel_order_callback instruction discriminator
/// sha256("global:cancel_order_callback")[0..8]
const DEX_CANCEL_ORDER_CALLBACK_DISCRIMINATOR: [u8; 8] = [0xa3, 0xc2, 0x1f, 0x67, 0x8b, 0x4e, 0xd9, 0x12];

declare_id!("4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi");

#[arcium_program]
pub mod confidex_mxe {
    use super::*;

    // =============================================================
    // COMPUTATION DEFINITION INITIALIZATION
    // These only need to be called once after deployment
    // Circuits are stored offchain and verified via circuit_hash! macro
    // =============================================================

    pub fn init_compare_prices_comp_def(ctx: Context<InitComparePricesCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/compare_prices.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("compare_prices"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_calculate_fill_comp_def(ctx: Context<InitCalculateFillCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/calculate_fill.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("calculate_fill"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_verify_position_params_comp_def(
        ctx: Context<InitVerifyPositionParamsCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/verify_position_params.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("verify_position_params"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_check_liquidation_comp_def(
        ctx: Context<InitCheckLiquidationCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/check_liquidation.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("check_liquidation"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_batch_liquidation_check_comp_def(
        ctx: Context<InitBatchLiquidationCheckCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/batch_liquidation_check.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("batch_liquidation_check"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_calculate_pnl_comp_def(ctx: Context<InitCalculatePnlCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/calculate_pnl.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("calculate_pnl"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_calculate_funding_comp_def(
        ctx: Context<InitCalculateFundingCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/calculate_funding.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("calculate_funding"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_add_encrypted_comp_def(ctx: Context<InitAddEncryptedCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/add_encrypted.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("add_encrypted"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_sub_encrypted_comp_def(ctx: Context<InitSubEncryptedCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/sub_encrypted.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("sub_encrypted"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_mul_encrypted_comp_def(ctx: Context<InitMulEncryptedCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/mul_encrypted.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("mul_encrypted"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_check_balance_comp_def(ctx: Context<InitCheckBalanceCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/check_balance.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("check_balance"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_check_order_balance_comp_def(
        ctx: Context<InitCheckOrderBalanceCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/check_order_balance.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("check_order_balance"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_decrypt_for_settlement_comp_def(
        ctx: Context<InitDecryptForSettlementCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/decrypt_for_settlement.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("decrypt_for_settlement"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_calculate_refund_comp_def(
        ctx: Context<InitCalculateRefundCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/calculate_refund.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("calculate_refund"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_batch_compare_prices_comp_def(
        ctx: Context<InitBatchComparePricesCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/batch_compare_prices.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("batch_compare_prices"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_batch_calculate_fill_comp_def(
        ctx: Context<InitBatchCalculateFillCompDef>,
    ) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/batch_calculate_fill.arcis", CIRCUIT_BASE_URL),
                hash: circuit_hash!("batch_calculate_fill"),
            })),
            None,
        )?;
        Ok(())
    }

    // =============================================================
    // SPOT TRADING OPERATIONS
    // =============================================================

    /// Queue a price comparison for order matching
    ///
    /// Compares buy_price >= sell_price and returns result via callback.
    /// If buy_order and sell_order are provided, the callback will CPI to DEX.
    pub fn compare_prices(
        ctx: Context<ComparePrices>,
        computation_offset: u64,
        buy_price_ciphertext: [u8; 32],
        sell_price_ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
        // Optional: DEX order pubkeys for CPI callback
        buy_order: Option<Pubkey>,
        sell_order: Option<Pubkey>,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(buy_price_ciphertext)
            .encrypted_u64(sell_price_ciphertext)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build callback accounts - include DEX order accounts if provided
        let mut callback_accounts = Vec::new();

        // If order pubkeys provided, add accounts needed for CPI to DEX
        if let (Some(buy), Some(sell)) = (buy_order, sell_order) {
            // MXE authority PDA for signing CPI to DEX
            let (mxe_authority, _) = Pubkey::find_program_address(
                &[MXE_AUTHORITY_SEED],
                ctx.program_id,
            );
            callback_accounts.push(CallbackAccount {
                pubkey: mxe_authority,
                is_writable: false,
            });
            callback_accounts.push(CallbackAccount {
                pubkey: buy,
                is_writable: true,
            });
            callback_accounts.push(CallbackAccount {
                pubkey: sell,
                is_writable: true,
            });
            // CRITICAL: Include DEX program ID so callback can CPI to it
            callback_accounts.push(CallbackAccount {
                pubkey: DEX_PROGRAM_ID,
                is_writable: false,
            });
        }

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ComparePricesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0, // No priority fee for devnet
        )?;

        Ok(())
    }

    /// Callback for price comparison result
    ///
    /// SECURITY: This callback performs cryptographic verification via verify_output()
    /// before CPI-ing to DEX. This ensures MPC results are authentic.
    #[arcium_callback(encrypted_ix = "compare_prices")]
    pub fn compare_prices_callback(
        ctx: Context<ComparePricesCallback>,
        output: SignedComputationOutputs<ComparePricesOutput>,
    ) -> Result<()> {
        // CRITICAL: Verify MPC output cryptographically
        // This checks signatures from the MPC cluster to ensure the result is authentic
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

        let prices_match = result.ciphertexts[0][0] != 0; // First byte of encrypted bool

        // Emit event for monitoring (backend can still subscribe)
        emit!(PriceCompareResult {
            computation_offset: ctx.accounts.computation_account.key(),
            prices_match,
            nonce: result.nonce.to_le_bytes(),
        });

        // If order accounts are provided, CPI to DEX to update orders
        // This provides on-chain verification that the MPC result was authentic
        if ctx.remaining_accounts.len() >= 4 {
            // remaining_accounts[0] = MXE authority account (UncheckedAccount for PDA signing)
            // remaining_accounts[1] = buy_order
            // remaining_accounts[2] = sell_order
            // remaining_accounts[3] = DEX program (CRITICAL: needed for CPI target)
            let mxe_authority_info = &ctx.remaining_accounts[0];
            let buy_order = &ctx.remaining_accounts[1];
            let sell_order = &ctx.remaining_accounts[2];
            let dex_program_info = &ctx.remaining_accounts[3];

            // Verify DEX program matches expected
            require!(
                *dex_program_info.key == DEX_PROGRAM_ID,
                ErrorCode::AbortedComputation
            );

            // Derive MXE authority PDA for signing
            let (expected_mxe_authority, bump) = Pubkey::find_program_address(
                &[MXE_AUTHORITY_SEED],
                ctx.program_id,
            );

            // Verify the passed account matches the derived PDA
            require!(
                *mxe_authority_info.key == expected_mxe_authority,
                ErrorCode::AbortedComputation
            );

            // Build request_id from computation account
            let request_id = ctx.accounts.computation_account.key().to_bytes();

            // Build result: 1 byte for prices_match
            let result_data = vec![if prices_match { 1u8 } else { 0u8 }];

            // Build CPI to DEX finalize_match
            let mut ix_data = Vec::with_capacity(8 + 32 + 4 + result_data.len());
            ix_data.extend_from_slice(&DEX_FINALIZE_MATCH_DISCRIMINATOR);
            ix_data.extend_from_slice(&request_id);
            ix_data.extend_from_slice(&(result_data.len() as u32).to_le_bytes());
            ix_data.extend_from_slice(&result_data);

            let ix = Instruction {
                program_id: DEX_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new_readonly(expected_mxe_authority, true), // MXE authority (signer)
                    AccountMeta::new(*buy_order.key, false),        // buy_order
                    AccountMeta::new(*sell_order.key, false),       // sell_order
                ],
                data: ix_data,
            };

            // Sign with MXE authority PDA
            let seeds: &[&[u8]] = &[MXE_AUTHORITY_SEED, &[bump]];
            let signer_seeds = &[seeds];

            // NOTE: The dex_program_info must be included in account_infos for invoke_signed
            // even though it's the target of the CPI - this is how Solana runtime resolves the program
            invoke_signed(
                &ix,
                &[
                    mxe_authority_info.clone(),
                    buy_order.clone(),
                    sell_order.clone(),
                    dex_program_info.clone(),
                ],
                signer_seeds,
            )?;

            msg!("CPI to DEX finalize_match complete: prices_match={}", prices_match);
        }

        Ok(())
    }

    /// Queue fill amount calculation
    ///
    /// If buy_order and sell_order are provided, the callback will CPI to DEX.
    pub fn calculate_fill(
        ctx: Context<CalculateFill>,
        computation_offset: u64,
        buy_amount_ciphertext: [u8; 32],
        sell_amount_ciphertext: [u8; 32],
        buy_price_ciphertext: [u8; 32],
        sell_price_ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
        // Optional: DEX order pubkeys for CPI callback
        buy_order: Option<Pubkey>,
        sell_order: Option<Pubkey>,
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

        // Build callback accounts - include DEX order accounts if provided
        let mut callback_accounts = Vec::new();

        // If order pubkeys provided, add accounts needed for CPI to DEX
        if let (Some(buy), Some(sell)) = (buy_order, sell_order) {
            // MXE authority PDA for signing CPI to DEX
            let (mxe_authority, _) = Pubkey::find_program_address(
                &[MXE_AUTHORITY_SEED],
                ctx.program_id,
            );
            callback_accounts.push(CallbackAccount {
                pubkey: mxe_authority,
                is_writable: false,
            });
            callback_accounts.push(CallbackAccount {
                pubkey: buy,
                is_writable: true,
            });
            callback_accounts.push(CallbackAccount {
                pubkey: sell,
                is_writable: true,
            });
            // CRITICAL: Include DEX program ID so callback can CPI to it
            callback_accounts.push(CallbackAccount {
                pubkey: DEX_PROGRAM_ID,
                is_writable: false,
            });
        }

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CalculateFillCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for fill calculation result
    ///
    /// SECURITY: This callback performs cryptographic verification via verify_output()
    /// before CPI-ing to DEX. This ensures MPC results are authentic.
    #[arcium_callback(encrypted_ix = "calculate_fill")]
    pub fn calculate_fill_callback(
        ctx: Context<CalculateFillCallback>,
        output: SignedComputationOutputs<CalculateFillOutput>,
    ) -> Result<()> {
        // CRITICAL: Verify MPC output cryptographically
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

        let fill_amount_ciphertext = result.ciphertexts[0];
        let buy_fully_filled = result.ciphertexts[1][0] != 0;
        let sell_fully_filled = result.ciphertexts[2][0] != 0;

        // Emit event for monitoring
        emit!(FillCalculationResult {
            computation_offset: ctx.accounts.computation_account.key(),
            fill_amount_ciphertext,
            buy_fully_filled,
            sell_fully_filled,
            nonce: result.nonce.to_le_bytes(),
        });

        // If order accounts are provided, CPI to DEX to update orders
        if ctx.remaining_accounts.len() >= 4 {
            // remaining_accounts[0] = MXE authority account (UncheckedAccount for PDA signing)
            // remaining_accounts[1] = buy_order
            // remaining_accounts[2] = sell_order
            // remaining_accounts[3] = DEX program (CRITICAL: needed for CPI target)
            let mxe_authority_info = &ctx.remaining_accounts[0];
            let buy_order = &ctx.remaining_accounts[1];
            let sell_order = &ctx.remaining_accounts[2];
            let dex_program_info = &ctx.remaining_accounts[3];

            // Verify DEX program matches expected
            require!(
                *dex_program_info.key == DEX_PROGRAM_ID,
                ErrorCode::AbortedComputation
            );

            // Derive MXE authority PDA for signing
            let (expected_mxe_authority, bump) = Pubkey::find_program_address(
                &[MXE_AUTHORITY_SEED],
                ctx.program_id,
            );

            // Verify the passed account matches the derived PDA
            require!(
                *mxe_authority_info.key == expected_mxe_authority,
                ErrorCode::AbortedComputation
            );

            let request_id = ctx.accounts.computation_account.key().to_bytes();

            // Build result: 64 bytes fill + 1 byte buy_filled + 1 byte sell_filled
            let mut result_data = Vec::with_capacity(66);
            result_data.extend_from_slice(&fill_amount_ciphertext);
            result_data.push(if buy_fully_filled { 1u8 } else { 0u8 });
            result_data.push(if sell_fully_filled { 1u8 } else { 0u8 });

            // Build CPI to DEX finalize_match (or receive_fill_result)
            let mut ix_data = Vec::with_capacity(8 + 32 + 4 + result_data.len());
            ix_data.extend_from_slice(&DEX_FINALIZE_MATCH_DISCRIMINATOR);
            ix_data.extend_from_slice(&request_id);
            ix_data.extend_from_slice(&(result_data.len() as u32).to_le_bytes());
            ix_data.extend_from_slice(&result_data);

            let ix = Instruction {
                program_id: DEX_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new_readonly(expected_mxe_authority, true),
                    AccountMeta::new(*buy_order.key, false),
                    AccountMeta::new(*sell_order.key, false),
                ],
                data: ix_data,
            };

            let seeds: &[&[u8]] = &[MXE_AUTHORITY_SEED, &[bump]];
            let signer_seeds = &[seeds];

            // NOTE: The dex_program_info must be included in account_infos for invoke_signed
            // even though it's the target of the CPI - this is how Solana runtime resolves the program
            invoke_signed(
                &ix,
                &[
                    mxe_authority_info.clone(),
                    buy_order.clone(),
                    sell_order.clone(),
                    dex_program_info.clone(),
                ],
                signer_seeds,
            )?;

            msg!("CPI to DEX finalize_match complete: buy_filled={}, sell_filled={}",
                 buy_fully_filled, sell_fully_filled);
        }

        Ok(())
    }

    // =============================================================
    // BATCH SPOT TRADING OPERATIONS
    // =============================================================

    /// Queue batch price comparison for up to 5 order pairs
    ///
    /// More efficient than 5 separate compare_prices calls.
    /// Results are revealed since match/no-match is public information.
    pub fn batch_compare_prices(
        ctx: Context<BatchComparePrices>,
        computation_offset: u64,
        buy_prices: [[u8; 32]; 5],
        sell_prices: [[u8; 32]; 5],
        pub_key: [u8; 32],
        nonce: u128,
        count: u8,
    ) -> Result<()> {
        require!(count > 0 && count <= 5, ErrorCode::AbortedComputation);

        let mut args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce);

        // Add all buy prices
        for price in buy_prices.iter() {
            args = args.encrypted_u64(*price);
        }
        // Add all sell prices
        for price in sell_prices.iter() {
            args = args.encrypted_u64(*price);
        }
        // Add count
        args = args.plaintext_u8(count);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args.build(),
            None,
            vec![BatchComparePricesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[], // No CPI callback - just emit event
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for batch price comparison result
    #[arcium_callback(encrypted_ix = "batch_compare_prices")]
    pub fn batch_compare_prices_callback(
        ctx: Context<BatchComparePricesCallback>,
        output: SignedComputationOutputs<BatchComparePricesOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(BatchComparePricesOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Batch price compare verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // Extract match results
        let matches = [
            result.field_0,
            result.field_1,
            result.field_2,
            result.field_3,
            result.field_4,
        ];

        emit!(BatchPriceCompareResult {
            computation_offset: ctx.accounts.computation_account.key(),
            matches,
        });

        Ok(())
    }

    /// Queue batch fill calculation for up to 5 order pairs
    ///
    /// More efficient than 5 separate calculate_fill calls.
    pub fn batch_calculate_fill(
        ctx: Context<BatchCalculateFill>,
        computation_offset: u64,
        buy_amounts: [[u8; 32]; 5],
        sell_amounts: [[u8; 32]; 5],
        buy_prices: [[u8; 32]; 5],
        sell_prices: [[u8; 32]; 5],
        pub_key: [u8; 32],
        nonce: u128,
        count: u8,
    ) -> Result<()> {
        require!(count > 0 && count <= 5, ErrorCode::AbortedComputation);

        let mut args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce);

        // Add buy amounts, sell amounts, buy prices, sell prices
        for amt in buy_amounts.iter() {
            args = args.encrypted_u64(*amt);
        }
        for amt in sell_amounts.iter() {
            args = args.encrypted_u64(*amt);
        }
        for price in buy_prices.iter() {
            args = args.encrypted_u64(*price);
        }
        for price in sell_prices.iter() {
            args = args.encrypted_u64(*price);
        }
        // Add count
        args = args.plaintext_u8(count);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args.build(),
            None,
            vec![BatchCalculateFillCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[], // No CPI callback - just emit event
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for batch fill calculation result
    #[arcium_callback(encrypted_ix = "batch_calculate_fill")]
    pub fn batch_calculate_fill_callback(
        ctx: Context<BatchCalculateFillCallback>,
        output: SignedComputationOutputs<BatchCalculateFillOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(BatchCalculateFillOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Batch fill calculation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // Extract fill amounts (encrypted)
        let fills = [
            result.ciphertexts[0],
            result.ciphertexts[1],
            result.ciphertexts[2],
            result.ciphertexts[3],
            result.ciphertexts[4],
        ];

        // Extract filled flags from ciphertexts array
        // The struct has fills[5], buy_filled[5], sell_filled[5]
        // After fills, we have 5 more for buy_filled, 5 more for sell_filled
        let buy_filled = [
            result.ciphertexts[5][0] != 0,
            result.ciphertexts[6][0] != 0,
            result.ciphertexts[7][0] != 0,
            result.ciphertexts[8][0] != 0,
            result.ciphertexts[9][0] != 0,
        ];
        let sell_filled = [
            result.ciphertexts[10][0] != 0,
            result.ciphertexts[11][0] != 0,
            result.ciphertexts[12][0] != 0,
            result.ciphertexts[13][0] != 0,
            result.ciphertexts[14][0] != 0,
        ];

        emit!(BatchFillCalculationResult {
            computation_offset: ctx.accounts.computation_account.key(),
            fills,
            buy_filled,
            sell_filled,
            nonce: result.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // =============================================================
    // BALANCE VALIDATION OPERATIONS
    // =============================================================

    /// Queue a simple balance check (balance >= required)
    ///
    /// Returns true if the user has sufficient balance for the operation.
    /// Used for pre-order validation to ensure users can't place orders
    /// they can't fulfill.
    pub fn check_balance(
        ctx: Context<CheckBalance>,
        computation_offset: u64,
        balance_ciphertext: [u8; 32],
        required_ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
        // Optional: user account for CPI callback
        user_account: Option<Pubkey>,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(balance_ciphertext)
            .encrypted_u64(required_ciphertext)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut callback_accounts = Vec::new();
        if let Some(user) = user_account {
            callback_accounts.push(CallbackAccount {
                pubkey: user,
                is_writable: false,
            });
        }

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CheckBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for balance check result
    #[arcium_callback(encrypted_ix = "check_balance")]
    pub fn check_balance_callback(
        ctx: Context<CheckBalanceCallback>,
        output: SignedComputationOutputs<CheckBalanceOutput>,
    ) -> Result<()> {
        // The result is a revealed bool
        let sufficient = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckBalanceOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Balance check verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(BalanceCheckResult {
            computation_offset: ctx.accounts.computation_account.key(),
            sufficient,
        });

        Ok(())
    }

    /// Queue an order-specific balance check
    ///
    /// For buy orders: checks balance >= (amount * price / PRICE_SCALE)
    /// For sell orders: checks balance >= amount
    ///
    /// This is more efficient than computing the required amount client-side
    /// and then calling check_balance, since it's all done in MPC.
    pub fn check_order_balance(
        ctx: Context<CheckOrderBalance>,
        computation_offset: u64,
        balance_ciphertext: [u8; 32],
        order_amount_ciphertext: [u8; 32],
        order_price_ciphertext: [u8; 32],
        is_buy: bool,
        pub_key: [u8; 32],
        nonce: u128,
        // Optional: order account for CPI callback
        order_account: Option<Pubkey>,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(balance_ciphertext)
            .encrypted_u64(order_amount_ciphertext)
            .encrypted_u64(order_price_ciphertext)
            .plaintext_bool(is_buy)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut callback_accounts = Vec::new();
        if let Some(order) = order_account {
            callback_accounts.push(CallbackAccount {
                pubkey: order,
                is_writable: true,
            });
        }

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CheckOrderBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for order balance check result
    #[arcium_callback(encrypted_ix = "check_order_balance")]
    pub fn check_order_balance_callback(
        ctx: Context<CheckOrderBalanceCallback>,
        output: SignedComputationOutputs<CheckOrderBalanceOutput>,
    ) -> Result<()> {
        // The result is a revealed bool
        let sufficient = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckOrderBalanceOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Order balance check verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(OrderBalanceCheckResult {
            computation_offset: ctx.accounts.computation_account.key(),
            sufficient,
        });

        // TODO: If order account is provided and balance is insufficient,
        // CPI to DEX to reject/cancel the order

        Ok(())
    }

    // =============================================================
    // SETTLEMENT OPERATIONS
    // =============================================================

    /// Queue settlement decryption
    ///
    /// Reveals fill amount and price for settlement transfer calculation.
    /// The callback will CPI to DEX with the revealed values.
    ///
    /// SECURITY: Only the MXE authority can trigger settlement, and values
    /// are NOT emitted in events (only passed via CPI to DEX).
    pub fn decrypt_for_settlement(
        ctx: Context<DecryptForSettlement>,
        computation_offset: u64,
        fill_ciphertext: [u8; 32],
        price_ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
        // Required: Settlement accounts for CPI callback
        buy_order: Pubkey,
        sell_order: Pubkey,
        pair: Pubkey,
        buyer_base_balance: Pubkey,
        buyer_quote_balance: Pubkey,
        seller_base_balance: Pubkey,
        seller_quote_balance: Pubkey,
        fee_recipient_balance: Pubkey,
        exchange: Pubkey,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(fill_ciphertext)
            .encrypted_u64(price_ciphertext)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build callback accounts for settlement CPI
        let (mxe_authority, _) = Pubkey::find_program_address(
            &[MXE_AUTHORITY_SEED],
            ctx.program_id,
        );

        let callback_accounts = vec![
            CallbackAccount { pubkey: mxe_authority, is_writable: false },
            CallbackAccount { pubkey: buy_order, is_writable: true },
            CallbackAccount { pubkey: sell_order, is_writable: true },
            CallbackAccount { pubkey: pair, is_writable: false },
            CallbackAccount { pubkey: buyer_base_balance, is_writable: true },
            CallbackAccount { pubkey: buyer_quote_balance, is_writable: true },
            CallbackAccount { pubkey: seller_base_balance, is_writable: true },
            CallbackAccount { pubkey: seller_quote_balance, is_writable: true },
            CallbackAccount { pubkey: fee_recipient_balance, is_writable: true },
            CallbackAccount { pubkey: exchange, is_writable: false },
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![DecryptForSettlementCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for settlement decryption
    ///
    /// Receives revealed fill_amount and price from MPC, then CPIs to DEX
    /// to execute the settlement with the decrypted values.
    #[arcium_callback(encrypted_ix = "decrypt_for_settlement")]
    pub fn decrypt_for_settlement_callback(
        ctx: Context<DecryptForSettlementCallback>,
        output: SignedComputationOutputs<DecryptForSettlementOutput>,
    ) -> Result<()> {
        // Verify and extract revealed values
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(DecryptForSettlementOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Settlement decryption verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // The result contains revealed fill_amount and price
        let fill_amount = result.field_0; // fill_amount from struct
        let price = result.field_1;       // price from struct

        // Emit minimal event (NO amounts for privacy)
        emit!(SettlementDecryptionResult {
            computation_offset: ctx.accounts.computation_account.key(),
        });

        // CPI to DEX settle_order_callback with revealed values
        // remaining_accounts[0] = MXE authority
        // remaining_accounts[1] = buy_order
        // remaining_accounts[2] = sell_order
        // remaining_accounts[3] = pair
        // remaining_accounts[4] = buyer_base_balance
        // remaining_accounts[5] = buyer_quote_balance
        // remaining_accounts[6] = seller_base_balance
        // remaining_accounts[7] = seller_quote_balance
        // remaining_accounts[8] = fee_recipient_balance
        // remaining_accounts[9] = exchange
        if ctx.remaining_accounts.len() >= 10 {
            let mxe_authority_info = &ctx.remaining_accounts[0];
            let buy_order = &ctx.remaining_accounts[1];
            let sell_order = &ctx.remaining_accounts[2];
            let pair = &ctx.remaining_accounts[3];
            let buyer_base_balance = &ctx.remaining_accounts[4];
            let buyer_quote_balance = &ctx.remaining_accounts[5];
            let seller_base_balance = &ctx.remaining_accounts[6];
            let seller_quote_balance = &ctx.remaining_accounts[7];
            let fee_recipient_balance = &ctx.remaining_accounts[8];
            let exchange = &ctx.remaining_accounts[9];

            // Derive MXE authority PDA
            let (expected_mxe_authority, bump) = Pubkey::find_program_address(
                &[MXE_AUTHORITY_SEED],
                ctx.program_id,
            );

            require!(
                *mxe_authority_info.key == expected_mxe_authority,
                ErrorCode::AbortedComputation
            );

            // Build CPI data: [discriminator(8) | fill_amount(8) | price(8)]
            let mut ix_data = Vec::with_capacity(24);
            ix_data.extend_from_slice(&DEX_SETTLE_ORDER_CALLBACK_DISCRIMINATOR);
            ix_data.extend_from_slice(&fill_amount.to_le_bytes());
            ix_data.extend_from_slice(&price.to_le_bytes());

            let ix = Instruction {
                program_id: DEX_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new_readonly(expected_mxe_authority, true), // MXE authority (signer)
                    AccountMeta::new(*buy_order.key, false),
                    AccountMeta::new(*sell_order.key, false),
                    AccountMeta::new_readonly(*pair.key, false),
                    AccountMeta::new(*buyer_base_balance.key, false),
                    AccountMeta::new(*buyer_quote_balance.key, false),
                    AccountMeta::new(*seller_base_balance.key, false),
                    AccountMeta::new(*seller_quote_balance.key, false),
                    AccountMeta::new(*fee_recipient_balance.key, false),
                    AccountMeta::new_readonly(*exchange.key, false),
                ],
                data: ix_data,
            };

            let seeds: &[&[u8]] = &[MXE_AUTHORITY_SEED, &[bump]];
            let signer_seeds = &[seeds];

            invoke_signed(
                &ix,
                &[
                    mxe_authority_info.clone(),
                    buy_order.clone(),
                    sell_order.clone(),
                    pair.clone(),
                    buyer_base_balance.clone(),
                    buyer_quote_balance.clone(),
                    seller_base_balance.clone(),
                    seller_quote_balance.clone(),
                    fee_recipient_balance.clone(),
                    exchange.clone(),
                ],
                signer_seeds,
            )?;

            msg!("CPI to DEX settle_order_callback complete");
        } else {
            msg!("Warning: Not enough remaining accounts for settlement CPI");
        }

        Ok(())
    }

    // =============================================================
    // CANCEL ORDER / REFUND OPERATIONS
    // =============================================================

    /// Queue refund calculation for order cancellation
    ///
    /// Computes: refund_amount = encrypted_amount - encrypted_filled
    /// The result is revealed and passed to cancel_order_callback.
    pub fn calculate_refund(
        ctx: Context<CalculateRefund>,
        computation_offset: u64,
        amount_ciphertext: [u8; 32],
        filled_ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
        // Required: Cancel order accounts for CPI callback
        order: Pubkey,
        user_base_balance: Pubkey,
        user_quote_balance: Pubkey,
        pair: Pubkey,
        exchange: Pubkey,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(amount_ciphertext)
            .encrypted_u64(filled_ciphertext)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build callback accounts for cancel order CPI
        let (mxe_authority, _) = Pubkey::find_program_address(
            &[MXE_AUTHORITY_SEED],
            ctx.program_id,
        );

        let callback_accounts = vec![
            CallbackAccount { pubkey: mxe_authority, is_writable: false },
            CallbackAccount { pubkey: order, is_writable: true },
            CallbackAccount { pubkey: user_base_balance, is_writable: true },
            CallbackAccount { pubkey: user_quote_balance, is_writable: true },
            CallbackAccount { pubkey: pair, is_writable: true },
            CallbackAccount { pubkey: exchange, is_writable: false },
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CalculateRefundCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &callback_accounts,
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for refund calculation
    ///
    /// Receives revealed refund_amount from MPC, then CPIs to DEX
    /// to execute the cancellation with the calculated refund.
    #[arcium_callback(encrypted_ix = "calculate_refund")]
    pub fn calculate_refund_callback(
        ctx: Context<CalculateRefundCallback>,
        output: SignedComputationOutputs<CalculateRefundOutput>,
    ) -> Result<()> {
        // Verify and extract revealed values
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CalculateRefundOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Refund calculation verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // The result contains revealed refund_amount and had_fills flag
        let refund_amount = result.field_0; // refund_amount from struct
        let had_fills = result.field_1;     // had_fills from struct

        // Emit minimal event (NO amounts for privacy)
        emit!(RefundCalculationResult {
            computation_offset: ctx.accounts.computation_account.key(),
            had_fills,
        });

        // CPI to DEX cancel_order_callback with revealed values
        // remaining_accounts[0] = MXE authority
        // remaining_accounts[1] = order
        // remaining_accounts[2] = user_base_balance
        // remaining_accounts[3] = user_quote_balance
        // remaining_accounts[4] = pair
        // remaining_accounts[5] = exchange
        if ctx.remaining_accounts.len() >= 6 {
            let mxe_authority_info = &ctx.remaining_accounts[0];
            let order = &ctx.remaining_accounts[1];
            let user_base_balance = &ctx.remaining_accounts[2];
            let user_quote_balance = &ctx.remaining_accounts[3];
            let pair = &ctx.remaining_accounts[4];
            let exchange = &ctx.remaining_accounts[5];

            // Derive MXE authority PDA
            let (expected_mxe_authority, bump) = Pubkey::find_program_address(
                &[MXE_AUTHORITY_SEED],
                ctx.program_id,
            );

            require!(
                *mxe_authority_info.key == expected_mxe_authority,
                ErrorCode::AbortedComputation
            );

            // Build CPI data: [discriminator(8) | refund_amount(8)]
            let mut ix_data = Vec::with_capacity(16);
            ix_data.extend_from_slice(&DEX_CANCEL_ORDER_CALLBACK_DISCRIMINATOR);
            ix_data.extend_from_slice(&refund_amount.to_le_bytes());

            let ix = Instruction {
                program_id: DEX_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new_readonly(expected_mxe_authority, true), // MXE authority (signer)
                    AccountMeta::new(*order.key, false),
                    AccountMeta::new(*user_base_balance.key, false),
                    AccountMeta::new(*user_quote_balance.key, false),
                    AccountMeta::new(*pair.key, false),
                    AccountMeta::new_readonly(*exchange.key, false),
                ],
                data: ix_data,
            };

            let seeds: &[&[u8]] = &[MXE_AUTHORITY_SEED, &[bump]];
            let signer_seeds = &[seeds];

            invoke_signed(
                &ix,
                &[
                    mxe_authority_info.clone(),
                    order.clone(),
                    user_base_balance.clone(),
                    user_quote_balance.clone(),
                    pair.clone(),
                    exchange.clone(),
                ],
                signer_seeds,
            )?;

            msg!("CPI to DEX cancel_order_callback complete");
        } else {
            msg!("Warning: Not enough remaining accounts for cancel order CPI");
        }

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

#[event]
pub struct BalanceCheckResult {
    pub computation_offset: Pubkey,
    pub sufficient: bool,
}

#[event]
pub struct OrderBalanceCheckResult {
    pub computation_offset: Pubkey,
    pub sufficient: bool,
}

#[event]
pub struct SettlementDecryptionResult {
    /// Computation account key (no amounts for privacy)
    pub computation_offset: Pubkey,
}

#[event]
pub struct RefundCalculationResult {
    /// Computation account key (no amounts for privacy)
    pub computation_offset: Pubkey,
    /// Whether the order had any fills (for logging/monitoring)
    pub had_fills: bool,
}

#[event]
pub struct BatchPriceCompareResult {
    /// Computation account key
    pub computation_offset: Pubkey,
    /// Match results for each pair (true = buy >= sell)
    pub matches: [bool; 5],
}

#[event]
pub struct BatchFillCalculationResult {
    /// Computation account key
    pub computation_offset: Pubkey,
    /// Fill amounts (encrypted) for each pair
    pub fills: [[u8; 32]; 5],
    /// Whether each buy order is fully filled
    pub buy_filled: [bool; 5],
    /// Whether each sell order is fully filled
    pub sell_filled: [bool; 5],
    /// Nonce for decryption
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

#[init_computation_definition_accounts("check_balance", payer)]
#[derive(Accounts)]
pub struct InitCheckBalanceCompDef<'info> {
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

#[init_computation_definition_accounts("check_order_balance", payer)]
#[derive(Accounts)]
pub struct InitCheckOrderBalanceCompDef<'info> {
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

#[init_computation_definition_accounts("decrypt_for_settlement", payer)]
#[derive(Accounts)]
pub struct InitDecryptForSettlementCompDef<'info> {
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

#[init_computation_definition_accounts("calculate_refund", payer)]
#[derive(Accounts)]
pub struct InitCalculateRefundCompDef<'info> {
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

#[init_computation_definition_accounts("batch_compare_prices", payer)]
#[derive(Accounts)]
pub struct InitBatchComparePricesCompDef<'info> {
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

#[init_computation_definition_accounts("batch_calculate_fill", payer)]
#[derive(Accounts)]
pub struct InitBatchCalculateFillCompDef<'info> {
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

#[queue_computation_accounts("check_balance", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckBalance<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_BALANCE))]
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

#[queue_computation_accounts("check_order_balance", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckOrderBalance<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_ORDER_BALANCE))]
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

#[queue_computation_accounts("decrypt_for_settlement", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DecryptForSettlement<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DECRYPT_FOR_SETTLEMENT))]
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

#[queue_computation_accounts("calculate_refund", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CalculateRefund<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_REFUND))]
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

#[queue_computation_accounts("batch_compare_prices", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct BatchComparePrices<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BATCH_COMPARE_PRICES))]
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

#[queue_computation_accounts("batch_calculate_fill", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct BatchCalculateFill<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BATCH_CALCULATE_FILL))]
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

#[callback_accounts("check_balance")]
#[derive(Accounts)]
pub struct CheckBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_BALANCE))]
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

#[callback_accounts("check_order_balance")]
#[derive(Accounts)]
pub struct CheckOrderBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_ORDER_BALANCE))]
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

#[callback_accounts("decrypt_for_settlement")]
#[derive(Accounts)]
pub struct DecryptForSettlementCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DECRYPT_FOR_SETTLEMENT))]
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

#[callback_accounts("calculate_refund")]
#[derive(Accounts)]
pub struct CalculateRefundCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_REFUND))]
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

#[callback_accounts("batch_compare_prices")]
#[derive(Accounts)]
pub struct BatchComparePricesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BATCH_COMPARE_PRICES))]
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

#[callback_accounts("batch_calculate_fill")]
#[derive(Accounts)]
pub struct BatchCalculateFillCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BATCH_CALCULATE_FILL))]
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

// =============================================================================
// CONSTANT VERIFICATION TESTS
// =============================================================================
// These tests verify that hardcoded program ID bytes match expected Base58 strings.
// If these tests fail, it means the hardcoded bytes are out of sync.

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify DEX_PROGRAM_ID matches expected Base58 string
    /// This test prevents the bug where wrong bytes were used (61yJy... instead of 63bxU...)
    #[test]
    fn verify_dex_program_id() {
        assert_eq!(
            DEX_PROGRAM_ID.to_string(),
            "63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB",
            "DEX_PROGRAM_ID bytes do not match expected Base58"
        );
    }

    /// Verify DEX_FINALIZE_MATCH_DISCRIMINATOR is sha256("global:finalize_match")[0..8]
    /// Manually verified: sha256("global:finalize_match") = 06672f07420155cf...
    /// This constant check ensures we don't accidentally change it
    #[test]
    fn verify_finalize_match_discriminator() {
        // Verified manually via: echo -n "global:finalize_match" | sha256sum
        // Result: 06672f07420155cf... (first 8 bytes)
        let expected: [u8; 8] = [0x06, 0x67, 0x2f, 0x07, 0x42, 0x01, 0x55, 0xcf];
        assert_eq!(
            DEX_FINALIZE_MATCH_DISCRIMINATOR, expected,
            "DEX_FINALIZE_MATCH_DISCRIMINATOR doesn't match sha256('global:finalize_match')[0..8]"
        );
    }
}
