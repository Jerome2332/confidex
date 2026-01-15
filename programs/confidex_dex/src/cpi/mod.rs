//! Cross-Program Invocation modules for external integrations
//!
//! This module contains CPI helpers for:
//! - Arcium MPC operations (encrypted computations)
//! - Sunspot ZK verifier (Groth16 proof verification)

pub mod arcium;
pub mod verifier;

pub use arcium::*;
pub use verifier::*;
