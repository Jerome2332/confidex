//! Confidex DEX Encrypted Instructions
//!
//! This module contains Arcis circuits for confidential order matching,
//! fill calculation, and perpetuals operations.
//!
//! All operations run on encrypted data via Arcium's MPC network using
//! the Cerberus protocol (dishonest majority secure).
//!
//! Reference: https://docs.arcium.com/developers/arcis

use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // =============================================================
    // SPOT TRADING CIRCUITS
    // =============================================================

    /// Input for price comparison
    pub struct PriceCompareInput {
        /// Encrypted buy price
        buy_price: u64,
        /// Encrypted sell price
        sell_price: u64,
    }

    /// Compare two encrypted prices for order matching
    ///
    /// Returns true if buy_price >= sell_price (match condition met)
    /// Both parties can decrypt the result.
    #[instruction]
    pub fn compare_prices(input: Enc<Shared, PriceCompareInput>) -> Enc<Shared, bool> {
        let prices = input.to_arcis();
        let matches = prices.buy_price >= prices.sell_price;
        input.owner.from_arcis(matches)
    }

    /// Input for fill amount calculation
    pub struct FillInput {
        /// Encrypted buy order remaining amount
        buy_amount: u64,
        /// Encrypted sell order remaining amount
        sell_amount: u64,
        /// Encrypted buy price
        buy_price: u64,
        /// Encrypted sell price
        sell_price: u64,
    }

    /// Output from fill calculation
    pub struct FillOutput {
        /// Fill amount (min of buy_amount, sell_amount)
        fill_amount: u64,
        /// Whether buy order is fully filled
        buy_fully_filled: bool,
        /// Whether sell order is fully filled
        sell_fully_filled: bool,
    }

    /// Calculate fill amount for matching orders
    ///
    /// Returns the minimum of buy/sell amounts and flags indicating
    /// which orders are fully filled.
    #[instruction]
    pub fn calculate_fill(input: Enc<Shared, FillInput>) -> Enc<Shared, FillOutput> {
        let fill = input.to_arcis();

        // Check if prices match
        let prices_match = fill.buy_price >= fill.sell_price;

        // Calculate fill amount as min of both sides
        let fill_amount = if fill.buy_amount < fill.sell_amount {
            fill.buy_amount
        } else {
            fill.sell_amount
        };

        // If prices don't match, fill amount is 0
        let actual_fill = if prices_match { fill_amount } else { 0u64 };

        // Determine if orders are fully filled
        let buy_fully_filled = prices_match && fill.buy_amount <= fill.sell_amount;
        let sell_fully_filled = prices_match && fill.sell_amount <= fill.buy_amount;

        input.owner.from_arcis(FillOutput {
            fill_amount: actual_fill,
            buy_fully_filled,
            sell_fully_filled,
        })
    }

    // =============================================================
    // PERPETUALS CIRCUITS
    // =============================================================

    /// Input for position parameter verification
    pub struct PositionParamsInput {
        /// Encrypted entry price
        entry_price: u64,
        /// Leverage (1-20x, plaintext)
        leverage: u8,
        /// Maintenance margin basis points (plaintext)
        mm_bps: u16,
        /// Whether this is a long position (plaintext)
        is_long: bool,
    }

    /// Verify that position parameters are valid and compute liquidation threshold
    ///
    /// Returns the encrypted liquidation threshold that can be stored on-chain
    /// without revealing the entry price.
    #[instruction]
    pub fn verify_position_params(input: Enc<Shared, PositionParamsInput>) -> Enc<Shared, u64> {
        let params = input.to_arcis();

        // Validate leverage (1-20x)
        let valid_leverage = params.leverage >= 1 && params.leverage <= 20;

        // Calculate liquidation threshold
        // For longs: liq_price = entry * (1 - 1/leverage + mm/10000)
        // For shorts: liq_price = entry * (1 + 1/leverage - mm/10000)
        //
        // Simplified integer math (scaled by 10000):
        // longs: entry * (10000 - 10000/leverage + mm) / 10000
        // shorts: entry * (10000 + 10000/leverage - mm) / 10000

        let entry = params.entry_price;
        let leverage_factor = 10000u64 / (params.leverage as u64);
        let mm = params.mm_bps as u64;

        let liq_threshold = if params.is_long {
            // Long: liquidate when price drops
            let factor = 10000u64 - leverage_factor + mm;
            (entry * factor) / 10000u64
        } else {
            // Short: liquidate when price rises
            let factor = 10000u64 + leverage_factor - mm;
            (entry * factor) / 10000u64
        };

        // Return 0 if invalid, else the threshold
        let result = if valid_leverage { liq_threshold } else { 0u64 };

        input.owner.from_arcis(result)
    }

    /// Input for liquidation check
    pub struct LiquidationCheckInput {
        /// Encrypted liquidation threshold
        liq_threshold: u64,
        /// Current mark price (plaintext oracle price)
        mark_price: u64,
        /// Is this a long position?
        is_long: bool,
    }

    /// Check if a position should be liquidated
    ///
    /// For longs: liquidate if mark_price <= liq_threshold
    /// For shorts: liquidate if mark_price >= liq_threshold
    #[instruction]
    pub fn check_liquidation(input: Enc<Shared, LiquidationCheckInput>) -> bool {
        let check = input.to_arcis();

        let should_liquidate = if check.is_long {
            check.mark_price <= check.liq_threshold
        } else {
            check.mark_price >= check.liq_threshold
        };

        // Reveal the boolean result (liquidation status is public)
        should_liquidate.reveal()
    }

    /// Input for batch liquidation check (up to 10 positions)
    pub struct BatchLiquidationInput {
        /// Encrypted liquidation thresholds (padded to 10)
        thresholds: [u64; 10],
        /// Is each position long? (padded to 10)
        is_long: [bool; 10],
        /// How many valid positions in this batch
        count: u8,
        /// Current mark price (same for all, plaintext)
        mark_price: u64,
    }

    /// Output from batch liquidation check
    /// Using a struct to properly return revealed bools
    pub struct BatchLiquidationOutput {
        r0: bool,
        r1: bool,
        r2: bool,
        r3: bool,
        r4: bool,
        r5: bool,
        r6: bool,
        r7: bool,
        r8: bool,
        r9: bool,
    }

    /// Check multiple positions for liquidation in one MPC call
    ///
    /// Returns struct of booleans indicating which positions should be liquidated.
    /// More efficient than 10 separate MPC calls.
    /// Note: Uses reveal() since liquidation status is public information.
    #[instruction]
    pub fn batch_liquidation_check(input: Enc<Shared, BatchLiquidationInput>) -> BatchLiquidationOutput {
        let batch = input.to_arcis();

        // Check each position (fixed for MPC compatibility - no dynamic loops)
        let should_liq_0 = if batch.is_long[0] {
            batch.mark_price <= batch.thresholds[0]
        } else {
            batch.mark_price >= batch.thresholds[0]
        };
        let r0 = (batch.count > 0 && should_liq_0).reveal();

        let should_liq_1 = if batch.is_long[1] {
            batch.mark_price <= batch.thresholds[1]
        } else {
            batch.mark_price >= batch.thresholds[1]
        };
        let r1 = (batch.count > 1 && should_liq_1).reveal();

        let should_liq_2 = if batch.is_long[2] {
            batch.mark_price <= batch.thresholds[2]
        } else {
            batch.mark_price >= batch.thresholds[2]
        };
        let r2 = (batch.count > 2 && should_liq_2).reveal();

        let should_liq_3 = if batch.is_long[3] {
            batch.mark_price <= batch.thresholds[3]
        } else {
            batch.mark_price >= batch.thresholds[3]
        };
        let r3 = (batch.count > 3 && should_liq_3).reveal();

        let should_liq_4 = if batch.is_long[4] {
            batch.mark_price <= batch.thresholds[4]
        } else {
            batch.mark_price >= batch.thresholds[4]
        };
        let r4 = (batch.count > 4 && should_liq_4).reveal();

        let should_liq_5 = if batch.is_long[5] {
            batch.mark_price <= batch.thresholds[5]
        } else {
            batch.mark_price >= batch.thresholds[5]
        };
        let r5 = (batch.count > 5 && should_liq_5).reveal();

        let should_liq_6 = if batch.is_long[6] {
            batch.mark_price <= batch.thresholds[6]
        } else {
            batch.mark_price >= batch.thresholds[6]
        };
        let r6 = (batch.count > 6 && should_liq_6).reveal();

        let should_liq_7 = if batch.is_long[7] {
            batch.mark_price <= batch.thresholds[7]
        } else {
            batch.mark_price >= batch.thresholds[7]
        };
        let r7 = (batch.count > 7 && should_liq_7).reveal();

        let should_liq_8 = if batch.is_long[8] {
            batch.mark_price <= batch.thresholds[8]
        } else {
            batch.mark_price >= batch.thresholds[8]
        };
        let r8 = (batch.count > 8 && should_liq_8).reveal();

        let should_liq_9 = if batch.is_long[9] {
            batch.mark_price <= batch.thresholds[9]
        } else {
            batch.mark_price >= batch.thresholds[9]
        };
        let r9 = (batch.count > 9 && should_liq_9).reveal();

        BatchLiquidationOutput {
            r0, r1, r2, r3, r4, r5, r6, r7, r8, r9,
        }
    }

    /// Input for PnL calculation
    pub struct PnlInput {
        /// Encrypted position size
        size: u64,
        /// Encrypted entry price
        entry_price: u64,
        /// Exit/mark price (plaintext)
        exit_price: u64,
        /// Is this a long position?
        is_long: bool,
    }

    /// Output from PnL calculation
    pub struct PnlOutput {
        /// Absolute PnL value
        pnl: u64,
        /// True if this is a loss, false if profit
        is_loss: bool,
    }

    /// Calculate PnL for closing a position
    ///
    /// Returns absolute PnL value and whether it's a loss.
    /// PnL = size * |entry - exit| / entry (simplified)
    #[instruction]
    pub fn calculate_pnl(input: Enc<Shared, PnlInput>) -> Enc<Shared, PnlOutput> {
        let pnl = input.to_arcis();

        // For longs: profit if exit > entry
        // For shorts: profit if exit < entry
        let (is_profit, price_diff) = if pnl.is_long {
            if pnl.exit_price > pnl.entry_price {
                (true, pnl.exit_price - pnl.entry_price)
            } else {
                (false, pnl.entry_price - pnl.exit_price)
            }
        } else {
            if pnl.exit_price < pnl.entry_price {
                (true, pnl.entry_price - pnl.exit_price)
            } else {
                (false, pnl.exit_price - pnl.entry_price)
            }
        };

        // PnL = size * price_diff / entry_price
        // To avoid overflow, we do: (size * price_diff) / entry_price
        let pnl_value = if pnl.entry_price > 0 {
            (pnl.size * price_diff) / pnl.entry_price
        } else {
            0u64
        };

        input.owner.from_arcis(PnlOutput {
            pnl: pnl_value,
            is_loss: !is_profit,
        })
    }

    /// Input for funding calculation
    pub struct FundingInput {
        /// Encrypted position size
        size: u64,
        /// Funding rate (basis points, plaintext, can be negative)
        funding_rate_bps: i64,
        /// Time delta in seconds (plaintext)
        time_delta_secs: u64,
        /// Is this a long position?
        is_long: bool,
    }

    /// Output from funding calculation
    pub struct FundingOutput {
        /// Absolute funding amount
        funding_amount: u64,
        /// True if position pays funding (long pays when rate > 0)
        is_paying: bool,
    }

    /// Calculate funding payment for a position
    ///
    /// Longs pay shorts when funding rate is positive.
    /// Shorts pay longs when funding rate is negative.
    #[instruction]
    pub fn calculate_funding(input: Enc<Shared, FundingInput>) -> Enc<Shared, FundingOutput> {
        let funding = input.to_arcis();

        // Determine if position pays or receives
        // Positive rate: longs pay, shorts receive
        // Negative rate: shorts pay, longs receive
        let rate_positive = funding.funding_rate_bps >= 0;
        let is_paying = if funding.is_long {
            rate_positive
        } else {
            !rate_positive
        };

        // Calculate absolute funding amount
        // funding = size * |rate| * time_delta / (10000 * 3600)
        // Simplified: funding = size * |rate| * time_delta / 36000000
        let abs_rate = if funding.funding_rate_bps >= 0 {
            funding.funding_rate_bps as u64
        } else {
            (-funding.funding_rate_bps) as u64
        };

        let funding_amount = (funding.size * abs_rate * funding.time_delta_secs) / 36000000u64;

        input.owner.from_arcis(FundingOutput {
            funding_amount,
            is_paying,
        })
    }

    // =============================================================
    // ARITHMETIC HELPERS
    // =============================================================

    /// Input for encrypted addition
    pub struct AddInput {
        a: u64,
        b: u64,
    }

    /// Add two encrypted values
    #[instruction]
    pub fn add_encrypted(input: Enc<Shared, AddInput>) -> Enc<Shared, u64> {
        let vals = input.to_arcis();
        let result = vals.a + vals.b;
        input.owner.from_arcis(result)
    }

    /// Input for encrypted subtraction
    pub struct SubInput {
        a: u64,
        b: u64,
    }

    /// Subtract two encrypted values (a - b, returns 0 if underflow)
    #[instruction]
    pub fn sub_encrypted(input: Enc<Shared, SubInput>) -> Enc<Shared, u64> {
        let vals = input.to_arcis();
        let result = if vals.a >= vals.b {
            vals.a - vals.b
        } else {
            0u64
        };
        input.owner.from_arcis(result)
    }

    /// Input for encrypted multiplication
    pub struct MulInput {
        a: u64,
        b: u64,
    }

    /// Multiply two encrypted values
    #[instruction]
    pub fn mul_encrypted(input: Enc<Shared, MulInput>) -> Enc<Shared, u64> {
        let vals = input.to_arcis();
        let result = vals.a * vals.b;
        input.owner.from_arcis(result)
    }
}

#[cfg(test)]
mod tests {
    // Note: Arcis circuits cannot be directly unit tested
    // as they require the MPC runtime. Use TypeScript integration
    // tests with arcium test instead.
}
