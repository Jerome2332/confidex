# Encrypting Inputs

Let's say we have the following confidential instruction that adds 2 encrypted `u8`s and returns the result encrypted:

```rust
use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct InputValues {
        v1: u8,
        v2: u8,
    }

    #[instruction]
    pub fn add_together(input_ctxt: Enc<Shared, InputValues>) -> Enc<Shared, u16> {
        let input = input_ctxt.to_arcis();
        let sum = input.v1 as u16 + input.v2 as u16;
        input_ctxt.owner.from_arcis(sum)
    }
}
```

We want to input the values `x = 42` and `y = 101` into this instruction. To do this, we first have to build the parameters for the confidential instruction correctly:

```typescript
import { RescueCipher, getArciumEnv, x25519 } from "@arcium-hq/client";
import { randomBytes } from "crypto";

// Our confidential instruction takes two encrypted `u8` values as input, so we need to provide two ciphertext values which are represented as `[u8; 32]` in our Solana program.
const val1 = BigInt(42);
const val2 = BigInt(101);
const plaintext = [val1, val2];
```

Now that we have the inputs, we need to encrypt them. This is done using the `RescueCipher` class with some info about the MPC cluster we want to use:

```typescript
// Fetch the MXE x25519 public key
// getMXEPublicKeyWithRetry is a helper that wraps getMXEPublicKey with retries
// See the Hello World tutorial for the full implementation
const mxePublicKey = await getMXEPublicKeyWithRetry(
  provider as anchor.AnchorProvider,
  program.programId
);
// Generate a random private key for x25519 elliptic curve Diffie-Hellman key exchange.
const privateKey = x25519.utils.randomSecretKey();
// Derive the public key from the private key.
const publicKey = x25519.getPublicKey(privateKey);
// Generate a random nonce for the encryption.
const nonce = randomBytes(16);
// Get the shared secret with the cluster.
const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
// Initialize the cipher with the shared secret.
const cipher = new RescueCipher(sharedSecret);
// Encrypt the plaintext, and serialize it to a `[u8; 32]` array.
const ciphertext = cipher.encrypt(plaintext, nonce);
```

To decrypt the data, again it follows a similar pattern:

```typescript
// Initialize the cipher with the shared secret.
const cipher = new RescueCipher(sharedSecret);
const plaintext = cipher.decrypt(ciphertext, nonce);
```

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
