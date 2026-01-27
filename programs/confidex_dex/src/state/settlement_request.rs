use anchor_lang::prelude::*;

/// Settlement status tracking
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum SettlementStatus {
    #[default]
    /// Settlement initiated, waiting for first transfer
    Pending,
    /// Base token transfer completed via ShadowWire
    BaseTransferred,
    /// Quote token transfer completed via ShadowWire
    QuoteTransferred,
    /// Both transfers complete, settlement finalized
    Completed,
    /// Settlement failed (transfer error, timeout, etc.)
    Failed,
    /// Settlement expired before completion
    Expired,
    /// Settlement is being rolled back (partial transfer reversal in progress)
    RollingBack,
}

/// Settlement method enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum SettlementMethod {
    #[default]
    /// ShadowWire (Bulletproof ZK, 1% fee)
    ShadowWire,
    /// C-SPL Confidential Transfer (Arcium MPC, 0% fee) - not yet available
    Cspl,
    /// Standard SPL Transfer (no privacy, fallback)
    StandardSpl,
}

impl From<u8> for SettlementMethod {
    fn from(value: u8) -> Self {
        match value {
            0 => SettlementMethod::ShadowWire,
            1 => SettlementMethod::Cspl,
            _ => SettlementMethod::StandardSpl,
        }
    }
}

impl From<SettlementMethod> for u8 {
    fn from(value: SettlementMethod) -> Self {
        match value {
            SettlementMethod::ShadowWire => 0,
            SettlementMethod::Cspl => 1,
            SettlementMethod::StandardSpl => 2,
        }
    }
}

/// Settlement request account for tracking two-phase ShadowWire settlement
///
/// This account is created when settlement is initiated and tracks the lifecycle:
/// 1. Pending - Settlement initiated, waiting for backend to execute transfers
/// 2. BaseTransferred - First transfer (base token: seller -> buyer) complete
/// 3. QuoteTransferred - Second transfer (quote token: buyer -> seller) complete
/// 4. Completed - Both transfers confirmed, orders marked as filled
///
/// The settlement uses encrypted values from the orders - decrypted amounts
/// are obtained via MPC callbacks and never stored on-chain.
#[account]
pub struct SettlementRequest {
    /// Buy order being settled
    pub buy_order: Pubkey,

    /// Sell order being settled
    pub sell_order: Pubkey,

    /// Settlement method (ShadowWire, CSPL, StandardSPL)
    pub method: SettlementMethod,

    /// Current settlement status
    pub status: SettlementStatus,

    /// Base token mint (the asset being traded)
    pub base_mint: Pubkey,

    /// Quote token mint (the settlement currency, usually USDC)
    pub quote_mint: Pubkey,

    /// Encrypted fill amount copied from order (64 bytes V2 format)
    /// Backend obtains decrypted value via MPC for actual transfer
    pub encrypted_fill_amount: [u8; 64],

    /// Encrypted fill value (amount * price) computed at initiation
    /// Backend obtains decrypted value via MPC for actual transfer
    pub encrypted_fill_value: [u8; 64],

    /// ShadowWire transfer ID for base token (32 bytes, set after transfer)
    /// None until base transfer is recorded
    pub base_transfer_id: [u8; 32],
    pub base_transfer_set: bool,

    /// ShadowWire transfer ID for quote token (32 bytes, set after transfer)
    /// None until quote transfer is recorded
    pub quote_transfer_id: [u8; 32],
    pub quote_transfer_set: bool,

    /// Buyer's public key (from buy order)
    pub buyer: Pubkey,

    /// Seller's public key (from sell order)
    pub seller: Pubkey,

    /// Unix timestamp when settlement was initiated
    pub created_at: i64,

    /// Unix timestamp when settlement expires (created_at + EXPIRY_SECONDS)
    pub expires_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl SettlementRequest {
    /// Settlement expiry time in seconds (5 minutes)
    pub const EXPIRY_SECONDS: i64 = 300;

    /// PDA seed prefix
    pub const SEED: &'static [u8] = b"settlement";

    /// Account size calculation
    /// discriminator (8) + buy_order (32) + sell_order (32) + method (1) + status (1) +
    /// base_mint (32) + quote_mint (32) + encrypted_fill_amount (64) + encrypted_fill_value (64) +
    /// base_transfer_id (32) + base_transfer_set (1) + quote_transfer_id (32) + quote_transfer_set (1) +
    /// buyer (32) + seller (32) + created_at (8) + expires_at (8) + bump (1)
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 1 + 32 + 32 + 64 + 64 + 32 + 1 + 32 + 1 + 32 + 32 + 8 + 8 + 1;
    // Total: 413 bytes

    /// Check if settlement has expired
    pub fn is_expired(&self, current_timestamp: i64) -> bool {
        current_timestamp > self.expires_at
    }

    /// Check if settlement can be finalized (both transfers complete)
    pub fn can_finalize(&self) -> bool {
        matches!(self.status, SettlementStatus::QuoteTransferred)
    }

    /// Check if base transfer can be recorded
    pub fn can_record_base_transfer(&self) -> bool {
        matches!(self.status, SettlementStatus::Pending) && !self.base_transfer_set
    }

    /// Check if quote transfer can be recorded
    pub fn can_record_quote_transfer(&self) -> bool {
        matches!(self.status, SettlementStatus::BaseTransferred) && !self.quote_transfer_set
    }

    /// Check if settlement can be marked as failed
    /// Can fail from Pending or BaseTransferred states
    pub fn can_fail(&self) -> bool {
        matches!(
            self.status,
            SettlementStatus::Pending | SettlementStatus::BaseTransferred
        )
    }

    /// Check if settlement requires rollback (has partial transfer)
    pub fn requires_rollback(&self) -> bool {
        self.base_transfer_set && !self.quote_transfer_set
    }

    /// Check if settlement can be expired
    /// Can only expire from Pending, BaseTransferred, or RollingBack states
    pub fn can_expire(&self) -> bool {
        matches!(
            self.status,
            SettlementStatus::Pending
                | SettlementStatus::BaseTransferred
                | SettlementStatus::RollingBack
        )
    }

    /// Check if settlement is in a terminal state
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            SettlementStatus::Completed | SettlementStatus::Failed | SettlementStatus::Expired
        )
    }
}
