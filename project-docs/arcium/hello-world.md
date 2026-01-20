# Hello World with Arcium

## Hello World

The Arcium tooling suite for writing MXEs (MPC eXecution Environments) is built on top of [Anchor](https://www.anchor-lang.com/), so if you're familiar with Anchor, you should find Arcium to be a familiar experience, except that you're using the `arcium` CLI instead of `anchor`.

To initialize a new MXE project, you can therefore simply run:

```bash
arcium init <project-name>
```

This will create a new project with the given name and initialize it with a basic structure. The structure is the same as in an Anchor project with two differences, so it is not repeated here (for an explanation of the Anchor project structure, see the [Anchor documentation](https://www.anchor-lang.com/docs/quickstart/local)). The two differences are:

* The `Arcium.toml` file, which contains the configuration for the Arcium tooling suite.
* The `encrypted-ixs` directory. This is where we write all our code that is meant to operate on encrypted data and therefore runs in MPC. This code is written using our own Rust framework called [Arcis](arcis/README.md). This will already be populated with a simple example called `add_together.rs`. Let's take a closer look at it.

### Our first encrypted instruction

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

Let's go through it line by line. `use arcis::*;` imports all the necessary types and functions for writing encrypted instructions with Arcis. The `#[encrypted]` attribute marks a module that contains encrypted instructions. Inside this module, we define a struct `InputValues` that contains the two values we want to encrypt and pass to the encrypted instruction.

The `#[instruction]` macro marks the function as an entry point for MPC execution. While you can write helper functions without this attribute, only functions marked with `#[instruction]` will be compiled into individual circuits that can be called onchain.

The function `add_together` takes an encrypted input parameter of type `Enc<Shared, InputValues>`. Let's break this down:

* `Enc<Owner, Data>` is Arcium's encrypted data type
* `Shared` means the data is encrypted with a shared secret between the client and MXE (both can decrypt it)
* `InputValues` is the actual data structure being encrypted (our struct with v1 and v2)
* The alternative to `Shared` is `Mxe`, where only the MXE can decrypt the data

Inside the function:

1. `input_ctxt.to_arcis()` converts the input into a form we can operate on within the MPC environment.
2. We perform the addition operation, casting the u8 values to u16 to prevent overflow.
3. `input_ctxt.owner.from_arcis(sum)` converts the encrypted sum into an encrypted format that can be stored onchain, while maintaining encryption with the shared secret between the client and the MXE.

### Calling it from Solana

Now that we've written our first confidential instruction, let's see how we can use it from within a Solana program. Our default project already contains a Solana program in the `programs/` directory. Let's take a closer look at it too:

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// This constant identifies our encrypted instruction for onchain operations
// comp_def_offset() generates a unique identifier from the function name
const COMP_DEF_OFFSET_ADD_TOGETHER: u32 = comp_def_offset("add_together");

declare_id!("YOUR_PROGRAM_ID_HERE");

#[arcium_program]
pub mod hello_world {
    use super::*;

    pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn add_together(
        ctx: Context<AddTogether>,
        computation_offset: u64,
        ciphertext_0: [u8; 32],
        ciphertext_1: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u8(ciphertext_0)
            .encrypted_u8(ciphertext_1)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![AddTogetherCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[]
            )?],
            1,
            0,  // cu_price_micro: priority fee in microlamports
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "add_together")]
    pub fn add_together_callback(
        ctx: Context<AddTogetherCallback>,
        output: SignedComputationOutputs<AddTogetherOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account
        ) {
            Ok(AddTogetherOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Error: {}", e);
                return Err(ErrorCode::AbortedComputation.into())
            },
        };

        emit!(SumEvent {
            sum: o.ciphertexts[0],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }
}
```

For brevity, the `InitAddTogetherCompDef`, `AddTogether`, and `AddTogetherCallback` account structs are not included here, but they are automatically generated when you run `arcium init`. Here's a simplified version of what `AddTogether` looks like:

```rust
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AddTogether<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    // ... other required Arcium accounts (see program/ section for full details)
}
```

You can read more about them and the invocation of confidential instructions inside Solana programs in the [program documentation](program/README.md).

The key things to note here are that every MXE program is identified by the `#[arcium_program]` macro (which replaces Anchor's `#[program]` macro) and that for every confidential instruction, we generally have three instructions in the Solana program:

* `init_add_together_comp_def`: This is the instruction that initializes the confidential instruction definition. It is used to set up the computation definition and is therefore only called once prior to the first invocation of the confidential instruction. More info on this can be found in [computation-def-accs.md](program/computation-def-accs.md).
* `add_together`: This is the instruction that invokes the confidential instruction. It takes in the arguments for the confidential instruction and queues it for execution using the Arcium program. More info on this can be found in the [program documentation](program/README.md).
* `add_together_callback`: This is the instruction that is called by the MPC cluster when the confidential instruction has finished executing which returns our result. More info on this can be found in the [program documentation](program/README.md).

This is due to the general flow of computations throughout Arcium, which you can read more about in [computation-lifecycle.md](computation-lifecycle.md).

## Building and testing

Similar to Anchor, the confidential instructions and Solana programs can be built using `arcium build`. Testing is done using the `@arcium-hq/client` TypeScript library (more information can be found in the [JS client library documentation](js-client-library/README.md)) by default and can be run using `arcium test` (make sure you have installed the npm dependencies prior by running `yarn` or `npm install` in your project directory). By default, this runs against a local cluster. To test against devnet or mainnet, use `arcium test --cluster devnet` (requires cluster configuration in `Arcium.toml` - see the [migration guide](migration/migration-v0.5-to-v0.6.md#6-optional-configure-arciumtoml-for-non-localnet-testing)).

Let's take a quick look at the default test file. Note that some helper functions and imports are excluded for brevity, but you can find the complete examples in your generated project:

```typescript
describe("Hello World", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.HelloWorld as Program<HelloWorld>;
  const provider = anchor.getProvider();

  const arciumEnv = getArciumEnv();

  it("Is initialized!", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Initializing add together computation definition");
    const initATSig = await initAddTogetherCompDef(program, owner, false);
    console.log(
      "Add together computation definition initialized with signature",
      initATSig
    );

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    console.log("MXE x25519 pubkey is", mxePublicKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const val1 = BigInt(1);
    const val2 = BigInt(2);
    const plaintext = [val1, val2];

    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const sumEventPromise = awaitEvent("sumEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueSig = await program.methods
      .addTogether(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("add_together")).readUInt32LE()
        ),
      })
      .rpc({ commitment: "confirmed" });
    console.log("Queue sig is ", queueSig);

    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Finalize sig is ", finalizeSig);

    const sumEvent = await sumEventPromise;
    const decrypted = cipher.decrypt([sumEvent.sum], sumEvent.nonce)[0];
    expect(decrypted).to.equal(val1 + val2);
  });
});
```

This test demonstrates the complete flow of encrypted computations in Arcium. Here's what each key step does:

* `initAddTogetherCompDef`: Call the `init_add_together_comp_def` instruction to initialize the confidential instruction definition. (only need to be called once after the program is deployed)
* `getMXEPublicKeyWithRetry`: Fetch the MXE's x25519 public key.
* `x25519.utils.randomSecretKey`: Generate a random private key for the x25519 key exchange.
* `x25519.getPublicKey`: Generate the public key corresponding to the private key we generated above.
* `x25519.getSharedSecret`: Generate the shared secret with the MXE cluster using a x25519 key exchange.
* `cipher = new RescueCipher(sharedSecret)`: Initialize the Rescue cipher (the constructor internally performs a key derivation based on the Rescue-Prime hash function, you can learn more in [encryption.md](js-client-library/encryption.md))
* `cipher.encrypt`: Encrypt the inputs for the confidential instruction.
* `awaitEvent`: Wait for the `sumEvent` event to be emitted by the program on finalization of the computation (in the callback instruction).
* `addTogether`: Call the `add_together` instruction to invoke the confidential instruction.
* `awaitComputationFinalization`: Since waiting for an Arcium computation is not the same as waiting for one Solana transaction (because the MPC cluster must finish the computation and invoke the callback), this function is used, which is provided by the Arcium TypeScript library.

## Ready to Deploy?

Now that you have built and tested your MXE locally, you are probably eager to see it running on devnet! Head over to our [deployment guide](deployment.md) where we'll walk you through getting your MXE live on Solana devnet. We'll cover everything from choosing the right RPC endpoint to initializing your computation definitions.

## What's Next?

Now that you have built your first MXE, you are ready to deploy it to testnet. Follow the [deployment guide](deployment.md) to get your MXE running on Solana devnet and test with real encrypted computations.

### Learn Arcis

To build more complex circuits, learn the Arcis framework:

* **[Thinking in MPC](arcis/mental-model.md)** — Understand why Arcis has constraints like fixed loops and both-branches-execute
* **[Quick Reference](arcis/quick-reference.md)** — Syntax cheatsheet for when you're coding

### Build Your Application

From there, you can build more sophisticated applications by learning about [input/output patterns](arcis/input-output.md) for working with encrypted data, [callback accounts](program/callback-accs.md) for persistent state, and [JavaScript client integration](js-client-library/encryption.md) for frontend development.

For inspiration, browse our [examples repo](https://github.com/arcium-hq/examples/) to see voting systems, games, and DeFi applications built with Arcium. If you need help, join our [Discord community](https://discord.gg/arcium) where other builders share tips and get support.

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
