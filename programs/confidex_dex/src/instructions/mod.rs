pub mod admin;
pub mod cancel_order;
pub mod create_pair;
pub mod initialize;
pub mod match_orders;
pub mod place_order;
pub mod settle_order;
pub mod unwrap_tokens;
pub mod wrap_tokens;

// ZK verification (Layer 1 of three-layer privacy)
pub mod verify_eligibility;

// Perpetuals instructions (all at root level for Anchor compatibility)
pub mod perp_init_market;
pub mod perp_init_liquidation;
pub mod perp_update_funding;
pub mod perp_open_position;
pub mod perp_close_position;
pub mod perp_add_margin;
pub mod perp_remove_margin;
pub mod perp_liquidate;
pub mod perp_auto_deleverage;
pub mod perp_settle_funding;
pub mod check_liquidation_batch;

// MPC callback handlers
pub mod mpc_callback;
pub mod settle_order_callback;
pub mod cancel_order_callback;

// ShadowWire settlement (Layer 4 - private transfer)
pub mod finalize_settlement;
pub mod initiate_settlement;
pub mod record_shadowwire_transfer;
pub mod register_shadowwire;
pub mod fail_settlement;
pub mod expire_settlement;

pub use admin::*;
pub use cancel_order::*;
pub use create_pair::*;
pub use initialize::*;
pub use match_orders::*;
pub use place_order::*;
pub use settle_order::*;
pub use unwrap_tokens::*;
pub use wrap_tokens::*;

// ZK verification exports
pub use verify_eligibility::*;

// Perpetuals exports
pub use perp_init_market::*;
pub use perp_init_liquidation::*;
pub use perp_update_funding::*;
pub use perp_open_position::*;
pub use perp_close_position::*;
pub use perp_add_margin::*;
pub use perp_remove_margin::*;
pub use perp_liquidate::*;
pub use perp_auto_deleverage::*;
pub use perp_settle_funding::*;
pub use check_liquidation_batch::*;

// MPC callback exports
pub use mpc_callback::*;
pub use settle_order_callback::*;
pub use cancel_order_callback::*;

// ShadowWire settlement exports
pub use finalize_settlement::*;
pub use initiate_settlement::*;
pub use record_shadowwire_transfer::*;
pub use register_shadowwire::*;
pub use fail_settlement::*;
pub use expire_settlement::*;
