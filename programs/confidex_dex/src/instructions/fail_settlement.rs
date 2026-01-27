use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, ExchangeState, OrderStatus, SettlementRequest, SettlementStatus};

/// Failure reason for settlement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum FailureReason {
    /// ShadowWire transfer failed (API error, insufficient balance, etc.)
    TransferFailed,
    /// MPC decryption failed
    MpcFailed,
    /// Timeout waiting for transfer confirmation
    Timeout,
    /// Manual intervention required
    ManualIntervention,
    /// Unknown or unspecified failure
    Unknown,
}

/// Accounts for failing a settlement
///
/// This instruction marks a settlement as failed and optionally triggers
/// rollback if a partial transfer occurred (base transferred but quote failed).
#[derive(Accounts)]
pub struct FailSettlement<'info> {
    /// Settlement request to fail
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

    /// Buy order - status will be reset to Active if not partially filled elsewhere
    #[account(
        mut,
        constraint = buy_order.key() == settlement_request.buy_order @ ConfidexError::InvalidOrder,
    )]
    pub buy_order: Box<Account<'info, ConfidentialOrder>>,

    /// Sell order - status will be reset to Active if not partially filled elsewhere
    #[account(
        mut,
        constraint = sell_order.key() == settlement_request.sell_order @ ConfidexError::InvalidOrder,
    )]
    pub sell_order: Box<Account<'info, ConfidentialOrder>>,

    /// Exchange state (for verifying authority)
    #[account(
        seeds = [ExchangeState::SEED],
        bump = exchange.bump,
    )]
    pub exchange: Box<Account<'info, ExchangeState>>,

    /// Crank authority - only authorized callers can fail settlements
    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Parameters for fail_settlement instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FailSettlementParams {
    /// Reason for failure
    pub reason: FailureReason,
    /// Optional error message (truncated to 64 bytes for on-chain storage)
    pub error_message: Option<String>,
}

/// Fail a settlement that cannot complete
///
/// This instruction handles settlement failures:
/// - If no transfers occurred (Pending): marks Failed, returns orders to Active
/// - If base transferred but quote failed: marks RollingBack, emits rollback event
///
/// The backend must handle the actual rollback (reverse transfer) and then
/// call expire_settlement or update the status manually.
///
/// # Arguments
/// * `ctx` - Instruction context
/// * `params` - Failure details including reason
///
/// # Errors
/// * `CannotFailSettlement` - Settlement is not in a failible state
/// * `SettlementExpired` - Settlement has already expired
pub fn handler(ctx: Context<FailSettlement>, params: FailSettlementParams) -> Result<()> {
    let settlement = &mut ctx.accounts.settlement_request;
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let clock = Clock::get()?;

    // Verify settlement can be failed
    require!(settlement.can_fail(), ConfidexError::CannotFailSettlement);

    // Check if already expired (should use expire_settlement instead)
    require!(
        !settlement.is_expired(clock.unix_timestamp),
        ConfidexError::SettlementExpired
    );

    // Determine if rollback is needed
    let needs_rollback = settlement.requires_rollback();

    if needs_rollback {
        // Base transfer occurred but quote failed - need to reverse
        settlement.status = SettlementStatus::RollingBack;

        emit!(SettlementRollbackRequired {
            settlement_request: settlement.key(),
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            base_transfer_id: settlement.base_transfer_id,
            reason: params.reason,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Settlement {} requires rollback - base transfer must be reversed",
            settlement.key()
        );
    } else {
        // No transfers occurred - can fail directly
        settlement.status = SettlementStatus::Failed;

        // Reset orders to matchable state
        buy_order.status = OrderStatus::Active;
        sell_order.status = OrderStatus::Active;
        buy_order.is_matching = false;
        sell_order.is_matching = false;
        buy_order.pending_match_request = [0u8; 32];
        sell_order.pending_match_request = [0u8; 32];

        emit!(SettlementFailed {
            settlement_request: settlement.key(),
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            buy_order_id: buy_order.order_id,
            sell_order_id: sell_order.order_id,
            reason: params.reason,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Settlement {} failed (reason: {:?}), orders returned to active",
            settlement.key(),
            params.reason
        );
    }

    Ok(())
}

/// Event emitted when settlement fails without needing rollback
#[event]
pub struct SettlementFailed {
    /// Settlement request PDA
    pub settlement_request: Pubkey,
    /// Buy order PDA
    pub buy_order: Pubkey,
    /// Sell order PDA
    pub sell_order: Pubkey,
    /// Buy order hash-based ID
    pub buy_order_id: [u8; 16],
    /// Sell order hash-based ID
    pub sell_order_id: [u8; 16],
    /// Failure reason
    pub reason: FailureReason,
    /// Timestamp when failure was recorded
    pub timestamp: i64,
}

/// Event emitted when settlement needs rollback (partial transfer occurred)
#[event]
pub struct SettlementRollbackRequired {
    /// Settlement request PDA
    pub settlement_request: Pubkey,
    /// Buy order PDA
    pub buy_order: Pubkey,
    /// Sell order PDA
    pub sell_order: Pubkey,
    /// Base transfer ID that needs to be reversed
    pub base_transfer_id: [u8; 32],
    /// Original failure reason
    pub reason: FailureReason,
    /// Timestamp when rollback was triggered
    pub timestamp: i64,
}
