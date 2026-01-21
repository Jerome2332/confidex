use anchor_lang::prelude::*;

pub mod cpi;
pub mod error;
pub mod instructions;
pub mod oracle;
pub mod settlement;
pub mod state;

use instructions::*;

declare_id!("63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB");

#[program]
pub mod confidex_dex {
    use super::*;

    /// Initialize the exchange with admin settings
    pub fn initialize(
        ctx: Context<Initialize>,
        maker_fee_bps: u16,
        taker_fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, maker_fee_bps, taker_fee_bps)
    }

    /// Create a new trading pair
    pub fn create_pair(
        ctx: Context<CreatePair>,
        min_order_size: u64,
        tick_size: u64,
    ) -> Result<()> {
        instructions::create_pair::handler(ctx, min_order_size, tick_size)
    }

    /// Wrap standard SPL tokens into confidential tokens
    pub fn wrap_tokens(ctx: Context<WrapTokens>, amount: u64) -> Result<()> {
        instructions::wrap_tokens::handler(ctx, amount)
    }

    /// Unwrap confidential tokens back to standard SPL tokens
    pub fn unwrap_tokens(ctx: Context<UnwrapTokens>, amount: u64) -> Result<()> {
        instructions::unwrap_tokens::handler(ctx, amount)
    }

    /// Place a confidential order with ZK eligibility proof (V5 - no plaintext)
    /// All order values are encrypted; settlement uses MPC-computed results
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: state::Side,
        order_type: state::OrderType,
        encrypted_amount: [u8; 64],
        encrypted_price: [u8; 64],
        eligibility_proof: [u8; 324],
        ephemeral_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::place_order::handler(
            ctx,
            side,
            order_type,
            encrypted_amount,
            encrypted_price,
            eligibility_proof,
            ephemeral_pubkey,
        )
    }

    /// Cancel an open order
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        instructions::cancel_order::handler(ctx)
    }

    /// Match two orders via MPC price comparison
    pub fn match_orders(ctx: Context<MatchOrders>) -> Result<()> {
        instructions::match_orders::handler(ctx)
    }

    /// Settle matched orders by transferring tokens between users
    /// Called after orders have been matched via MPC (status = Inactive, filled > 0)
    pub fn settle_order(ctx: Context<SettleOrder>) -> Result<()> {
        instructions::settle_order::handler(ctx)
    }

    /// Pause trading (admin only)
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::admin::pause_handler(ctx)
    }

    /// Unpause trading (admin only)
    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::admin::unpause_handler(ctx)
    }

    /// Update fee rates (admin only)
    pub fn update_fees(
        ctx: Context<UpdateFees>,
        maker_fee_bps: u16,
        taker_fee_bps: u16,
    ) -> Result<()> {
        instructions::admin::update_fees_handler(ctx, maker_fee_bps, taker_fee_bps)
    }

    /// Update blacklist merkle root (admin only)
    pub fn update_blacklist(ctx: Context<UpdateBlacklist>, new_root: [u8; 32]) -> Result<()> {
        instructions::admin::update_blacklist_handler(ctx, new_root)
    }

    /// Set vault addresses for a trading pair (admin only)
    pub fn set_pair_vaults(ctx: Context<SetPairVaults>) -> Result<()> {
        instructions::admin::set_pair_vaults_handler(ctx)
    }

    /// Close a perpetual market for migration (admin only)
    pub fn close_perp_market(ctx: Context<ClosePerpMarket>) -> Result<()> {
        instructions::admin::close_perp_market_handler(ctx)
    }

    /// Close a funding state for migration (admin only)
    pub fn close_funding_state(ctx: Context<CloseFundingState>) -> Result<()> {
        instructions::admin::close_funding_state_handler(ctx)
    }

    /// Set vault addresses for a perpetual market (admin only)
    pub fn set_perp_market_vaults(ctx: Context<SetPerpMarketVaults>) -> Result<()> {
        instructions::admin::set_perp_market_vaults_handler(ctx)
    }

    /// Update perpetual market configuration (admin only)
    pub fn update_perp_market_config(
        ctx: Context<UpdatePerpMarketConfig>,
        params: UpdatePerpMarketParams,
    ) -> Result<()> {
        instructions::admin::update_perp_market_config_handler(ctx, params)
    }

    /// Migrate Exchange account from V4 (158 bytes) to V5 (262 bytes) - admin only
    /// Resizes the account and initializes new program ID fields with defaults
    pub fn migrate_exchange(ctx: Context<MigrateExchange>) -> Result<()> {
        instructions::admin::migrate_exchange_handler(ctx)
    }

    /// Update program IDs stored in ExchangeState (admin only)
    /// Allows switching MXE or verifier programs without redeploying DEX
    pub fn update_program_ids(
        ctx: Context<UpdateProgramIds>,
        params: UpdateProgramIdsParams,
    ) -> Result<()> {
        instructions::admin::update_program_ids_handler(ctx, params)
    }

    // === ZK Verification (Layer 1 of Three-Layer Privacy) ===

    /// Verify trader eligibility via ZK proof (blacklist non-membership)
    /// This must be called before opening positions - stores result in TraderEligibility account
    /// The ZK proof proves the trader is not on the blacklist without revealing their identity
    pub fn verify_eligibility(
        ctx: Context<VerifyEligibility>,
        params: VerifyEligibilityParams,
    ) -> Result<()> {
        instructions::verify_eligibility::handler(ctx, params)
    }

    // === Perpetuals Instructions ===

    /// Initialize a perpetual futures market
    pub fn initialize_perp_market(
        ctx: Context<InitializePerpMarket>,
        max_leverage: u8,
        maintenance_margin_bps: u16,
        initial_margin_bps: u16,
        taker_fee_bps: u16,
        maker_fee_bps: u16,
        liquidation_fee_bps: u16,
        min_position_size: u64,
        tick_size: u64,
        max_open_interest: u64,
        funding_interval_seconds: u64,
        max_funding_rate_bps: u16,
    ) -> Result<()> {
        instructions::perp_init_market::handler(
            ctx,
            max_leverage,
            maintenance_margin_bps,
            initial_margin_bps,
            taker_fee_bps,
            maker_fee_bps,
            liquidation_fee_bps,
            min_position_size,
            tick_size,
            max_open_interest,
            funding_interval_seconds,
            max_funding_rate_bps,
        )
    }

    /// Initialize global liquidation configuration
    pub fn initialize_liquidation_config(
        ctx: Context<InitializeLiquidationConfig>,
        liquidation_bonus_bps: u16,
        insurance_fund_share_bps: u16,
        max_liquidation_per_tx: u64,
        min_liquidation_threshold: u64,
        adl_enabled: bool,
        adl_trigger_threshold_bps: u16,
    ) -> Result<()> {
        instructions::perp_init_liquidation::handler(
            ctx,
            liquidation_bonus_bps,
            insurance_fund_share_bps,
            max_liquidation_per_tx,
            min_liquidation_threshold,
            adl_enabled,
            adl_trigger_threshold_bps,
        )
    }

    /// Update funding rate for a perpetual market (keeper crank)
    pub fn update_funding_rate(ctx: Context<UpdateFundingRate>) -> Result<()> {
        instructions::perp_update_funding::handler(ctx)
    }

    // === Position Management Instructions ===

    /// Open a new perpetual position
    pub fn open_position(
        ctx: Context<OpenPosition>,
        params: OpenPositionParams,
    ) -> Result<()> {
        instructions::perp_open_position::handler(ctx, params)
    }

    /// Close a perpetual position (full or partial)
    pub fn close_position(
        ctx: Context<ClosePosition>,
        params: ClosePositionParams,
    ) -> Result<()> {
        instructions::perp_close_position::handler(ctx, params)
    }

    /// Add margin/collateral to an existing position
    pub fn add_margin(
        ctx: Context<AddMargin>,
        params: AddMarginParams,
    ) -> Result<()> {
        instructions::perp_add_margin::handler(ctx, params)
    }

    /// Remove excess margin from a position
    pub fn remove_margin(
        ctx: Context<RemoveMargin>,
        params: RemoveMarginParams,
    ) -> Result<()> {
        instructions::perp_remove_margin::handler(ctx, params)
    }

    // === Liquidation Instructions ===

    /// Queue batch liquidation check via MPC
    /// Checks up to 10 positions in a single MPC call for efficiency
    /// Required before liquidation since thresholds are now encrypted
    pub fn check_liquidation_batch<'info>(
        ctx: Context<'_, '_, 'info, 'info, CheckLiquidationBatch<'info>>,
        params: CheckLiquidationBatchParams,
    ) -> Result<()> {
        instructions::check_liquidation_batch::handler(ctx, params)
    }

    /// Callback for batch liquidation check results from MPC
    pub fn liquidation_batch_callback(
        ctx: Context<LiquidationBatchCallback>,
        params: LiquidationBatchCallbackParams,
    ) -> Result<()> {
        instructions::check_liquidation_batch::callback_handler(ctx, params)
    }

    /// Liquidate an underwater position (V2: requires prior MPC batch verification)
    /// The batch_request must have verified this position is liquidatable via MPC
    /// Anyone can call this - incentivized by liquidation bonus
    pub fn liquidate_position(
        ctx: Context<LiquidatePosition>,
        params: LiquidatePositionParams,
    ) -> Result<()> {
        instructions::perp_liquidate::handler(ctx, params)
    }

    /// Auto-deleverage when insurance fund is depleted
    /// Force-closes profitable positions to cover underwater liquidations
    pub fn auto_deleverage(ctx: Context<AutoDeleverage>) -> Result<()> {
        instructions::perp_auto_deleverage::handler(ctx)
    }

    /// Settle accumulated funding payments for a position
    pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()> {
        instructions::perp_settle_funding::handler(ctx)
    }

    // === MPC Callback Instructions ===

    /// Finalize order match from Arcium MPC callback (simplified production flow)
    /// Called by the MXE after MPC price comparison completes.
    /// Orders are passed directly via callback_account_1/2 stored in ComputationRequest.
    pub fn finalize_match(
        ctx: Context<FinalizeMatch>,
        request_id: [u8; 32],
        result: Vec<u8>,
    ) -> Result<()> {
        instructions::mpc_callback::finalize_match(ctx, request_id, result)
    }

    /// Receive price comparison result from Arcium MPC (legacy PendingMatch flow)
    /// Called by the MXE after MPC execution completes
    pub fn receive_compare_result(
        ctx: Context<ReceiveCompareResult>,
        request_id: [u8; 32],
        result: Vec<u8>,
    ) -> Result<()> {
        instructions::mpc_callback::receive_compare_result(ctx, request_id, result)
    }

    /// Receive fill calculation result from Arcium MPC (legacy PendingMatch flow)
    /// Called by the MXE after MPC execution completes
    pub fn receive_fill_result(
        ctx: Context<ReceiveFillResult>,
        request_id: [u8; 32],
        result: Vec<u8>,
    ) -> Result<()> {
        instructions::mpc_callback::receive_fill_result(ctx, request_id, result)
    }
}
