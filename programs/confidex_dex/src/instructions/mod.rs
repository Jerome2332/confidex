pub mod admin;
pub mod cancel_order;
pub mod create_pair;
pub mod initialize;
pub mod match_orders;
pub mod place_order;
pub mod unwrap_tokens;
pub mod wrap_tokens;

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

pub use admin::*;
pub use cancel_order::*;
pub use create_pair::*;
pub use initialize::*;
pub use match_orders::*;
pub use place_order::*;
pub use unwrap_tokens::*;
pub use wrap_tokens::*;

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
