use anchor_lang::prelude::*;

/// Settlement method selection
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum SettlementMethod {
    /// ShadowWire Bulletproof-based private transfers
    /// Production ready, 1% relayer fee
    #[default]
    ShadowWire,

    /// Arcium C-SPL confidential tokens
    /// Preferred when available (lower fees, on-chain privacy)
    CSPL,

    /// Standard SPL transfer (no privacy, fallback only)
    StandardSPL,
}

/// Settlement request for a matched trade
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettlementRequest {
    /// Buy order ID
    pub buy_order_id: u64,
    /// Sell order ID
    pub sell_order_id: u64,
    /// Buyer's wallet
    pub buyer: Pubkey,
    /// Seller's wallet
    pub seller: Pubkey,
    /// Base token mint
    pub base_mint: Pubkey,
    /// Quote token mint
    pub quote_mint: Pubkey,
    /// Fill amount (encrypted)
    pub encrypted_fill_amount: [u8; 64],
    /// Fill price (encrypted)
    pub encrypted_fill_price: [u8; 64],
    /// Selected settlement method
    pub method: SettlementMethod,
    /// Timestamp
    pub created_at: i64,
}

/// Settlement result
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettlementResult {
    /// Request that was settled
    pub request: SettlementRequest,
    /// Whether settlement succeeded
    pub success: bool,
    /// Settlement transaction signature (if available)
    pub tx_signature: Option<[u8; 64]>,
    /// Error message if failed
    pub error: Option<String>,
    /// Completion timestamp
    pub completed_at: i64,
}

/// Token transfer direction in settlement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TransferDirection {
    /// Base tokens: Seller -> Buyer
    BaseTobuyer,
    /// Quote tokens: Buyer -> Seller
    QuoteToSeller,
}

/// Supported tokens for ShadowWire
/// Reference: https://github.com/Radrdotfun/ShadowWire
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ShadowWireToken {
    SOL,
    USDC,
    USDT,
    BONK,
    WIF,
    POPCAT,
    RADR,
    ORE,
    GRASS,
    RAY,
    JUP,
    PYTH,
    JTO,
    RENDER,
    HNT,
    MOBILE,
    IOT,
}

impl ShadowWireToken {
    /// Get the token symbol string
    pub fn symbol(&self) -> &'static str {
        match self {
            Self::SOL => "SOL",
            Self::USDC => "USDC",
            Self::USDT => "USDT",
            Self::BONK => "BONK",
            Self::WIF => "WIF",
            Self::POPCAT => "POPCAT",
            Self::RADR => "RADR",
            Self::ORE => "ORE",
            Self::GRASS => "GRASS",
            Self::RAY => "RAY",
            Self::JUP => "JUP",
            Self::PYTH => "PYTH",
            Self::JTO => "JTO",
            Self::RENDER => "RENDER",
            Self::HNT => "HNT",
            Self::MOBILE => "MOBILE",
            Self::IOT => "IOT",
        }
    }

    /// Check if a mint is supported by ShadowWire
    pub fn from_mint(_mint: &Pubkey) -> Option<Self> {
        // TODO: Map actual mint addresses to token types
        // For now, return None (use StandardSPL as fallback)
        None
    }
}
