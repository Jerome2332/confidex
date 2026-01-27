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
    ///
    /// All 12 Arcium accounts must be provided by the client using Arcium SDK derivation.
    /// The computation_offset should be a random u64 to prevent computation account collisions.
    pub fn match_orders<'info>(
        ctx: Context<'_, '_, 'info, 'info, MatchOrders<'info>>,
        params: match_orders::MatchOrdersParams,
    ) -> Result<()> {
        instructions::match_orders::handler(ctx, params)
    }

    /// Settle matched orders by transferring tokens between users
    /// Called after orders have been matched via MPC (status = Inactive, filled > 0)
    ///
    /// Settlement methods:
    /// - 0 = ShadowWire (Bulletproof ZK, 1% fee)
    /// - 1 = C-SPL (Arcium MPC, 0% fee) - disabled until SDK available
    /// - 2 = StandardSPL (no privacy, fallback)
    pub fn settle_order(ctx: Context<SettleOrder>, params: SettleOrderParams) -> Result<()> {
        instructions::settle_order::handler(ctx, params)
    }

    /// Settlement callback from MXE
    ///
    /// Called by the MXE's decrypt_for_settlement_callback with decrypted
    /// fill_amount and price. Only the MXE authority PDA can invoke this.
    /// This is the production MPC-based settlement that doesn't read plaintext.
    pub fn settle_order_callback(
        ctx: Context<SettleOrderCallback>,
        fill_amount: u64,
        price: u64,
    ) -> Result<()> {
        instructions::settle_order_callback::handler(ctx, fill_amount, price)
    }

    /// Cancel order callback from MXE
    ///
    /// Called by the MXE's calculate_refund_callback with decrypted
    /// refund_amount. Only the MXE authority PDA can invoke this.
    /// This is the production MPC-based cancellation that doesn't read plaintext.
    pub fn cancel_order_callback(
        ctx: Context<CancelOrderCallback>,
        refund_amount: u64,
    ) -> Result<()> {
        instructions::cancel_order_callback::handler(ctx, refund_amount)
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

    /// Admin force-close a broken or legacy position (admin only)
    ///
    /// EMERGENCY function for positions that cannot be closed via MPC because:
    /// - Broken V2 encryption (truncated ephemeral pubkey - cannot decrypt)
    /// - Legacy hackathon positions (plaintext format)
    ///
    /// The position must have `threshold_verified = false` to be eligible.
    /// Refund amount is specified by admin since encrypted values are unreadable.
    pub fn admin_force_close_position(
        ctx: Context<AdminForceClosePosition>,
        params: AdminForceCloseParams,
    ) -> Result<()> {
        instructions::admin::admin_force_close_handler(ctx, params)
    }

    /// Admin force-close a V7 position (pre-V8, 692 bytes) - admin only
    ///
    /// This is for positions created before the V8 update that added the
    /// ephemeral_pubkey field. These positions are 692 bytes instead of 724.
    /// Uses manual parsing to avoid deserialization errors from size mismatch.
    pub fn admin_force_close_v7_position(
        ctx: Context<AdminForceCloseV7Position>,
        params: AdminForceCloseParams,
    ) -> Result<()> {
        instructions::admin::admin_force_close_v7_handler(ctx, params)
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

    /// DEPRECATED: Legacy close position (panics - use initiate_close_position instead)
    pub fn close_position(
        ctx: Context<ClosePosition>,
        params: ClosePositionParams,
    ) -> Result<()> {
        instructions::perp_close_position::handler(ctx, params)
    }

    /// Initiate closing a perpetual position (V7 - async MPC flow)
    /// Phase 1: Validates position, captures oracle price, queues MPC PnL computation
    /// Phase 2 happens via close_position_callback when MPC completes
    pub fn initiate_close_position(
        ctx: Context<InitiateClosePosition>,
        params: InitiateClosePositionParams,
    ) -> Result<()> {
        instructions::perp_close_position::initiate_close_position(ctx, params)
    }

    /// Callback for close position MPC result (V7)
    /// Receives computed PnL and funding, executes token transfer, closes position
    pub fn close_position_callback(
        ctx: Context<ClosePositionCallback>,
        params: ClosePositionCallbackParams,
    ) -> Result<()> {
        instructions::mpc_callback::close_position_callback(ctx, params)
    }

    /// Callback for funding settlement MPC result (V7)
    /// Receives computed funding payment and updates encrypted collateral
    pub fn funding_settlement_callback(
        ctx: Context<FundingSettlementCallback>,
        params: FundingSettlementParams,
    ) -> Result<()> {
        instructions::mpc_callback::funding_settlement_callback(ctx, params)
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

    /// Auto-deleverage when insurance fund is depleted (legacy handler)
    /// Force-closes profitable positions to cover underwater liquidations
    /// Note: Uses cached is_liquidatable flag from batch MPC check (V6)
    pub fn auto_deleverage(ctx: Context<AutoDeleverage>) -> Result<()> {
        instructions::perp_auto_deleverage::handler(ctx)
    }

    /// Execute auto-deleverage using cached liquidation status (V6)
    /// Requires position.is_liquidatable = true from prior batch MPC check
    pub fn execute_adl(ctx: Context<ExecuteAdl>) -> Result<()> {
        instructions::perp_auto_deleverage::execute_adl(ctx)
    }

    /// Initiate batch liquidation check for multiple positions (V6)
    /// Marks positions as pending and emits event for crank to trigger MPC
    pub fn initiate_liquidation_check(ctx: Context<InitiateLiquidationCheck>) -> Result<()> {
        instructions::perp_auto_deleverage::initiate_liquidation_check(ctx)
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

    /// Update orders from MPC computation result (event-driven pattern)
    /// Called by backend after receiving MXE events (PriceCompareResult, FillCalculationResult)
    /// This decouples MXE from DEX - backend subscribes to MXE events and updates DEX state
    pub fn update_orders_from_result(
        ctx: Context<UpdateOrdersFromResult>,
        params: UpdateOrdersFromResultParams,
    ) -> Result<()> {
        instructions::mpc_callback::update_orders_from_result(ctx, params)
    }

    // === V6: Async MPC Callback Instructions ===

    /// Callback for position verification from MXE (V6)
    /// Called after verify_position_params MPC computes liquidation thresholds
    /// Updates position with encrypted thresholds and marks as verified
    pub fn position_verification_callback(
        ctx: Context<PositionVerificationCallback>,
        params: PositionVerificationParams,
    ) -> Result<()> {
        instructions::mpc_callback::position_verification_callback(ctx, params)
    }

    /// Callback for margin operation from MXE (V6)
    /// Called after add/sub_encrypted MPC completes
    /// Updates position with new collateral and thresholds, executes token transfer
    pub fn margin_operation_callback(
        ctx: Context<MarginOperationCallback>,
        params: MarginOperationParams,
    ) -> Result<()> {
        instructions::mpc_callback::margin_operation_callback(ctx, params)
    }

    /// Callback for batch liquidation check from MXE (V6)
    /// Called after batch_liquidation_check MPC determines which positions are underwater
    /// Updates is_liquidatable flag on each position passed in remaining_accounts
    pub fn liquidation_check_callback(
        ctx: Context<LiquidationCheckCallback>,
        params: LiquidationCheckParams,
    ) -> Result<()> {
        instructions::mpc_callback::liquidation_check_callback(ctx, params)
    }

    // === ShadowWire Settlement (Layer 4 - Private Transfer) ===

    /// Initiate ShadowWire settlement for matched orders
    ///
    /// Creates a SettlementRequest that tracks the two-phase transfer process.
    /// Backend executes transfers via ShadowWire API using MPC-decrypted amounts.
    pub fn initiate_settlement(
        ctx: Context<InitiateSettlement>,
        params: InitiateSettlementParams,
    ) -> Result<()> {
        instructions::initiate_settlement::handler(ctx, params)
    }

    /// Record a ShadowWire transfer completion
    ///
    /// Called by backend after executing a transfer via ShadowWire API.
    /// Updates settlement state machine with transfer ID.
    pub fn record_shadowwire_transfer(
        ctx: Context<RecordShadowWireTransfer>,
        params: RecordTransferParams,
    ) -> Result<()> {
        instructions::record_shadowwire_transfer::handler(ctx, params)
    }

    /// Finalize ShadowWire settlement after both transfers complete
    ///
    /// Marks orders as filled and closes settlement request account.
    pub fn finalize_settlement(ctx: Context<FinalizeSettlement>) -> Result<()> {
        instructions::finalize_settlement::handler(ctx)
    }

    /// Register a user's ShadowWire account for private settlement
    ///
    /// Creates UserShadowWireAccount linking wallet to ShadowWire pool.
    /// Required before orders can be settled via ShadowWire.
    pub fn register_shadowwire_account(
        ctx: Context<RegisterShadowWireAccount>,
        params: RegisterShadowWireParams,
    ) -> Result<()> {
        instructions::register_shadowwire::handler(ctx, params)
    }

    /// Update a user's ShadowWire account
    ///
    /// Add supported mints or update pool address.
    pub fn update_shadowwire_account(
        ctx: Context<UpdateShadowWireAccount>,
        params: UpdateShadowWireParams,
    ) -> Result<()> {
        instructions::register_shadowwire::update_handler(ctx, params)
    }

    /// Fail a settlement that cannot complete
    ///
    /// Handles settlement failures:
    /// - If no transfers occurred: marks Failed, returns orders to Active
    /// - If base transferred but quote failed: marks RollingBack, triggers rollback
    pub fn fail_settlement(
        ctx: Context<FailSettlement>,
        params: FailSettlementParams,
    ) -> Result<()> {
        instructions::fail_settlement::handler(ctx, params)
    }

    /// Expire a settlement that has passed its deadline
    ///
    /// Anyone can call this after expiry time. Handles:
    /// - No transfers: marks Expired, returns orders to Active
    /// - Partial transfer: marks RollingBack for manual intervention
    pub fn expire_settlement(ctx: Context<ExpireSettlement>) -> Result<()> {
        instructions::expire_settlement::handler(ctx)
    }
}
