use anchor_lang::prelude::*;

#[error_code]
pub enum ConfidexError {
    #[msg("Exchange is currently paused")]
    ExchangePaused,

    #[msg("Exchange is not paused")]
    ExchangeNotPaused,

    #[msg("Unauthorized access")]
    Unauthorized,

    #[msg("Invalid fee basis points (must be <= 10000)")]
    InvalidFeeBps,

    #[msg("Trading pair is not active")]
    PairNotActive,

    #[msg("Trading pair already exists")]
    PairAlreadyExists,

    #[msg("Order amount below minimum")]
    OrderBelowMinimum,

    #[msg("Order is not open")]
    OrderNotOpen,

    #[msg("Order does not belong to this user")]
    OrderOwnerMismatch,

    #[msg("Invalid order")]
    InvalidOrder,

    #[msg("Order is not filled (cannot settle)")]
    OrderNotFilled,

    #[msg("Invalid order side for matching")]
    InvalidOrderSide,

    #[msg("Orders are not matchable")]
    OrdersNotMatchable,

    #[msg("Order is already in a pending match")]
    OrderAlreadyMatching,

    #[msg("Eligibility proof verification failed")]
    EligibilityProofFailed,

    #[msg("Eligibility proof not verified")]
    EligibilityNotVerified,

    #[msg("Invalid proof length")]
    InvalidProofLength,

    #[msg("Invalid merkle root")]
    InvalidMerkleRoot,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Insufficient balance")]
    InsufficientBalance,

    #[msg("Invalid token mint")]
    InvalidTokenMint,

    #[msg("Invalid vault account")]
    InvalidVault,

    #[msg("Settlement failed")]
    SettlementFailed,

    #[msg("MPC operation failed")]
    MpcOperationFailed,

    #[msg("Invalid encrypted data length")]
    InvalidEncryptedDataLength,

    #[msg("Invalid amount format")]
    InvalidAmount,

    // === Perpetuals Errors ===

    #[msg("Invalid leverage (must be 1-20)")]
    InvalidLeverage,

    #[msg("Invalid margin basis points")]
    InvalidMarginBps,

    #[msg("Invalid funding interval")]
    InvalidFundingInterval,

    #[msg("Funding state does not match market")]
    InvalidFundingState,

    #[msg("Invalid ADL threshold (must be > 0)")]
    InvalidAdlThreshold,

    #[msg("Funding update not due yet")]
    FundingNotDue,

    #[msg("Market is not active")]
    MarketNotActive,

    #[msg("Position is not open")]
    PositionNotOpen,

    #[msg("Position is not liquidatable")]
    PositionNotLiquidatable,

    #[msg("Liquidation threshold not verified by MPC")]
    ThresholdNotVerified,

    #[msg("Invalid liquidation threshold - MPC verification failed")]
    InvalidLiquidationThreshold,

    #[msg("Open interest limit exceeded")]
    OpenInterestLimitExceeded,

    #[msg("Insufficient collateral for position")]
    InsufficientCollateral,

    #[msg("Position size too small")]
    PositionTooSmall,

    #[msg("Invalid oracle price")]
    InvalidOraclePrice,

    #[msg("Oracle price is stale")]
    StaleOraclePrice,

    #[msg("Insurance fund depleted")]
    InsuranceFundDepleted,

    #[msg("Liquidation threshold does not match position parameters")]
    ThresholdMismatch,

    #[msg("Insurance fund not depleted - ADL not triggered")]
    InsuranceFundNotDepleted,

    #[msg("Position is not liquidatable at current price")]
    NotLiquidatable,

    #[msg("Invalid token mint")]
    InvalidMint,

    #[msg("Invalid account owner")]
    InvalidOwner,

    #[msg("Invalid collateral amount")]
    InvalidCollateral,

    // === Migration Errors ===

    #[msg("Invalid account size for migration")]
    InvalidAccountSize,

    #[msg("Invalid account data")]
    InvalidAccountData,

    #[msg("Invalid program ID")]
    InvalidProgramId,

    #[msg("Invalid account count in remaining_accounts")]
    InvalidAccountCount,

    // === V6 Async MPC Errors ===

    #[msg("Operation pending - position has an active MPC request")]
    OperationPending,

    #[msg("Invalid MPC request ID")]
    InvalidMpcRequest,

    #[msg("Position already verified")]
    PositionAlreadyVerified,

    #[msg("Feature is temporarily disabled")]
    FeatureDisabled,

    // === V7 Close Position Errors ===

    #[msg("Position is pending close - cannot perform other operations")]
    PositionPendingClose,

    #[msg("Position has a pending operation (margin add/remove)")]
    PositionHasPendingOperation,

    #[msg("Position is not pending close")]
    PositionNotPendingClose,

    #[msg("Invalid payout amount from MPC")]
    InvalidPayoutAmount,
}
