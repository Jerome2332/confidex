//! Arcium MXE Program for Confidex
//!
//! This program defines the Multi-Party Execution Environment (MXE)
//! computations for confidential order matching.
//!
//! In production, this would be deployed to an Arcium cluster and
//! executed by Arx nodes using the Cerberus MPC protocol.
//!
//! Key computations:
//! - compare_prices: Check if buy_price >= sell_price
//! - calculate_fill: Compute min(buy_remaining, sell_remaining)
//! - update_balances: Atomic balance transfers after match

use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;

use instructions::*;

declare_id!("CKRX2k2Fsa3t2yYUxtr8Gy5D9poW2ut3wKCyLUc51SgX");

#[program]
pub mod arcium_mxe {
    use super::*;

    /// Initialize the MXE with cluster configuration
    pub fn initialize(ctx: Context<InitializeMxe>, cluster_id: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, cluster_id)
    }

    /// Queue a price comparison computation
    /// Returns true if buy_price >= sell_price (orders can match)
    pub fn queue_compare_prices(
        ctx: Context<QueueComputation>,
        buy_price_encrypted: [u8; 64],
        sell_price_encrypted: [u8; 64],
        callback_program: Pubkey,
        callback_discriminator: [u8; 8],
    ) -> Result<()> {
        instructions::compare_prices::handler(
            ctx,
            buy_price_encrypted,
            sell_price_encrypted,
            callback_program,
            callback_discriminator,
        )
    }

    /// Queue a fill amount calculation
    /// Returns min(buy_remaining, sell_remaining) encrypted
    pub fn queue_calculate_fill(
        ctx: Context<QueueComputation>,
        buy_amount_encrypted: [u8; 64],
        buy_filled_encrypted: [u8; 64],
        sell_amount_encrypted: [u8; 64],
        sell_filled_encrypted: [u8; 64],
        callback_program: Pubkey,
        callback_discriminator: [u8; 8],
    ) -> Result<()> {
        instructions::calculate_fill::handler(
            ctx,
            buy_amount_encrypted,
            buy_filled_encrypted,
            sell_amount_encrypted,
            sell_filled_encrypted,
            callback_program,
            callback_discriminator,
        )
    }

    /// Process callback from Arcium cluster with computation result
    pub fn process_callback(
        ctx: Context<ProcessCallback>,
        request_id: [u8; 32],
        result: Vec<u8>,
        success: bool,
    ) -> Result<()> {
        instructions::callback::handler(ctx, request_id, result, success)
    }
}
