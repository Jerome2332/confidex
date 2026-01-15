//! Settlement module for executing trades
//!
//! Supports multiple settlement methods:
//! - ShadowWire: Bulletproof-based private transfers (production ready)
//! - C-SPL: Arcium confidential SPL tokens (when available)
//!
//! The settlement layer executes after order matching completes.

pub mod shadowwire;
pub mod types;

pub use shadowwire::*;
pub use types::*;
