use anchor_lang::prelude::*;

// Well-known mint addresses for ShadowWire token mapping
// Wrapped SOL: So11111111111111111111111111111111111111112
pub const WSOL_MINT: Pubkey = Pubkey::new_from_array([
    0x06, 0x9b, 0x88, 0x57, 0xfe, 0xab, 0x81, 0x84,
    0xfb, 0x68, 0x7f, 0x63, 0x46, 0x18, 0xc0, 0x35,
    0xda, 0xc4, 0x39, 0xdc, 0x1a, 0xeb, 0x3b, 0x55,
    0x98, 0xa0, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x01,
]);

// Dummy USDC (Devnet): Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
pub const USDC_DEVNET_MINT: Pubkey = Pubkey::new_from_array([
    0xe9, 0x28, 0x39, 0x55, 0x09, 0x65, 0xff, 0xd4,
    0xd6, 0x4a, 0xca, 0xaf, 0x46, 0xd4, 0x5d, 0xf7,
    0x31, 0x8e, 0x5b, 0x4f, 0x57, 0xc9, 0x0c, 0x48,
    0x7d, 0x60, 0x62, 0x5d, 0x82, 0x9b, 0x83, 0x7b,
]);

// USDC (Mainnet): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
pub const USDC_MAINNET_MINT: Pubkey = Pubkey::new_from_array([
    0xc6, 0xfa, 0x7a, 0xf3, 0xbe, 0xdb, 0xad, 0x3a,
    0x3d, 0x65, 0xf3, 0x6a, 0xab, 0xc9, 0x74, 0x31,
    0xb1, 0xbb, 0xe4, 0xc2, 0xd2, 0xf6, 0xe0, 0xe4,
    0x7c, 0xa6, 0x02, 0x03, 0x45, 0x2f, 0x5d, 0x61,
]);

// USDT (Mainnet): Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
pub const USDT_MAINNET_MINT: Pubkey = Pubkey::new_from_array([
    0xce, 0x01, 0x0e, 0x60, 0xaf, 0xed, 0xb2, 0x27,
    0x17, 0xbd, 0x63, 0x19, 0x2f, 0x54, 0x14, 0x5a,
    0x3f, 0x96, 0x5a, 0x33, 0xbb, 0x82, 0xd2, 0xc7,
    0x02, 0x9e, 0xb2, 0xce, 0x1e, 0x20, 0x82, 0x64,
]);

/// Settlement method selection
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
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
/// V2: Uses hash-based order IDs for privacy (no sequential correlation)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettlementRequest {
    /// Buy order ID (hash-based, 16 bytes)
    pub buy_order_id: [u8; 16],
    /// Sell order ID (hash-based, 16 bytes)
    pub sell_order_id: [u8; 16],
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
    /// Timestamp (coarse - hour precision)
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

    /// Check if a mint is supported by ShadowWire and return the token type
    pub fn from_mint(mint: &Pubkey) -> Option<Self> {
        // Native SOL (wrapped)
        if *mint == WSOL_MINT {
            return Some(Self::SOL);
        }

        // USDC (devnet and mainnet)
        if *mint == USDC_DEVNET_MINT || *mint == USDC_MAINNET_MINT {
            return Some(Self::USDC);
        }

        // USDT (mainnet)
        if *mint == USDT_MAINNET_MINT {
            return Some(Self::USDT);
        }

        // Not a supported ShadowWire token
        None
    }

    /// Check if both mints in a trading pair are supported by ShadowWire
    pub fn pair_supported(base_mint: &Pubkey, quote_mint: &Pubkey) -> bool {
        Self::from_mint(base_mint).is_some() && Self::from_mint(quote_mint).is_some()
    }
}
