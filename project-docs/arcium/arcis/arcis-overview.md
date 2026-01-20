# Arcis Overview

> Introduction to Arcis, a Rust-based framework for writing secure MPC circuits on the Arcium network

Arcis is a Rust-based framework for writing secure multi-party computation (MPC) circuits that run on the Arcium network. Create privacy-preserving applications that compute over encrypted data using familiar Rust syntax.

## What Arcis Code Looks Like

Arcis code is standard Rust with special annotations for MPC execution:

```rust
use arcis::*;

#[encrypted]
mod my_circuit {
    use arcis::*;

    #[instruction]
    pub fn add_private(a: Enc<Shared, u64>, b: Enc<Shared, u64>) -> Enc<Shared, u64> {
        let x = a.to_arcis();  // Encrypted → secret shares
        let y = b.to_arcis();
        a.owner.from_arcis(x + y)  // Secret shares → encrypted
    }
}
```

This computes `a + b` where both inputs remain encrypted throughout. No node ever sees the plaintext values.

## Key Resources

| Resource | Description |
|----------|-------------|
| [Thinking in MPC](mental-model.md) | Understand why MPC circuits work differently and the mental model behind Arcis |
| [Hello World](../hello-world.md) | Build your first Arcis circuit with a hands-on tutorial |
| [Examples](https://github.com/arcium-hq/examples) | Real-world circuits: voting, games, DeFi applications |
| [Quick Reference](quick-reference.md) | Quick reference cheatsheet for Arcis syntax and patterns |

## Key Features

* **Rust-based**: Use Rust's type safety and performance for MPC development.
* **Circuit-oriented**: Write MPC circuits using familiar Rust syntax with constraints for fixed circuit structure.
* **Privacy-focused**: Compute over encrypted data without revealing the underlying information.

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
