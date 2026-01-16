use anchor_lang::prelude::*;

pub mod cpi;
pub mod error;
pub mod instructions;
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

    /// Place a confidential order with ZK eligibility proof
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: state::Side,
        order_type: state::OrderType,
        encrypted_amount: [u8; 64],
        encrypted_price: [u8; 64],
        eligibility_proof: [u8; 388],
    ) -> Result<()> {
        instructions::place_order::handler(
            ctx,
            side,
            order_type,
            encrypted_amount,
            encrypted_price,
            eligibility_proof,
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
}
