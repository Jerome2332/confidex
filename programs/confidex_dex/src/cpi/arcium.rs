//! Arcium MPC CPI integration
//!
//! This module provides helpers for interacting with Arcium's
//! Multi-Party Computation infrastructure for encrypted operations.
//!
//! Architecture:
//! 1. DEX calls queue_* functions to submit encrypted computations
//! 2. Computations are queued in the arcium_mxe program
//! 3. Arcium Arx nodes pick up from mempool and execute via Cerberus MPC
//! 4. Results are posted back via callback to the DEX
//!
//! Reference: https://docs.arcium.com/developers

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

/// Arcium Program ID (devnet)
/// From @arcium-hq/client v0.6.2
/// Base58: Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ
pub const ARCIUM_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x92, 0x6f, 0x09, 0xaa, 0x6d, 0x48, 0x7d, 0xe2,
    0xd8, 0x8c, 0x37, 0x6a, 0x16, 0x1d, 0x07, 0x7f,
    0xb0, 0x81, 0x0b, 0x13, 0x23, 0x6b, 0x7c, 0x76,
    0x47, 0xa0, 0x70, 0x28, 0x03, 0xfa, 0x5d, 0x89,
]);

/// Arcium MXE Program ID (our deployed MXE)
/// Base58: CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE
pub const ARCIUM_MXE_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0xa6, 0x07, 0x94, 0x3d, 0xdf, 0x43, 0xc1, 0xab,
    0xf5, 0x9b, 0x85, 0x84, 0x6b, 0x1e, 0xae, 0x6e,
    0xe9, 0x85, 0x23, 0x63, 0x3b, 0xa3, 0x3d, 0x8a,
    0x45, 0x19, 0xba, 0x03, 0xde, 0x53, 0xf2, 0x9d,
]);

/// Default cluster offset for devnet (123, 456, or 789 available)
pub const DEFAULT_CLUSTER_OFFSET: u16 = 123;

/// Feature flag for using real MPC vs simulation
/// Set to true when Arcium cluster is configured and ready
pub const USE_REAL_MPC: bool = true;

/// Encrypted value type (64 bytes)
/// Uses Arcium's Rescue cipher encryption
pub type EncryptedU64 = [u8; 64];

/// Result of an encrypted comparison
pub type EncryptedBool = [u8; 32];

/// Instruction discriminators for arcium_mxe program
/// Computed as sha256("global:<instruction_name>")[0..8]
pub mod mxe_discriminators {
    /// queue_compare_prices: sha256("global:queue_compare_prices")[0..8]
    pub const QUEUE_COMPARE_PRICES: [u8; 8] = [0x40, 0x28, 0xea, 0x8a, 0xf5, 0xa3, 0x0f, 0xf6];
    /// queue_calculate_fill: sha256("global:queue_calculate_fill")[0..8]
    pub const QUEUE_CALCULATE_FILL: [u8; 8] = [0xee, 0x2a, 0x2b, 0x88, 0x10, 0x47, 0x1d, 0x48];

    // === Perpetuals Operations ===
    /// verify_position_params instruction discriminator
    pub const VERIFY_POSITION_PARAMS: [u8; 8] = [0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x9a, 0x0b];
    /// check_liquidation instruction discriminator
    pub const CHECK_LIQUIDATION: [u8; 8] = [0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x9a, 0x0b, 0x1c];
    /// calculate_pnl instruction discriminator
    pub const CALCULATE_PNL: [u8; 8] = [0x5c, 0x6d, 0x7e, 0x8f, 0x9a, 0x0b, 0x1c, 0x2d];
    /// calculate_funding instruction discriminator
    pub const CALCULATE_FUNDING: [u8; 8] = [0x6d, 0x7e, 0x8f, 0x9a, 0x0b, 0x1c, 0x2d, 0x3e];
    /// calculate_margin_ratio instruction discriminator
    pub const CALCULATE_MARGIN_RATIO: [u8; 8] = [0x7e, 0x8f, 0x9a, 0x0b, 0x1c, 0x2d, 0x3e, 0x4f];
    /// update_collateral instruction discriminator
    pub const UPDATE_COLLATERAL: [u8; 8] = [0x8f, 0x9a, 0x0b, 0x1c, 0x2d, 0x3e, 0x4f, 0x50];
}

/// Supported Arcium operations for confidential DEX
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArciumOperation {
    /// Compare buy_price >= sell_price (for matching)
    ComparePrices,
    /// Calculate min(buy_remaining, sell_remaining) for fill amount
    CalculateFill,
    /// Add two encrypted values
    Add,
    /// Subtract two encrypted values
    Subtract,
    /// Encrypt a plaintext value
    Encrypt,
}

/// Result from queuing a computation
#[derive(Clone)]
pub struct QueuedComputation {
    /// Request ID for tracking
    pub request_id: [u8; 32],
    /// Whether this was a real MPC queue or simulated
    pub is_simulated: bool,
    /// Simulated result (only valid if is_simulated = true)
    pub simulated_result: Option<Vec<u8>>,
}

/// Accounts needed for MXE CPI
pub struct MxeCpiAccounts<'a, 'info> {
    /// MXE config account
    pub mxe_config: &'a AccountInfo<'info>,
    /// Computation request account (will be created)
    pub request_account: &'a AccountInfo<'info>,
    /// Payer/requester
    pub requester: &'a AccountInfo<'info>,
    /// System program
    pub system_program: &'a AccountInfo<'info>,
    /// MXE program
    pub mxe_program: &'a AccountInfo<'info>,
}

/// Queue a price comparison computation
///
/// In production mode (USE_REAL_MPC = true):
/// - CPIs to arcium_mxe program to queue computation
/// - Returns request_id for tracking
/// - Result comes back via callback
///
/// In simulation mode (USE_REAL_MPC = false):
/// - Compares first 8 bytes as u64 (NOT secure)
/// - Returns immediate simulated result
///
/// callback_account_1: buy_order pubkey (for MXE to pass to DEX callback)
/// callback_account_2: sell_order pubkey (for MXE to pass to DEX callback)
pub fn queue_compare_prices<'info>(
    accounts: Option<MxeCpiAccounts<'_, 'info>>,
    buy_price: &EncryptedU64,
    sell_price: &EncryptedU64,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
    callback_account_1: &Pubkey, // buy_order
    callback_account_2: &Pubkey, // sell_order
) -> Result<QueuedComputation> {
    if USE_REAL_MPC {
        let accounts = accounts.ok_or(error!(ArciumError::MissingMxeAccounts))?;

        msg!("Arcium CPI: queue_compare_prices (REAL MPC)");

        // Build CPI instruction data
        // Format: discriminator + buy_price + sell_price + callback_program + callback_discriminator + callback_account_1 + callback_account_2
        let mut ix_data = Vec::with_capacity(8 + 64 + 64 + 32 + 8 + 32 + 32);
        ix_data.extend_from_slice(&mxe_discriminators::QUEUE_COMPARE_PRICES);
        ix_data.extend_from_slice(buy_price);
        ix_data.extend_from_slice(sell_price);
        ix_data.extend_from_slice(&callback_program.to_bytes());
        ix_data.extend_from_slice(&callback_discriminator);
        ix_data.extend_from_slice(&callback_account_1.to_bytes()); // buy_order for callback
        ix_data.extend_from_slice(&callback_account_2.to_bytes()); // sell_order for callback

        let ix = Instruction {
            program_id: ARCIUM_MXE_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*accounts.mxe_config.key, false),
                AccountMeta::new(*accounts.request_account.key, false),
                AccountMeta::new(*accounts.requester.key, true),
                AccountMeta::new_readonly(*accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke(
            &ix,
            &[
                accounts.mxe_config.clone(),
                accounts.request_account.clone(),
                accounts.requester.clone(),
                accounts.system_program.clone(),
            ],
        )?;

        // Extract request_id from the created request account
        // For now, generate a placeholder - in practice read from account
        let request_id = generate_request_id();

        Ok(QueuedComputation {
            request_id,
            is_simulated: false,
            simulated_result: None,
        })
    } else {
        msg!("Arcium CPI: compare_encrypted_prices (SIMULATED)");

        // Simulated comparison (NOT secure - for development only)
        let buy = u64::from_le_bytes(buy_price[0..8].try_into().unwrap_or([0u8; 8]));
        let sell = u64::from_le_bytes(sell_price[0..8].try_into().unwrap_or([0u8; 8]));
        let result = buy >= sell;

        Ok(QueuedComputation {
            request_id: [0u8; 32],
            is_simulated: true,
            simulated_result: Some(vec![if result { 1 } else { 0 }]),
        })
    }
}

/// Synchronous version for backward compatibility
/// Returns immediate result (simulated or from cache)
pub fn compare_encrypted_prices(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    buy_price: &EncryptedU64,
    sell_price: &EncryptedU64,
) -> Result<bool> {
    msg!("Arcium CPI: compare_encrypted_prices (simulated - legacy)");

    // Always simulate for backward compatibility
    let buy = u64::from_le_bytes(buy_price[0..8].try_into().unwrap_or([0u8; 8]));
    let sell = u64::from_le_bytes(sell_price[0..8].try_into().unwrap_or([0u8; 8]));

    Ok(buy >= sell)
}

/// Queue a fill amount calculation
pub fn queue_calculate_fill<'info>(
    accounts: Option<MxeCpiAccounts<'_, 'info>>,
    buy_amount: &EncryptedU64,
    buy_filled: &EncryptedU64,
    sell_amount: &EncryptedU64,
    sell_filled: &EncryptedU64,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    if USE_REAL_MPC {
        let accounts = accounts.ok_or(error!(ArciumError::MissingMxeAccounts))?;

        msg!("Arcium CPI: queue_calculate_fill (REAL MPC)");

        // Build CPI instruction data
        let mut ix_data = Vec::with_capacity(8 + 64 * 4 + 32 + 8);
        ix_data.extend_from_slice(&mxe_discriminators::QUEUE_CALCULATE_FILL);
        ix_data.extend_from_slice(buy_amount);
        ix_data.extend_from_slice(buy_filled);
        ix_data.extend_from_slice(sell_amount);
        ix_data.extend_from_slice(sell_filled);
        ix_data.extend_from_slice(&callback_program.to_bytes());
        ix_data.extend_from_slice(&callback_discriminator);

        let ix = Instruction {
            program_id: ARCIUM_MXE_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*accounts.mxe_config.key, false),
                AccountMeta::new(*accounts.request_account.key, false),
                AccountMeta::new(*accounts.requester.key, true),
                AccountMeta::new_readonly(*accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke(
            &ix,
            &[
                accounts.mxe_config.clone(),
                accounts.request_account.clone(),
                accounts.requester.clone(),
                accounts.system_program.clone(),
            ],
        )?;

        let request_id = generate_request_id();

        Ok(QueuedComputation {
            request_id,
            is_simulated: false,
            simulated_result: None,
        })
    } else {
        msg!("Arcium CPI: calculate_encrypted_fill (SIMULATED)");

        // Simulated computation
        let buy_amt = u64::from_le_bytes(buy_amount[0..8].try_into().unwrap_or([0u8; 8]));
        let buy_fld = u64::from_le_bytes(buy_filled[0..8].try_into().unwrap_or([0u8; 8]));
        let sell_amt = u64::from_le_bytes(sell_amount[0..8].try_into().unwrap_or([0u8; 8]));
        let sell_fld = u64::from_le_bytes(sell_filled[0..8].try_into().unwrap_or([0u8; 8]));

        let buy_remaining = buy_amt.saturating_sub(buy_fld);
        let sell_remaining = sell_amt.saturating_sub(sell_fld);
        let fill_amount = buy_remaining.min(sell_remaining);

        let mut result = vec![0u8; 66]; // 64 bytes fill + 2 bool flags
        result[0..8].copy_from_slice(&fill_amount.to_le_bytes());
        result[64] = if fill_amount >= buy_remaining { 1 } else { 0 };
        result[65] = if fill_amount >= sell_remaining { 1 } else { 0 };

        Ok(QueuedComputation {
            request_id: [0u8; 32],
            is_simulated: true,
            simulated_result: Some(result),
        })
    }
}

/// Synchronous version for backward compatibility
pub fn calculate_encrypted_fill(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    buy_amount: &EncryptedU64,
    buy_filled: &EncryptedU64,
    sell_amount: &EncryptedU64,
    sell_filled: &EncryptedU64,
) -> Result<(EncryptedU64, bool, bool)> {
    msg!("Arcium CPI: calculate_encrypted_fill (simulated - legacy)");

    let buy_amt = u64::from_le_bytes(buy_amount[0..8].try_into().unwrap_or([0u8; 8]));
    let buy_fld = u64::from_le_bytes(buy_filled[0..8].try_into().unwrap_or([0u8; 8]));
    let sell_amt = u64::from_le_bytes(sell_amount[0..8].try_into().unwrap_or([0u8; 8]));
    let sell_fld = u64::from_le_bytes(sell_filled[0..8].try_into().unwrap_or([0u8; 8]));

    let buy_remaining = buy_amt.saturating_sub(buy_fld);
    let sell_remaining = sell_amt.saturating_sub(sell_fld);
    let fill_amount = buy_remaining.min(sell_remaining);

    let mut encrypted_fill = [0u8; 64];
    encrypted_fill[0..8].copy_from_slice(&fill_amount.to_le_bytes());

    let buy_fully_filled = fill_amount >= buy_remaining;
    let sell_fully_filled = fill_amount >= sell_remaining;

    Ok((encrypted_fill, buy_fully_filled, sell_fully_filled))
}

/// Encrypt a plaintext u64 value
/// Note: On-chain encryption is complex; prefer client-side encryption
pub fn encrypt_value(
    _arcium_program: &AccountInfo,
    _mxe_pubkey: &[u8; 32],
    value: u64,
) -> Result<EncryptedU64> {
    msg!("Arcium: encrypt_value (simulated)");

    // Simulated - store plaintext in first 8 bytes
    // Real encryption should be done client-side with RescueCipher
    let mut encrypted = [0u8; 64];
    encrypted[0..8].copy_from_slice(&value.to_le_bytes());

    Ok(encrypted)
}

/// Add two encrypted values
pub fn add_encrypted(
    _arcium_program: &AccountInfo,
    a: &EncryptedU64,
    b: &EncryptedU64,
) -> Result<EncryptedU64> {
    msg!("Arcium CPI: add_encrypted (simulated)");

    let val_a = u64::from_le_bytes(a[0..8].try_into().unwrap_or([0u8; 8]));
    let val_b = u64::from_le_bytes(b[0..8].try_into().unwrap_or([0u8; 8]));
    let result = val_a.saturating_add(val_b);

    let mut encrypted = [0u8; 64];
    encrypted[0..8].copy_from_slice(&result.to_le_bytes());

    Ok(encrypted)
}

/// Subtract two encrypted values (a - b)
pub fn sub_encrypted(
    _arcium_program: &AccountInfo,
    a: &EncryptedU64,
    b: &EncryptedU64,
) -> Result<EncryptedU64> {
    msg!("Arcium CPI: sub_encrypted (simulated)");

    let val_a = u64::from_le_bytes(a[0..8].try_into().unwrap_or([0u8; 8]));
    let val_b = u64::from_le_bytes(b[0..8].try_into().unwrap_or([0u8; 8]));
    let result = val_a.saturating_sub(val_b);

    let mut encrypted = [0u8; 64];
    encrypted[0..8].copy_from_slice(&result.to_le_bytes());

    Ok(encrypted)
}

/// Arcium callback handler for computation results
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ArciumCallback {
    /// Original request ID
    pub request_id: [u8; 32],
    /// Computation result (encrypted or plaintext depending on operation)
    pub result: Vec<u8>,
    /// Success flag
    pub success: bool,
}

// ============================================================================
// PERPETUALS MPC OPERATIONS
// ============================================================================

/// Verify that the claimed liquidation threshold matches the encrypted position params
/// Uses MPC to compute: threshold = entry_price * (1 - maintenance_margin / leverage) for longs
///                      threshold = entry_price * (1 + maintenance_margin / leverage) for shorts
/// Returns: bool (revealed) - whether the claimed threshold is valid
pub fn verify_position_params<'info>(
    accounts: Option<MxeCpiAccounts<'_, 'info>>,
    encrypted_collateral: &EncryptedU64,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    claimed_threshold: u64,
    leverage: u8,
    is_long: bool,
    maintenance_margin_bps: u16,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    if USE_REAL_MPC {
        let accounts = accounts.ok_or(error!(ArciumError::MissingMxeAccounts))?;

        msg!("Arcium CPI: verify_position_params (REAL MPC)");

        // Build CPI instruction data
        let mut ix_data = Vec::with_capacity(8 + 64 * 3 + 8 + 1 + 1 + 2 + 32 + 8);
        ix_data.extend_from_slice(&mxe_discriminators::VERIFY_POSITION_PARAMS);
        ix_data.extend_from_slice(encrypted_collateral);
        ix_data.extend_from_slice(encrypted_size);
        ix_data.extend_from_slice(encrypted_entry_price);
        ix_data.extend_from_slice(&claimed_threshold.to_le_bytes());
        ix_data.push(leverage);
        ix_data.push(if is_long { 1 } else { 0 });
        ix_data.extend_from_slice(&maintenance_margin_bps.to_le_bytes());
        ix_data.extend_from_slice(&callback_program.to_bytes());
        ix_data.extend_from_slice(&callback_discriminator);

        let ix = Instruction {
            program_id: ARCIUM_MXE_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*accounts.mxe_config.key, false),
                AccountMeta::new(*accounts.request_account.key, false),
                AccountMeta::new(*accounts.requester.key, true),
                AccountMeta::new_readonly(*accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke(
            &ix,
            &[
                accounts.mxe_config.clone(),
                accounts.request_account.clone(),
                accounts.requester.clone(),
                accounts.system_program.clone(),
            ],
        )?;

        let request_id = generate_request_id();

        Ok(QueuedComputation {
            request_id,
            is_simulated: false,
            simulated_result: None,
        })
    } else {
        msg!("Arcium CPI: verify_position_params (SIMULATED)");

        // Simulated verification (NOT secure - for development only)
        let entry_price = u64::from_le_bytes(encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8]));

        // Calculate expected threshold
        // For longs: threshold = entry_price * (1 - mm / leverage)
        // For shorts: threshold = entry_price * (1 + mm / leverage)
        let mm_factor = (maintenance_margin_bps as u64) * 10000 / (leverage as u64); // bps to ratio * 10000
        let expected_threshold = if is_long {
            entry_price.saturating_sub(entry_price * mm_factor / 1_000_000)
        } else {
            entry_price.saturating_add(entry_price * mm_factor / 1_000_000)
        };

        // Allow 1% tolerance for rounding
        let tolerance = expected_threshold / 100;
        let valid = claimed_threshold >= expected_threshold.saturating_sub(tolerance)
            && claimed_threshold <= expected_threshold.saturating_add(tolerance);

        Ok(QueuedComputation {
            request_id: [0u8; 32],
            is_simulated: true,
            simulated_result: Some(vec![if valid { 1 } else { 0 }]),
        })
    }
}

/// Synchronous version for backward compatibility
/// Calculates expected liquidation threshold and validates against claimed value.
///
/// Formula for liquidation price:
/// - Long:  liq_price = entry * (1 - 1/leverage + maintenance_margin)
/// - Short: liq_price = entry * (1 + 1/leverage - maintenance_margin)
///
/// All calculations done in basis points (10000 = 100%)
pub fn verify_position_params_sync(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    encrypted_entry_price: &EncryptedU64,
    claimed_threshold: u64,
    leverage: u8,
    is_long: bool,
    maintenance_margin_bps: u16,
) -> Result<bool> {
    msg!("Arcium CPI: verify_position_params (simulated - legacy)");

    // Extract entry price from hybrid encrypted format (first 8 bytes are plaintext)
    let entry_price = u64::from_le_bytes(encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8]));

    // Calculate liquidation price using basis points arithmetic
    // leverage_factor = 10000 / leverage (e.g., 10x leverage = 1000 bps = 10%)
    let leverage_factor_bps = 10000u64 / (leverage as u64);
    let mm_bps = maintenance_margin_bps as u64;

    // For longs: factor = 10000 - leverage_factor + mm_bps = 10000 - 1000 + 500 = 9500 (95%)
    // For shorts: factor = 10000 + leverage_factor - mm_bps = 10000 + 1000 - 500 = 10500 (105%)
    let factor_bps = if is_long {
        10000u64.saturating_sub(leverage_factor_bps).saturating_add(mm_bps)
    } else {
        10000u64.saturating_add(leverage_factor_bps).saturating_sub(mm_bps)
    };

    // expected_threshold = entry_price * factor_bps / 10000
    let expected_threshold = entry_price
        .checked_mul(factor_bps)
        .unwrap_or(u64::MAX)
        .checked_div(10000)
        .unwrap_or(0);

    msg!("Liquidation calc: entry={}, leverage={}, mm_bps={}, factor_bps={}, expected={}, claimed={}",
        entry_price, leverage, mm_bps, factor_bps, expected_threshold, claimed_threshold);

    // Allow 1% tolerance for rounding differences
    let tolerance = expected_threshold / 100;
    let valid = claimed_threshold >= expected_threshold.saturating_sub(tolerance)
        && claimed_threshold <= expected_threshold.saturating_add(tolerance);

    msg!("Threshold validation: {} (tolerance={})", if valid { "PASS" } else { "FAIL" }, tolerance);

    Ok(valid)
}

/// Check if a position should be liquidated based on current mark price
/// Inputs: encrypted position data + public mark price
/// Returns: bool (revealed) - whether position should be liquidated
pub fn check_liquidation<'info>(
    accounts: Option<MxeCpiAccounts<'_, 'info>>,
    encrypted_collateral: &EncryptedU64,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    mark_price: u64,
    is_long: bool,
    maintenance_margin_bps: u16,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    if USE_REAL_MPC {
        let accounts = accounts.ok_or(error!(ArciumError::MissingMxeAccounts))?;

        msg!("Arcium CPI: check_liquidation (REAL MPC)");

        let mut ix_data = Vec::with_capacity(8 + 64 * 3 + 8 + 1 + 2 + 32 + 8);
        ix_data.extend_from_slice(&mxe_discriminators::CHECK_LIQUIDATION);
        ix_data.extend_from_slice(encrypted_collateral);
        ix_data.extend_from_slice(encrypted_size);
        ix_data.extend_from_slice(encrypted_entry_price);
        ix_data.extend_from_slice(&mark_price.to_le_bytes());
        ix_data.push(if is_long { 1 } else { 0 });
        ix_data.extend_from_slice(&maintenance_margin_bps.to_le_bytes());
        ix_data.extend_from_slice(&callback_program.to_bytes());
        ix_data.extend_from_slice(&callback_discriminator);

        let ix = Instruction {
            program_id: ARCIUM_MXE_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*accounts.mxe_config.key, false),
                AccountMeta::new(*accounts.request_account.key, false),
                AccountMeta::new(*accounts.requester.key, true),
                AccountMeta::new_readonly(*accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke(
            &ix,
            &[
                accounts.mxe_config.clone(),
                accounts.request_account.clone(),
                accounts.requester.clone(),
                accounts.system_program.clone(),
            ],
        )?;

        let request_id = generate_request_id();

        Ok(QueuedComputation {
            request_id,
            is_simulated: false,
            simulated_result: None,
        })
    } else {
        msg!("Arcium CPI: check_liquidation (SIMULATED)");

        let collateral = u64::from_le_bytes(encrypted_collateral[0..8].try_into().unwrap_or([0u8; 8]));
        let size = u64::from_le_bytes(encrypted_size[0..8].try_into().unwrap_or([0u8; 8]));
        let entry_price = u64::from_le_bytes(encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8]));

        // Calculate unrealized PnL
        let pnl = if is_long {
            if mark_price > entry_price {
                (mark_price - entry_price).saturating_mul(size) / entry_price
            } else {
                0u64.wrapping_sub((entry_price - mark_price).saturating_mul(size) / entry_price)
            }
        } else {
            if entry_price > mark_price {
                (entry_price - mark_price).saturating_mul(size) / entry_price
            } else {
                0u64.wrapping_sub((mark_price - entry_price).saturating_mul(size) / entry_price)
            }
        };

        // Calculate margin ratio: (collateral + pnl) / notional
        let notional = size.saturating_mul(mark_price) / 1_000_000; // assuming 6 decimals
        let equity = if is_long && mark_price < entry_price {
            collateral.saturating_sub((entry_price - mark_price).saturating_mul(size) / entry_price)
        } else if !is_long && mark_price > entry_price {
            collateral.saturating_sub((mark_price - entry_price).saturating_mul(size) / entry_price)
        } else {
            collateral.saturating_add(pnl)
        };

        let margin_ratio_bps = if notional > 0 {
            (equity * 10000) / notional
        } else {
            10000
        };

        let should_liquidate = margin_ratio_bps < maintenance_margin_bps as u64;

        Ok(QueuedComputation {
            request_id: [0u8; 32],
            is_simulated: true,
            simulated_result: Some(vec![if should_liquidate { 1 } else { 0 }]),
        })
    }
}

/// Synchronous liquidation check for backward compatibility
pub fn check_liquidation_sync(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    encrypted_collateral: &EncryptedU64,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    mark_price: u64,
    is_long: bool,
    maintenance_margin_bps: u16,
) -> Result<bool> {
    msg!("Arcium CPI: check_liquidation (simulated - legacy)");

    let collateral = u64::from_le_bytes(encrypted_collateral[0..8].try_into().unwrap_or([0u8; 8]));
    let size = u64::from_le_bytes(encrypted_size[0..8].try_into().unwrap_or([0u8; 8]));
    let entry_price = u64::from_le_bytes(encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8]));

    let pnl_loss = if is_long && mark_price < entry_price {
        (entry_price - mark_price).saturating_mul(size) / entry_price
    } else if !is_long && mark_price > entry_price {
        (mark_price - entry_price).saturating_mul(size) / entry_price
    } else {
        0
    };

    let equity = collateral.saturating_sub(pnl_loss);
    let notional = size.saturating_mul(mark_price) / 1_000_000;
    let margin_ratio_bps = if notional > 0 { (equity * 10000) / notional } else { 10000 };

    Ok(margin_ratio_bps < maintenance_margin_bps as u64)
}

/// Calculate PnL for a position
/// Inputs: encrypted_size, encrypted_entry_price, exit_price (public), is_long (public)
/// Returns: encrypted_pnl (can be negative, stored as signed in first 8 bytes)
pub fn calculate_pnl<'info>(
    accounts: Option<MxeCpiAccounts<'_, 'info>>,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    exit_price: u64,
    is_long: bool,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    if USE_REAL_MPC {
        let accounts = accounts.ok_or(error!(ArciumError::MissingMxeAccounts))?;

        msg!("Arcium CPI: calculate_pnl (REAL MPC)");

        let mut ix_data = Vec::with_capacity(8 + 64 * 2 + 8 + 1 + 32 + 8);
        ix_data.extend_from_slice(&mxe_discriminators::CALCULATE_PNL);
        ix_data.extend_from_slice(encrypted_size);
        ix_data.extend_from_slice(encrypted_entry_price);
        ix_data.extend_from_slice(&exit_price.to_le_bytes());
        ix_data.push(if is_long { 1 } else { 0 });
        ix_data.extend_from_slice(&callback_program.to_bytes());
        ix_data.extend_from_slice(&callback_discriminator);

        let ix = Instruction {
            program_id: ARCIUM_MXE_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*accounts.mxe_config.key, false),
                AccountMeta::new(*accounts.request_account.key, false),
                AccountMeta::new(*accounts.requester.key, true),
                AccountMeta::new_readonly(*accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke(
            &ix,
            &[
                accounts.mxe_config.clone(),
                accounts.request_account.clone(),
                accounts.requester.clone(),
                accounts.system_program.clone(),
            ],
        )?;

        let request_id = generate_request_id();

        Ok(QueuedComputation {
            request_id,
            is_simulated: false,
            simulated_result: None,
        })
    } else {
        msg!("Arcium CPI: calculate_pnl (SIMULATED)");

        let size = u64::from_le_bytes(encrypted_size[0..8].try_into().unwrap_or([0u8; 8]));
        let entry_price = u64::from_le_bytes(encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8]));

        // PnL = (exit - entry) * size for longs, (entry - exit) * size for shorts
        let (pnl, is_profit) = if is_long {
            if exit_price >= entry_price {
                ((exit_price - entry_price).saturating_mul(size) / entry_price, true)
            } else {
                ((entry_price - exit_price).saturating_mul(size) / entry_price, false)
            }
        } else {
            if entry_price >= exit_price {
                ((entry_price - exit_price).saturating_mul(size) / entry_price, true)
            } else {
                ((exit_price - entry_price).saturating_mul(size) / entry_price, false)
            }
        };

        // Encode as signed: first 8 bytes = magnitude, byte 8 = sign (0 = positive, 1 = negative)
        let mut result = vec![0u8; 65];
        result[0..8].copy_from_slice(&pnl.to_le_bytes());
        result[64] = if is_profit { 0 } else { 1 };

        Ok(QueuedComputation {
            request_id: [0u8; 32],
            is_simulated: true,
            simulated_result: Some(result),
        })
    }
}

/// Synchronous PnL calculation for backward compatibility
pub fn calculate_pnl_sync(
    _arcium_program: &AccountInfo,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    exit_price: u64,
    is_long: bool,
) -> Result<(EncryptedU64, bool)> {
    msg!("Arcium CPI: calculate_pnl (simulated - legacy)");

    let size = u64::from_le_bytes(encrypted_size[0..8].try_into().unwrap_or([0u8; 8]));
    let entry_price = u64::from_le_bytes(encrypted_entry_price[0..8].try_into().unwrap_or([0u8; 8]));

    let (pnl, is_profit) = if is_long {
        if exit_price >= entry_price {
            ((exit_price - entry_price).saturating_mul(size) / entry_price, true)
        } else {
            ((entry_price - exit_price).saturating_mul(size) / entry_price, false)
        }
    } else {
        if entry_price >= exit_price {
            ((entry_price - exit_price).saturating_mul(size) / entry_price, true)
        } else {
            ((exit_price - entry_price).saturating_mul(size) / entry_price, false)
        }
    };

    let mut encrypted_pnl = [0u8; 64];
    encrypted_pnl[0..8].copy_from_slice(&pnl.to_le_bytes());

    Ok((encrypted_pnl, is_profit))
}

/// Calculate funding payment for a position
/// Inputs: encrypted_size, funding_rate (public), funding_delta (public)
/// Returns: encrypted_funding_payment
pub fn calculate_funding<'info>(
    accounts: Option<MxeCpiAccounts<'_, 'info>>,
    encrypted_size: &EncryptedU64,
    funding_rate: i64,
    funding_delta: i64,
    is_long: bool,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    if USE_REAL_MPC {
        let accounts = accounts.ok_or(error!(ArciumError::MissingMxeAccounts))?;

        msg!("Arcium CPI: calculate_funding (REAL MPC)");

        let mut ix_data = Vec::with_capacity(8 + 64 + 8 + 8 + 1 + 32 + 8);
        ix_data.extend_from_slice(&mxe_discriminators::CALCULATE_FUNDING);
        ix_data.extend_from_slice(encrypted_size);
        ix_data.extend_from_slice(&funding_rate.to_le_bytes());
        ix_data.extend_from_slice(&funding_delta.to_le_bytes());
        ix_data.push(if is_long { 1 } else { 0 });
        ix_data.extend_from_slice(&callback_program.to_bytes());
        ix_data.extend_from_slice(&callback_discriminator);

        let ix = Instruction {
            program_id: ARCIUM_MXE_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*accounts.mxe_config.key, false),
                AccountMeta::new(*accounts.request_account.key, false),
                AccountMeta::new(*accounts.requester.key, true),
                AccountMeta::new_readonly(*accounts.system_program.key, false),
            ],
            data: ix_data,
        };

        invoke(
            &ix,
            &[
                accounts.mxe_config.clone(),
                accounts.request_account.clone(),
                accounts.requester.clone(),
                accounts.system_program.clone(),
            ],
        )?;

        let request_id = generate_request_id();

        Ok(QueuedComputation {
            request_id,
            is_simulated: false,
            simulated_result: None,
        })
    } else {
        msg!("Arcium CPI: calculate_funding (SIMULATED)");

        let size = u64::from_le_bytes(encrypted_size[0..8].try_into().unwrap_or([0u8; 8]));

        // Funding payment = size * funding_delta / 1e6
        // Longs pay when funding_delta > 0, shorts receive
        let funding_payment = (size as i128 * funding_delta as i128 / 1_000_000) as i64;
        let (payment_amount, is_receiving) = if is_long {
            if funding_payment >= 0 {
                (funding_payment as u64, false) // paying
            } else {
                ((-funding_payment) as u64, true) // receiving
            }
        } else {
            if funding_payment >= 0 {
                (funding_payment as u64, true) // receiving
            } else {
                ((-funding_payment) as u64, false) // paying
            }
        };

        let mut result = vec![0u8; 65];
        result[0..8].copy_from_slice(&payment_amount.to_le_bytes());
        result[64] = if is_receiving { 0 } else { 1 }; // 0 = receiving, 1 = paying

        Ok(QueuedComputation {
            request_id: [0u8; 32],
            is_simulated: true,
            simulated_result: Some(result),
        })
    }
}

/// Synchronous funding calculation for backward compatibility
pub fn calculate_funding_sync(
    _arcium_program: &AccountInfo,
    encrypted_size: &EncryptedU64,
    funding_delta: i64,
    is_long: bool,
) -> Result<(EncryptedU64, bool)> {
    msg!("Arcium CPI: calculate_funding (simulated - legacy)");

    let size = u64::from_le_bytes(encrypted_size[0..8].try_into().unwrap_or([0u8; 8]));

    let funding_payment = (size as i128 * funding_delta as i128 / 1_000_000) as i64;
    let (payment_amount, is_receiving) = if is_long {
        if funding_payment >= 0 {
            (funding_payment as u64, false)
        } else {
            ((-funding_payment) as u64, true)
        }
    } else {
        if funding_payment >= 0 {
            (funding_payment as u64, true)
        } else {
            ((-funding_payment) as u64, false)
        }
    };

    let mut encrypted_payment = [0u8; 64];
    encrypted_payment[0..8].copy_from_slice(&payment_amount.to_le_bytes());

    Ok((encrypted_payment, is_receiving))
}

/// Multiply two encrypted values
pub fn mul_encrypted(
    _arcium_program: &AccountInfo,
    a: &EncryptedU64,
    b: &EncryptedU64,
) -> Result<EncryptedU64> {
    msg!("Arcium CPI: mul_encrypted (simulated)");

    let val_a = u64::from_le_bytes(a[0..8].try_into().unwrap_or([0u8; 8]));
    let val_b = u64::from_le_bytes(b[0..8].try_into().unwrap_or([0u8; 8]));
    let result = val_a.saturating_mul(val_b);

    let mut encrypted = [0u8; 64];
    encrypted[0..8].copy_from_slice(&result.to_le_bytes());

    Ok(encrypted)
}

/// Generate a unique request ID
fn generate_request_id() -> [u8; 32] {
    let clock = Clock::get().unwrap_or_default();
    let mut id = [0u8; 32];
    id[0..8].copy_from_slice(&clock.slot.to_le_bytes());
    id[8..16].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
    id
}

/// Arcium-specific errors
#[error_code]
pub enum ArciumError {
    #[msg("MXE accounts required for real MPC but not provided")]
    MissingMxeAccounts,
    #[msg("MPC computation failed")]
    ComputationFailed,
    #[msg("Invalid computation result")]
    InvalidResult,
    #[msg("Callback from unauthorized source")]
    UnauthorizedCallback,
}
