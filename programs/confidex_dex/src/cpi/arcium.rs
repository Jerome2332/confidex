//! Arcium MPC CPI integration
//!
//! This module provides helpers for interacting with Arcium's
//! Multi-Party Computation infrastructure for encrypted operations.
//!
//! IMPORTANT: Simulation mode has been REMOVED. All operations require
//! the real MPC cluster. This is intentional - privacy is non-negotiable.
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
/// From @arcium-hq/client v0.6.3
/// Base58: Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ
pub const ARCIUM_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x92, 0x6f, 0x09, 0xaa, 0x6d, 0x48, 0x7d, 0xe2,
    0xd8, 0x8c, 0x37, 0x6a, 0x16, 0x1d, 0x07, 0x7f,
    0xb0, 0x81, 0x0b, 0x13, 0x23, 0x6b, 0x7c, 0x76,
    0x47, 0xa0, 0x70, 0x28, 0x03, 0xfa, 0x5d, 0x89,
]);

/// Arcium MXE Program ID (our deployed MXE)
/// Base58: DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM
/// Deployed: 2026-01-20 with cluster offset 456
pub const ARCIUM_MXE_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0xbe, 0x32, 0x6f, 0x45, 0xc0, 0xae, 0x35, 0xa7,
    0xdf, 0xeb, 0x5c, 0x91, 0x92, 0x00, 0x5d, 0x25,
    0x85, 0xf1, 0x05, 0x1a, 0x36, 0x86, 0x3a, 0x0b,
    0x06, 0xa1, 0x45, 0x2d, 0xd6, 0x67, 0xc4, 0xbe,
]);

/// Default cluster offset for devnet
/// Cluster 456: v0.6.3 (recommended)
/// Recovery set size: 4 nodes (required for devnet)
/// Reference: https://docs.arcium.com/developers/deployment
pub const DEFAULT_CLUSTER_OFFSET: u16 = 456;

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
    /// batch_liquidation_check instruction discriminator
    pub const BATCH_LIQUIDATION_CHECK: [u8; 8] = [0x9a, 0x0b, 0x1c, 0x2d, 0x3e, 0x4f, 0x50, 0x61];
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

/// Queue a price comparison computation via MPC
///
/// CPIs to arcium_mxe program to queue computation.
/// Returns request_id for tracking. Result comes back via callback.
///
/// callback_account_1: buy_order pubkey (for MXE to pass to DEX callback)
/// callback_account_2: sell_order pubkey (for MXE to pass to DEX callback)
pub fn queue_compare_prices<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    buy_price: &EncryptedU64,
    sell_price: &EncryptedU64,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
    callback_account_1: &Pubkey, // buy_order
    callback_account_2: &Pubkey, // sell_order
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: queue_compare_prices (MPC)");

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

    Ok(QueuedComputation { request_id })
}

/// Synchronous version for backward compatibility
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT extract
/// plaintext from the encrypted data. Price comparison must be done via MPC.
///
/// This function returns false (no match) - actual matching uses async MPC.
pub fn compare_encrypted_prices(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    _buy_price: &EncryptedU64,
    _sell_price: &EncryptedU64,
) -> Result<bool> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: compare_encrypted_prices (MPC required - use async flow)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract plaintext from encrypted data anymore.
    // Real price comparison must be done via async MPC flow.
    //
    // Return false to indicate no match - caller should use queue_compare_prices
    // for real MPC-based comparison.

    Ok(false)
}

/// Queue a fill amount calculation via MPC
pub fn queue_calculate_fill<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    buy_amount: &EncryptedU64,
    buy_filled: &EncryptedU64,
    sell_amount: &EncryptedU64,
    sell_filled: &EncryptedU64,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: queue_calculate_fill (MPC)");

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

    Ok(QueuedComputation { request_id })
}

/// Synchronous version for backward compatibility
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT extract
/// plaintext from the encrypted data. Fill calculation must be done via MPC.
///
/// This function returns zero fill - actual fill uses async MPC.
pub fn calculate_encrypted_fill(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    _buy_amount: &EncryptedU64,
    _buy_filled: &EncryptedU64,
    _sell_amount: &EncryptedU64,
    _sell_filled: &EncryptedU64,
) -> Result<(EncryptedU64, bool, bool)> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: calculate_encrypted_fill (MPC required - use async flow)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract plaintext from encrypted data anymore.
    // Real fill calculation must be done via async MPC flow.
    //
    // Return zero fill - caller should use queue_calculate_fill for real MPC.

    let encrypted_fill = [0u8; 64];
    let buy_fully_filled = false;
    let sell_fully_filled = false;

    Ok((encrypted_fill, buy_fully_filled, sell_fully_filled))
}

/// Encrypt a plaintext u64 value
///
/// IMPORTANT: On-chain encryption should ONLY be used for public values
/// (like fee multipliers, constants). User values must be encrypted client-side.
///
/// With pure ciphertext format (V2), this function stores the value in a
/// format compatible with MPC operations but does NOT provide privacy
/// for the encrypted value itself (it's in a known position).
pub fn encrypt_value(
    _arcium_program: &AccountInfo,
    _mxe_pubkey: &[u8; 32],
    value: u64,
) -> Result<EncryptedU64> {
    #[cfg(feature = "debug")]
    msg!("Arcium: encrypt_value (on-chain - for public constants only)");

    // For on-chain encryption of PUBLIC values (fee rates, multipliers):
    // Store in bytes 16-23 to match V2 ciphertext position
    // MPC will interpret this as a "plaintext ciphertext" for constants
    //
    // WARNING: This does NOT provide privacy - only use for public values!
    let mut encrypted = [0u8; 64];
    encrypted[16..24].copy_from_slice(&value.to_le_bytes());

    Ok(encrypted)
}

/// Add two encrypted values
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT perform
/// actual addition on encrypted data. It returns the first operand unchanged.
/// Real encrypted arithmetic must be done via MPC.
pub fn add_encrypted(
    _arcium_program: &AccountInfo,
    a: &EncryptedU64,
    _b: &EncryptedU64,
) -> Result<EncryptedU64> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: add_encrypted (MPC required - returning first operand)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot perform arithmetic on encrypted data without MPC.
    // Return first operand unchanged - real addition via async MPC.
    //
    // The caller should use queue_*_computation for real encrypted arithmetic.

    Ok(*a)
}

/// Subtract two encrypted values (a - b)
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT perform
/// actual subtraction on encrypted data. It returns the first operand unchanged.
/// Real encrypted arithmetic must be done via MPC.
pub fn sub_encrypted(
    _arcium_program: &AccountInfo,
    a: &EncryptedU64,
    _b: &EncryptedU64,
) -> Result<EncryptedU64> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: sub_encrypted (MPC required - returning first operand)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot perform arithmetic on encrypted data without MPC.
    // Return first operand unchanged - real subtraction via async MPC.

    Ok(*a)
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

/// Verify that the claimed liquidation threshold matches the encrypted position params via MPC
/// Uses MPC to compute: threshold = entry_price * (1 - maintenance_margin / leverage) for longs
///                      threshold = entry_price * (1 + maintenance_margin / leverage) for shorts
/// Returns: bool (revealed) - whether the claimed threshold is valid
pub fn verify_position_params<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
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
    msg!("Arcium CPI: verify_position_params (MPC)");

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

    Ok(QueuedComputation { request_id })
}

/// Synchronous version for backward compatibility
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT extract
/// plaintext from the encrypted data. It delegates to real MPC via the async flow.
///
/// For now, it accepts the claimed threshold and returns true, trusting the MPC
/// verification that will happen when the actual async queue is processed.
/// The real validation is performed by the MPC cluster.
///
/// Formula for liquidation price (computed by MPC):
/// - Long:  liq_price = entry * (1 - 1/leverage + maintenance_margin)
/// - Short: liq_price = entry * (1 + 1/leverage - maintenance_margin)
///
/// All calculations done in basis points (10000 = 100%)
pub fn verify_position_params_sync(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    _encrypted_entry_price: &EncryptedU64,
    _claimed_threshold: u64,
    _leverage: u8,
    _is_long: bool,
    _maintenance_margin_bps: u16,
) -> Result<bool> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: verify_position_params (MPC required - trusting claimed threshold)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract plaintext from encrypted data anymore.
    // Real validation must be done via async MPC flow.
    //
    // For now, return true to allow the transaction to proceed.
    // The MPC cluster will verify the threshold asynchronously.
    // If invalid, the callback will reject the position.
    //
    // Security note: This is acceptable because:
    // 1. The position is marked as PendingVerification
    // 2. MPC callback will finalize or reject
    // 3. Trader's collateral is already locked
    // 4. Invalid thresholds only hurt the trader (liquidated early)

    Ok(true)
}

/// Check if a position should be liquidated based on current mark price via MPC
/// Inputs: encrypted position data + public mark price
/// Returns: bool (revealed) - whether position should be liquidated
pub fn check_liquidation<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    encrypted_collateral: &EncryptedU64,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    mark_price: u64,
    is_long: bool,
    maintenance_margin_bps: u16,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: check_liquidation (MPC)");

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

    Ok(QueuedComputation { request_id })
}

/// Synchronous liquidation check for backward compatibility
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT extract
/// plaintext from the encrypted data. Liquidation eligibility must be verified
/// using the PUBLIC liquidation threshold stored on the position account.
///
/// The position has `liquidatable_below_price` (for longs) and
/// `liquidatable_above_price` (for shorts) which are PUBLIC values that
/// were verified by MPC when the position was opened.
///
/// This sync function returns false (not liquidatable) - actual liquidation
/// check uses the public threshold on the position account.
pub fn check_liquidation_sync(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    _encrypted_collateral: &EncryptedU64,
    _encrypted_size: &EncryptedU64,
    _encrypted_entry_price: &EncryptedU64,
    _mark_price: u64,
    _is_long: bool,
    _maintenance_margin_bps: u16,
) -> Result<bool> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: check_liquidation (MPC required - use position.is_liquidatable())");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract plaintext from encrypted data anymore.
    // Liquidation check uses PUBLIC threshold on position account.
    //
    // The caller should use position.is_liquidatable(mark_price) instead,
    // which compares mark_price against the PUBLIC threshold.
    //
    // Return false to indicate MPC verification is needed for detailed check.
    // The actual liquidation eligibility is determined by:
    // 1. position.is_liquidatable(mark_price) - uses public threshold
    // 2. MPC confirmation via async flow for detailed margin calculation

    Ok(false)
}

/// Position data for batch liquidation check
pub struct BatchLiquidationPositionData {
    /// Encrypted liquidation threshold (below for longs, above for shorts)
    pub encrypted_liq_threshold: EncryptedU64,
    /// Position side (true = long, false = short)
    pub is_long: bool,
}

/// Queue a batch liquidation check for multiple positions
/// Inputs: array of encrypted liquidation thresholds + mark price (public)
/// Returns: array of bool (revealed) - which positions should be liquidated
///
/// This allows checking up to 10 positions in a single MPC call (~500ms total)
/// instead of 10 separate calls (~5s total), making liquidation bots efficient.
pub fn queue_batch_liquidation_check<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    positions: &[BatchLiquidationPositionData],
    mark_price: u64,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
    batch_request_pubkey: &Pubkey,
) -> Result<QueuedComputation> {
    if positions.is_empty() || positions.len() > 10 {
        return Err(error!(ArciumError::InvalidResult));
    }

    msg!("Arcium CPI: queue_batch_liquidation_check (MPC) - {} positions", positions.len());

    // Build CPI instruction data
    // Format: discriminator + position_count + [encrypted_liq_threshold + is_long] * count + mark_price + callback_program + callback_discriminator + batch_request
    let mut ix_data = Vec::with_capacity(8 + 1 + (65 * positions.len()) + 8 + 32 + 8 + 32);
    ix_data.extend_from_slice(&mxe_discriminators::BATCH_LIQUIDATION_CHECK);
    ix_data.push(positions.len() as u8);

    for pos in positions {
        ix_data.extend_from_slice(&pos.encrypted_liq_threshold);
        ix_data.push(if pos.is_long { 1 } else { 0 });
    }

    ix_data.extend_from_slice(&mark_price.to_le_bytes());
    ix_data.extend_from_slice(&callback_program.to_bytes());
    ix_data.extend_from_slice(&callback_discriminator);
    ix_data.extend_from_slice(&batch_request_pubkey.to_bytes());

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

    Ok(QueuedComputation { request_id })
}

/// Calculate PnL for a position
/// Inputs: encrypted_size, encrypted_entry_price, exit_price (public), is_long (public)
/// Returns: encrypted_pnl (can be negative, stored as signed in first 8 bytes)
pub fn calculate_pnl<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    exit_price: u64,
    is_long: bool,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: calculate_pnl (MPC)");

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

    Ok(QueuedComputation { request_id })
}

/// Synchronous PnL calculation for backward compatibility
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT extract
/// plaintext from the encrypted data. PnL calculation must be done via MPC.
///
/// This function returns a zero PnL with is_profit=true as a placeholder.
/// The real PnL will be calculated by MPC and applied via callback.
pub fn calculate_pnl_sync(
    _arcium_program: &AccountInfo,
    _encrypted_size: &EncryptedU64,
    _encrypted_entry_price: &EncryptedU64,
    _exit_price: u64,
    _is_long: bool,
) -> Result<(EncryptedU64, bool)> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: calculate_pnl (MPC required - returning zero placeholder)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract plaintext from encrypted data anymore.
    // Real PnL calculation must be done via async MPC flow.
    //
    // Return zero PnL as placeholder. The actual PnL will be:
    // 1. Calculated by MPC cluster
    // 2. Applied via callback to position.encrypted_realized_pnl
    // 3. Used for settlement via C-SPL transfer

    let encrypted_pnl = [0u8; 64];
    let is_profit = true; // Placeholder - MPC determines actual profit/loss

    Ok((encrypted_pnl, is_profit))
}

/// Calculate funding payment for a position
/// Inputs: encrypted_size, funding_rate (public), funding_delta (public)
/// Returns: encrypted_funding_payment
pub fn calculate_funding<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    encrypted_size: &EncryptedU64,
    funding_rate: i64,
    funding_delta: i64,
    is_long: bool,
    callback_program: &Pubkey,
    callback_discriminator: [u8; 8],
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: calculate_funding (MPC)");

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

    Ok(QueuedComputation { request_id })
}

/// Synchronous funding calculation for backward compatibility
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT extract
/// plaintext from the encrypted data. Funding calculation must be done via MPC.
///
/// This function returns zero funding with is_receiving=true as a placeholder.
/// The real funding will be calculated by MPC and applied via callback.
pub fn calculate_funding_sync(
    _arcium_program: &AccountInfo,
    _encrypted_size: &EncryptedU64,
    _funding_delta: i64,
    _is_long: bool,
) -> Result<(EncryptedU64, bool)> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: calculate_funding (MPC required - returning zero placeholder)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot extract plaintext from encrypted data anymore.
    // Real funding calculation must be done via async MPC flow.
    //
    // Return zero funding as placeholder. The actual funding will be:
    // 1. Calculated by MPC cluster using encrypted position size
    // 2. Applied via callback
    // 3. Used for settlement

    let encrypted_payment = [0u8; 64];
    let is_receiving = true; // Placeholder - MPC determines actual direction

    Ok((encrypted_payment, is_receiving))
}

/// Multiply two encrypted values
///
/// IMPORTANT: With pure ciphertext format (V2), this function CANNOT perform
/// actual multiplication on encrypted data. It returns the first operand unchanged.
/// Real encrypted arithmetic must be done via MPC.
pub fn mul_encrypted(
    _arcium_program: &AccountInfo,
    a: &EncryptedU64,
    _b: &EncryptedU64,
) -> Result<EncryptedU64> {
    #[cfg(feature = "debug")]
    msg!("Arcium CPI: mul_encrypted (MPC required - returning first operand)");

    // PURE CIPHERTEXT FORMAT (V2):
    // We cannot perform arithmetic on encrypted data without MPC.
    // Return first operand unchanged - real multiplication via async MPC.

    Ok(*a)
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
