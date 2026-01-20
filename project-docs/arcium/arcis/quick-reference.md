# Quick Reference

> A quick reference cheatsheet for Arcis syntax and patterns

Arcis is a Rust framework for writing MPC circuits on Solana. This page is a **quick reference**—for conceptual understanding, see [Thinking in MPC](mental-model.md).

**Use this page when** you need quick syntax lookup while coding.

## Quick Reference: Limitations

| Category         | Supported                                    | Not Supported                                                           |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| **Control Flow** | `if`, `if/else`, `else if`, `for` loops      | `while`, `loop`, `break`, `continue`, `match`, `if let`, early `return` |
| **Types**        | Integers, floats, arrays, tuples, structs    | `Vec`, `String`, `HashMap`, enums                                       |
| **Functions**    | Helpers, closures, generics, traits          | Recursion, async/await                                                  |
| **Operations**   | Arithmetic, comparisons, right shift (const) | Left shift, right shift (variable)                                      |

**Why?** MPC circuits must have fixed structure. See [Thinking in MPC](mental-model.md) for the full explanation.

## Basic Structure

```rust
use arcis::*;

#[encrypted]
mod my_circuit {
    use arcis::*;

    #[instruction]
    pub fn add(a: u8, b: u8) -> u16 {
        a as u16 + b as u16
    }
}
```

* `#[encrypted]` marks modules containing MPC circuits
* `#[instruction]` marks entry points callable from Solana

## Working with Encrypted Data

```rust
#[instruction]
pub fn process(input: Enc<Shared, u64>) -> Enc<Shared, u64> {
    let value = input.to_arcis();      // Encrypted → secret shares
    let result = value * 2 + 10;       // Compute on shares
    input.owner.from_arcis(result)     // Secret shares → encrypted
}
```

| Owner            | Who Can Decrypt |
| ---------------- | --------------- |
| `Enc<Shared, T>` | Client AND MXE  |
| `Enc<Mxe, T>`    | MXE only        |

## Types

```rust
// Integers
let x: u8 = 255;
let y: i64 = -1000;
let z: u128 = 10000;

// Floats (emulated fixed-point)
let pi: f64 = 3.14159;

// Arrays (fixed-size only)
let arr: [u8; 10] = [0; 10];

// Tuples and structs
let pair: (u8, u16) = (1, 2);

#[derive(Copy, Clone)]
struct Point { x: u16, y: u16 }
```

See [Types](types.md) for complete reference.

## Control Flow

```rust
// if/else: when condition is not a compile-time constant, both branches execute
let result = if condition { a } else { b };

// if without else (for side effects)
if should_update {
    counter += 1;
}

// else if chains work normally
let category = if value < 10 {
    0
} else if value < 100 {
    1
} else {
    2
};

// for loops: fixed iteration count required
for i in 0..10 {
    process(arr[i]);
}
```

## Functions

```rust
// Helper function
fn helper(a: u8, b: u8) -> u16 {
    a as u16 + b as u16
}

// Closures
let double = |x: u8| x * 2;

// Generics
fn set_zero<T: ArcisType + Copy>(a: &mut T) {
    *a = make_zero(*a);
}
```

See [Operations](operations.md#generics) for generics and traits.

## Arrays

```rust
let arr: [u8; 10] = [0; 10];

// Constant index: O(1)
let x = arr[5];

// Secret index: O(n)
let y = arr[secret_idx];

// Methods
arr.swap(0, 1);
arr.reverse();
arr.fill(42);
arr.sort();  // O(n·log²(n)·bit_size)
```

## Iterators

```rust
// Basic iteration
for val in arr.iter() {
    sum += *val;
}

// Chaining
arr.iter().map(|x| *x * 2).sum()
```

See [Operations](operations.md#iterators) for complete iterator support. Note: `.filter()` is not supported.

## Encryption Patterns

```rust
// Shared: client + MXE can decrypt
fn process(input: Enc<Shared, u64>) -> Enc<Shared, u64>

// MXE-owned: only MXE can decrypt
fn process_state(state: Enc<Mxe, GameState>) -> Enc<Mxe, GameState>

// Reveal (use carefully)
let plain = secret.reveal();

// Create MXE-owned data
let mxe_data = Mxe::get().from_arcis(value);
```

See [Input/Output](input-output.md) for details.

## Randomness

```rust
let coin = ArcisRNG::bool();
let num = ArcisRNG::gen_integer_from_width(64);
let uniform = ArcisRNG::gen_uniform::<[u8; 32]>();
ArcisRNG::shuffle(&mut arr);
let (val, ok) = ArcisRNG::gen_integer_in_range(1, 100, 24);
```

See [Primitives](primitives.md#random-number-generation) for complete RNG reference.

## Cryptography

```rust
// Hashing
let hash = SHA3_256::new().digest(&data).reveal();

// Signature verification
let valid = vk.verify(&message, &signature).reveal();

// Key generation
let sk = SecretKey::new_rand();
let vk = VerifyingKey::from_secret_key(&sk);

// MXE signing
let sig = MXESigningKey::sign(&message).reveal();
```

See [Primitives](primitives.md#cryptographic-operations) for complete crypto reference.

## Data Packing

```rust
// Pack for efficient storage
let packed = Pack::new(data);

// Unpack to use
let data: [u8; 64] = packed.unpack();
```

See [Primitives](primitives.md#data-packing) for details.

## Debugging

```rust
println!("value = {}", x);
debug_assert!(x > 0, "x must be positive");
```

See [Best Practices](best-practices.md#debugging) for debugging strategies.

## Testing

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_helper() {
        // Only non-#[instruction] functions can be unit tested
        assert_eq!(helper(1, 2), 3);
    }
}
```

See [Best Practices](best-practices.md#testing) for testing strategies.

## What's Next?

Ready to build? Start here:

| Resource | Description |
|----------|-------------|
| [Hello World](../hello-world.md) | Build your first Arcis circuit step-by-step |
| [Solana Integration](../program/program-overview.md) | Invoke circuits from your Solana program |
| [JavaScript Client](../js-client-library/js-client-overview.md) | Call circuits from TypeScript |

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
