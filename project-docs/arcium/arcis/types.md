# Types

> Supported types in Arcis: integers, floats, arrays, structs, and encrypted types

The following types are supported:

* `u8`, `u16`, `u32`, `u64`, `u128`, `usize`, `i8`, `i16`, `i32`, `i64`, `i128`, `isize`
* `f64`, `f32` (emulated as fixed-point with 52 fractional bits; supported range is `[-2^75, 2^75)`. Values outside this range are unsupported.)
* tuples of supported types, including `()`
* fixed-length arrays of a supported type
* slices with compile-time known length (e.g., `&arr[..]` from fixed arrays, or `&[u8]` parameters in stdlib APIs like SHA3)
* compile-time known ranges
* (mutable) references to a supported type
* user-defined structs of supported types
* functions (but not as input or output of an encrypted instruction)
* `ArcisX25519Pubkey`, an Arcis public key wrapper.
* Arcis-defined `Enc`, `Mxe` and `Shared`.
* `Pack<T>`, a wrapper for bit-packing data into fewer field elements for onchain storage.
* `EncData<T>`, encrypted data without embedded cipher info. Use with `.to_arcis_with_pubkey_and_nonce()` when multiple values share the same key.
* `BaseField`, a Curve25519 field element (F_{2^255-19}, stored in 256 bits) used as the native type for circuit computations.

**Float emulation warning**: Arcis emulates `f64`/`f32` as fixed-point with 52 fractional bits. This differs from IEEE 754 floats:

* Different precision characteristics than standard floats
* Supported range: `[-2^75, 2^75)`
* **Float literals outside this range produce a compile-time error:** `"Arcis only supports inputs in the range [-2**75, 2**75)"`
* **Computed values outside this range are silently clamped** to the boundary values

## Encryption Types

| Type             | Description                                 |
| ---------------- | ------------------------------------------- |
| `Enc<Shared, T>` | Data encrypted for client + MXE             |
| `Enc<Mxe, T>`    | Data encrypted for MXE only                 |
| `EncData<T>`     | Raw encrypted data (advanced use—see below) |
| `Shared`         | Owner type for client-shared encryption     |
| `Mxe`            | Owner type for MXE-only encryption          |

The `Owner` type parameter determines who can decrypt:

* **`Shared`**: Both client and MXE can decrypt. Use for user inputs/outputs that need client-side verification.
* **`Mxe`**: Only the MXE cluster can decrypt. Use for internal protocol state that users should not access.

## Public Key Types

| Type                        | Description                                  |
| --------------------------- | -------------------------------------------- |
| `ArcisX25519Pubkey`         | Arcis X25519 public key wrapper              |
| `SolanaPublicKey`           | Solana public key (32 bytes)                 |
| `SerializedSolanaPublicKey` | Serialized form using `{lo: u128, hi: u128}` |

## Example

```rust
use arcis::*;

#[encrypted]
mod types_example {
    use arcis::*;

    #[derive(Copy, Clone)]
    struct GameState {
        score: u64,
        level: u8,
    }

    #[instruction]
    fn example(
        user_data: Enc<Shared, u64>,
        state: Enc<Mxe, GameState>,
    ) -> Enc<Shared, u64> {
        let value = user_data.to_arcis();
        user_data.owner.from_arcis(value * 2)
    }
}
```

## Advanced: EncData\<T>

`EncData<T>` stores just the encrypted ciphertext without owner metadata. Compare:

| Type            | Contains                         | Use Case                                   |
| --------------- | -------------------------------- | ------------------------------------------ |
| `Enc<Owner, T>` | Owner (cipher context) + EncData | Standard encrypted input/output            |
| `EncData<T>`    | Just ciphertext                  | Performance optimization when sharing keys |

**When to use `EncData<T>`:** When multiple inputs share the same public key, `Enc<Shared, T>` duplicates the key-derivation circuit for each input. Instead, use `EncData<T>` with a shared key:

```rust
#[instruction]
fn optimized_sum(
    key: ArcisX25519Pubkey,
    t_nonce: u128, t: EncData<u64>,
    u_nonce: u128, u: EncData<u64>,
) -> u64 {
    // Decrypt both values using shared key (avoids duplicate key-derivation circuits)
    let t_val = t.to_arcis_with_pubkey_and_nonce(key, t_nonce);
    let u_val = u.to_arcis_with_pubkey_and_nonce(key, u_nonce);

    // Compute sum and reveal result
    (t_val + u_val).reveal()
}
```

**Warning:** `EncData<T>` is an advanced optimization with security implications:

* **Nonce uniqueness:** Each (key, nonce) pair must be unique. Reusing nonces compromises security.
* **Silent failures:** Using the wrong key or nonce produces garbage data without error—MPC cannot add runtime validation since that would leak information.

For most use cases, use `Enc<Shared, T>` or `Enc<Mxe, T>`, which handle key management automatically.

## Unsupported Types

In particular, Arcis does not currently support `HashMap`, `Vec`, `String` (we do not support types with a variable `len`). Constant-size byte strings (like `b"hello_world"`) are supported.

The `Enc` type defines the encrypted data input, which is used as `Enc<Owner, T>` where `Owner` can be either `Mxe` or `Shared`, signaling which party can decrypt data of type `T`. You can read more about dealing with encrypted inputs/outputs in [input-output.md](input-output.md).

**Storage representation:** All values are stored as 256-bit Curve25519 field elements. A `u8` uses the same storage as a `u128`—integer type bounds are enforced at compile time, not by storage size. Use `Pack<T>` to compress multiple small values into fewer field elements for onchain efficiency.

## What's Next?

| Resource | Description |
|----------|-------------|
| [Input/Output](input-output.md) | Working with `Enc<Owner, T>` for encrypted inputs and outputs |
| [Operations](operations.md) | Complete operation support matrix and iterator reference |
| [Primitives](primitives.md) | RNG, crypto, and `Pack<T>` for efficient storage |

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
