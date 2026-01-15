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

    #[msg("Invalid order side for matching")]
    InvalidOrderSide,

    #[msg("Orders are not matchable")]
    OrdersNotMatchable,

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
}
