use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ExchangeState, SettlementRequest, SettlementStatus};

/// Transfer type for ShadowWire settlement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TransferType {
    /// Base token transfer (seller -> buyer)
    Base,
    /// Quote token transfer (buyer -> seller)
    Quote,
}

/// Accounts for recording a ShadowWire transfer
///
/// Called by the backend crank after executing a ShadowWire transfer.
/// Updates the settlement state machine with the transfer ID.
#[derive(Accounts)]
pub struct RecordShadowWireTransfer<'info> {
    /// Settlement request being updated
    #[account(
        mut,
        seeds = [
            SettlementRequest::SEED,
            settlement_request.buy_order.as_ref(),
            settlement_request.sell_order.as_ref(),
        ],
        bump = settlement_request.bump,
    )]
    pub settlement_request: Box<Account<'info, SettlementRequest>>,

    /// Exchange state (for verifying crank authority)
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,

    /// Crank authority - must be the exchange authority or an authorized crank
    /// For now we allow any signer, but in production this should be restricted
    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Parameters for record_shadowwire_transfer instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RecordTransferParams {
    /// Type of transfer being recorded (Base or Quote)
    pub transfer_type: TransferType,
    /// ShadowWire transfer ID (32 bytes)
    pub transfer_id: [u8; 32],
}

/// Record a ShadowWire transfer completion
///
/// Called by the backend after successfully executing a transfer via
/// the ShadowWire API. Updates the settlement state machine.
///
/// State transitions:
/// - Pending + Base transfer -> BaseTransferred
/// - BaseTransferred + Quote transfer -> QuoteTransferred
///
/// # Arguments
/// * `ctx` - Instruction context
/// * `params` - Transfer details including type and ID
///
/// # Errors
/// * `InvalidOrder` - Settlement is not in the correct state for this transfer
/// * `SettlementFailed` - Settlement has expired or already failed
pub fn handler(ctx: Context<RecordShadowWireTransfer>, params: RecordTransferParams) -> Result<()> {
    let settlement = &mut ctx.accounts.settlement_request;
    let clock = Clock::get()?;

    // Check settlement hasn't expired
    require!(
        !settlement.is_expired(clock.unix_timestamp),
        ConfidexError::SettlementFailed
    );

    // Check settlement hasn't already failed
    require!(
        !matches!(settlement.status, SettlementStatus::Failed | SettlementStatus::Expired),
        ConfidexError::SettlementFailed
    );

    match params.transfer_type {
        TransferType::Base => {
            // Validate state transition: Pending -> BaseTransferred
            require!(
                settlement.can_record_base_transfer(),
                ConfidexError::InvalidOrder
            );

            // Record base transfer
            settlement.base_transfer_id = params.transfer_id;
            settlement.base_transfer_set = true;
            settlement.status = SettlementStatus::BaseTransferred;

            emit!(BaseTransferRecorded {
                settlement_request: settlement.key(),
                transfer_id: params.transfer_id,
                timestamp: clock.unix_timestamp,
            });

            msg!(
                "Base transfer recorded for settlement: {}",
                settlement.key()
            );
        }
        TransferType::Quote => {
            // Validate state transition: BaseTransferred -> QuoteTransferred
            require!(
                settlement.can_record_quote_transfer(),
                ConfidexError::InvalidOrder
            );

            // Record quote transfer
            settlement.quote_transfer_id = params.transfer_id;
            settlement.quote_transfer_set = true;
            settlement.status = SettlementStatus::QuoteTransferred;

            emit!(QuoteTransferRecorded {
                settlement_request: settlement.key(),
                transfer_id: params.transfer_id,
                timestamp: clock.unix_timestamp,
            });

            msg!(
                "Quote transfer recorded for settlement: {} - ready to finalize",
                settlement.key()
            );
        }
    }

    Ok(())
}

/// Event emitted when base token transfer is recorded
#[event]
pub struct BaseTransferRecorded {
    /// Settlement request PDA
    pub settlement_request: Pubkey,
    /// ShadowWire transfer ID
    pub transfer_id: [u8; 32],
    /// Timestamp when recorded
    pub timestamp: i64,
}

/// Event emitted when quote token transfer is recorded
#[event]
pub struct QuoteTransferRecorded {
    /// Settlement request PDA
    pub settlement_request: Pubkey,
    /// ShadowWire transfer ID
    pub transfer_id: [u8; 32],
    /// Timestamp when recorded
    pub timestamp: i64,
}
