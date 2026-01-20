# Operations

> Complete reference for supported operations, expressions, and patterns in Arcis MPC circuits

Arcis supports many of Rust's native operations and extends them for encrypted data, allowing you to write private computations using familiar Rust syntax. See the tables below for a detailed list of supported and unsupported operations.

**Use this page when** you need to check if a specific operation is supported in Arcis circuits.

## Quick Summary

**Works:** `if/else`, `for` loops, arithmetic, comparisons, iterators (except filter)

**Doesn't work:** `while`, `loop`, `break`, `match`, `return`, `.filter()`

See tables below for full details.

### Table of contents

* [Expression support](#expression-support)
  * [Binary expressions](#binary-expressions)
  * [Casts](#cast-expressions)
  * [Literals](#literal-expressions)
  * [Methods](#method-calls)
  * [Paths](#paths)
* [Item support](#item-support)
* [Pattern support](#pattern-support)

## Expression support

| Expression Name   | Example                        | Support         | Comments                                                                                                                                    |
| ----------------- | ------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Array literal     | `[a, b]`                       | Supported       |                                                                                                                                             |
| Assignment        | `a = b;`                       | Supported       |                                                                                                                                             |
| Async block       | `async { ... }`                | Unsupported     |                                                                                                                                             |
| Await             | `foo().await`                  | Unsupported     |                                                                                                                                             |
| Binary expression | `a + b`                        | Partial Support | [See table below](#binary-expressions) for supported binary expressions.                                                                    |
| Block expression  | `{ ... }`                      | Supported       |                                                                                                                                             |
| Break             | `break;`                       | Unsupported     |                                                                                                                                             |
| Function call     | `f(a, b)`                      | Partial Support | [See table below](#function-calls) for supported functions.                                                                                 |
| Casts             | `a as u16`                     | Partial Support | [See table below](#cast-expressions) for supported conversions.                                                                             |
| Closures          | `\|a, b\| a + b`               | Supported       |                                                                                                                                             |
| Const block       | `const { ... }`                | Supported       |                                                                                                                                             |
| Continue          | `continue;`                    | Unsupported     |                                                                                                                                             |
| Field access/set  | `obj.field`                    | Supported       |                                                                                                                                             |
| For loop          | `for i in expr { ... }`        | Supported       | Note that `expr` will have its length known at compile-time.                                                                                |
| If                | `if cond { ... } else { ... }` | Supported       | Complexity is O(then_block + else_block).                                                                                                   |
| Indexing          | `a[idx]`                       | Supported       | Complexity is O(`a.len()`) if `idx` isn't compile-time known (all positions are checked to hide which index was accessed).                  |
| If let            | `if let Some(x) = ...`         | Unsupported     |                                                                                                                                             |
| Literals          | `1u128`                        | Partial Support | [See table below](#literal-expressions) for supported literals.                                                                             |
| Loops             | `loop { ... }`                 | Unsupported     | MPC circuits have fixed structure—variable iteration counts would require dynamic circuit size. Use `for` with compile-time bounds instead. |
| Macros            | `println!("{}", q)`            | Partial Support | [See table below](#macros) for supported macros.                                                                                            |
| Match             | `match n { ... }`              | Unsupported     |                                                                                                                                             |
| Method calls      | `x.foo(a, b)`                  | Partial Support | [See table below](#method-calls) for supported methods.                                                                                     |
| Parentheses       | `(a + b)`                      | Supported       |                                                                                                                                             |
| Paths             | `Foo::bar`                     | Partial Support | [See table below](#paths) for supported paths.                                                                                              |
| Ranges            | `4..5`                         | Partial Support | Not supported in `arr[4..16]`.                                                                                                              |
| Raw addresses     | `&raw const foo`               | Unsupported     |                                                                                                                                             |
| References        | `&mut foo`                     | Supported       |                                                                                                                                             |
| Repeat arrays     | `[4u8; 128]`                   | Supported       |                                                                                                                                             |
| Return            | `return false;`                | Unsupported     |                                                                                                                                             |
| Struct literals   | `MyStruct { a: 12, b }`        | Supported       |                                                                                                                                             |
| Try expression    | `this_call_can_err()?;`        | Unsupported     |                                                                                                                                             |
| Tuple literal     | `(a, 4, c)`                    | Supported       |                                                                                                                                             |
| Unary expressions | `!x`                           | Partial Support | User-defined unary operations are not supported.                                                                                            |
| Unsafe            | `unsafe { ... }`               | Unsupported     |                                                                                                                                             |
| While loops       | `while x < 64 { ... }`         | Unsupported     | Cannot be supported as the number of iterations is not known.                                                                               |

**Note:** In MPC, both `if` and `else` branches are always evaluated—the condition only selects which result to use. This ensures the execution pattern does not leak information about the condition value. See [Thinking in MPC](mental-model.md) for details.

### Binary expressions

User-defined binary operations are currently unsupported.

| Example    | Supported types                            |
| ---------- | ------------------------------------------ |
| `a + b`    | Integers, floats                           |
| `a - b`    | Integers, floats                           |
| `a * b`    | Integers, floats                           |
| `a / b`    | Integers, floats                           |
| `a % b`    | Integers                                   |
| `a && b`   | Booleans                                   |
| `a \|\| b` | Booleans                                   |
| `a ^ b`    | Booleans                                   |
| `a & b`    | Booleans                                   |
| `a \| b`   | Booleans                                   |
| `a << b`   | None                                       |
| `a >> b`   | Integers, if `b` is known at compile time. |
| `a == b`   | All. Use `derive(PartialEq)` for structs.  |
| `a != b`   | All. Use `derive(PartialEq)` for structs.  |
| `a < b`    | Booleans, integers, floats                 |
| `a <= b`   | Booleans, integers, floats                 |
| `a >= b`   | Booleans, integers, floats                 |
| `a > b`    | Booleans, integers, floats                 |
| `a += b`   | Integers, floats                           |
| `a -= b`   | Integers, floats                           |
| `a *= b`   | Integers, floats                           |
| `a /= b`   | Integers, floats                           |
| `a %= b`   | Integers                                   |
| `a ^= b`   | Booleans                                   |
| `a &= b`   | Booleans                                   |
| `a \|= b`  | Booleans                                   |
| `a <<= b`  | None                                       |
| `a >>= b`  | Integers, if `b` is known at compile time  |

### Cast expressions

`a as MyType` is only supported:

| From Type    | To Type      |
| ------------ | ------------ |
| integer type | integer type |
| `bool`       | integer type |
| integer type | `bool`       |
| `&...&T`     | `&T`         |

### Function calls

The following function calls are supported:

* user-defined function calls (without recursion)
* `ArcisRNG::bool()` to generate a boolean.
* `ArcisRNG::gen_uniform::<T>()` to generate a uniform value of type T (bool, integer, or combination). Requires explicit type parameter.
* `ArcisRNG::gen_integer_from_width(width: usize) -> u128`. Generates a secret integer between 0 and 2^width - 1 included.
* `ArcisRNG::gen_public_integer_from_width(width: usize) -> u128`. Generates a public integer between 0 and 2^width - 1 included.
* `ArcisRNG::gen_integer_in_range(min: u128, max: u128, n_attempts: usize) -> (u128, bool)`. Generates a random integer in `[min, max]` using rejection sampling. **`n_attempts` must be compile-time known**. Returns `(result, success)` where `success=false` indicates all attempts were rejected. With `n_attempts=24`, failure probability is `<2^-24`.
* `ArcisRNG::shuffle(slice)` on slices. Complexity is in `O(n*log³(n) + n*log²(n)*sizeof(T))`.
* `Mxe::get()` to be able to create MXE-owned secret data.
* `Shared::new(arcis_public_key)` to share private data with `arcis_public_key`.
* `ArcisX25519Pubkey::from_base58(base58_byte_string)` to create a public key from a base58-encoded address.
* `ArcisX25519Pubkey::from_uint8(u8_byte_slice)` to create a public key from a Uint8 array.
* `SolanaPublicKey::from_serialized(value)` to create a Solana public key from serialized form.
* `SolanaPublicKey::from_base58(byte_string)` to create a Solana public key from base58.
* `ArcisMath::sigmoid(x)` for the sigmoid activation function.
* `LogisticRegression::new(coef, intercept)` for logistic regression models.
* `LinearRegression::new(coef, intercept)` for linear regression models.
* `Pack::new(value)` to bit-pack data for onchain storage (multiple small values fit into fewer field elements).
* `ArcisX25519Pubkey::new_from_x(x: BaseField)` to create a public key from its Curve25519 Montgomery X-coordinate.
* `ArcisX25519Pubkey::to_x()` to extract the Montgomery X-coordinate from a public key.

### Literal expressions

| Example     | Support     |
| ----------- | ----------- |
| `"foo"`     | Unsupported |
| `b"foo"`    | Supported   |
| `c"foo"`    | Unsupported |
| `b'f'`      | Supported   |
| `'a'`       | Unsupported |
| `1`         | Supported   |
| `1u16`      | Supported   |
| `1f64`      | Supported   |
| `1.0e10f64` | Supported   |
| `true`      | Supported   |

### Macros

The following macros are supported to help debug your Rust code:

* `debug_assert!`, `debug_assert_ne!`, `debug_assert_eq!`. They do not change instruction behavior and are only useful for debugging your Rust code.
* `eprint!`, `eprintln!`, `print!`, `println!`. They do not change instruction behavior and are only useful for debugging your Rust code.
* `arcis_static_panic!(message)` to fail compilation when the branch is reached. Useful for enforcing constraints that must be known before circuit generation.

Example usage:

```rust
const ARRAY_LEN: usize = 3; // Change to 1 and the example will not compile.

fn second_element(arr: &[u8]) -> u8 {
    if arr.len() < 2 {
        arcis_static_panic!("Array must have at least 2 elements");
    }
    arr[1]
}

#[instruction]
fn reveal_second_element(input: Enc<Shared, Pack<[u8; ARRAY_LEN]>>) -> u8 {
    let array = input.to_arcis().unpack();
    second_element(&array).reveal()
}
```

**Note:** `arcis_static_panic!` triggers at compile time when the Arcis compiler evaluates the branch. Try changing `ARRAY_LEN` to `1` above—the compile error demonstrates how this macro enforces constraints that must be validated before circuit generation.

### Method calls

The following method calls are supported:

* user-defined method calls (with generics but without recursion)
* `.clone()` on all `Clone` objects.
* `.len()`, `.is_empty()`, `.swap(a, b)`, `.fill(value)`, `.reverse()`, `.iter()`, `.iter_mut()`, `.into_iter()`, `.windows(width)`, `.copy_from_slice(src)`, `.clone_from_slice(src)`, `.split_at(mid)`, `.split_at_mut(mid)`, `.rotate_left(mid)`, `.rotate_right(mid)`, `.contains(item)`, `.starts_with(needle)`, `.ends_with(needle)` on arrays and slices.
* `.sort()` on arrays of integers. Complexity is in `O(n*log²(n)*bit_size)`.
* `.enumerate()`, `.chain(other)`, `.cloned()`, `.copied()`, `.count()`, `.rev()`, `.zip(other)`, `.map(func)`, `.for_each(func)`, `.fold(init, func)`, `.sum()`, `.product()` on iterators.
* `.take(n)`, `.skip(n)`, `.step_by(n)` on iterators when `n` is compile-time known.
* `.reveal()` if not inside an `if` or `else` block where the condition is not a compile-time constant
* `.to_arcis()` on `Enc`s
* `.from_arcis(x)` on `Owner`s (objects of types `Mxe` or `Shared`) if not inside an `if` or `else` block where the condition is not a compile-time constant
* `.abs()`, `.min(x)`, `.max(x)` on integers and floats
* `.abs_diff(other)`, `.is_positive()`, `.is_negative()`, `.div_ceil(other)` on integers
* `.to_le_bytes()`, `.to_be_bytes()` on typed integers (does not work on integers whose type the interpreter does not know)
* `.exp()`, `.exp2()`, `.ln()`, `.log2()`, `.sqrt()` on floats.
* `.unpack()` on `Pack<T>` to extract the original value from packed storage.
* `.to_arcis_with_pubkey_and_nonce(pubkey, nonce)` on `EncData<T>` to decrypt when the key is shared across inputs (avoids duplicate decryption gates).

### Paths

The following paths are supported:

* `IntType::BITS`, `IntType::MIN` and `IntType::MAX` where `IntType` is an integer type.
* Paths to user-defined constants, functions and structs, as long as they don't use the unsupported `crate` or `super`.
* `std::mem::replace` and `std::mem::swap`

## Item support

| Item Name         | Example                     | Support         | Comments                                                                               |
| ----------------- | --------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| Constant          | `const MAX: u16 = 65535`    | Supported       |                                                                                        |
| Enum              | `enum MyEnum { ... }`       | Unsupported     |                                                                                        |
| Extern            | `extern ...`                | Unsupported     |                                                                                        |
| Functions         | `fn foo() -> u8 { 0 }`      | Partial Support | Recursive functions are not supported.                                                 |
| Impls             | `impl MyType { ... }`       | Supported       | Generics and custom traits are supported. `MyType` must not be a reference.            |
| Macro Definitions | `macro_rules! ...`          | Unsupported     |                                                                                        |
| Macro Invocations | `println!(...)`             | Partial Support | [See table above](#macros) for supported macros.                                       |
| Modules           | `mod my_module { ... }`     | Supported       |                                                                                        |
| Statics           | `static ...`                | Unsupported     |                                                                                        |
| Structs           | `struct MyStruct { ... }`   | Supported       |                                                                                        |
| Traits            | `trait MyTrait { ... }`     | Partial Support | Custom traits with associated types and constants. Standard library traits forbidden.¹ |
| Type Aliases      | `type MyId = usize;`        | Supported       |                                                                                        |
| Union             | `union MyUnion { ... }`     | Unsupported     |                                                                                        |
| Use               | `use arcis::*`              | Partial Support | Only `use arcis::*` is supported.                                                      |
| Arcis Circuit     | `#[arcis_circuit = "name"]` | Supported       | Use a pre-built optimized circuit by name. For internal/advanced use.                  |

**¹ Forbidden trait implementations**: You cannot manually implement `Drop`, `Deref`, `AsRef`, `AsMut`, `From`, `Into`, `TryFrom`, `TryInto`, `PartialEq`, `Eq`, `PartialOrd`, `Ord`, `Clone`, `ToOwned`, `ToString`, `Default`, `Iterator`, `IntoIterator`, `DoubleEndedIterator`, `ExactSizeIterator`, `Extend`, `FromIterator`, `Fn`, `FnMut`, `FnOnce`, `Future`, `IntoFuture`, `AsyncFn`, `AsyncFnMut`, or `AsyncFnOnce`.

**Why?** These traits have special runtime semantics (drop ordering, lazy evaluation, dynamic dispatch) that cannot be correctly translated to fixed MPC circuits. The Arcis compiler provides built-in implementations that work within MPC constraints.

Use `#[derive(...)]` for `Clone`, `PartialEq`, etc., which generates MPC-compatible implementations.

## Pattern support

The following patterns are supported in function arguments and `let` statements:

* simple idents: `let ident = ...;`
* mutable idents: `let mut ident = ...;`
* ref idents: `let ref ident = ...;`
* mutable ref idents: `let ref mut ident = ...;`
* parentheses around a supported pattern: `let (...) = ...;`
* reference of a supported pattern: `let &... = ...;`
* array of supported patterns: `let [...] = ...;`
* struct of supported patterns: `let MyStruct { ... } = ...;`
* tuple of supported patterns: `let (...) = ...;`
* tuple struct of supported patterns: `let MyStruct(...) = ...;`
* type pattern of a supported pattern: `let ...: ty = ...;`
* wild pattern: `let _ = ...;`

In particular, the `..` pattern is currently unsupported.

## Generics

Arcis supports Rust generics with some constraints. Generic types must be known at compile time. Runtime polymorphism is not supported.

### Generic Functions

```rust
#[encrypted]
mod generics_example {
    use arcis::*;

    // Use a pre-built optimized circuit by name
    // The empty function body is intentional - the circuit implementation is built-in
    #[arcis_circuit = "zero"]
    fn make_zero<T: ArcisType>(a: T) -> T {}

    fn set_zero<T: ArcisType + Copy>(a: &mut T) {
        *a = make_zero(*a);
    }

    #[instruction]
    fn zero_any_type(mut arr: [u8; 10], mut val: u64) -> ([u8; 10], u64) {
        set_zero(&mut arr);
        set_zero::<u64>(&mut val);  // Turbofish syntax works
        (arr, val)
    }
}
```

### Generic Structs

```rust
struct Wrapper<T>(T);

impl<T> Wrapper<T> {
    fn new(value: T) -> Self {
        Wrapper(value)
    }

    fn into_inner(self) -> T {
        self.0
    }
}

#[instruction]
fn use_generic_struct(a: u8) -> u8 {
    Wrapper::new(a).into_inner()
}
```

### Custom Traits

```rust
trait Processable {
    type Output;
    fn process(&self) -> Self::Output;
}

impl Processable for u8 {
    type Output = u16;
    fn process(&self) -> u16 {
        *self as u16 * 2
    }
}

fn apply_process<T: Processable>(val: &T) -> T::Output {
    val.process()
}

#[instruction]
fn trait_example(x: u8) -> u16 {
    apply_process(&x)
}
```

### Generic Constraints

| Feature                 | Supported | Notes                           |
| ----------------------- | --------- | ------------------------------- |
| Type parameters `<T>`   | Yes       | Must be known at compile time   |
| Trait bounds `T: Trait` | Yes       | Including `ArcisType`           |
| Associated types        | Yes       | `type Output;`                  |
| Associated constants    | Yes       | `const SIZE: usize;`            |
| Where clauses           | Yes       | `where T: Clone`                |
| Turbofish `::<T>`       | Yes       | For explicit type specification |
| Runtime polymorphism    | No        | No `dyn Trait` or trait objects |

## Iterators

Most iterator methods work in Arcis, with the notable exception of `.filter()`.

### Supported Iterator Methods

```rust
#[instruction]
fn iterator_examples(arr: [u8; 10]) -> u16 {
    // Basic iteration
    let mut sum = 0u16;
    for val in arr.iter() {
        sum += *val as u16;
    }

    // Method chaining
    arr.iter()
       .map(|x| *x as u16)
       .map(|x| x * 2)
       .sum()
}
```

### Complete Iterator Support

| Method           | Supported | Notes                                |
| ---------------- | --------- | ------------------------------------ |
| `.iter()`        | Yes       | Creates iterator of references       |
| `.iter_mut()`    | Yes       | Mutable references                   |
| `.into_iter()`   | Yes       | Consumes collection                  |
| `.map(f)`        | Yes       | Transform elements                   |
| `.enumerate()`   | Yes       | Add indices                          |
| `.zip(other)`    | Yes       | Pair with another iterator           |
| `.chain(other)`  | Yes       | Concatenate iterators                |
| `.rev()`         | Yes       | Reverse order                        |
| `.cloned()`      | Yes       | Clone elements                       |
| `.copied()`      | Yes       | Copy elements                        |
| `.fold(init, f)` | Yes       | Reduce with accumulator              |
| `.sum()`         | Yes       | Sum all elements                     |
| `.product()`     | Yes       | Multiply all elements                |
| `.count()`       | Yes       | Count elements                       |
| `.take(n)`       | Yes       | n must be compile-time known         |
| `.skip(n)`       | Yes       | n must be compile-time known         |
| `.step_by(n)`    | Yes       | n must be compile-time known         |
| `.for_each(f)`   | Yes       | Apply function to each               |
| `.filter(f)`     | **No**    | Would produce variable-length output |
| `.find(f)`       | **No**    | Would require early exit             |
| `.any(f)`        | **No**    | Would require early exit             |
| `.all(f)`        | **No**    | Would require early exit             |

### Filter Alternative

Since `.filter()` is not supported (it produces variable-length output), use a manual loop with conditionals:

```rust
// ✗ Not supported
arr.iter().filter(|x| **x > threshold).sum()

// ✓ Manual filter pattern
#[instruction]
fn filter_sum(arr: [u8; 10], threshold: u8) -> u16 {
    let mut sum = 0u16;
    for val in arr.iter() {
        if *val > threshold {
            sum += *val as u16;
        }
    }
    sum
}
```

This pattern checks all elements but only accumulates those meeting the condition—same result, fixed execution structure.

## What's Next?

| Resource | Description |
|----------|-------------|
| [Primitives](primitives.md) | RNG, cryptography, and data packing operations |
| [Best Practices](best-practices.md) | Performance optimization tips based on operation costs |
| [Cost Model](mental-model.md#cost-model) | Understanding the cost model behind operations |

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
