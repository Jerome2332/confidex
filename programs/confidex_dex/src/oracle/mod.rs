//! Pyth Oracle Integration
//!
//! Provides helpers for fetching SOL/USD price from Pyth Network.
//! Used by perpetuals for mark price, entry/exit validation, and liquidations.
//!
//! Reference: https://docs.pyth.network/price-feeds/solana

use anchor_lang::prelude::*;
use pyth_sdk_solana::state::SolanaPriceAccount;

/// Maximum age for price data
/// On devnet, Pyth feeds may update infrequently, so we use a larger window.
/// For mainnet, this should be reduced to 60-120 seconds.
#[cfg(feature = "devnet")]
pub const MAX_PRICE_AGE_SECS: u64 = 3600; // 1 hour for devnet

#[cfg(not(feature = "devnet"))]
pub const MAX_PRICE_AGE_SECS: u64 = 120; // 2 minutes for mainnet

/// Pyth price precision (8 decimals typically)
pub const PYTH_PRICE_DECIMALS: u32 = 8;

/// Our internal price precision (6 decimals for USDC compatibility)
pub const INTERNAL_PRICE_DECIMALS: u32 = 6;

/// Get SOL/USD price from Pyth price feed
///
/// Returns price in 6 decimal precision (micro-dollars).
/// For example, $100.50 = 100_500_000
///
/// # Arguments
/// * `price_feed` - The Pyth price feed account
///
/// # Returns
/// * `Ok(u64)` - Price in micro-dollars (6 decimals)
/// * `Err(_)` - If price feed is stale, invalid, or parsing fails
pub fn get_sol_usd_price(price_feed: &AccountInfo) -> Result<u64> {
    let price_feed_data = SolanaPriceAccount::account_info_to_feed(price_feed)
        .map_err(|_| OracleError::InvalidFeedId)?;

    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    // On devnet, Pyth price feeds may be extremely stale (months old)
    // Use a very large age threshold to effectively disable staleness checking
    // On mainnet, use a strict 120-second threshold
    #[cfg(feature = "devnet")]
    let age_threshold: u64 = u64::MAX / 2; // Effectively disable staleness check

    #[cfg(not(feature = "devnet"))]
    let age_threshold: u64 = MAX_PRICE_AGE_SECS;

    let price = price_feed_data
        .get_price_no_older_than(current_time, age_threshold)
        .ok_or(OracleError::StalePrice)?;

    // Pyth returns price with variable exponent (usually -8)
    // We need to convert to our 6-decimal precision
    //
    // Example: SOL at $100.12345678
    // - Pyth: price = 10012345678, expo = -8
    // - Our format: 100_123_456 (6 decimals)
    //
    // Conversion: price * 10^(6 - |expo|)
    // If expo = -8: price * 10^(6-8) = price / 100

    // Ensure price is positive
    require!(price.price > 0, OracleError::InvalidPrice);

    let expo_abs = (-price.expo) as u32;

    let normalized_price = if expo_abs > INTERNAL_PRICE_DECIMALS {
        // Pyth has more precision, divide to reduce
        let divisor = 10u64.pow(expo_abs - INTERNAL_PRICE_DECIMALS);
        (price.price as u64) / divisor
    } else if expo_abs < INTERNAL_PRICE_DECIMALS {
        // Pyth has less precision, multiply to increase
        let multiplier = 10u64.pow(INTERNAL_PRICE_DECIMALS - expo_abs);
        (price.price as u64).saturating_mul(multiplier)
    } else {
        // Same precision
        price.price as u64
    };

    msg!("Pyth SOL/USD price: {} (6 decimals)", normalized_price);

    Ok(normalized_price)
}

/// Validate that a user-provided price is within acceptable range of oracle price
///
/// # Arguments
/// * `user_price` - The price provided by user (6 decimals)
/// * `oracle_price` - The current oracle price (6 decimals)
/// * `max_deviation_bps` - Maximum allowed deviation in basis points (e.g., 100 = 1%)
///
/// # Returns
/// * `Ok(true)` - Price is within acceptable range
/// * `Ok(false)` - Price deviation exceeds limit
pub fn validate_price_deviation(
    user_price: u64,
    oracle_price: u64,
    max_deviation_bps: u16,
) -> Result<bool> {
    if oracle_price == 0 {
        return Err(OracleError::InvalidPrice.into());
    }

    // Calculate absolute deviation
    let deviation = if user_price > oracle_price {
        user_price - oracle_price
    } else {
        oracle_price - user_price
    };

    // Calculate deviation in basis points
    // deviation_bps = (deviation * 10000) / oracle_price
    let deviation_bps = deviation
        .checked_mul(10000)
        .ok_or(OracleError::ArithmeticOverflow)?
        .checked_div(oracle_price)
        .ok_or(OracleError::ArithmeticOverflow)?;

    Ok(deviation_bps <= max_deviation_bps as u64)
}

/// Calculate liquidation price for a perpetual position
///
/// # Arguments
/// * `entry_price` - Entry price (6 decimals)
/// * `leverage` - Position leverage (e.g., 10 for 10x)
/// * `is_long` - True for long, false for short
/// * `maintenance_margin_bps` - Maintenance margin in basis points (e.g., 500 = 5%)
///
/// # Returns
/// * Liquidation price (6 decimals)
pub fn calculate_liquidation_price(
    entry_price: u64,
    leverage: u8,
    is_long: bool,
    maintenance_margin_bps: u16,
) -> u64 {
    // For longs: liq_price = entry_price * (1 - 1/leverage + maintenance_margin)
    // For shorts: liq_price = entry_price * (1 + 1/leverage - maintenance_margin)

    let leverage_u64 = leverage as u64;
    let mm_factor = maintenance_margin_bps as u64; // in bps

    // Calculate 1/leverage in bps (10000 / leverage)
    let leverage_impact_bps = 10000u64.checked_div(leverage_u64).unwrap_or(10000);

    if is_long {
        // Long: liq_price = entry * (1 - leverage_impact + mm) = entry * (10000 - leverage_impact + mm) / 10000
        let factor = 10000u64
            .saturating_sub(leverage_impact_bps)
            .saturating_add(mm_factor);
        entry_price.saturating_mul(factor) / 10000
    } else {
        // Short: liq_price = entry * (1 + leverage_impact - mm) = entry * (10000 + leverage_impact - mm) / 10000
        let factor = 10000u64
            .saturating_add(leverage_impact_bps)
            .saturating_sub(mm_factor);
        entry_price.saturating_mul(factor) / 10000
    }
}

#[error_code]
pub enum OracleError {
    #[msg("Invalid Pyth feed ID")]
    InvalidFeedId,
    #[msg("Price data is stale")]
    StalePrice,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Price deviation exceeds maximum allowed")]
    PriceDeviationExceeded,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
