# Primitives

> Random number generation, cryptographic operations, and data packing in Arcis

Arcis provides built-in primitives for randomness, cryptography, and efficient data storage. These operations are implemented as optimized MPC circuits.

## Random Number Generation

The `ArcisRNG` struct provides access to randomness within MPC circuits. All random values are generated within the MPC context.

### Basic Usage

```rust
use arcis::*;

#[encrypted]
mod randomness_example {
    use arcis::*;

    #[instruction]
    pub fn random_operations() -> (bool, u128, [u8; 32]) {
        // Generate a random boolean (50/50 probability)
        let coin_flip = ArcisRNG::bool();

        // Generate a random integer with specific bit width
        // Returns u128 in range [0, 2^width - 1]
        let random_byte = ArcisRNG::gen_integer_from_width(8);  // 0-255
        let random_u64 = ArcisRNG::gen_integer_from_width(64);  // 0 to 2^64-1

        // Generate a uniformly random value of any supported type
        let random_array = ArcisRNG::gen_uniform::<[u8; 32]>();

        (coin_flip.reveal(), random_byte.reveal(), random_array.reveal())
    }
}
```

**Note:** The `width` parameter in `gen_integer_from_width` must be known at compile time.

### Public vs Secret Random Integers

```rust
// Secret random integer (default) - only revealed when you call .reveal()
let secret_num = ArcisRNG::gen_integer_from_width(64);

// Public random integer - visible to all ARX nodes during circuit execution
let public_num = ArcisRNG::gen_public_integer_from_width(64);
```

Use `gen_public_integer_from_width` when you need randomness that does not need to stay secret within the MPC computation—for example, nonce generation. The value is visible to ARX nodes during execution but is not automatically included in the circuit output; you still control what gets returned.

### Range-Based Generation

To generate integers within a specific range, use `gen_integer_in_range`:

```rust
#[instruction]
pub fn dice_roll() -> (u128, bool) {
    // Generate integer between min and max (both inclusive)
    // n_attempts controls the success probability
    let (roll, success) = ArcisRNG::gen_integer_in_range(1, 6, 24);

    // With 24 attempts, failure probability is below 2^-24
    (roll.reveal(), success.reveal())
}
```

The function uses rejection sampling. Each attempt has >50% success probability, so `n_attempts=24` gives a failure probability below 2^-24.

**Note:** The `n_attempts` parameter must be known at compile time.

### Shuffling

Shuffle arrays in-place with cryptographic uniformity:

```rust
#[instruction]
pub fn shuffle_deck(mut cards: [u8; 52]) -> [u8; 52] {
    ArcisRNG::shuffle(&mut cards);
    cards.reveal()
}
```

**Complexity:** O(n·log³(n) + n·log²(n)·sizeof(T))

### What Works and What Doesn't

```rust
// ✓ Works
let b: bool = ArcisRNG::bool();
let n: u128 = ArcisRNG::gen_integer_from_width(64);
let arr: [u8; 32] = ArcisRNG::gen_uniform::<[u8; 32]>();

// ✗ Doesn't work - type must be explicit
let b = ArcisRNG::gen_uniform();  // Error: type inference not supported

// ✗ Doesn't work - floats cannot be generated uniformly
let f: f64 = ArcisRNG::gen_uniform::<f64>();  // Error
```

## Cryptographic Operations

### SHA3 Hashing

Arcis provides SHA3-256 and SHA3-512 hash functions:

```rust
#[instruction]
pub fn hash_message(message: [u8; 64]) -> [u8; 32] {
    let hasher = SHA3_256::new();
    hasher.digest(&message).reveal()
}

#[instruction]
pub fn hash_512(message: [u8; 128]) -> [u8; 64] {
    let hasher = SHA3_512::new();
    hasher.digest(&message).reveal()
}
```

**Note:** Arcis uses SHA3 (Keccak) rather than SHA-2/SHA-512 because SHA3 has a more efficient circuit structure for MPC evaluation.

### Ed25519 Signatures

Arcis provides Ed25519 signature operations using SHA3-512 internally (ArcisEd25519).

#### Signature Verification

```rust
#[instruction]
pub fn verify_signature(
    verifying_key: Pack<VerifyingKey>,  // Public key from client
    message: [u8; 32],
    signature: [u8; 64],
) -> bool {
    let vk = verifying_key.unpack();
    let sig = ArcisEd25519Signature::from_bytes(signature);
    vk.verify(&message, &sig).reveal()
}
```

#### Key Generation

```rust
#[instruction]
pub fn generate_keypair() -> VerifyingKey {
    // Generate a random secret key (stays secret within MPC)
    let secret_key = SecretKey::new_rand();

    // Derive and return only the verifying (public) key
    let verifying_key = VerifyingKey::from_secret_key(&secret_key);
    verifying_key.reveal()
}
```

**Note:** Only the public verifying key is revealed. The secret key is never revealed in plaintext; it exists only as secret shares distributed across ARX nodes. Arcium uses **full-threshold security**—all ARX nodes in the cluster would need to collude to reconstruct the secret. As long as even one node remains honest, the secret stays protected.

#### MXE Cluster Signing

Sign messages using the MXE cluster's collective key:

```rust
#[instruction]
pub fn cluster_sign(message: [u8; 32]) -> ArcisEd25519Signature {
    MXESigningKey::sign(&message).reveal()
}
```

### Public Key Operations

Work with X25519 public keys:

```rust
#[instruction]
pub fn compare_keys(key1: [u8; 32], key2: [u8; 32]) -> bool {
    let pk1 = ArcisX25519Pubkey::from_uint8(&key1);
    let pk2 = ArcisX25519Pubkey::from_uint8(&key2);
    (pk1 == pk2).reveal()
}

#[instruction]
pub fn key_from_base58() -> ArcisX25519Pubkey {
    // Create public key from base58-encoded string
    // Note: b"..." creates a byte string literal
    ArcisX25519Pubkey::from_base58(b"2uKu51kQaLseu7FySMAGWU6hpnjNvgGr3PkvUCBVTTPD")
}
```

#### Advanced: Coordinate Extraction

For advanced use, work with the Montgomery X coordinate directly:

```rust
#[instruction]
pub fn extract_coordinate(pubkey: ArcisX25519Pubkey) -> BaseField {
    pubkey.to_x()  // Extract Montgomery X-coordinate
}

#[instruction]
pub fn rebuild_from_coordinate(x: BaseField) -> ArcisX25519Pubkey {
    ArcisX25519Pubkey::new_from_x(x)  // Rebuild from X-coordinate
}
```

Coordinate extraction is for advanced cryptographic operations such as:

* **Custom ECDH key exchange** implementations
* **Key derivation** from shared secrets
* **Interoperability** with external systems that work with raw Curve25519 coordinates
* **Zero-knowledge proof** inputs that require field elements

Most applications should use `from_base58()` or `from_uint8()` for standard public key handling.

**Warning:** Revealing cryptographic keys or signatures makes them public to all ARX nodes. Only reveal data that is intended to be public output. For internal computations, keep values in secret-shared form.

## Data Packing

The `Pack<T>` type provides bit-level compression for onchain storage efficiency.

### Why Packing Matters

In Arcis, all values are stored as field elements (~255 bits / 32 bytes each). Without packing:

* A single `u8` (8 bits) uses one full field element
* `[u8; 256]` uses 256 field elements

With packing, multiple small values are combined into fewer field elements:

**The math:**

* `[u8; 256]` = 256 bytes total
* Each field element packs ~26 bytes (208 usable bits)
* Packed: ⌈256 / 26⌉ = **10 field elements**
* Compression: 256 → 10 = **~26x fewer field elements**

Without packing, each `u8` would use a full field element (256 elements total). This significantly reduces onchain storage costs and transaction sizes.

### When to Use Pack

* Large arrays of small integers (`[u8; N]`, `[u16; N]`)
* Data that needs to be stored onchain
* Input/output parameters approaching transaction size limits

### Basic Usage

```rust
// Pack data for efficient storage
let packed: Pack<[u8; 64]> = Pack::new(data);

// Unpack to use the data
let data: [u8; 64] = packed.unpack();
```

**Tip:** Packing/unpacking has compute cost. Use `Pack<T>` when storage savings outweigh the computation overhead—typically for arrays of 32+ small integers.

### Simple Example

```rust
#[instruction]
pub fn pack_data(data: [u8; 64]) -> Pack<[u8; 64]> {
    Pack::new(data)  // Compress 64 bytes into ~3 field elements
}

#[instruction]
pub fn unpack_data(packed: Pack<[u8; 64]>) -> [u8; 64] {
    packed.unpack()  // Restore original array
}

#[instruction]
pub fn process_packed(packed: Pack<[u8; 64]>) -> u8 {
    let data = packed.unpack();
    let mut max = data[0];
    for i in 1..64 {
        if data[i] > max {
            max = data[i];
        }
    }
    max.reveal()
}
```

These basic patterns cover most `Pack<T>` use cases. The "Practical Example" below shows advanced usage with encrypted types.

### Practical Example

```rust
const ARRAY_SIZE: usize = 64;

#[instruction]
pub fn merge_and_sort(
    player_min: Enc<Shared, Pack<[u8; ARRAY_SIZE]>>,
    player_max: Enc<Shared, Pack<[u8; ARRAY_SIZE]>>,
) -> (Enc<Shared, Pack<[u8; ARRAY_SIZE]>>, Enc<Shared, Pack<[u8; ARRAY_SIZE]>>) {
    // Unpack the encrypted data
    let mut min_array = player_min.to_arcis().unpack();
    let mut max_array = player_max.to_arcis().unpack();

    // Combine, sort, and split
    let mut full = [0u8; 2 * ARRAY_SIZE];
    full[..ARRAY_SIZE].copy_from_slice(&min_array);
    full[ARRAY_SIZE..].copy_from_slice(&max_array);
    full.sort();

    min_array.copy_from_slice(&full[..ARRAY_SIZE]);
    max_array.copy_from_slice(&full[ARRAY_SIZE..]);

    // Re-pack for output
    (
        player_min.owner.from_arcis(Pack::new(min_array)),
        player_max.owner.from_arcis(Pack::new(max_array))
    )
}
```

### Pack with Crypto Types

Cryptographic types like `VerifyingKey` are often passed as `Pack<VerifyingKey>`:

```rust
#[instruction]
pub fn verify_with_packed_key(
    key: Pack<VerifyingKey>,  // Efficiently packed public key
    message: [u8; 32],
    signature: [u8; 64],
) -> bool {
    let vk = key.unpack();
    let sig = ArcisEd25519Signature::from_bytes(signature);
    vk.verify(&message, &sig).reveal()
}
```

## Machine Learning

Arcis includes basic ML primitives for privacy-preserving inference.

### Logistic Regression

```rust
#[instruction]
pub fn predict_class(
    features: Enc<Shared, [f64; 8]>,
    coefficients: Enc<Shared, [f64; 8]>,
    intercept: Enc<Shared, f64>,
) -> Enc<Shared, bool> {
    let x = features.to_arcis();
    let coef = coefficients.to_arcis();
    let bias = intercept.to_arcis();

    let model = LogisticRegression::new(&coef, bias);
    let prediction = model.predict(&x, 0.5);  // threshold = 0.5

    features.owner.from_arcis(prediction)
}
```

### Linear Regression

```rust
#[instruction]
pub fn predict_value(
    features: Enc<Shared, [f64; 4]>,
    coefficients: [f64; 4],  // Plaintext model weights
    intercept: f64,
) -> Enc<Shared, f64> {
    let x = features.to_arcis();
    let model = LinearRegression::new(&coefficients, intercept);
    let prediction = model.predict(&x);
    features.owner.from_arcis(prediction)
}
```

### Available ML Functions

| Function                                    | Description                      |
| ------------------------------------------- | -------------------------------- |
| `LogisticRegression::new(coef, intercept)`  | Create logistic regression model |
| `LogisticRegression::predict(x, threshold)` | Binary classification            |
| `LogisticRegression::predict_proba(x)`      | Probability output               |
| `LinearRegression::new(coef, intercept)`    | Create linear regression model   |
| `LinearRegression::predict(x)`              | Continuous prediction            |
| `ArcisMath::sigmoid(x)`                     | Sigmoid activation function      |
| `logit(p)`                                  | Inverse of sigmoid               |
| `expit(x)`                                  | Alias for sigmoid                |

**Note:** ML models support up to 100 features (`MAX_FEATURES = 100`). For larger models, consider feature selection or dimensionality reduction.

## Summary

| Primitive            | Use Case               | Key Methods                                                                                                                     |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ArcisRNG`           | Random values          | `bool()`, `gen_integer_from_width()`, `gen_public_integer_from_width()`, `gen_integer_in_range()`, `gen_uniform()`, `shuffle()` |
| `SHA3_256/512`       | Hashing                | `new()`, `digest()`                                                                                                             |
| `SecretKey`          | Ed25519 keys           | `new_rand()`, `from_bytes()`                                                                                                    |
| `VerifyingKey`       | Signature verification | `from_secret_key()`, `verify()`                                                                                                 |
| `MXESigningKey`      | Cluster signing        | `sign()`                                                                                                                        |
| `ArcisX25519Pubkey`  | Public keys            | `from_base58()`, `from_uint8()`, `to_x()`, `new_from_x()`                                                                       |
| `Pack<T>`            | Efficient storage      | `new()`, `unpack()`                                                                                                             |
| `LogisticRegression` | Binary classification  | `new()`, `predict()`, `predict_proba()`                                                                                         |
| `LinearRegression`   | Regression             | `new()`, `predict()`                                                                                                            |
| `ArcisMath`          | Math functions         | `sigmoid()`                                                                                                                     |

## What's Next?

| Resource | Description |
|----------|-------------|
| [Best Practices](best-practices.md) | Performance optimization, debugging, and testing strategies |
| [Quick Reference](quick-reference.md) | Concise syntax lookup for all Arcis patterns |
| [Operations](operations.md) | Full function and method reference |

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
