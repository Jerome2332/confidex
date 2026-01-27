use anchor_lang::prelude::*;

use crate::error::ConfidexError;
use crate::state::{ConfidentialOrder, OrderStatus, SettlementRequest, SettlementStatus};

/// Accounts for expiring a settlement
///
/// This instruction can be called by anyone if the settlement has passed
/// its expiry time. It returns orders to matchable state and marks the
/// settlement as expired.
///
/// If a partial transfer occurred, the settlement will be marked for
/// manual intervention rather than automatically returning orders.
#[derive(Accounts)]
pub struct ExpireSettlement<'info> {
    /// Settlement request to expire
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

    /// Buy order - status may be reset to Active
    #[account(
        mut,
        constraint = buy_order.key() == settlement_request.buy_order @ ConfidexError::InvalidOrder,
    )]
    pub buy_order: Box<Account<'info, ConfidentialOrder>>,

    /// Sell order - status may be reset to Active
    #[account(
        mut,
        constraint = sell_order.key() == settlement_request.sell_order @ ConfidexError::InvalidOrder,
    )]
    pub sell_order: Box<Account<'info, ConfidentialOrder>>,

    /// Caller - anyone can expire a settlement after expiry time
    /// This allows permissionless cleanup of stale settlements
    pub caller: Signer<'info>,
}

/// Expire a settlement that has passed its deadline
///
/// This instruction handles expired settlements:
/// - If no transfers occurred: marks Expired, returns orders to Active
/// - If partial transfer occurred: marks RollingBack (needs manual intervention)
/// - If rollback already in progress: marks Expired, flags for manual review
///
/// # Security
/// Anyone can call this instruction after the expiry time. This ensures
/// settlements don't remain stuck indefinitely. However, actual fund recovery
/// for partial transfers requires authorized rollback execution.
///
/// # Arguments
/// * `ctx` - Instruction context
///
/// # Errors
/// * `SettlementNotExpired` - Settlement hasn't reached expiry time
/// * `CannotFailSettlement` - Settlement is in a terminal state
pub fn handler(ctx: Context<ExpireSettlement>) -> Result<()> {
    let settlement = &mut ctx.accounts.settlement_request;
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let clock = Clock::get()?;

    // Verify settlement has expired
    require!(
        settlement.is_expired(clock.unix_timestamp),
        ConfidexError::SettlementFailed // Reuse error - settlement hasn't failed/expired yet
    );

    // Verify settlement is not already in a terminal state
    require!(!settlement.is_terminal(), ConfidexError::CannotFailSettlement);

    // Handle based on current state
    let had_partial_transfer = settlement.requires_rollback();

    if settlement.status == SettlementStatus::RollingBack {
        // Rollback was already in progress - mark as expired
        // This indicates rollback timed out and needs manual intervention
        settlement.status = SettlementStatus::Expired;

        emit!(SettlementExpiredWithPendingRollback {
            settlement_request: settlement.key(),
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            base_transfer_id: settlement.base_transfer_id,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Settlement {} expired with pending rollback - manual intervention required",
            settlement.key()
        );
    } else if had_partial_transfer {
        // Base transfer occurred but expired before quote - need rollback
        settlement.status = SettlementStatus::RollingBack;

        emit!(SettlementExpiredNeedsRollback {
            settlement_request: settlement.key(),
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            base_transfer_id: settlement.base_transfer_id,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Settlement {} expired with partial transfer - rollback required",
            settlement.key()
        );
    } else {
        // No transfers occurred - safe to return orders to active
        settlement.status = SettlementStatus::Expired;

        // Reset orders to matchable state
        buy_order.status = OrderStatus::Active;
        sell_order.status = OrderStatus::Active;
        buy_order.is_matching = false;
        sell_order.is_matching = false;
        buy_order.pending_match_request = [0u8; 32];
        sell_order.pending_match_request = [0u8; 32];

        emit!(SettlementExpired {
            settlement_request: settlement.key(),
            buy_order: buy_order.key(),
            sell_order: sell_order.key(),
            buy_order_id: buy_order.order_id,
            sell_order_id: sell_order.order_id,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Settlement {} expired, orders {} and {} returned to active",
            settlement.key(),
            buy_order.key(),
            sell_order.key()
        );
    }

    Ok(())
}

/// Event emitted when settlement expires without partial transfers
#[event]
pub struct SettlementExpired {
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
    /// Timestamp when expiry was processed
    pub timestamp: i64,
}

/// Event emitted when settlement expires with partial transfer needing rollback
#[event]
pub struct SettlementExpiredNeedsRollback {
    /// Settlement request PDA
    pub settlement_request: Pubkey,
    /// Buy order PDA
    pub buy_order: Pubkey,
    /// Sell order PDA
    pub sell_order: Pubkey,
    /// Base transfer ID that needs to be reversed
    pub base_transfer_id: [u8; 32],
    /// Timestamp when expiry was processed
    pub timestamp: i64,
}

/// Event emitted when settlement expires while rollback was already pending
#[event]
pub struct SettlementExpiredWithPendingRollback {
    /// Settlement request PDA
    pub settlement_request: Pubkey,
    /// Buy order PDA
    pub buy_order: Pubkey,
    /// Sell order PDA
    pub sell_order: Pubkey,
    /// Base transfer ID that was being rolled back
    pub base_transfer_id: [u8; 32],
    /// Timestamp when expiry was processed
    pub timestamp: i64,
}
