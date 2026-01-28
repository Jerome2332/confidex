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

/// Arcium MXE Program ID (production MXE deployed via `arcium deploy`)
/// Base58: 4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi
/// Deployed to devnet cluster 456 (v0.6.3) with keygen complete (2026-01-22).
/// This is the production MXE with full Arcium MPC support.
pub const ARCIUM_MXE_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x38, 0xc6, 0xd6, 0xff, 0xdd, 0xb3, 0xe9, 0xf0,
    0x63, 0x27, 0xdb, 0xa9, 0x19, 0x2c, 0x03, 0x2a,
    0x00, 0x63, 0x03, 0x1c, 0xab, 0x8b, 0xfa, 0x8e,
    0x61, 0xe4, 0x32, 0x76, 0x1f, 0x95, 0x79, 0xa7,
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
///
/// These are the correct discriminators for the MXE instructions.
/// The MXE uses Anchor's standard discriminator format.
pub mod mxe_discriminators {
    /// compare_prices: sha256("global:compare_prices")[0..8]
    pub const COMPARE_PRICES: [u8; 8] = [0x0f, 0xe0, 0x51, 0x76, 0xbb, 0x73, 0xde, 0xa6];
    /// calculate_fill: sha256("global:calculate_fill")[0..8]
    pub const CALCULATE_FILL: [u8; 8] = [0xe2, 0xd3, 0xaf, 0xc6, 0x8b, 0xce, 0xa4, 0xd0];

    // === Perpetuals Operations ===
    /// verify_position_params: sha256("global:verify_position_params")[0..8]
    pub const VERIFY_POSITION_PARAMS: [u8; 8] = [0xa8, 0x7c, 0xc9, 0xca, 0x61, 0xbf, 0x86, 0x7c];
    /// check_liquidation: sha256("global:check_liquidation")[0..8]
    pub const CHECK_LIQUIDATION: [u8; 8] = [0x11, 0xa4, 0x28, 0xf9, 0xfd, 0xa2, 0x84, 0xb6];
    /// batch_liquidation_check: sha256("global:batch_liquidation_check")[0..8]
    pub const BATCH_LIQUIDATION_CHECK: [u8; 8] = [0x3e, 0x33, 0xc0, 0x49, 0x7f, 0xbb, 0xf2, 0xc9];
    /// calculate_pnl: sha256("global:calculate_pnl")[0..8]
    pub const CALCULATE_PNL: [u8; 8] = [0x59, 0xdf, 0x00, 0x06, 0xae, 0x49, 0x22, 0xb0];
    /// calculate_funding: sha256("global:calculate_funding")[0..8]
    pub const CALCULATE_FUNDING: [u8; 8] = [0x6d, 0x7e, 0x85, 0xc8, 0xe7, 0x30, 0xe3, 0x80];
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

/// Full accounts needed for MXE CPI (12 accounts required)
///
/// The MXE uses Arcium's `#[queue_computation_accounts]` macro which requires
/// exactly these 12 accounts in this order. The DEX must pass all accounts
/// when CPI-ing to the MXE.
///
/// Account derivation:
/// - sign_pda_account: seeds = ["ArciumSignerAccount"], program = MXE
/// - mxe_account: seeds = ["MXEAccount"], program = MXE
/// - mempool_account: from cluster offset via Arcium SDK
/// - executing_pool: from cluster offset via Arcium SDK
/// - computation_account: from computation_offset via Arcium SDK
/// - comp_def_account: from circuit name hash via Arcium SDK
/// - cluster_account: from cluster offset via Arcium SDK
/// - pool_account: ARCIUM_FEE_POOL_ACCOUNT_ADDRESS constant
/// - clock_account: ARCIUM_CLOCK_ACCOUNT_ADDRESS constant
pub struct MxeCpiAccounts<'a, 'info> {
    /// Payer for computation fees (signer)
    pub payer: &'a AccountInfo<'info>,
    /// MXE signer PDA (seeds: "ArciumSignerAccount")
    pub sign_pda_account: &'a AccountInfo<'info>,
    /// MXE account (seeds: "MXEAccount")
    pub mxe_account: &'a AccountInfo<'info>,
    /// Cluster mempool account
    pub mempool_account: &'a AccountInfo<'info>,
    /// Cluster executing pool account
    pub executing_pool: &'a AccountInfo<'info>,
    /// Computation account (for this specific computation)
    pub computation_account: &'a AccountInfo<'info>,
    /// Computation definition account (for the circuit)
    pub comp_def_account: &'a AccountInfo<'info>,
    /// Cluster account
    pub cluster_account: &'a AccountInfo<'info>,
    /// Arcium fee pool account
    pub pool_account: &'a AccountInfo<'info>,
    /// Arcium clock account
    pub clock_account: &'a AccountInfo<'info>,
    /// System program
    pub system_program: &'a AccountInfo<'info>,
    /// Arcium program
    pub arcium_program: &'a AccountInfo<'info>,
    /// MXE program (target of CPI)
    pub mxe_program: &'a AccountInfo<'info>,
}

/// LEGACY: Simplified accounts struct (DEPRECATED)
/// This was used before the migration to full Arcium patterns.
/// Use MxeCpiAccounts instead.
#[deprecated(since = "0.2.0", note = "Use MxeCpiAccounts with full 12 accounts")]
pub struct LegacyMxeCpiAccounts<'a, 'info> {
    pub mxe_config: &'a AccountInfo<'info>,
    pub request_account: &'a AccountInfo<'info>,
    pub requester: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub mxe_program: &'a AccountInfo<'info>,
}

/// Queue a price comparison computation via MPC
///
/// CPIs to arcium_mxe program to queue computation using the full 12-account structure
/// required by Arcium's `#[queue_computation_accounts]` macro.
///
/// Returns request_id for tracking. Result comes back via callback.
///
/// The MXE's compare_prices instruction expects:
/// - computation_offset: u64 (random seed for computation PDA)
/// - buy_price_ciphertext: [u8; 32] (only the ciphertext portion, not full 64 bytes)
/// - sell_price_ciphertext: [u8; 32]
/// - pub_key: [u8; 32] (X25519 public key for output encryption)
/// - nonce: u128 (encryption nonce)
/// - buy_order: Option<Pubkey> (order pubkey for callback CPI)
/// - sell_order: Option<Pubkey> (order pubkey for callback CPI)
pub fn queue_compare_prices<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    computation_offset: u64,
    buy_price: &EncryptedU64,
    sell_price: &EncryptedU64,
    pub_key: &[u8; 32],
    nonce: u128,
    buy_order: Option<&Pubkey>,
    sell_order: Option<&Pubkey>,
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: compare_prices (MPC) via MXE");

    // Build CPI instruction data matching MXE's expected format
    // Format: discriminator (8) + computation_offset (8) + buy_ciphertext (32) +
    //         sell_ciphertext (32) + pub_key (32) + nonce (16) +
    //         buy_order (Option<Pubkey> = 1 or 33 bytes) + sell_order (Option<Pubkey> = 1 or 33 bytes)
    //
    // Borsh serialization for Option<T>:
    //   None = [0x00]
    //   Some(value) = [0x01, ...value_bytes...]
    let buy_order_size = if buy_order.is_some() { 33 } else { 1 };
    let sell_order_size = if sell_order.is_some() { 33 } else { 1 };
    let total_size = 8 + 8 + 32 + 32 + 32 + 16 + buy_order_size + sell_order_size;

    let mut ix_data = Vec::with_capacity(total_size);
    ix_data.extend_from_slice(&mxe_discriminators::COMPARE_PRICES);
    ix_data.extend_from_slice(&computation_offset.to_le_bytes());
    // Extract the 32-byte ciphertext portion from the 64-byte encrypted value
    // V2 format: [nonce (16) | ciphertext (32) | ephemeral_pubkey (16)]
    ix_data.extend_from_slice(&buy_price[16..48]); // ciphertext only
    ix_data.extend_from_slice(&sell_price[16..48]); // ciphertext only
    ix_data.extend_from_slice(pub_key);
    ix_data.extend_from_slice(&nonce.to_le_bytes());

    // Serialize Option<Pubkey> for buy_order
    match buy_order {
        Some(pk) => {
            ix_data.push(0x01); // Some variant
            ix_data.extend_from_slice(pk.as_ref());
        }
        None => {
            ix_data.push(0x00); // None variant
        }
    }

    // Serialize Option<Pubkey> for sell_order
    match sell_order {
        Some(pk) => {
            ix_data.push(0x01); // Some variant
            ix_data.extend_from_slice(pk.as_ref());
        }
        None => {
            ix_data.push(0x00); // None variant
        }
    }

    // Build the 12-account structure required by Arcium's queue_computation
    let ix = Instruction {
        program_id: ARCIUM_MXE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*accounts.payer.key, true),            // 1. payer (signer)
            AccountMeta::new(*accounts.sign_pda_account.key, false), // 2. sign_pda
            AccountMeta::new(*accounts.mxe_account.key, false),      // 3. mxe_account
            AccountMeta::new(*accounts.mempool_account.key, false),  // 4. mempool
            AccountMeta::new(*accounts.executing_pool.key, false),   // 5. executing_pool
            AccountMeta::new(*accounts.computation_account.key, false), // 6. computation
            AccountMeta::new_readonly(*accounts.comp_def_account.key, false), // 7. comp_def
            AccountMeta::new(*accounts.cluster_account.key, false),  // 8. cluster
            AccountMeta::new(*accounts.pool_account.key, false),     // 9. fee_pool
            AccountMeta::new(*accounts.clock_account.key, false),    // 10. clock
            AccountMeta::new_readonly(*accounts.system_program.key, false), // 11. system
            AccountMeta::new_readonly(*accounts.arcium_program.key, false), // 12. arcium
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            accounts.payer.clone(),
            accounts.sign_pda_account.clone(),
            accounts.mxe_account.clone(),
            accounts.mempool_account.clone(),
            accounts.executing_pool.clone(),
            accounts.computation_account.clone(),
            accounts.comp_def_account.clone(),
            accounts.cluster_account.clone(),
            accounts.pool_account.clone(),
            accounts.clock_account.clone(),
            accounts.system_program.clone(),
            accounts.arcium_program.clone(),
        ],
    )?;

    // Use computation account's public key as request_id
    // This matches what MXE uses in compare_prices_callback:
    //   let request_id = ctx.accounts.computation_account.key().to_bytes();
    let request_id = accounts.computation_account.key.to_bytes();

    msg!("MXE CPI complete (compare_prices), computation_offset={}, request_id={:?}",
        computation_offset, &request_id[0..8]);

    Ok(QueuedComputation { request_id })
}

/// REMOVED IN MIGRATION: Sync price comparison extracted plaintext from ciphertext
///
/// This function has been removed because it:
/// 1. Extracted plaintext from ciphertext position 16-23 (CRITICAL SECURITY RISK)
/// 2. Bypassed MPC entirely, defeating the purpose of encryption
///
/// Use the async MPC flow via queue_compare_prices() or CPI to MXE.compare_prices() instead.
///
/// PANICS: This function always panics. Migration to proper MXE CPI required.
#[deprecated(since = "0.2.0", note = "Use queue_compare_prices() or CPI to MXE instead")]
#[allow(unused_variables)]
pub fn compare_encrypted_prices(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    _buy_price: &EncryptedU64,
    _sell_price: &EncryptedU64,
) -> Result<bool> {
    panic!(
        "FATAL: compare_encrypted_prices() sync fallback removed in migration. \
        This function extracted plaintext from ciphertext, defeating encryption. \
        Use queue_compare_prices() for async MPC or CPI to MXE.compare_prices()."
    );
}

/// Queue a fill amount calculation via MPC
///
/// CPIs to arcium_mxe program using the full 12-account structure.
/// Calculates: min(buy_remaining, sell_remaining) where remaining = amount - filled
pub fn queue_calculate_fill<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    computation_offset: u64,
    buy_amount: &EncryptedU64,
    buy_filled: &EncryptedU64,
    sell_amount: &EncryptedU64,
    sell_filled: &EncryptedU64,
    pub_key: &[u8; 32],
    nonce: u128,
    buy_order: Option<&Pubkey>,
    sell_order: Option<&Pubkey>,
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: calculate_fill (MPC) via MXE");

    // Build CPI instruction data
    // Format: discriminator (8) + computation_offset (8) + 4x ciphertext (32 each) +
    //         pub_key (32) + nonce (16) + buy_order (Option) + sell_order (Option)
    let buy_order_size = if buy_order.is_some() { 33 } else { 1 };
    let sell_order_size = if sell_order.is_some() { 33 } else { 1 };
    let total_size = 8 + 8 + 32 * 4 + 32 + 16 + buy_order_size + sell_order_size;

    let mut ix_data = Vec::with_capacity(total_size);
    ix_data.extend_from_slice(&mxe_discriminators::CALCULATE_FILL);
    ix_data.extend_from_slice(&computation_offset.to_le_bytes());
    // Extract 32-byte ciphertext portions from 64-byte encrypted values
    ix_data.extend_from_slice(&buy_amount[16..48]);
    ix_data.extend_from_slice(&buy_filled[16..48]);
    ix_data.extend_from_slice(&sell_amount[16..48]);
    ix_data.extend_from_slice(&sell_filled[16..48]);
    ix_data.extend_from_slice(pub_key);
    ix_data.extend_from_slice(&nonce.to_le_bytes());

    // Serialize Option<Pubkey> for buy_order
    match buy_order {
        Some(pk) => {
            ix_data.push(0x01);
            ix_data.extend_from_slice(pk.as_ref());
        }
        None => {
            ix_data.push(0x00);
        }
    }

    // Serialize Option<Pubkey> for sell_order
    match sell_order {
        Some(pk) => {
            ix_data.push(0x01);
            ix_data.extend_from_slice(pk.as_ref());
        }
        None => {
            ix_data.push(0x00);
        }
    }

    // Build the 12-account structure required by Arcium's queue_computation
    let ix = Instruction {
        program_id: ARCIUM_MXE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*accounts.payer.key, true),
            AccountMeta::new(*accounts.sign_pda_account.key, false),
            AccountMeta::new(*accounts.mxe_account.key, false),
            AccountMeta::new(*accounts.mempool_account.key, false),
            AccountMeta::new(*accounts.executing_pool.key, false),
            AccountMeta::new(*accounts.computation_account.key, false),
            AccountMeta::new_readonly(*accounts.comp_def_account.key, false),
            AccountMeta::new(*accounts.cluster_account.key, false),
            AccountMeta::new(*accounts.pool_account.key, false),
            AccountMeta::new(*accounts.clock_account.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
            AccountMeta::new_readonly(*accounts.arcium_program.key, false),
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            accounts.payer.clone(),
            accounts.sign_pda_account.clone(),
            accounts.mxe_account.clone(),
            accounts.mempool_account.clone(),
            accounts.executing_pool.clone(),
            accounts.computation_account.clone(),
            accounts.comp_def_account.clone(),
            accounts.cluster_account.clone(),
            accounts.pool_account.clone(),
            accounts.clock_account.clone(),
            accounts.system_program.clone(),
            accounts.arcium_program.clone(),
        ],
    )?;

    // Use computation account's public key as request_id (matches MXE callback)
    let request_id = accounts.computation_account.key.to_bytes();

    msg!("MXE CPI complete (calculate_fill), computation_offset={}, request_id={:?}",
        computation_offset, &request_id[0..8]);

    Ok(QueuedComputation { request_id })
}

/// REMOVED IN MIGRATION: Sync fill calculation extracted plaintext from ciphertext
///
/// This function has been removed because it:
/// 1. Extracted plaintext from ciphertext position 16-23 (CRITICAL SECURITY RISK)
/// 2. Bypassed MPC entirely, defeating the purpose of encryption
///
/// Use the async MPC flow via queue_calculate_fill() or CPI to MXE.calculate_fill() instead.
///
/// PANICS: This function always panics. Migration to proper MXE CPI required.
#[deprecated(since = "0.2.0", note = "Use queue_calculate_fill() or CPI to MXE instead")]
#[allow(unused_variables)]
pub fn calculate_encrypted_fill(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    _buy_amount: &EncryptedU64,
    _buy_filled: &EncryptedU64,
    _sell_amount: &EncryptedU64,
    _sell_filled: &EncryptedU64,
) -> Result<(EncryptedU64, bool, bool)> {
    panic!(
        "FATAL: calculate_encrypted_fill() sync fallback removed in migration. \
        This function extracted plaintext from ciphertext, defeating encryption. \
        Use queue_calculate_fill() for async MPC or CPI to MXE.calculate_fill()."
    );
}

/// REMOVED IN MIGRATION: On-chain "encryption" stored plaintext at known position
///
/// This function has been removed because it:
/// 1. Stored plaintext at offset 16-23, NOT actual encryption
/// 2. Created fake "ciphertext" that MPC couldn't decrypt
/// 3. Provided false sense of security
///
/// For public constants in MPC operations, use ArgBuilder.plaintext_u64() in the MXE.
/// User values must be encrypted client-side using RescueCipher.
///
/// PANICS: This function always panics. Migration to proper encryption required.
#[deprecated(since = "0.2.0", note = "Use client-side RescueCipher or ArgBuilder.plaintext_*()")]
#[allow(unused_variables)]
pub fn encrypt_value(
    _arcium_program: &AccountInfo,
    _mxe_pubkey: &[u8; 32],
    _value: u64,
) -> Result<EncryptedU64> {
    panic!(
        "FATAL: encrypt_value() removed in migration. \
        This function stored plaintext at known position, NOT actual encryption. \
        Use client-side RescueCipher for user values or ArgBuilder.plaintext_u64() for constants."
    );
}

/// REMOVED IN MIGRATION: Addition on encrypted data requires MPC
///
/// This function has been removed because it:
/// 1. Returned first operand unchanged (NOT actual addition)
/// 2. Created incorrect results silently
/// 3. Cannot perform arithmetic on ciphertext without MPC
///
/// Use MXE.add_encrypted() instruction via CPI, or redesign to use
/// async MPC computation queue.
///
/// PANICS: This function always panics. Migration to MXE CPI required.
#[deprecated(since = "0.2.0", note = "Use MXE CPI for encrypted arithmetic")]
#[allow(unused_variables)]
pub fn add_encrypted(
    _arcium_program: &AccountInfo,
    _a: &EncryptedU64,
    _b: &EncryptedU64,
) -> Result<EncryptedU64> {
    panic!(
        "FATAL: add_encrypted() cannot perform arithmetic on ciphertext without MPC. \
        This function returned first operand unchanged (incorrect). \
        Use MXE.add_encrypted() via CPI or redesign with async MPC queue."
    );
}

/// REMOVED IN MIGRATION: Subtraction on encrypted data requires MPC
///
/// This function has been removed because it:
/// 1. Returned first operand unchanged (NOT actual subtraction)
/// 2. Created incorrect results silently
/// 3. Cannot perform arithmetic on ciphertext without MPC
///
/// Use MXE.sub_encrypted() instruction via CPI, or redesign to use
/// async MPC computation queue.
///
/// PANICS: This function always panics. Migration to MXE CPI required.
#[deprecated(since = "0.2.0", note = "Use MXE CPI for encrypted arithmetic")]
#[allow(unused_variables)]
pub fn sub_encrypted(
    _arcium_program: &AccountInfo,
    _a: &EncryptedU64,
    _b: &EncryptedU64,
) -> Result<EncryptedU64> {
    panic!(
        "FATAL: sub_encrypted() cannot perform arithmetic on ciphertext without MPC. \
        This function returned first operand unchanged (incorrect). \
        Use MXE.sub_encrypted() via CPI or redesign with async MPC queue."
    );
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
    computation_offset: u64,
    encrypted_collateral: &EncryptedU64,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    claimed_threshold: u64,
    leverage: u8,
    is_long: bool,
    maintenance_margin_bps: u16,
    pub_key: &[u8; 32],
    nonce: u128,
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: verify_position_params (MPC) via MXE");

    // Build CPI instruction data
    let mut ix_data = Vec::with_capacity(8 + 8 + 32 * 3 + 8 + 1 + 1 + 2 + 32 + 16);
    ix_data.extend_from_slice(&mxe_discriminators::VERIFY_POSITION_PARAMS);
    ix_data.extend_from_slice(&computation_offset.to_le_bytes());
    // Extract 32-byte ciphertext portions
    ix_data.extend_from_slice(&encrypted_collateral[16..48]);
    ix_data.extend_from_slice(&encrypted_size[16..48]);
    ix_data.extend_from_slice(&encrypted_entry_price[16..48]);
    ix_data.extend_from_slice(&claimed_threshold.to_le_bytes());
    ix_data.push(leverage);
    ix_data.push(if is_long { 1 } else { 0 });
    ix_data.extend_from_slice(&maintenance_margin_bps.to_le_bytes());
    ix_data.extend_from_slice(pub_key);
    ix_data.extend_from_slice(&nonce.to_le_bytes());

    // Build the 12-account structure
    let ix = Instruction {
        program_id: ARCIUM_MXE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*accounts.payer.key, true),
            AccountMeta::new(*accounts.sign_pda_account.key, false),
            AccountMeta::new(*accounts.mxe_account.key, false),
            AccountMeta::new(*accounts.mempool_account.key, false),
            AccountMeta::new(*accounts.executing_pool.key, false),
            AccountMeta::new(*accounts.computation_account.key, false),
            AccountMeta::new_readonly(*accounts.comp_def_account.key, false),
            AccountMeta::new(*accounts.cluster_account.key, false),
            AccountMeta::new(*accounts.pool_account.key, false),
            AccountMeta::new(*accounts.clock_account.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
            AccountMeta::new_readonly(*accounts.arcium_program.key, false),
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            accounts.payer.clone(),
            accounts.sign_pda_account.clone(),
            accounts.mxe_account.clone(),
            accounts.mempool_account.clone(),
            accounts.executing_pool.clone(),
            accounts.computation_account.clone(),
            accounts.comp_def_account.clone(),
            accounts.cluster_account.clone(),
            accounts.pool_account.clone(),
            accounts.clock_account.clone(),
            accounts.system_program.clone(),
            accounts.arcium_program.clone(),
        ],
    )?;

    // Use computation account's public key as request_id (matches MXE callback)
    let request_id = accounts.computation_account.key.to_bytes();

    msg!("MXE CPI complete (verify_position_params), computation_offset={}, request_id={:?}",
        computation_offset, &request_id[0..8]);

    Ok(QueuedComputation { request_id })
}

/// Synchronous position params verification - REMOVED IN V5
///
/// This function previously provided a fallback that trusted claimed thresholds.
/// In V5, all position verification MUST use async MPC.
///
/// PANICS: This function always panics in V5. Use verify_position_params instead.
#[allow(unused_variables)]
pub fn verify_position_params_sync(
    _arcium_program: &AccountInfo,
    _cluster: &Pubkey,
    _encrypted_entry_price: &EncryptedU64,
    _claimed_threshold: u64,
    _leverage: u8,
    _is_long: bool,
    _maintenance_margin_bps: u16,
) -> Result<bool> {
    // V5 PRODUCTION: Sync MPC fallbacks are NOT allowed
    // All encrypted operations MUST use async MPC flow
    panic!(
        "FATAL: verify_position_params_sync fallback called in production. \
        V5 requires async MPC via verify_position_params(). \
        This indicates a code path that bypasses privacy guarantees."
    );
}

/// Check if a position should be liquidated based on current mark price via MPC
/// Inputs: encrypted position data + public mark price
/// Returns: bool (revealed) - whether position should be liquidated
pub fn check_liquidation<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    computation_offset: u64,
    encrypted_collateral: &EncryptedU64,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    mark_price: u64,
    is_long: bool,
    maintenance_margin_bps: u16,
    pub_key: &[u8; 32],
    nonce: u128,
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: check_liquidation (MPC) via MXE");

    let mut ix_data = Vec::with_capacity(8 + 8 + 32 * 3 + 8 + 1 + 2 + 32 + 16);
    ix_data.extend_from_slice(&mxe_discriminators::CHECK_LIQUIDATION);
    ix_data.extend_from_slice(&computation_offset.to_le_bytes());
    // Extract 32-byte ciphertext portions
    ix_data.extend_from_slice(&encrypted_collateral[16..48]);
    ix_data.extend_from_slice(&encrypted_size[16..48]);
    ix_data.extend_from_slice(&encrypted_entry_price[16..48]);
    ix_data.extend_from_slice(&mark_price.to_le_bytes());
    ix_data.push(if is_long { 1 } else { 0 });
    ix_data.extend_from_slice(&maintenance_margin_bps.to_le_bytes());
    ix_data.extend_from_slice(pub_key);
    ix_data.extend_from_slice(&nonce.to_le_bytes());

    // Build the 12-account structure
    let ix = Instruction {
        program_id: ARCIUM_MXE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*accounts.payer.key, true),
            AccountMeta::new(*accounts.sign_pda_account.key, false),
            AccountMeta::new(*accounts.mxe_account.key, false),
            AccountMeta::new(*accounts.mempool_account.key, false),
            AccountMeta::new(*accounts.executing_pool.key, false),
            AccountMeta::new(*accounts.computation_account.key, false),
            AccountMeta::new_readonly(*accounts.comp_def_account.key, false),
            AccountMeta::new(*accounts.cluster_account.key, false),
            AccountMeta::new(*accounts.pool_account.key, false),
            AccountMeta::new(*accounts.clock_account.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
            AccountMeta::new_readonly(*accounts.arcium_program.key, false),
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            accounts.payer.clone(),
            accounts.sign_pda_account.clone(),
            accounts.mxe_account.clone(),
            accounts.mempool_account.clone(),
            accounts.executing_pool.clone(),
            accounts.computation_account.clone(),
            accounts.comp_def_account.clone(),
            accounts.cluster_account.clone(),
            accounts.pool_account.clone(),
            accounts.clock_account.clone(),
            accounts.system_program.clone(),
            accounts.arcium_program.clone(),
        ],
    )?;

    // Use computation account's public key as request_id (matches MXE callback)
    let request_id = accounts.computation_account.key.to_bytes();

    msg!("MXE CPI complete (check_liquidation), computation_offset={}, request_id={:?}",
        computation_offset, &request_id[0..8]);

    Ok(QueuedComputation { request_id })
}

/// Synchronous liquidation check - REMOVED IN V5
///
/// This function previously provided a fallback for liquidation checks.
/// In V5, all liquidation checks MUST use async MPC batch verification.
///
/// PANICS: This function always panics in V5. Use queue_batch_liquidation_check instead.
#[allow(unused_variables)]
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
    // V5 PRODUCTION: Sync MPC fallbacks are NOT allowed
    // All encrypted operations MUST use async MPC flow
    panic!(
        "FATAL: check_liquidation_sync fallback called in production. \
        V5 requires async MPC via queue_batch_liquidation_check(). \
        This indicates a code path that bypasses privacy guarantees."
    );
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
    computation_offset: u64,
    positions: &[BatchLiquidationPositionData],
    mark_price: u64,
    pub_key: &[u8; 32],
    nonce: u128,
) -> Result<QueuedComputation> {
    if positions.is_empty() || positions.len() > 10 {
        return Err(error!(ArciumError::InvalidResult));
    }

    msg!("Arcium CPI: batch_liquidation_check (MPC) via MXE - {} positions", positions.len());

    // Build CPI instruction data
    // Format: discriminator + computation_offset + position_count + [ciphertext (32) + is_long] * count + mark_price + pub_key + nonce
    let mut ix_data = Vec::with_capacity(8 + 8 + 1 + (33 * positions.len()) + 8 + 32 + 16);
    ix_data.extend_from_slice(&mxe_discriminators::BATCH_LIQUIDATION_CHECK);
    ix_data.extend_from_slice(&computation_offset.to_le_bytes());
    ix_data.push(positions.len() as u8);

    for pos in positions {
        // Extract 32-byte ciphertext portion from 64-byte encrypted value
        ix_data.extend_from_slice(&pos.encrypted_liq_threshold[16..48]);
        ix_data.push(if pos.is_long { 1 } else { 0 });
    }

    ix_data.extend_from_slice(&mark_price.to_le_bytes());
    ix_data.extend_from_slice(pub_key);
    ix_data.extend_from_slice(&nonce.to_le_bytes());

    // Build the 12-account structure
    let ix = Instruction {
        program_id: ARCIUM_MXE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*accounts.payer.key, true),
            AccountMeta::new(*accounts.sign_pda_account.key, false),
            AccountMeta::new(*accounts.mxe_account.key, false),
            AccountMeta::new(*accounts.mempool_account.key, false),
            AccountMeta::new(*accounts.executing_pool.key, false),
            AccountMeta::new(*accounts.computation_account.key, false),
            AccountMeta::new_readonly(*accounts.comp_def_account.key, false),
            AccountMeta::new(*accounts.cluster_account.key, false),
            AccountMeta::new(*accounts.pool_account.key, false),
            AccountMeta::new(*accounts.clock_account.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
            AccountMeta::new_readonly(*accounts.arcium_program.key, false),
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            accounts.payer.clone(),
            accounts.sign_pda_account.clone(),
            accounts.mxe_account.clone(),
            accounts.mempool_account.clone(),
            accounts.executing_pool.clone(),
            accounts.computation_account.clone(),
            accounts.comp_def_account.clone(),
            accounts.cluster_account.clone(),
            accounts.pool_account.clone(),
            accounts.clock_account.clone(),
            accounts.system_program.clone(),
            accounts.arcium_program.clone(),
        ],
    )?;

    // Use computation account's public key as request_id (matches MXE callback)
    let request_id = accounts.computation_account.key.to_bytes();

    msg!("MXE CPI complete (batch_liquidation_check), computation_offset={}, request_id={:?}",
        computation_offset, &request_id[0..8]);

    Ok(QueuedComputation { request_id })
}

/// Calculate PnL for a position
/// Inputs: encrypted_size, encrypted_entry_price, exit_price (public), is_long (public)
/// Returns: encrypted_pnl (can be negative, stored as signed in first 8 bytes)
pub fn calculate_pnl<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    computation_offset: u64,
    encrypted_size: &EncryptedU64,
    encrypted_entry_price: &EncryptedU64,
    exit_price: u64,
    is_long: bool,
    pub_key: &[u8; 32],
    nonce: u128,
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: calculate_pnl (MPC) via MXE");

    let mut ix_data = Vec::with_capacity(8 + 8 + 32 * 2 + 8 + 1 + 32 + 16);
    ix_data.extend_from_slice(&mxe_discriminators::CALCULATE_PNL);
    ix_data.extend_from_slice(&computation_offset.to_le_bytes());
    // Extract 32-byte ciphertext portions
    ix_data.extend_from_slice(&encrypted_size[16..48]);
    ix_data.extend_from_slice(&encrypted_entry_price[16..48]);
    ix_data.extend_from_slice(&exit_price.to_le_bytes());
    ix_data.push(if is_long { 1 } else { 0 });
    ix_data.extend_from_slice(pub_key);
    ix_data.extend_from_slice(&nonce.to_le_bytes());

    // Build the 12-account structure
    let ix = Instruction {
        program_id: ARCIUM_MXE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*accounts.payer.key, true),
            AccountMeta::new(*accounts.sign_pda_account.key, false),
            AccountMeta::new(*accounts.mxe_account.key, false),
            AccountMeta::new(*accounts.mempool_account.key, false),
            AccountMeta::new(*accounts.executing_pool.key, false),
            AccountMeta::new(*accounts.computation_account.key, false),
            AccountMeta::new_readonly(*accounts.comp_def_account.key, false),
            AccountMeta::new(*accounts.cluster_account.key, false),
            AccountMeta::new(*accounts.pool_account.key, false),
            AccountMeta::new(*accounts.clock_account.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
            AccountMeta::new_readonly(*accounts.arcium_program.key, false),
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            accounts.payer.clone(),
            accounts.sign_pda_account.clone(),
            accounts.mxe_account.clone(),
            accounts.mempool_account.clone(),
            accounts.executing_pool.clone(),
            accounts.computation_account.clone(),
            accounts.comp_def_account.clone(),
            accounts.cluster_account.clone(),
            accounts.pool_account.clone(),
            accounts.clock_account.clone(),
            accounts.system_program.clone(),
            accounts.arcium_program.clone(),
        ],
    )?;

    // Use computation account's public key as request_id (matches MXE callback)
    let request_id = accounts.computation_account.key.to_bytes();

    msg!("MXE CPI complete (calculate_pnl), computation_offset={}, request_id={:?}",
        computation_offset, &request_id[0..8]);

    Ok(QueuedComputation { request_id })
}

/// Synchronous PnL calculation - REMOVED IN V5
///
/// This function previously provided a fallback that returned placeholder values.
/// In V5, all PnL calculation MUST use async MPC.
///
/// PANICS: This function always panics in V5. Use calculate_pnl instead.
#[allow(unused_variables)]
pub fn calculate_pnl_sync(
    _arcium_program: &AccountInfo,
    _encrypted_size: &EncryptedU64,
    _encrypted_entry_price: &EncryptedU64,
    _exit_price: u64,
    _is_long: bool,
) -> Result<(EncryptedU64, bool)> {
    // V5 PRODUCTION: Sync MPC fallbacks are NOT allowed
    // All encrypted operations MUST use async MPC flow
    panic!(
        "FATAL: calculate_pnl_sync fallback called in production. \
        V5 requires async MPC via calculate_pnl(). \
        This indicates a code path that bypasses privacy guarantees."
    );
}

/// Calculate funding payment for a position
/// Inputs: encrypted_size, funding_rate (public), funding_delta (public)
/// Returns: encrypted_funding_payment
pub fn calculate_funding<'info>(
    accounts: MxeCpiAccounts<'_, 'info>,
    computation_offset: u64,
    encrypted_size: &EncryptedU64,
    funding_rate: i64,
    funding_delta: i64,
    is_long: bool,
    pub_key: &[u8; 32],
    nonce: u128,
) -> Result<QueuedComputation> {
    msg!("Arcium CPI: calculate_funding (MPC) via MXE");

    let mut ix_data = Vec::with_capacity(8 + 8 + 32 + 8 + 8 + 1 + 32 + 16);
    ix_data.extend_from_slice(&mxe_discriminators::CALCULATE_FUNDING);
    ix_data.extend_from_slice(&computation_offset.to_le_bytes());
    // Extract 32-byte ciphertext portion
    ix_data.extend_from_slice(&encrypted_size[16..48]);
    ix_data.extend_from_slice(&funding_rate.to_le_bytes());
    ix_data.extend_from_slice(&funding_delta.to_le_bytes());
    ix_data.push(if is_long { 1 } else { 0 });
    ix_data.extend_from_slice(pub_key);
    ix_data.extend_from_slice(&nonce.to_le_bytes());

    // Build the 12-account structure
    let ix = Instruction {
        program_id: ARCIUM_MXE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*accounts.payer.key, true),
            AccountMeta::new(*accounts.sign_pda_account.key, false),
            AccountMeta::new(*accounts.mxe_account.key, false),
            AccountMeta::new(*accounts.mempool_account.key, false),
            AccountMeta::new(*accounts.executing_pool.key, false),
            AccountMeta::new(*accounts.computation_account.key, false),
            AccountMeta::new_readonly(*accounts.comp_def_account.key, false),
            AccountMeta::new(*accounts.cluster_account.key, false),
            AccountMeta::new(*accounts.pool_account.key, false),
            AccountMeta::new(*accounts.clock_account.key, false),
            AccountMeta::new_readonly(*accounts.system_program.key, false),
            AccountMeta::new_readonly(*accounts.arcium_program.key, false),
        ],
        data: ix_data,
    };

    invoke(
        &ix,
        &[
            accounts.payer.clone(),
            accounts.sign_pda_account.clone(),
            accounts.mxe_account.clone(),
            accounts.mempool_account.clone(),
            accounts.executing_pool.clone(),
            accounts.computation_account.clone(),
            accounts.comp_def_account.clone(),
            accounts.cluster_account.clone(),
            accounts.pool_account.clone(),
            accounts.clock_account.clone(),
            accounts.system_program.clone(),
            accounts.arcium_program.clone(),
        ],
    )?;

    // Use computation account's public key as request_id (matches MXE callback)
    let request_id = accounts.computation_account.key.to_bytes();

    msg!("MXE CPI complete (calculate_funding), computation_offset={}, request_id={:?}",
        computation_offset, &request_id[0..8]);

    Ok(QueuedComputation { request_id })
}

/// Synchronous funding calculation - REMOVED IN V5
///
/// This function previously provided a fallback that returned placeholder values.
/// In V5, all funding calculation MUST use async MPC.
///
/// PANICS: This function always panics in V5. Use calculate_funding instead.
#[allow(unused_variables)]
pub fn calculate_funding_sync(
    _arcium_program: &AccountInfo,
    _encrypted_size: &EncryptedU64,
    _funding_delta: i64,
    _is_long: bool,
) -> Result<(EncryptedU64, bool)> {
    // V5 PRODUCTION: Sync MPC fallbacks are NOT allowed
    // All encrypted operations MUST use async MPC flow
    panic!(
        "FATAL: calculate_funding_sync fallback called in production. \
        V5 requires async MPC via calculate_funding(). \
        This indicates a code path that bypasses privacy guarantees."
    );
}

/// REMOVED IN MIGRATION: Multiplication on encrypted data requires MPC
///
/// This function has been removed because it:
/// 1. Returned first operand unchanged (NOT actual multiplication)
/// 2. Created incorrect results silently
/// 3. Cannot perform arithmetic on ciphertext without MPC
///
/// Use MXE.mul_encrypted() instruction via CPI, or redesign to use
/// async MPC computation queue.
///
/// PANICS: This function always panics. Migration to MXE CPI required.
#[deprecated(since = "0.2.0", note = "Use MXE CPI for encrypted arithmetic")]
#[allow(unused_variables)]
pub fn mul_encrypted(
    _arcium_program: &AccountInfo,
    _a: &EncryptedU64,
    _b: &EncryptedU64,
) -> Result<EncryptedU64> {
    panic!(
        "FATAL: mul_encrypted() cannot perform arithmetic on ciphertext without MPC. \
        This function returned first operand unchanged (incorrect). \
        Use MXE.mul_encrypted() via CPI or redesign with async MPC queue."
    );
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

// =============================================================================
// CONSTANT VERIFICATION TESTS
// =============================================================================
// These tests verify that hardcoded program ID bytes match expected Base58 strings.
// If these tests fail, it means the hardcoded bytes are out of sync.

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify ARCIUM_PROGRAM_ID matches expected Base58 string
    #[test]
    fn verify_arcium_program_id() {
        assert_eq!(
            ARCIUM_PROGRAM_ID.to_string(),
            "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ",
            "ARCIUM_PROGRAM_ID bytes do not match expected Base58"
        );
    }

    /// Verify ARCIUM_MXE_PROGRAM_ID matches expected Base58 string
    #[test]
    fn verify_arcium_mxe_program_id() {
        assert_eq!(
            ARCIUM_MXE_PROGRAM_ID.to_string(),
            "4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi",
            "ARCIUM_MXE_PROGRAM_ID bytes do not match expected Base58"
        );
    }

    /// Verify DEFAULT_CLUSTER_OFFSET is a valid devnet cluster
    #[test]
    fn verify_cluster_offset() {
        // Valid devnet clusters: 456 (v0.6.3), 789 (v0.5.1)
        // Note: Cluster 123 does NOT exist
        assert!(
            DEFAULT_CLUSTER_OFFSET == 456 || DEFAULT_CLUSTER_OFFSET == 789,
            "DEFAULT_CLUSTER_OFFSET must be 456 or 789 for devnet"
        );
    }
}
