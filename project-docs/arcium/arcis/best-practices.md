# Best Practices

> Performance tips, debugging techniques, and testing strategies for Arcis circuits

This guide covers practical tips for writing efficient, debuggable, and testable Arcis circuits.

**Use this page when** you are optimizing circuit performance, debugging an issue, or setting up tests.

## Understanding Execution Flow

For conceptual background on why MPC circuits work differently (e.g., why both if/else branches execute), see [Thinking in MPC](mental-model.md).

## Performance Optimization

### Operation Costs

See [Thinking in MPC - Cost Model](mental-model.md#cost-model) for the full cost breakdown.

| Operation                             | Cost      | Notes                                       |
| ------------------------------------- | --------- | ------------------------------------------- |
| Addition, subtraction, multiplication | Cheap     | Multiplications optimized via preprocessing |
| Comparisons                           | Expensive | Bit decomposition required                  |
| Division, modulo                      | Expensive | Multiple internal operations                |
| Dynamic indexing                      | O(n)      | Checks all positions                        |

### Optimization Tips

**Batch encrypted outputs when possible**:

```rust
// Multiple separate encryptions have overhead
let enc_a = owner.from_arcis(x);
let enc_b = owner.from_arcis(y);

// If you need both values encrypted together, use a tuple type
let enc_tuple: Enc<Shared, (u64, u64)> = owner.from_arcis((x, y));

// ✗ Won't compile - Enc<T> wraps the entire value,
//   so destructuring patterns don't work on Enc types
// let (enc_a, enc_b) = owner.from_arcis((x, y));
```

**Reuse comparison results**:

```rust
// ✗ Redundant - same comparison computed twice
if x > 1000 {
    do_something();
}
if x > 1000 {  // Expensive comparison done AGAIN
    do_another_thing();
}

// ✓ Compute once, reuse the result
let is_large = x > 1000;
if is_large {
    do_something();
}
if is_large {  // Reuses the boolean, no recomputation
    do_another_thing();
}
```

**Prefer public constants over secret-dependent values**:

```rust
// ✓ Constant multiplier - compiler can optimize
fn double(x: u64) -> u64 {
    x * 2  // Multiplication by constant is efficient
}

// ✓ Pass known values as public inputs
fn apply_rate(amount: u64, rate_percent: u64) -> u64 {
    // If rate is known ahead of time, pass it as a public input
    // rather than computing it inside the secure computation
    amount * rate_percent / 100
}
```

In MPC, values known before the computation (public inputs and constants) can be handled more efficiently than values computed during secure execution.

## Debugging

Arcis provides familiar debugging macros that work during circuit development.

### Print Debugging

```rust
#[instruction]
fn debug_example(a: u32, b: u32) -> u32 {
    println!("Inputs: a = {}, b = {}", a, b);

    let result = a + b;
    println!("Result: {}", result);

    // Also available: print!, eprint!, eprintln!
    eprintln!("Debug: computation complete");

    result
}
```

**Note:** Print macros do not change circuit behavior. They are for development only. Output appears during circuit execution on ARX nodes.

### Debug Assertions

Use assertions to verify invariants during development:

```rust
#[instruction]
fn with_assertions(x: u32, y: u32) -> u32 {
    debug_assert!(x > 0, "x must be positive");
    debug_assert_eq!(x, x, "sanity check");
    debug_assert_ne!(x, y, "x and y should differ");

    x + y
}
```

**Warning:** `debug_assert` macros are for development verification only. They do not enforce constraints in production—use explicit conditionals for actual validation logic.

### Common Debugging Patterns

**Trace loop iterations**:

```rust
for i in 0..10 {
    println!("Iteration {}: value = {}", i, arr[i]);
    // ... processing
}
```

**Check intermediate values**:

```rust
let step1 = compute_step1(input);
println!("After step1: {}", step1);

let step2 = compute_step2(step1);
println!("After step2: {}", step2);
```

## Testing

### What Can Be Unit Tested

You can test:

* **Helper functions** (non-`#[instruction]` functions)
* **`#[arcis_circuit]` functions** (builtin circuits)
* **Pure logic** extracted into testable units

You **cannot** directly unit test:

* **`#[instruction]` functions** (require MPC runtime)

### Testing Strategy

Extract testable logic into helper functions:

```rust
#[encrypted]
mod circuits {
    use arcis::*;

    // Testable: regular function
    pub fn calculate_fee(amount: u64, rate: u64) -> u64 {
        amount * rate / 10000  // basis points
    }

    // Testable: builtin circuit
    #[arcis_circuit = "min"]
    pub fn min(a: u128, b: u128) -> u128 {}

    // NOT directly testable: requires MPC
    #[instruction]
    fn transfer_with_fee(amount: u64, rate: u64) -> u64 {
        let fee = calculate_fee(amount, rate);
        amount - fee
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_calculation() {
        // 2.5% fee on 10000
        assert_eq!(circuits::calculate_fee(10000, 250), 250);
        // 1% fee on 5000
        assert_eq!(circuits::calculate_fee(5000, 100), 50);
    }

    #[test]
    fn test_builtin_circuit() {
        assert_eq!(circuits::min(10, 20), 10);
        assert_eq!(circuits::min(1, 0), 0);
        assert_eq!(circuits::min(4, 4), 4);
    }
}
```

### Integration Testing

`#[instruction]` functions cannot be unit-tested in isolation—they require the full MPC runtime. For end-to-end testing, use the TypeScript SDK to invoke deployed circuits on a test cluster.

See the [JavaScript Client documentation](../js-client-library/js-client-overview.md) and the [Hello World tutorial](../hello-world.md) for integration testing setup.

## Common Pitfalls

### Conditionals Don't Guard Execution

When a condition is not a compile-time constant, both branches execute. The condition selects which result to keep, but ARX nodes perform work for both paths.

See [Thinking in MPC](mental-model.md#both-branches-always-execute) for the full explanation.

```rust
// Problematic: assumes the indexing won't happen when found_match is false
if found_match {
    data[secret_idx] = new_value;  // Executes regardless of found_match
}

// Safe: constant-index loop with conditional assignment
for i in 0..DATA_SIZE {
    let should_update = found_match && (i == secret_idx);
    if should_update {
        data[i] = new_value;
    }
}
```

### Reveal and Encryption Placement

`.reveal()` and `.from_arcis()` cannot appear inside conditional blocks. See [Thinking in MPC](mental-model.md#reveal-and-encryption-placement) for the correct pattern.

## Error Handling

### Compile-Time vs Runtime

| Condition                 | Compile-Time                 | Runtime                 |
| ------------------------- | ---------------------------- | ----------------------- |
| Division by zero          | Error if divisor is constant | Undefined behavior      |
| Array index out of bounds | Error if index is constant   | Error during evaluation |
| Float out of range        | Error for literals           | Silently clamped        |

**Warning:** If your divisor could be zero based on secret inputs, add explicit validation:

```rust
let is_valid = divisor != 0;
let safe_divisor = if is_valid { divisor } else { 1 };
let result = if is_valid { numerator / safe_divisor } else { 0 };
```

**Best practices:**

1. Use constant array sizes where possible
2. Validate divisors before division when they depend on secret inputs
3. Keep floats within the supported range `[-2^75, 2^75)`

## What's Next?

| Resource | Description |
|----------|-------------|
| [Quick Reference](quick-reference.md) | Keep this open while coding for fast syntax lookup |
| [Hello World](../hello-world.md) | Build your first Arcis circuit end-to-end |
| [Solana Integration](../program/program-overview.md) | Invoke circuits from your Solana program |
| [JavaScript Client](../js-client-library/js-client-overview.md) | Call circuits from TypeScript |

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
